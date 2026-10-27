// @ts-check
import {connect} from './irori.js';
import {createGame, publicView, updateGame} from './logic.js';
import {createView} from './view.js';

const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const view = createView(stage, status);

async function boot() {
  const irori = await connect();
  if (['pad-tiles-v1', 'result-options-v1', 'host-environment-v1'].some((cap)=>!irori.capabilities.includes(/** @type {import('./irori.js').HostCapability} */ (cap)))) {
    view.showMessage('更新が必要です', 'iroriを更新して、ゲームを開き直してください。', 'unsupported');
    irori.setPad({k:'wait', title:'更新が必要です'});
    irori.ready();
    return;
  }
  const random = crypto.getRandomValues(new Uint32Array(2));
  const nonce = (random[0] ?? 0).toString(16).padStart(8, '0');
  const initial = createGame({players:irori.players, leader:irori.leader, environment:irori.environment, paused:irori.paused, nonce, seed:random[1] ?? 0});
  let state = initial.state;
  let disposed = false;
  let ended = false;
  let frame = 0;
  /** @type {number|null} */
  let last = null;
  /** @type {(()=>void)[]} */
  const subscriptions = [];

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    for (const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide', dispose);
    stage.removeEventListener('click', continueDay);
    view.dispose();
  }
  function render() {
    // Only the public projection enters view.js. Suspension controls CSS, never roles or picks.
    const suspended = String(state.blockers.length > 0 || state.resumeRequired);
    if (stage.dataset.suspended !== suspended) stage.dataset.suspended = suspended;
    view.render(publicView(state));
    const button = stage.querySelector('button');
    if (button) button.disabled = state.blockers.length > 0 || state.resumeRequired;
  }
  /** @param {readonly import('./logic.js').GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed) return;
      if (effect.t === 'pad') irori.setPad(effect.spec, effect.to);
      else if (effect.t === 'cue') irori.cue?.(/** @type {import('./irori.js').CueName} */ (effect.name), effect.v);
      else if (effect.t === 'vibrate') irori.vibrate(effect.ms, effect.to);
      else if (!ended) {
        ended = true;
        dispose();
        irori.end(effect.results, effect.options);
      }
    }
  }
  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if (disposed) return;
    if (event.t !== 'tick') last = null;
    const next = updateGame(state, event);
    if (next.state === state && !next.effects.length) return;
    state = next.state;
    render();
    apply(next.effects);
  }
  /** @param {MouseEvent} event */
  function continueDay(event) {
    if (!(event.target instanceof Element) || !event.target.closest('[data-action="day"]') || state.phase !== 'dawn' || state.leader === null) return;
    const t = `w${state.nonce}_${(state.epochs[state.leader] ?? 0).toString(36)}`;
    dispatch({t:'input', p:state.leader, input:{k:'tiles', ids:[], t}});
  }
  /** @param {number} now */
  function tick(now) {
    if (disposed) return;
    const running = !state.blockers.length && !state.resumeRequired;
    const elapsed = running && last !== null ? Math.max(0, now-last) : 0;
    last = running ? now : null;
    if (elapsed > 0) dispatch({t:'tick', ms:elapsed});
    if (!disposed) frame = requestAnimationFrame(tick);
  }
  try {
    subscriptions.push(
      irori.on('input', (p, input)=>dispatch({t:'input', p, input})),
      irori.on('players', (players, leader)=>dispatch({t:'players', players, leader})),
      irori.on('pause', ()=>dispatch({t:'menu', paused:true})),
      irori.on('resume', ()=>dispatch({t:'menu', paused:false})),
      irori.on('environment', (value)=>dispatch({t:'environment', value})),
    );
    stage.addEventListener('click', continueDay);
    addEventListener('pagehide', dispose, {once:true});
    render();
    apply(initial.effects);
    if (!disposed) frame = requestAnimationFrame(tick);
    irori.ready();
  } catch (error) {
    dispose();
    throw error;
  }
}

void boot().catch(()=>view.showMessage('つながりませんでした', 'ゲームを開き直してください。', 'error'));
