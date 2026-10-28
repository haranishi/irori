// @ts-check
import {connect} from './irori.js';
import {createGame,publicView,updateGame} from './logic.js';
import {createView} from './view.js';

/** @typedef {import('./logic.js').GameEffect} GameEffect */
/** @typedef {Extract<GameEffect,{t:'cue'}>} CueEffect */
/** 効果音の依頼（cue-v1）は、まだ無いホストもある。無ければ何もしない。 */
/** @typedef {import('./irori.js').Irori & {cue?:(name:CueEffect['name'],v?:number)=>void}} Console */

const NEEDED=/** @type {const} */ (['pad-tiles-v1','result-options-v1','host-environment-v1']);
const stage=/** @type {HTMLElement} */ (document.getElementById('stage'));
const status=/** @type {HTMLElement} */ (document.getElementById('status'));
/** @type {Console|null} */
let device=null;
const view=createView(stage,status,{cue:(name,v)=>device?.cue?.(name,v)});

/** 止まっている間は数えない時計。終わりの「短い間」（ジョーカーを見せてから結果へ進む）に使う。 @param {number} ms @param {()=>void} done */
function hold(ms,done) {
  let left=ms;let since=0;let over=false;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  return {
    run() {if(over || timer !== undefined) return;since=performance.now();timer=setTimeout(()=>{timer=undefined;over=true;done();},left);},
    stop() {if(timer === undefined) return;clearTimeout(timer);timer=undefined;left=Math.max(0,left-(performance.now()-since));},
    cancel() {if(timer !== undefined) clearTimeout(timer);timer=undefined;over=true;},
  };
}
/** @param {GameEffect} effect @returns {effect is CueEffect} */
function isCue(effect) {return effect.t === 'cue';}

async function boot() {
  const irori=/** @type {Console} */ (await connect());
  device=irori;
  if(!NEEDED.every((c)=>irori.capabilities.includes(c))) {
    view.showMessage('更新が必要です','irori を新しくして、開き直してください','unsupported');
    irori.setPad({k:'wait',title:'更新が必要です',body:'irori を新しくして、開き直してください'});
    irori.ready();
    return;
  }
  /** @type {Map<number,import('./irori.js').Look>} */
  const looks=new Map(irori.players.map((p)=>[p.id,irori.look(p.id)]));
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(4)),(n)=>n.toString(16).padStart(2,'0')).join('');
  const seed=crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  let paused=irori.paused;let environment=irori.environment;
  const host=()=>({paused,connected:environment?.connected === true,visible:environment?.visible === true});
  const initial=createGame({players:irori.players,leader:irori.leader,environment,paused,nonce,seed});
  let state=initial.state;
  /** @type {(()=>void)[]} */
  const subscriptions=[];
  let disposed=false;let ended=false;
  /** @type {ReturnType<typeof hold>|null} */
  let closing=null;
  function dispose() {
    if(disposed) return;
    disposed=true;closing?.cancel();
    for(const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide',dispose);
    looks.clear();view.dispose();
  }
  /** 一時停止・切断・非表示を画面と終わりの時計へ伝える。 */
  function sync() {
    const h=host();view.setHost(h);
    if(!closing) return;
    if(h.paused || !h.connected || !h.visible) closing.stop();else closing.run();
  }
  /** @param {readonly GameEffect[]} effects */
  function apply(effects) {
    for(const effect of effects) {
      if(disposed) return;
      if(effect.t === 'pad') irori.setPad(effect.spec,effect.to);
      else if(effect.t === 'vibrate') irori.vibrate(effect.ms,effect.to);
      else if(effect.t === 'end' && !ended) {
        // end は1回だけ。最後の演出（ジョーカーを静かに見せる間）が済んでから送る。止まっている間は待つ。
        ended=true;
        closing=hold(view.finaleMs(),()=>{dispose();irori.end(effect.results,effect.options);});
        sync();
      }
    }
  }
  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if(disposed || ended) return;
    const next=updateGame(state,event);
    if(next.state === state && next.effects.length === 0) return;
    state=next.state;
    view.render(publicView(state),looks,host(),next.effects.filter(isCue));
    apply(next.effects);
  }
  subscriptions.push(
    irori.on('input',(p,input)=>dispatch({t:'input',p,input})),
    irori.on('players',(players,leader)=>{for(const p of players) if(!looks.has(p.id)) looks.set(p.id,irori.look(p.id));dispatch({t:'players',players,leader});}),
    irori.on('pause',()=>{paused=true;dispatch({t:'menu',paused:true});sync();}),
    irori.on('resume',()=>{paused=false;dispatch({t:'menu',paused:false});sync();}),
    irori.on('environment',(value)=>{environment=value;dispatch({t:'environment',value});sync();}),
  );
  addEventListener('pagehide',dispose,{once:true});
  view.render(publicView(state),looks,host(),[]);
  apply(initial.effects);
  irori.ready();
}
void boot().catch(()=>{view.showMessage('つながりませんでした','ゲームを開き直してください','error');});
