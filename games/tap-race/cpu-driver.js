// @ts-check
import {decide,thinkMs,makeRng,createPace} from './cpu.js';
/** @param {number[]} ids @param {number} seed
 * @param {(p:number)=>import('./cpu.js').SeatView} read
 * @param {(p:number,input:import('./irori.js').GameInput)=>void} send */
export function createCpuDriver(ids,seed,read,send) {
  const streams=ids.map(id=>{const rng=makeRng((seed+id*2654435761)>>>0);return {id,rng,profile:createPace(rng),key:'',due:0};});
  let generation=0;
  function cancel() {generation++;for(const s of streams) s.key='';}
  /** 呼出側のゲーム時計で進める。再描画だけでは押下予定を引き直さない。 @param {number} now */
  function sync(now) {
    const version=generation;
    for(const s of streams) {
      const view=read(s.id),input=decide(view,s.id,s.rng);
      if(!input) {s.key='';continue;}
      const key=JSON.stringify(view.pad);
      if(s.key !== key) {s.key=key;s.due=now+s.profile.nextMs(s.rng);}
      if(now<s.due) continue;
      s.due=now+s.profile.nextMs(s.rng);
      const latest=decide(read(s.id),s.id,s.rng);if(latest) send(s.id,latest);
      if(version !== generation) return;
    }
  }
  return {sync,cancel};
}
