// @ts-check
/** 正の内部IDを使う。CPUかどうかはIDの符号で判定しない。 @param {number} humans @returns {(import('./irori.js').PlayerInfo & {cpu:true})[]} */
export function fillSeats(humans) {
  if (!Number.isSafeInteger(humans) || humans < 0 || humans > 8) throw new RangeError('人数が不正です');
  return humans >= 2 ? [] : Array.from({length:2-humans},(_,i)=>({id:1000001+i,name:`CPU ${i+1}`,online:true,cpu:true}));
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


/** 公開の気力と直前の構えだけを手がかりにし、読みを固定しない。
 * @param {import('./logic.js').SeatView} view @param {number} seat @param {()=>number} rng @returns {import('./irori.js').GameInput|null} */
export function decide(view,seat,rng) {
  if(view.self !== seat) throw new RangeError('本人の情報だけを渡してください');
  const pad=view.pad;
  if(pad.k === 'pad') {const b=pad.buttons?.[0];return b ? {k:'btn',id:b.id,d:1} : null;}
  if(pad.k !== 'choices') return null;
  const self=view.seats.find(s=>s.id === seat), rival=view.seats.find(s=>s.id !== seat);
  if(!self || !rival) return null;
  const last=view.history.at(-1)?.find(r=>r.p === rival.id)?.move;
  const weights={slash:3+(rival.energy === 0 ? 2 : 0),guard:rival.energy > 0 ? 2 : .3,
    focus:self.energy < 3 ? 3 : .2,burst:4+(rival.hp <= 2 ? 3 : 0)};
  if(last === 'guard') {weights.slash*=.6;weights.focus*=1.4;}
  if(last === 'focus') weights.slash*=1.5;
  if(rival.energy >= 3) weights.guard*=.4;
  const options=pad.options.map(option=>({option,weight:weights[/** @type {import('./logic.js').Move} */ (option.id.split('_').at(-1))]}));
  let pick=rng()*options.reduce((sum,o)=>sum+o.weight,0);
  const selected=options.find(o=>(pick-=o.weight)<0) ?? options.at(-1);
  return selected ? {k:'pick',id:selected.option.id} : null;
}
