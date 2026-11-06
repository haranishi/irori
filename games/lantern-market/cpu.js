// @ts-check
/** @param {number} humans @returns {(import('./irori.js').PlayerInfo & {cpu:true})[]} */
export function fillSeats(humans) {
  if (!Number.isSafeInteger(humans) || humans < 0 || humans > 8) throw new RangeError('人数が不正です');
  return humans >= 2 ? [] : Array.from({length:4-humans},(_,i)=>({id:-(i+1),name:`CPU ${i+1}`,online:true,cpu:true}));
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

/** 公開済みの使用札から、相手にも残る数字を推定する。 @param {import('./logic.js').SeatView} view @param {number} seat @param {()=>number} rng @returns {import('./irori.js').GameInput|null} */
export function decide(view,seat,rng) {
  if(view.self !== seat) throw new RangeError('本人の情報だけを渡してください');
  const pad=view.pad;
  if(pad.k === 'pad') {const b=pad.buttons?.[0];return b ? {k:'btn',id:b.id,d:1} : null;}
  if(pad.k !== 'choices') return null;
  const weights=view.hand.map(card=>{
    const rivals=view.participants.filter(p=>p.id !== seat && !p.used.includes(card)).length;
    return (1+card*.6)/(1+rivals*.7);
  });
  let pick=rng()*weights.reduce((a,b)=>a+b,0);
  let index=weights.length-1;
  for(let i=0;i<weights.length;i++){pick-=weights[i] ?? 0;if(pick<0){index=i;break;}}
  const option=pad.options[index];
  return option ? {k:'pick',id:option.id} : null;
}
