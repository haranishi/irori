// @ts-check
/** @param {number} humans @param {()=>number} [rng] @returns {(import('./logic.js').PlayerInfo & {cpu:true})[]} */
export function fillSeats(humans,rng=()=>.999999) {
  if (!Number.isSafeInteger(humans) || humans < 0 || humans > 8) throw new RangeError('人数が不正です');
  if (humans >= 2) return [];
  const before=Math.floor(rng()*(5-humans));
  return Array.from({length:4-humans},(_,i)=>({id:i<before ? -(i+1) : Number.MAX_SAFE_INTEGER-i,name:`CPU ${i+1}`,online:true,cpu:true}));
}
/** @param {()=>number} rng */
export function thinkMs(rng) {return 800+Math.floor(rng()*1201);}
/** 人の印にない、灰白色のロボットの顔。 @type {import('./irori.js').Look} */
export const CPU_LOOK={color:'#D5D9DE',shape:'square',label:'CPUのロボット',path:'M11 1h2v4h7v14H4V5h7V1ZM7 8v4h3V8H7Zm7 0v4h3V8h-3ZM8 15v2h8v-2H8ZM1 8h2v8H1V8Zm20 0h2v8h-2V8Z'};
/** @param {import('./logic.js').SeatView} view @param {number} seat @param {()=>number} rng @returns {import('./irori.js').GameInput|null} */
export function decide(view,seat,rng) {
  if (view.self !== seat) throw new RangeError('本人の情報だけを渡してください');
  const pad=view.pad;
  if (pad.k === 'pad') {const button=pad.buttons?.[0];return button ? {k:'btn',id:button.id,d:1} : null;}
  if (pad.k !== 'tiles' || pad.disabled) return null;
  const options=pad.tiles.filter((tile)=>!tile.off);
  const tile=options[Math.floor(rng()*options.length)];
  return tile ? {k:'tiles',ids:[tile.id],...(pad.token ? {t:pad.token} : {})} : null;
}
