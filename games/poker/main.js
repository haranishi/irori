// @ts-check
import { connect } from './irori.js';
import { createGame, updateGame, publicView, viewFor } from './logic.js';
import { fillSeats } from './cpu.js';
import { createCpuDriver } from './cpu-driver.js';
import { createView } from './view.js';
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const availability = /** @type {HTMLElement} */ (document.getElementById('availability'));
const view = createView(stage, status);
const demo = new URLSearchParams(location.search).get('demo') === '1';
/** @type {(()=>void)|undefined} */
let cleanup;
async function boot() {
  const irori = await connect();
  if (demo && irori.mode === 'mock')
    document.documentElement.dataset.demo = 'true';
  if (( /** @type {const} */(['pad-tiles-v1', 'result-options-v1', 'host-environment-v1'])).some((c) => !irori.capabilities.includes(c))) {
    view.showMessage('更新が必要です', 'iroriを新しくして、ゲームを開き直してください。');
    for (const p of irori.players)
      irori.setPad({ k: 'wait', title: '更新が必要です' }, p.id);
    irori.ready();
    return;
  }
  let humans = demo ? [] : irori.players;
  let paused = irori.paused, environment = irori.environment;
  let seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  const cpus = fillSeats(humans.length);
  const first = () => createGame({ players: [...humans, ...cpus], leader: demo ? 'cpu1' : irori.leader, seed, nonce: nonce(), environment, paused });
  let initial = first(), state = initial.state, disposed = false, ended = false;
  let cpu = createCpuDriver(cpus.map(p => p.id), seed, p => viewFor(state, p), (p, input) => dispatch({ t: 'input', p, input }));
  /** @type {(()=>void)[]} */
  const subscriptions = [];
  const looks = new Map(humans.map((p) => [p.id, irori.look(p.id)]));
  let last = performance.now();
  const blocked = () => paused || !environment?.connected || !environment.visible;
  function cancelCpu() {
    cpu.cancel();
  }
  function reflect() {
    availability.hidden = !blocked();
    availability.textContent = paused ? '一時停止中 · メニューを閉じると続けられます' : !environment?.connected ? '大画面の接続を待っています' : '大画面に戻るのを待っています';
    view.hold(blocked());
  }
  function schedule() {
    if (disposed || ended || blocked()) {
      cancelCpu();
      return;
    }
    cpu.sync();
  }
  /** @param {readonly import('./logic.js').GameEffect[]} effects */
  function apply(effects) {
    for (const e of effects) {
      if (e.t === 'pad' && typeof e.to === 'number')
        irori.setPad(e.spec, e.to);
      else if (e.t === 'cue')
        irori.cue(e.name);
      else if (e.t === 'end' && !ended) {
        ended = true;
        cancelCpu();
        if (demo) {
          seed = (seed + 1) >>> 0;
          initial = first();
          state = initial.state;
          ended = false;
          cpu = createCpuDriver(cpus.map(p => p.id), seed, p => viewFor(state, p), (p, input) => dispatch({ t: 'input', p, input }));
          view.render(publicView(state), looks);
          apply(initial.effects);
          schedule();
        }
        else
          irori.end(e.results, e.options);
      }
    }
  }
  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if (disposed || ended)
      return;
    const next = updateGame(state, event);
    state = next.state;
    view.render(publicView(state), looks);
    apply(next.effects);
    schedule();
  }
  const clock = setInterval(() => {
    const now = performance.now(), ms = now - last;
    last = now;
    if (!blocked())
      dispatch({ t: 'tick', ms });
  }, 100);
  function dispose() {
    if (disposed)
      return;
    disposed = true;
    clearInterval(clock);
    cancelCpu();
    for (const off of subscriptions)
      off();
    view.dispose();
    removeEventListener('pagehide', dispose);
  }
  cleanup = dispose;
  subscriptions.push(irori.on('input', (p, input) => {
    if (!demo)
      dispatch({ t: 'input', p, input });
  }), irori.on('players', (players, leader) => {
    if (demo)
      return;
    humans = players;
    for (const p of players)
      looks.set(p.id, irori.look(p.id));
    dispatch({ t: 'players', players: [...players, ...cpus], leader });
  }), irori.on('pause', () => {
    paused = true;
    last = performance.now();
    cancelCpu();
    dispatch({ t: 'menu', paused: true });
    reflect();
  }), irori.on('resume', () => {
    paused = false;
    last = performance.now();
    dispatch({ t: 'menu', paused: false });
    reflect();
  }), irori.on('environment', (value) => {
    environment = value;
    last = performance.now();
    cancelCpu();
    dispatch({ t: 'environment', value });
    reflect();
  }));
  addEventListener('pagehide', dispose, { once: true });
  reflect();
  view.render(publicView(state), looks);
  apply(initial.effects);
  schedule();
  irori.ready();
}
void boot().catch(() => {
  cleanup?.();
  availability.hidden = true;
  view.showMessage('つながりませんでした', 'ゲームを開き直してください。');
  document.documentElement.dataset.phase = 'error';
});
