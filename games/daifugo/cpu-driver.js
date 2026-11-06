// @ts-check
import {decide,thinkMs} from './cpu.js';
import {makeRng} from './cards.js';
/** 最新の本人用ビューを発火時に取り直す。再描画・停止・終了で古い予約を捨てる。
 * @param {number[]} ids @param {number} seed
 * @param {(p:number)=>import('./logic.js').SeatView} read
 * @param {(p:number,input:NonNullable<ReturnType<typeof decide>>)=>void} send */
export function createCpuDriver(ids,seed,read,send) {
  const streams=new Map(ids.map((id)=>[id,makeRng((seed+id*2654435761)>>>0)]));
  /** @type {ReturnType<typeof setTimeout>[]} */
  let timers=[];
  function cancel() {for (const timer of timers) clearTimeout(timer);timers=[];}
  function sync() {
    cancel();
    for (const id of ids) {
      const pad=read(id).pad;
      if (pad.k !== 'pad' && (pad.k !== 'tiles' || pad.disabled)) continue;
      const rng=/** @type {()=>number} */ (streams.get(id));
      timers.push(setTimeout(()=>{const input=decide(read(id),id,rng);if (input) send(id,input);},thinkMs(rng)));
    }
  }
  return {sync,cancel};
}
