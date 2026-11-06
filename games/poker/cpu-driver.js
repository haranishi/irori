// @ts-check
import {decide,thinkMs} from './cpu.js';
import {makeRng} from './cards.js';
/** 本人のpadが同じなら予定を保つ。他席の応答で思考を先延ばしにしない。
 * @param {import('./cards.js').SeatId[]} ids @param {number} seed
 * @param {(p:import('./cards.js').SeatId)=>import('./logic.js').SeatView} read
 * @param {(p:import('./cards.js').SeatId,input:import('./logic.js').GameInput)=>void} send */
export function createCpuDriver(ids,seed,read,send) {
  const streams=new Map(ids.map((id,i)=>[id,makeRng(seed^Math.imul(i+1,7919))]));
  /** @type {Map<import('./cards.js').SeatId,{key:string,timer:ReturnType<typeof setTimeout>}>} */
  const pending=new Map();
  function cancel() {for (const job of pending.values()) clearTimeout(job.timer);pending.clear();}
  function sync() {
    for (const id of ids) {
      const view=read(id),pad=view.pad;
      const key=JSON.stringify(pad),old=pending.get(id);
      if (old?.key === key) continue;
      if (old) {clearTimeout(old.timer);pending.delete(id);}
      if (view.ended || view.paused || pad.disabled || !view.actions.length) continue;
      const rng=/** @type {ReturnType<typeof makeRng>} */(streams.get(id));
      const timer=setTimeout(()=>{
        pending.delete(id);const latest=read(id);
        if (JSON.stringify(latest.pad)!==key || latest.paused || latest.ended) return;
        const input=decide(latest,id,rng);if (input) send(id,input);
      },thinkMs(rng));
      pending.set(id,{key,timer});
    }
  }
  return {sync,cancel};
}
