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

/** @typedef {{self:number,pad:import('./irori.js').PadSpec}} SeatView */
/** @param {SeatView} view @param {number} seat @param {()=>number} _rng @returns {import('./irori.js').GameInput|null} */
export function decide(view,seat,_rng) {
  if(view.self !== seat) throw new RangeError('本人の情報だけを渡してください');
  return view.pad.k === 'buzzer' ? {k:'btn',id:'buzzer',d:1} : null;
}
/** 席ごとの速さは固定し、1打ごとの間隔だけ揺らす。 @param {()=>number} rng */
export function createPace(rng) {
  const mean=95+45*rng();
  return {mean,nextMs:(/** @type {()=>number} */ next)=>mean*(.7+.6*next())};
}
