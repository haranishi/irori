// @ts-check
import {classify,legalPlays,strength} from './cards.js';
/** @param {number} humans @returns {(import('./logic.js').PlayerInfo & {cpu:true})[]} */
export function fillSeats(humans) {
  if (!Number.isSafeInteger(humans) || humans < 0 || humans > 8) throw new RangeError('人数が不正です');
  return humans >= 3 ? [] : Array.from({length:4-humans},(_,i)=>({id:-(i+1),name:`CPU ${i+1}`,online:true,cpu:true}));
}
/** @param {()=>number} rng */
export function thinkMs(rng) {return 800+Math.floor(rng()*1201);}
/** 人の印にない、灰白色のロボットの顔。 @type {import('./irori.js').Look} */
export const CPU_LOOK={color:'#D5D9DE',shape:'square',label:'CPUのロボット',path:'M11 1h2v4h7v14H4V5h7V1ZM7 8v4h3V8H7Zm7 0v4h3V8h-3ZM8 15v2h8v-2H8ZM1 8h2v8H1V8Zm20 0h2v8h-2V8Z'};
/** 場に合う弱い手を優先し、同じ強さなら種つき乱数で選ぶ。
 * @param {import('./logic.js').SeatView} view @param {number} seat @param {()=>number} rng @returns {import('./logic.js').GameInput|null} */
export function decide(view,seat,rng) {
  if (view.self !== seat) throw new RangeError('本人の情報だけを渡してください');
  const pad=view.pad;
  if (pad.k === 'pad') {const button=pad.buttons?.[0];return button ? {k:'btn',id:button.id,d:1} : null;}
  if (pad.k !== 'tiles' || pad.disabled) return null;
  const plays=legalPlays(view.hand,view.table,view.revolution);
  if (!plays.length) return view.table ? {k:'tiles',ids:[],pass:true,...(pad.token ? {t:pad.token} : {})} : null;
  const late=view.hand.length <= 6 || view.seats.some((s)=>s.rank === null && !s.left && s.count <= 3);
  // 先に出すときは8切り・革命を温存する。場に応じる唯一の手なら使う。
  const quiet=plays.filter((play)=>play.length !== 4 && classify(play)?.rank !== '8');
  const candidates=!late && quiet.length ? quiet : plays;
  const score=(/** @type {string[]} */ play)=>{
    if (play.length === view.hand.length) return -100;
    const rank=classify(play)?.rank;
    const power=rank === 'joker' ? 13 : strength('s'+rank,view.revolution);
    return power + (view.table ? 0 : -play.length*.25);
  };
  const weakest=Math.min(...candidates.map(score));
  const ties=candidates.filter((play)=>score(play) === weakest);
  const play=/** @type {string[]} */ (ties[Math.floor(rng()*ties.length)]);
  return {k:'tiles',ids:play.map((card)=>/** @type {{id:string}} */ (pad.tiles.find((tile)=>tile.id.endsWith('_'+card)))).map((tile)=>tile.id),...(pad.token ? {t:pad.token} : {})};
}
