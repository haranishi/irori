// @vitest-environment happy-dom
// @ts-check
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({connect:vi.fn(),race:null}));
vi.mock('./irori.js',()=>({connect:hooks.connect}));
vi.mock('./logic.js',async(original)=>{const actual=await original();return {...actual,createRace:(...args)=>{hooks.race=actual.createRace(...args);return hooks.race;}};});
const text=vi.fn();
function host(n=1){const listeners=new Map();return {players:Array.from({length:n},(_,i)=>({id:i+1,name:`P${i+1}`,online:true})),paused:false,environment:{connected:true,visible:true},look:vi.fn(()=>({color:'#fff',path:'M0 0h24v24H0Z'})),ready:vi.fn(),setPad:vi.fn(),vibrate:vi.fn(),end:vi.fn(),on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);},emit:(name,...args)=>listeners.get(name)?.(...args)};}
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();document.body.innerHTML='<main id="stage"><canvas id="view"></canvas></main><p id="status"></p>';
 const ctx=new Proxy({fillText:text,createRadialGradient:()=>({addColorStop(){}})},{get:(obj,key)=>obj[key]??(()=>{})});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);
 vi.stubGlobal('Path2D',class {});vi.stubGlobal('requestAnimationFrame',fn=>setTimeout(()=>fn(performance.now()),16));vi.stubGlobal('cancelAnimationFrame',id=>clearTimeout(id));
});
afterEach(()=>{dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function boot(h){hooks.connect.mockResolvedValue(h);await import('./main.js');expect(h.ready).toHaveBeenCalledOnce();}
it('mainで人1＋CPUの完走・停止復帰・名簿更新とSDKの人限定を守る',async()=>{
 const h=host();await boot(h);h.emit('pause');vi.useFakeTimers();const taps=[...hooks.race.runners.values()].map(r=>r.taps);
 await vi.advanceTimersByTimeAsync(5000);expect([...hooks.race.runners.values()].map(r=>r.taps)).toEqual(taps);
 h.emit('resume');h.emit('players',h.players);let steps=0;
 while(hooks.race.phase!=='over'&&steps++<600){if(hooks.race.phase==='race')h.emit('input',1,{k:'btn',id:'buzzer',d:1},Date.now());await vi.advanceTimersByTimeAsync(100);}
 expect(steps).toBeLessThan(600);expect([...hooks.race.runners.values()].every(r=>r.state==='done')).toBe(true);
 expect(hooks.race.runners.get(1).doneT).toBe(hooks.race.runners.get(1).doneAt);
 expect(h.end).toHaveBeenCalledOnce();expect(h.end.mock.calls[0][0].map(r=>r.p)).toEqual([1]);expect(h.setPad.mock.calls.every(([,p])=>p===1)).toBe(true);expect(h.vibrate.mock.calls.every(([,p])=>p===1)).toBe(true);expect(h.look.mock.calls.every(([p])=>p===1)).toBe(true);
 expect(text.mock.calls.some(([value])=>value==='CPU 3')).toBe(true);
},30000);
it('人2人ならCPUを足さず、ページ破棄でCPUの時計を止める',async()=>{
 const h=host(2);await boot(h);expect(hooks.race.runners.size).toBe(2);dispatchEvent(new Event('pagehide'));vi.useFakeTimers();const before=structuredClone(hooks.race);await vi.advanceTimersByTimeAsync(40000);expect(hooks.race).toEqual(before);
});
