// @ts-check
/** 正の内部IDを使う。CPUかどうかはIDの符号で判定しない。 @param {number} humans @returns {(import('./irori.js').PlayerInfo & {cpu:true})[]} */
export function fillSeats(humans) {
  if (!Number.isSafeInteger(humans) || humans < 0 || humans > 8) throw new RangeError('人数が不正です');
  return humans >= 4 ? [] : Array.from({length:6-humans},(_,i)=>({id:1000001+i,name:`CPU ${i+1}`,online:true,cpu:true}));
}
/** @param {()=>number} rng */
export function thinkMs(rng) {return 800+Math.floor(rng()*1201);}
/** 人の印にない、灰白色のロボットの顔。 @type {import('./irori.js').Look} */
export const CPU_LOOK={color:'#D5D9DE',shape:'square',label:'CPUのロボット',path:'M11 1h2v4h7v14H4V5h7V1ZM7 8v4h3V8H7Zm7 0v4h3V8h-3ZM8 15v2h8v-2H8ZM1 8h2v8H1V8Zm20 0h2v8h-2V8Z'};
/** @typedef {(() => number) & {state:number}} Rng */

/** mulberry32。呼出後の状態を保存すれば同じ続きから再生できる。 @param {number} seed @returns {Rng} */
export function makeRng(seed) {
  const rng = Object.assign(() => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0;
    let value = rng.state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }, {state:seed >>> 0});
  return rng;
}


/** 自分の役・得た占い結果・公開票だけで選ぶ。昼の議論では発言しない。
 * @param {import('./logic.js').SeatView} view @param {number} seat @param {()=>number} rng @returns {import('./irori.js').GameInput|null} */
export function decide(view,seat,rng) {
  if(view.self !== seat) throw new RangeError('本人の情報だけを渡してください');
  const pad=view.pad;
  if(pad.k === 'pad') {const b=pad.buttons?.[0];return b ? {k:'btn',id:b.id,d:1} : null;}
  if(pad.k !== 'tiles' || pad.disabled) return null;
  if(view.phase === 'day' && !view.resumeRequired) return null;
  const input={k:/** @type {const} */ ('tiles'),ids:/** @type {string[]} */ ([]),...(pad.token ? {t:pad.token} : {})};
  if(!pad.tiles.length) return input;
  let targets=view.targets.filter(t=>t.id !== null);
  if(view.phase === 'night') {
    if(view.role === 'wolf') targets=targets.filter(t=>!view.friends.includes(/** @type {number} */ (t.id)));
    if(view.role === 'knight') targets=targets.filter(t=>t.id !== view.lastGuard);
    if(view.role === 'seer') {const unseen=targets.filter(t=>!(/** @type {number} */ (t.id) in view.knowledge));if(unseen.length) targets=unseen;}
  }
  const weighted=targets.map(target=>{
    const id=/** @type {number} */ (target.id),known=view.knowledge[id];
    let weight=1;
    if(view.phase === 'vote') {
      // 人狼も公開票を手がかりに票を散らし、仲間へ投票する余地を残す。
      weight+=.35*(view.votes?.filter(v=>v.to === id).length ?? 0);
      if(view.role === 'seer') weight*=known === true ? 12 : known === false ? .1 : 1;
    }
    return {target,weight};
  });
  let pick=rng()*weighted.reduce((sum,t)=>sum+t.weight,0);
  const selected=weighted.find(t=>(pick-=t.weight)<0) ?? weighted.at(-1);
  return selected ? {...input,ids:[selected.target.tile]} : input;
}
