// @ts-check
import {connect} from './irori.js';
import {createGame, publicView, updateGame} from './logic.js';
import {createView} from './view.js';

/**
 * 終わりの見せ場（全員の役と勝った側）を出してから、結果画面へ渡すまでの時間。
 * end を呼ぶとコンソールは枠を閉じ、スマホの画面を結果のリモコンに差し替える。直後に呼ぶと、大画面の役の表も、
 * 直前に送った全役の画面（end と同じ瞬間に送ったもの）も、スマホに届く前に置き換わってしまう（実ホストで確認）。
 */
export const FINALE_MS = 8000;

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
  // 大画面のボタンは仮想プレイヤーで試すときだけ出す。本物のホストでは枠がポインタを受けない。
  const assist = irori.mode === 'mock';
  let state = initial.state;
  let disposed = false;
  let frame = 0;
  /** @type {number|null} */
  let last = null;
  /** 終わりの見せ場の残り。null の間はまだ終わっていない。 @type {{left:number, send:()=>void}|null} */
  let finale = null;
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
    const suspended = String(!finale && (state.blockers.length > 0 || state.resumeRequired));
    if (stage.dataset.suspended !== suspended) stage.dataset.suspended = suspended;
    view.render(publicView(state), {assist});
    const button = stage.querySelector('button');
    if (button) button.disabled = state.blockers.length > 0 || state.resumeRequired;
  }
  /** 見せ場の時計は、一時停止・接続切れ・非表示の間は進めない（大画面を見られないため）。 */
  function watching() {
    const env = irori.environment;
    return !irori.paused && env?.connected !== false && env?.visible !== false;
  }
  /** @param {readonly import('./logic.js').GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed) return;
      if (effect.t === 'pad') irori.setPad(effect.spec, effect.to);
      else if (effect.t === 'cue') irori.cue?.(/** @type {import('./irori.js').CueName} */ (effect.name), effect.v);
      else if (effect.t === 'vibrate') irori.vibrate(effect.ms, effect.to);
      else if (!finale) {
        // end は1回だけ。全役の画面がスマホへ届き、大画面の役の表を見る間を置いてから送る。
        const {results, options} = effect;
        // 役がまだ配られていない終わり（はじめる前に全員が席を立った）は、見せる役の表がないので置かない。
        finale = {left:state.seats.some((s)=>s.role) ? FINALE_MS : 0, send:()=>{dispose(); irori.end(results, options);}};
        last = null;
        render();
      }
    }
  }
  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if (disposed) return;
    if (event.t !== 'tick') last = null;
    if (finale) return;
    const next = updateGame(state, event);
    if (next.state === state && !next.effects.length) return;
    state = next.state;
    render();
    apply(next.effects);
  }
  /** @param {MouseEvent} event */
  function continueDay(event) {
    if (!(event.target instanceof Element) || !event.target.closest('[data-action="day"]') || (state.phase !== 'dawn' && state.phase !== 'exec') || state.leader === null) return;
    const t = `w${state.nonce}_${(state.epochs[state.leader] ?? 0).toString(36)}`;
    dispatch({t:'input', p:state.leader, input:{k:'tiles', ids:[], t}});
  }
  /** @param {number} now */
  function tick(now) {
    if (disposed) return;
    if (finale) {
      const running = watching();
      // 背景のタブから戻った1コマで、見せ場を飛ばさないよう1秒までに抑える。
      const elapsed = running && last !== null ? Math.min(1000, Math.max(0, now-last)) : 0;
      last = running ? now : null;
      finale.left -= elapsed;
      if (finale.left <= 0) {finale.send(); return;}
    } else {
      const running = !state.blockers.length && !state.resumeRequired;
      const elapsed = running && last !== null ? Math.max(0, now-last) : 0;
      last = running ? now : null;
      if (elapsed > 0) dispatch({t:'tick', ms:elapsed});
    }
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
