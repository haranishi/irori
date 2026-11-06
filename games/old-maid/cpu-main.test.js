// @vitest-environment happy-dom
// @ts-check
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {decide} from './cpu.js';
const hooks=vi.hoisted(()=>({connect:vi.fn(),state:null}));
vi.mock('./irori.js',()=>({connect:hooks.connect}));
vi.mock('./logic.js',async(original)=>{
  const actual=await original();
  return {...actual,createGame:(init)=>{const result=actual.createGame(init);hooks.state=result.state;return result;},updateGame:(state,event)=>{const result=actual.updateGame(state,event);hooks.state=result.state;const end=result.effects.find(e=>e.t==='end');if(end)hooks.endEffect=end;return result;}};
});
const logic=await vi.importActual('./logic.js');
function host(n=1) {
  const listeners=new Map();
  return {players:Array.from({length:n},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true})),leader:1,
    environment:{connected:true,visible:true},paused:false,capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:vi.fn(),ready:vi.fn(),setPad:vi.fn(),end:vi.fn(),cue:vi.fn(),vibrate:vi.fn(),
    on:(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);},
    emit:(name,...args)=>listeners.get(name)?.(...args)};
}
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();
  document.body.innerHTML='<main id="stage"></main><p id="status"></p><p id="availability"></p>';
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  vi.spyOn(Element.prototype,'getAnimations').mockReturnValue([]);
  vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:Promise.resolve(),finish(){},pause(){},play(){},cancel(){}}));
});
afterEach(()=>{dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function boot(h) {hooks.connect.mockResolvedValue(h);await import('./main.js');await vi.waitFor(()=>expect(h.ready).toHaveBeenCalledTimes(1));}
it('人1＋CPUをmainのタイマーで結果まで進め、SDKには人だけを渡す',async()=>{
  const h=host();await boot(h);vi.useFakeTimers();
  const input=decide(logic.viewFor(hooks.state,1),1,()=>.3);h.emit('input',1,input);
  h.emit('pause');const stopped=structuredClone(hooks.state);
  await vi.advanceTimersByTimeAsync(5000);expect(hooks.state).toEqual(stopped);
  h.emit('resume');
  h.emit('players',h.players,1);expect(hooks.state.seats.filter((s)=>s.cpu)).toHaveLength(3);
  let steps=0;
  while (hooks.state.phase!=='ended' && steps++<2000) {
    const human=decide(logic.viewFor(hooks.state,1),1,()=>.3);
    if (human) h.emit('input',1,human);
    await vi.advanceTimersByTimeAsync(2000);
  }
  await vi.advanceTimersByTimeAsync(10000);
  expect(steps).toBeLessThan(2000);expect(hooks.state.outcome).toBe('complete');
  const row=h.end.mock.calls[0][0][0];const raw=hooks.endEffect.results.find(r=>r.p===1);expect(row.ranked).toBe(false);expect(Object.keys(row).sort()).toEqual(['label','p','ranked','score']);expect([...row.label].length).toBeLessThanOrEqual(12);expect(row.label).toBe(`${1+hooks.endEffect.results.filter(r=>r.ranked !== false && r.score>raw.score).length}位(CPUこみ)`);
 expect(h.end).toHaveBeenCalledTimes(1);expect(h.end.mock.calls[0][0].map((r)=>r.p)).toEqual([1]);
  expect(h.setPad.mock.calls.every(([,p])=>p===1)).toBe(true);
  expect(h.vibrate.mock.calls.every(([,p])=>p===1)).toBe(true);
  expect(h.look.mock.calls.every(([p])=>p===1)).toBe(true);
  expect(document.getElementById('stage').textContent).toContain('CPU 1');
  expect(document.getElementById('stage').querySelectorAll('[data-cpu]')).toHaveLength(3);
},30000);
it('元の最小人数ならCPUを補わない',async()=>{
  const h=host(2);await boot(h);
  expect(hooks.state.seats).toHaveLength(2);expect(hooks.state.seats.some((s)=>s.cpu)).toBe(false);
});
it('ページを閉じたあとはCPUの入力を発火させない',async()=>{
  const h=host();await boot(h);vi.useFakeTimers();
  h.emit('input',1,decide(logic.viewFor(hooks.state,1),1,()=>0));
  dispatchEvent(new Event('pagehide'));const before=structuredClone(hooks.state);
  await vi.advanceTimersByTimeAsync(10000);expect(hooks.state).toEqual(before);expect(h.end).not.toHaveBeenCalled();
});

it('人だけの局の終了行とlabel・rankedを変えない',async()=>{
 const h=host(2);await boot(h);vi.useFakeTimers();hooks.endEffect=null;
 for(let step=0;hooks.state.phase!=='ended'&&step<3000;step++){
  for(const p of h.players){
   const view=logic.viewFor(hooks.state,p.id);
   let input=decide(view,p.id,()=>.3);

   if(input)h.emit('input',p.id,input);
  }
  await vi.advanceTimersByTimeAsync(100);
 }
 await vi.advanceTimersByTimeAsync(10000);
 expect(h.end).toHaveBeenCalledOnce();expect(h.end.mock.calls[0][0]).toEqual(hooks.endEffect.results);
},30000);
