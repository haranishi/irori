// @vitest-environment happy-dom
// @ts-check
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createGame,publicView,updateGame,viewFor} from './logic.js';
import {createView,eventText,short} from './view.js';
import {fillSeats} from './cpu.js';
const humans=Array.from({length:8},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));
const initial=(players=humans)=>createGame({players,leader:1,seed:19,nonce:'view',environment:{connected:true,visible:true}}).state;
const disposals=[];
function fixture(reduced=false) {
  const listeners=new Set();
  vi.stubGlobal('matchMedia',()=>({matches:reduced,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)}));
  const stage=document.createElement('main'),status=document.createElement('p');document.body.append(stage,status);
  const view=createView(stage,status);disposals.push(()=>view.dispose());return {stage,status,view,listeners};
}
beforeEach(()=>{document.body.replaceChildren();});
afterEach(()=>{disposals.splice(0).forEach((fn)=>fn());vi.unstubAllGlobals();});
describe('ふところの鈴：公開の画面',()=>{
  it('配札後も手札と鈴の位置と専用通知を画面へ出さない',()=>{
    let state=initial();const pad=viewFor(state,1).pad;
    if (pad.k !== 'tiles') throw new Error('開始の札がありません');
    state=updateGame(state,{t:'input',p:1,input:{k:'tiles',ids:[pad.tiles[0].id],t:pad.token}}).state;
    const {stage,view}=fixture();view.render(publicView(state));
    expect(stage.querySelectorAll('.back')).toHaveLength(24);
    expect(stage.querySelectorAll('.face,.bell,.cat,.reveal')).toHaveLength(0);
    expect(stage.textContent).not.toMatch(/金の鈴|のぞき見|すりかえ|見えた札|渡した札/);
    const before=stage.innerHTML;
    for (const seat of state.seats) seat.hand.reverse();
    state.notices[1]='秘密の結果';view.render(publicView(state));expect(stage.innerHTML).toBe(before);
  });
  it('文字は符号位置で制限し、名前をHTMLとして解釈しない',()=>{
    expect(short('😀'.repeat(15),12)).toBe('😀'.repeat(12));
    const state=initial();state.seats[0].name='<img src=x onerror=1>'.repeat(10);
    const {stage,view}=fixture();view.render(publicView(state));
    expect([...stage.querySelector('.name').textContent]).toHaveLength(12);expect(stage.querySelector('img')).toBeNull();
    expect([...eventText(publicView(state),{seq:1,type:'swap',p:1,target:2})].length).toBeLessThanOrEqual(64);
  });
  it('CPUの印と人の席を区別し、守り・外れ指名を示す',()=>{
    const state=initial([...humans.slice(0,1),...fillSeats(1)]);state.seats[0].guard=true;
    state.events=[{seq:1,type:'miss',p:'cpu1',target:1}];
    const {stage,view}=fixture();view.render(publicView(state));
    expect(stage.querySelectorAll('.robot')).toHaveLength(4);expect(stage.querySelector('.guard').textContent).toContain('守られています');
    expect(stage.querySelector('.clear').textContent).toBe('いまは持っていない');
    state.events.push({seq:2,type:'swap',p:1,target:'cpu1'});view.render(publicView(state));expect(stage.querySelector('.clear')).toBeNull();
  });
  it('成立した結果でだけ鈴と猫と全席の得点を出す',()=>{
    const state=initial([...humans.slice(0,1),...fillSeats(1)]);state.phase='result';state.holder='cpu2';state.winner='bell';
    state.seats.forEach((s)=>{s.rank=s.id === 'cpu2' ? 1 : 2;s.score=s.id === 'cpu2' ? 4 : 0;});
    const {stage,view}=fixture();view.render(publicView(state));
    expect(stage.querySelector('[data-id="cpu2"] .bell')).not.toBeNull();expect(stage.querySelectorAll('.cat')).toHaveLength(1);
    expect(stage.querySelectorAll('.results li')).toHaveLength(5);expect(stage.querySelector('.results').textContent).toContain('1位 CPU 2（CPU） 4点');
    const bell=stage.querySelector('.bell');state.remaining=5000;view.render(publicView(state));expect(stage.querySelector('.bell')).toBe(bell);
    state.outcome='incomplete';state.seats.forEach((s)=>{s.rank=null;s.score=0;});view.render(publicView(state));
    expect(stage.querySelector('.bell,.cat')).toBeNull();expect(stage.textContent).toContain('今回は勝負なし');expect(stage.querySelector('.results').textContent).not.toContain('1位');
  });
  it('直近4件だけを示し、止めた時間を表示し、動きを減らす設定を保つ',()=>{
    const state=initial();state.events=Array.from({length:7},(_,i)=>({seq:i+1,type:'auto',p:1}));
    const {stage,view,listeners}=fixture(true);view.render(publicView(state));
    expect(stage.querySelectorAll('.events li')).toHaveLength(4);expect(stage.dataset.motion).toBe('reduce');
    view.hold(true);expect(stage.dataset.frozen).toBe('true');view.dispose();expect(listeners.size).toBe(0);
  });
});

const sdk=vi.hoisted(()=>({connect:vi.fn()}));
vi.mock('./irori.js',()=>({connect:sdk.connect}));
function fakeHost() {
  const listeners=new Map(),pads=new Map();
  return {players:humans.slice(0,1),leader:1,mode:'mock',paused:false,environment:{connected:true,visible:true},
    capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:()=>undefined,ready:vi.fn(),cue:vi.fn(),vibrate:vi.fn(),end:vi.fn(),pads,
    setPad:vi.fn((spec,to)=>pads.set(to,spec)),
    on:(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);},
    emit:(name,...args)=>listeners.get(name)?.(...args)};
}
describe('SDKと公開の画面の接続',()=>{
  beforeEach(()=>{
    vi.resetModules();vi.useFakeTimers();
    vi.stubGlobal('location',{search:''});
    document.body.innerHTML='<main id="stage"></main><p id="status"></p><p id="availability" hidden></p>';
  });
  afterEach(()=>{dispatchEvent(new Event('pagehide'));vi.useRealTimers();});
  async function boot() {
    const host=fakeHost();sdk.connect.mockResolvedValue(host);await import('./main.js');
    await vi.advanceTimersByTimeAsync(0);expect(host.ready).toHaveBeenCalledTimes(1);return host;
  }
  it('人1席だけへ本人のpadを送り、CPU4席を大画面へ足す',async()=>{
    const host=await boot();const pad=host.pads.get(1);
    host.emit('input',1,{k:'tiles',ids:[pad.tiles[0].id],t:pad.token});
    expect(document.querySelectorAll('.robot')).toHaveLength(4);
    expect(host.setPad.mock.calls.every(([,to])=>to === 1)).toBe(true);
    const own=host.pads.get(1);expect(own.tiles).toHaveLength(4);
    expect(document.querySelectorAll('.back')).toHaveLength(20);
    expect(document.querySelector('.bell,.cat')).toBeNull();
    expect(document.querySelector('.table').textContent).not.toMatch(/見えた札|渡した札/);
    const oldToken=own.token;
    host.emit('input',1,{k:'tiles',ids:['invalid'],t:'old'});
    expect(host.pads.get(1).token).not.toBe(oldToken);
  });
  it('人1席とCPUの通常終了で、人の結果だけを8秒後に1回渡す',async()=>{
    const host=await boot();const pad=host.pads.get(1);
    host.emit('input',1,{k:'tiles',ids:[pad.tiles[0].id],t:pad.token});
    for (let i=0;i<120 && document.documentElement.dataset.phase !== 'result';i++) await vi.advanceTimersByTimeAsync(5000);
    expect(document.documentElement.dataset.phase).toBe('result');expect(host.end).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.results li')).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(8100);expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0][0].map((r)=>r.p)).toEqual([1]);
    expect(host.end.mock.calls[0][1].outcome).toBe('complete');
    await vi.advanceTimersByTimeAsync(30000);expect(host.end).toHaveBeenCalledTimes(1);
  });
  it('停止中は時計とCPUを止め、退出のendには人だけを1回渡す',async()=>{
    const host=await boot();const pad=host.pads.get(1);
    host.emit('input',1,{k:'tiles',ids:[pad.tiles[0].id],t:pad.token});
    host.emit('pause');const seconds=document.querySelector('.clock').textContent;
    await vi.advanceTimersByTimeAsync(60000);expect(document.querySelector('.clock').textContent).toBe(seconds);
    expect(host.pads.get(1).k).toBe('wait');
    host.emit('resume');await vi.advanceTimersByTimeAsync(1000);
    expect(document.querySelector('.clock').textContent).not.toBe(seconds);
    host.emit('players',[],null);expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0][0]).toHaveLength(1);expect(host.end.mock.calls[0][0][0].p).toBe(1);
    expect(host.end.mock.calls[0][1].outcome).toBe('incomplete');
    host.emit('players',[],null);await vi.advanceTimersByTimeAsync(20000);expect(host.end).toHaveBeenCalledTimes(1);
    dispatchEvent(new Event('pagehide'));expect(vi.getTimerCount()).toBe(0);
  });
});
