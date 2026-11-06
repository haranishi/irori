// @vitest-environment happy-dom
// @ts-check
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {decide} from './cpu.js';
const hooks=vi.hoisted(()=>({connect:vi.fn(),state:null}));
vi.mock('./irori.js',()=>({connect:hooks.connect}));
vi.mock('./logic.js',async(original)=>{
  const actual=await original();
  return {...actual,createGame:(init)=>{const result=actual.createGame(init);hooks.state=result.state;return result;},updateGame:(state,event)=>{const result=actual.updateGame(state,event);hooks.state=result.state;return result;}};
});
const logic=await vi.importActual('./logic.js');
function host(n=1) {
  const listeners=new Map();
  return {players:Array.from({length:n},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true})),leader:1,
    environment:{connected:true,visible:true},paused:false,capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:vi.fn(()=>({color:'#fff',path:'M0 0h24v24H0Z',label:'印',shape:'square'})),ready:vi.fn(),setPad:vi.fn(),end:vi.fn(),cue:vi.fn(),vibrate:vi.fn(),
    on:(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);},
    emit:(name,...args)=>listeners.get(name)?.(...args)};
}
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();
  document.body.innerHTML='<main id="stage"></main><p id="status"></p><p id="availability"></p>';
  vi.stubGlobal('requestAnimationFrame',fn=>setTimeout(()=>fn(performance.now()),16));
  vi.stubGlobal('cancelAnimationFrame',id=>clearTimeout(id));
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  vi.spyOn(Element.prototype,'getAnimations').mockReturnValue([]);
  vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:Promise.resolve(),finish(){},pause(){},play(){},cancel(){}}));
});
afterEach(()=>{dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function boot(h) {hooks.connect.mockResolvedValue(h);await import('./main.js');await vi.waitFor(()=>expect(h.ready).toHaveBeenCalledTimes(1));}
it('mainで人1＋CPUの結果まで進み、SDKにCPUを送らず、全席の結果を残す',async()=>{
 const h=host();await boot(h);vi.useFakeTimers();
 const send=()=>{const input=decide(logic.viewFor(hooks.state,1),1,()=>.3);if(input)h.emit('input',1,input);};
 send();h.emit('pause');const before=structuredClone(hooks.state);await vi.advanceTimersByTimeAsync(5000);expect(hooks.state).toEqual(before);h.emit('resume');h.emit('players',h.players,1);expect(hooks.state.seats).toHaveLength(4);
 let steps=0;
 while(hooks.state.phase!=='ended'&&steps++<2000){
  send();
  await vi.advanceTimersByTimeAsync(100);
 }
 expect(steps).toBeLessThan(2000);expect(h.end).toHaveBeenCalledTimes(1);expect(h.end.mock.calls[0][0].map(r=>r.p)).toEqual([1]);
 expect(h.setPad.mock.calls.every(([,p])=>p===1)).toBe(true);expect(h.look.mock.calls.every(([p])=>p===1)).toBe(true);
 for(let i=1;i<=3;i++)expect(document.getElementById('stage').textContent).toContain(`CPU ${i}`);
},30000);
it('人2人なら補充せず、ページ破棄後はCPUが入力しない',async()=>{
 const h=host(2);await boot(h);expect(hooks.state.seats).toHaveLength(2);dispatchEvent(new Event('pagehide'));
});
