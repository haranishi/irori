// @ts-check
import {connect} from './irori.js';
import {createGame,publicView,updateGame} from './logic.js';
import {createView} from './view.js';

const stage=/** @type {HTMLElement} */ (document.getElementById('stage'));
const status=/** @type {HTMLElement} */ (document.getElementById('status'));
const availability=/** @type {HTMLElement} */ (document.getElementById('availability'));
const view=createView(stage,status);
/** @type {(()=>void)|undefined} */
let cleanup;

async function boot() {
  const irori=await connect();
  const required=/** @type {const} */ (['pad-tiles-v1','result-options-v1','host-environment-v1']);
  if (required.some((capability)=>!irori.capabilities.includes(capability))) {
    view.showMessage('更新が必要です','iroriを新しくして、ゲームを開き直してください。');
    document.documentElement.dataset.phase='unsupported';
    irori.setPad({k:'wait',title:'更新が必要です'});
    irori.ready();
    return;
  }
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(4)),(n)=>n.toString(16).padStart(2,'0')).join('');
  const seed=crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const initial=createGame({players:irori.players,leader:irori.leader,environment:irori.environment,paused:irori.paused,nonce,seed});
  let state=initial.state;
  let ended=false;
  let disposed=false;
  let paused=irori.paused;
  let environment=irori.environment;
  /** @type {Map<number,import('./irori.js').Look>} */
  const looks=new Map(irori.players.map((p)=>[p.id,irori.look(p.id)]));
  /** @type {(()=>void)[]} */
  const subscriptions=[];
  // ホストの公開通知だけで停止表示を作る。viewにはpublicView以外のゲーム状態を渡さない。
  function reflectAvailability() {
    const blocker=paused ? 'menu' : !environment?.connected ? 'offline' : !environment.visible ? 'hidden' : '';
    document.documentElement.dataset.blocker=blocker;
    availability.hidden=!blocker;
    availability.textContent=blocker === 'menu' ? '一時停止中 · メニューを閉じると続けられます'
      : blocker === 'offline' ? '大画面の接続を待っています' : blocker === 'hidden' ? '大画面に戻るのを待っています' : '';
    view.hold(!!blocker);
  }
  /** @type {number|null} */
  let feltTurn=null;
  let feltSeq=0;
  /** 公開の流れだけから、スマホの振動を頼む。番は短く、革命は全員に、上がりは本人に長く。
   * 判定は振動を出さないため、画面側で足す（音の依頼は判定の効果だけを使う）。
   * @param {import('./logic.js').GameViewModel} model */
  function feel(model) {
    const fresh=model.events.filter((event)=>event.seq>feltSeq);
    feltSeq=fresh.at(-1)?.seq ?? feltSeq;
    const turn=model.phase === 'play' ? model.turn : null;
    const turned=turn !== feltTurn;
    feltTurn=turn;
    if (paused || !environment?.connected || !environment.visible) return;
    const reachable=new Set(model.seats.filter((seat)=>seat.online && !seat.left).map((seat)=>seat.id));
    /** 1つの更新で1席に1回だけ（後の振動が前を打ち消すため、強いほうを選ぶ）。 @type {Map<number,number[]>} */
    const buzz=new Map();
    for (const event of fresh) {
      if (event.type === 'finish' && model.seats.find((seat)=>seat.id === event.p)?.count === 0) buzz.set(event.p,[40,40,40,40,120]);
    }
    if (fresh.some((event)=>event.type === 'revolution')) for (const id of reachable) if (!buzz.has(id)) buzz.set(id,[70,50,140]);
    if (turned && turn !== null && !buzz.has(turn)) buzz.set(turn,[30]);
    for (const [id,ms] of buzz) if (reachable.has(id)) irori.vibrate(ms,id);
  }
  function dispose() {
    if (disposed) return;
    disposed=true;
    for (const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide',dispose);
    looks.clear();
    view.dispose();
  }
  cleanup=dispose;
  /** @param {readonly import('./logic.js').GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed || ended) return;
      if (effect.t === 'pad') irori.setPad(effect.spec,effect.to);
      else if (effect.t === 'cue') irori.cue?.(effect.name,effect.v);
      else if (effect.t === 'vibrate') irori.vibrate(effect.ms,effect.to);
      else if (effect.t === 'end') {
        ended=true;
        dispose();
        irori.end(effect.results,effect.options);
      }
    }
  }
  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if (disposed || ended) return;
    const next=updateGame(state,event);
    state=next.state;
    const model=publicView(state);
    view.render(model,looks);
    feel(model);
    apply(next.effects);
  }
  subscriptions.push(
    irori.on('input',(p,input)=>dispatch({t:'input',p,input})),
    irori.on('players',(players,leader)=>{
      for (const player of players) if (!looks.has(player.id)) looks.set(player.id,irori.look(player.id));
      dispatch({t:'players',players,leader});
    }),
    irori.on('pause',()=>{paused=true;reflectAvailability();dispatch({t:'menu',paused:true});}),
    irori.on('resume',()=>{paused=false;reflectAvailability();dispatch({t:'menu',paused:false});}),
    irori.on('environment',(value)=>{environment=value;reflectAvailability();dispatch({t:'environment',value});}),
  );
  addEventListener('pagehide',dispose,{once:true});
  reflectAvailability();
  view.render(publicView(state),looks);
  apply(initial.effects);
  irori.ready();
}
void boot().catch(()=>{
  cleanup?.();
  availability.hidden=true;
  document.documentElement.dataset.blocker='';
  view.showMessage('つながりませんでした','ゲームを開き直してください。');
  document.documentElement.dataset.phase='error';
});
