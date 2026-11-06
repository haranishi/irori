// @vitest-environment happy-dom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCpuDriver} from './cpu-driver.js';
import {createGame,viewFor} from './logic.js';
import {fillSeats} from './cpu.js';
const sdk=vi.hoisted(()=>({connect:vi.fn()}));vi.mock('./irori.js',()=>({connect:sdk.connect}));
const humans=Array.from({length:8},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));
function host(count=1) {
  const listeners=new Map(),pads=new Map();return {players:humans.slice(0,count),leader:1,mode:'mock',paused:false,environment:{connected:true,visible:true},capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:vi.fn(),ready:vi.fn(),cue:vi.fn(),end:vi.fn(),vibrate:vi.fn(),pads,setPad:vi.fn((pad,p)=>pads.set(p,pad)),on:(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);},emit:(name,...args)=>listeners.get(name)?.(...args)};
}
let h;
async function boot(count=1,search='') {vi.stubGlobal('location',{search});h=host(count);sdk.connect.mockResolvedValue(h);await import('./main.js');await vi.advanceTimersByTimeAsync(0);expect(h.ready).toHaveBeenCalledTimes(1);return h;}
function act(p=1,preferred='そのまま') {const pad=h.pads.get(p);if(!pad||pad.disabled)return;const tile=pad.tiles.find(t=>t.label===preferred)??pad.tiles.find(t=>t.label.startsWith('あわせる'))??pad.tiles[0];h.emit('input',p,{k:'tiles',ids:[tile.id],t:pad.token});}
async function finish() {for(let i=0;i<2400&&!h.end.mock.calls.length;i++){for(const p of h.players)act(p.id);await vi.advanceTimersByTimeAsync(500);}expect(h.end).toHaveBeenCalledTimes(1);}
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();document.body.innerHTML='<main id="stage"></main><p id="status"></p><p id="availability" hidden></p>';vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));});
afterEach(()=>{dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.unstubAllGlobals();});
describe('SDK接続とCPU',()=>{
  it('人1とCPU3を6ハンド通し、人だけへ4項目の結果を一度渡す',async()=>{
    await boot();act();await finish();expect(document.querySelector('.hand-number').textContent).toContain('6 / 6');expect(document.querySelectorAll('.results li')).toHaveLength(4);expect(document.querySelectorAll('.robot')).toHaveLength(3);
    expect(h.setPad.mock.calls.every(([,p])=>p===1)).toBe(true);expect(h.look.mock.calls.every(([p])=>p===1)).toBe(true);
    const rows=h.end.mock.calls[0][0];expect(rows).toHaveLength(1);expect(Object.keys(rows[0]).sort()).toEqual(['label','p','ranked','score']);expect(rows[0]).toMatchObject({p:1,ranked:false});expect(rows[0].label).toMatch(/^[1-4]位\(CPUこみ\)$/);expect(h.end.mock.calls[0][1].outcome).toBe('complete');await vi.advanceTimersByTimeAsync(30000);expect(h.end).toHaveBeenCalledTimes(1);
  });
  it('停止中の時計と予約を止め、名簿更新でもCPUを保持し、再開から終える',async()=>{
    await boot();act();await vi.advanceTimersByTimeAsync(1500);h.emit('pause');const content=document.querySelector('#stage').innerHTML;await vi.advanceTimersByTimeAsync(60000);expect(document.querySelector('#stage').innerHTML).toBe(content);expect(h.pads.get(1).disabled).toBe(true);
    h.emit('players',[{...humans[0],name:'変更した名前'}],1);expect(document.querySelectorAll('.robot')).toHaveLength(3);h.emit('resume');await finish();expect(document.querySelector('.name').textContent).toBe('変更した名前');
  });
  it.each([2,4,8])('人%s席では補充せず結果に順位を渡す',async count=>{await boot(count);act();await finish();expect(document.querySelector('.robot')).toBeNull();const rows=h.end.mock.calls[0][0];expect(rows).toHaveLength(count);expect(rows.every(r=>r.ranked)).toBe(true);});
  it('全人退出は即時に勝負なしを一度だけ渡し破棄で予約を消す',async()=>{await boot();act();h.emit('players',[],null);expect(h.end).toHaveBeenCalledTimes(1);expect(h.end.mock.calls[0][1].outcome).toBe('incomplete');expect(h.end.mock.calls[0][0]).toEqual([{p:1,score:1000,label:'勝負なし',ranked:false}]);h.emit('players',[],null);await vi.advanceTimersByTimeAsync(10000);expect(h.end).toHaveBeenCalledTimes(1);dispatchEvent(new Event('pagehide'));expect(vi.getTimerCount()).toBe(0);});
  it('CPUのみのデモはSDKへpadと結果を送らず次局へ進む',async()=>{await boot(1,'?demo=1');let result=false,next=false;for(let i=0;i<2400;i++){await vi.advanceTimersByTimeAsync(500);const phase=document.documentElement.dataset.phase;if(phase==='result')result=true;else if(result){next=true;break;}}expect(result&&next).toBe(true);expect(h.setPad).not.toHaveBeenCalled();expect(h.end).not.toHaveBeenCalled();});
  it('予約中のpadが変わらなければ延期せず最新ビューで選ぶ',async()=>{
    const cpus=fillSeats(0);let s=createGame({players:cpus,leader:'cpu1',seed:1,nonce:'driver',environment:{connected:true,visible:true}}).state;
    const send=vi.fn(),driver=createCpuDriver(cpus.map(p=>p.id),1,p=>viewFor(s,p),send);driver.sync();await vi.advanceTimersByTimeAsync(700);driver.sync();await vi.advanceTimersByTimeAsync(1400);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toBe('cpu1');driver.cancel();
  });
});
