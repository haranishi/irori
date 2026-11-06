// @ts-check
import {decide,thinkMs,makeRng} from './cpu.js';
/** @param {number[]} ids @param {number} seed
 * @param {(p:number)=>import('./logic.js').SeatView} read
 * @param {(p:number,input:import('./irori.js').GameInput)=>void} send */
export function createCpuDriver(ids,seed,read,send) {
  const streams=ids.map(id=>({id,rng:makeRng((seed^Math.imul(id>>>0,2654435761)^Math.floor(id/4294967296))>>>0),key:'',timer:/** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined)}));
  function cancel() {for(const s of streams){clearTimeout(s.timer);s.timer=undefined;s.key='';}}
  function sync() {
    for(const s of streams) {
      const view=read(s.id),key=JSON.stringify(view.pad);
      if(s.key === key) continue;
      clearTimeout(s.timer);s.timer=undefined;s.key=key;
      if(view.pad.k !== 'pad' && view.pad.k !== 'choices' && (view.pad.k !== 'tiles' || view.pad.disabled)) continue;
      s.timer=setTimeout(()=>{s.timer=undefined;const latest=read(s.id);if(JSON.stringify(latest.pad) !== s.key) return;const input=decide(latest,s.id,s.rng);if(input) send(s.id,input);},thinkMs(s.rng));
    }
  }
  return {sync,cancel};
}
