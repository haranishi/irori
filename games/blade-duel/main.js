// @ts-check
import { connect } from './irori.js';
import { createGame, publicView, updateGame } from './logic.js';
import { createView } from './view.js';
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
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  const initial = createGame({ players: irori.players, leader: irori.leader,
    environment: irori.environment, paused: irori.paused, nonce });
  /** @type {GameState|null} */
  let state = initial.state;
  let disposed = false;
  let ended = false;
  /** @type {(()=>void)[]} */
  const subscriptions = [];
  function dispose() {
    if (disposed) return;
    disposed = true;
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
      if (effect.t === 'pad') irori.setPad(effect.spec, effect.to);
      else if (!ended) {
        ended = true;
        dispose();
        irori.end(effect.results, effect.options);
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
  }
  subscriptions.push(
    irori.on('input', (p, input) => dispatch({ t: 'input', p, input })),
    irori.on('players', (players, leader) => dispatch({ t: 'players', players, leader })),
    irori.on('pause', () => dispatch({ t: 'menu', paused: true })),
    irori.on('resume', () => dispatch({ t: 'menu', paused: false })),
    irori.on('environment', (value) => dispatch({ t: 'environment', value })),
  );
  addEventListener('pagehide', dispose, { once: true });
  view.render(publicView(state), looks);
  apply(initial.effects);
  irori.ready();
}

void boot().catch(() => {
  view.showMessage('つながりませんでした', 'ゲームを開き直してください');
  document.documentElement.dataset.phase = 'error';
});
