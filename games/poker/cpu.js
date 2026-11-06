// @ts-check
import {evaluate} from './cards.js';
/** @param {number} humans @returns {import('./logic.js').Player[]} */
export function fillSeats(humans){
  if(!Number.isSafeInteger(humans)||humans<0||humans>8)throw new RangeError('人数が不正です');
  return humans>=2?[]:Array.from({length:4-humans},(_,i)=>({id:`cpu${i+1}`,name:`CPU ${i+1}`,cpu:true,online:true}));
}
/** @param {()=>number} rng */
export function thinkMs(rng){return 800+Math.floor(rng()*1201);}
/** @param {import('./logic.js').SeatView} view */
export function strength(view){
  const ranks=view.hand.map(c=>Number(c.slice(1))).sort((a,b)=>b-a),a=ranks[0]??0,b=ranks[1]??0;
  if(!view.board.length)return a===b?Math.min(0.96,0.55+a/35):Math.min(0.85,(a+b)/40+(view.hand[0]?.[0]===view.hand[1]?.[0]?0.12:0)+(a-b<=2?0.08:0));
  const cards=[...view.hand,...view.board],category=evaluate(cards).category;
  const suits=['s','h','d','c'].map(s=>cards.filter(c=>c[0]===s).length),numbers=new Set(cards.map(c=>Number(c.slice(1))));if(numbers.has(14))numbers.add(1);
  const near=Array.from({length:10},(_,i)=>Array.from({length:5},(_,j)=>i+j+1).filter(n=>numbers.has(n)).length).some(n=>n===4);
  const draw=view.board.length<5&&(Math.max(...suits)===4||near)?0.15:0;
  return Math.min(0.99,([0.18,0.44,0.66,0.76,0.84,0.88,0.94,0.97,0.99,0.99][category]??0)+draw);
}
/** @param {import('./logic.js').SeatView} view @param {import('./cards.js').SeatId} p @param {()=>number} rng @returns {import('./logic.js').GameInput|null} */
export function decide(view,p,rng){
  if(view.self!==p)throw new RangeError('自分の情報だけを渡してください');
  if(view.pad.disabled||!view.actions.length)return null;
  const power=view.phase==='intro'?1:strength(view),bold=rng()<0.075,own=view.seats.find(v=>v.id===p),points=own?.points??0;
  const weights=view.actions.map(a=>{
    if(a.kind==='start')return 1;
    if(a.kind==='fold')return power<0.4?4:0.08;
    if(a.kind==='check')return power<0.6?12:4;
    if(a.kind==='call')return (power>0.4?6:1)/(1+a.amount/Math.max(1,points));
    return (bold?7:power>0.75?5:power>0.55?1:0.04)/(1+4*a.amount/Math.max(1,points));
  });
  let draw=rng()*weights.reduce((a,b)=>a+b,0),i=0;for(;i<weights.length-1;i++){draw-=weights[i]??0;if(draw<0)break;}
  return {k:'tiles',ids:[/** @type {import('./logic.js').Tile} */(view.pad.tiles[i]).id],t:view.pad.token};
}
