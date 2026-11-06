// @ts-check
import {consoleResults} from './logic.js';
import { connect } from './irori.js';
import { createGame, publicView, updateGame, viewFor } from './logic.js';
import { createView } from './view.js';
import {fillSeats,CPU_LOOK} from './cpu.js';
import {createCpuDriver} from './cpu-driver.js';
/** @typedef {import('./logic.js').GameState} GameState */
/** @typedef {import('./logic.js').GameEvent} GameEvent */
/** @typedef {import('./logic.js').GameEffect} GameEffect */
/** @typedef {import('./irori.js').Look} Look */
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const view = createView(stage, status);

async function boot() {
  const irori = await connect({ mockPlayers: 2 });
  if (!irori.capabilities.includes('result-options-v1') || !irori.capabilities.includes('host-environment-v1')) {
    view.showMessage('もう少しで遊べます', 'iroriを新しくして開き直してね');
    document.documentElement.dataset.phase = 'unsupported';
    irori.setPad({ k: 'wait', title: 'iroriを新しくして開き直してね' });
    irori.ready();
    return;
  }
  /** @type {Map<number,Look>} */
  const looks = new Map(irori.players.map((p) => [p.id, irori.look(p.id)]));
  const cpus=fillSeats(irori.players.length);
  const cpuIds=new Set(cpus.map(p=>p.id));
  const human=(/** @type {number} */ id)=>!cpuIds.has(id);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  const initial = createGame({ players: [...irori.players,...cpus], leader: irori.leader,
    environment: irori.environment, paused: irori.paused, nonce });
  /** @type {GameState|null} */
  let state = initial.state;
  const cpu=createCpuDriver(cpus.map(p=>p.id),parseInt(nonce,16),
    p=>viewFor(/** @type {GameState} */ (state),p),(p,input)=>dispatch({t:'input',p,input}));
  for(const p of cpus) looks.set(p.id,CPU_LOOK);
  let disposed = false;
  let ended = false;
  /** @type {(()=>void)[]} */
  const subscriptions = [];
  function dispose() {
    if (disposed) return;
    disposed = true;
    cpu.cancel();
    for (const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide', dispose);
    state = null;
    looks.clear();
    view.dispose();
  }
  /** @param {readonly GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed) return;
      if (effect.t === 'pad') {if(human(effect.to)) irori.setPad(effect.spec, effect.to);}
      else if (!ended) {
        ended = true;
        dispose();
        irori.end(consoleResults(effect.results,cpuIds), effect.options);
      }
    }
  }
  /** @param {GameEvent} event */
  function dispatch(event) {
    if (disposed || !state) return;
    const next = updateGame(state, event);
    state = next.state;
    view.render(publicView(state), looks);
    apply(next.effects);
    if(!disposed) cpu.sync();
  }
  subscriptions.push(
    irori.on('input', (p, input) => dispatch({ t: 'input', p, input })),
    irori.on('players', (players, leader) => dispatch({ t: 'players', players:[...players,...cpus], leader })),
    irori.on('pause', () => dispatch({ t: 'menu', paused: true })),
    irori.on('resume', () => dispatch({ t: 'menu', paused: false })),
    irori.on('environment', (value) => dispatch({ t: 'environment', value })),
  );
  addEventListener('pagehide', dispose, { once: true });
  view.render(publicView(state), looks);
  apply(initial.effects);
  cpu.sync();
  irori.ready();
}

void boot().catch(() => {
  view.showMessage('つながりませんでした', 'ゲームを開き直してください');
  document.documentElement.dataset.phase = 'error';
});
