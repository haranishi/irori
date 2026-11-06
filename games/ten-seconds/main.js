// @ts-check
import { connect } from './irori.js';
import { createGame, publicView, updateGame, viewFor } from './logic.js';
import {fillSeats,CPU_LOOK} from './cpu.js';
import {createCpuDriver} from './cpu-driver.js';
import { createView } from './view.js';

/** @typedef {import('./logic.js').GameState} GameState */
/** @typedef {import('./logic.js').GameEvent} GameEvent */
/** @typedef {import('./logic.js').GameEffect} GameEffect */
/** @typedef {import('./irori.js').PlayerId} PlayerId */
/** @typedef {import('./irori.js').Look} Look */

const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const view = createView(stage, status);

async function boot() {
  const irori = await connect();
  if (!irori.capabilities.includes('result-options-v1') || !irori.capabilities.includes('host-environment-v1')) {
    view.showMessage('もう少しで遊べます', 'iroriを新しくして開き直してね');
    document.documentElement.dataset.phase = 'unsupported';
    irori.setPad({ k: 'wait', title: 'iroriを新しくして開き直してね' });
    irori.ready();
    addEventListener('pagehide', () => view.dispose(), { once: true });
    return;
  }

  /** 色と形だけを保持し、描画側へゲームの生の状態を渡さない。 */
  /** @type {Map<PlayerId, Look>} */
  const looks = new Map();
  for (const p of irori.players) looks.set(p.id, irori.look(p.id));
  const cpus=fillSeats(irori.players.length);
  const cpuIds=new Set(cpus.map(p=>p.id));
  const human=(/** @type {number} */ id)=>!cpuIds.has(id);
  for(const cpu of cpus) looks.set(cpu.id,CPU_LOOK);
  const seed=crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  const initial = createGame({
    players: [...irori.players,...cpus], leader: irori.leader, environment: irori.environment,
    paused: irori.paused, nonce, nowMs: performance.now(),
  });
  /** @type {GameState | null} */
  let state = initial.state;
  const cpu=createCpuDriver(cpus.map(p=>p.id),seed,(p)=>{
    if(!state) throw new Error('終了した局です');
    return viewFor(state,p);
  },(p,input)=>{if(input.k === 'btn') dispatch({t:'press',p,id:input.id,down:input.d === 1,nowMs:performance.now()});});
  /** @type {(() => void)[]} */
  const subscriptions = [];
  let raf = 0;
  let disposed = false;
  let endSent = false;

  function dispose() {
    if (disposed) return;
    disposed = true;cpu.cancel();
    cancelAnimationFrame(raf);
    raf = 0;
    for (const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide', dispose);
    state = null;
    looks.clear();
    view.dispose();
  }

  function queueFrame() {
    if (disposed || !state || (state.phase !== 'countdown' && state.phase !== 'counting')) {
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      // 入力も描画フレームも、このiframeの同じ単調時計で測る。
      dispatch({ t: 'frame', nowMs: performance.now() });
    });
  }

  /** @param {readonly GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed) return;
      if (effect.t === 'pad') {if(human(effect.to)) irori.setPad(effect.spec, effect.to);}
      else if (!endSent) {
        endSent = true;
        // SDKの結果操作へ渡す前に、遅れて届く入力と描画を解放する。
        dispose();
        irori.end(effect.results.filter(r=>human(r.p)), effect.options);
      }
    }
  }

  /** @param {GameEvent} event */
  function dispatch(event) {
    if (disposed || !state) return;
    const next = updateGame(state, event);
    // mockのpad差し替えで離し入力が同期して戻っても、更新後の状態で受ける。
    state = next.state;
    view.render(publicView(state), looks);
    apply(next.effects);
    if(!disposed) cpu.sync(performance.now());
    queueFrame();
  }

  subscriptions.push(
    irori.on('input', (p, input) => {
      if (input.k === 'btn') dispatch({ t: 'press', nowMs: performance.now(), p, id: input.id, down: input.d === 1 });
    }),
    irori.on('players', (players, leader) => {
      for (const p of players) if (!looks.has(p.id)) looks.set(p.id, irori.look(p.id));
      dispatch({ t: 'players', nowMs: performance.now(), players:[...players,...cpus], leader });
    }),
    irori.on('pause', () => dispatch({ t: 'menu', nowMs: performance.now(), paused: true })),
    irori.on('resume', () => dispatch({ t: 'menu', nowMs: performance.now(), paused: false })),
    irori.on('environment', (value) => dispatch({ t: 'environment', nowMs: performance.now(), value })),
  );
  addEventListener('pagehide', dispose, { once: true });
  view.render(publicView(state), looks);
  apply(initial.effects);
  irori.ready();
  queueFrame();
}

void boot().catch(() => {
  view.showMessage('つながりませんでした', 'ゲームを開き直してください');
  document.documentElement.dataset.phase = 'error';
});
