// @vitest-environment happy-dom
// @ts-check
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const hooks=vi.hoisted(()=>({connect:vi.fn(),createGame:vi.fn(),updateGame:vi.fn()}));
vi.mock('./irori.js',()=>({connect:hooks.connect}));
vi.mock('./logic.js',async(importOriginal)=>({...await importOriginal(),createGame:hooks.createGame,updateGame:hooks.updateGame}));
const logic=await vi.importActual('./logic.js');
const players=Array.from({length:3},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));

beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();
  hooks.createGame.mockImplementation(logic.createGame);hooks.updateGame.mockImplementation(logic.updateGame);
  document.body.innerHTML='<main id="stage"></main><p id="status"></p>';
  delete document.documentElement.dataset.phase;
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  vi.spyOn(Element.prototype,'getAnimations').mockReturnValue([]);
  vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:Promise.resolve(),finish(){},pause(){},play(){},cancel(){}}));
});
afterEach(()=>{dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function fakeHost() {
  const listeners=new Map();const pads=new Map();
  return {
    players,leader:1,environment:{connected:true,visible:true},paused:false,
    capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:()=>undefined,ready:vi.fn(),cue:vi.fn(),vibrate:vi.fn(),end:vi.fn(),pads,
    setPad:vi.fn((spec,to)=>pads.set(to,spec)),
    on:(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);},
    emit:(name,...args)=>listeners.get(name)?.(...args),
  };
}
async function boot() {
  const host=fakeHost();hooks.connect.mockResolvedValue(host);await import('./main.js');
  await vi.waitFor(()=>expect(host.ready).toHaveBeenCalledTimes(1));return host;
}
function prepared(hands,order=[]) {
  // 実際の判定を接続したまま、評価担当が見た局面だけを固定する。
  hooks.createGame.mockImplementation((init)=>{
    const {state}=logic.createGame(init);state.phase='play';state.order=order;
    state.seats.forEach((s,i)=>{s.hand=[...hands[i]];s.rank=order.includes(s.id)?order.indexOf(s.id)+1:null;});
    const active=state.seats.filter((s)=>s.hand.length);state.turn={from:active[0].id,to:active[1].id};
    return logic.updateGame(state,{t:'menu',paused:false});
  });
}
describe('追補D3：mainからスマホと大画面への接続',()=>{
  it('第三者には操作のない待機を送り、再開・復帰でも本人の手札だけを示す',async()=>{
    // 実際のmain接続でも第三者にdisabled tilesを残さない。
    prepared([['s3'],['h4','h5'],['jk','d6']]);const host=await boot();
    const expected={k:'wait',title:'参加者1さんが参加者2さんから札をひいています',body:'あなた：JK ♦6'};
    expect(host.pads.get(3)).toEqual(expected);
    host.emit('pause');host.emit('resume');expect(host.pads.get(3)).toEqual(expected);
    host.emit('players',players.map((p)=>({...p,online:p.id!==3})),1);
    host.emit('players',players,1);expect(host.pads.get(3)).toEqual(expected);
    expect(host.pads.get(1).k).toBe('tiles');expect(host.pads.get(2).k).toBe('wait');
    expect(document.getElementById('stage').textContent).not.toMatch(/JK|♠3|♥4|♥5|♦6/);
    expect(host.setPad.mock.calls.every(([,to])=>typeof to==='number')).toBe(true);
  });
  it('上がりの空手札とジョーカーの専用通知を本人のpadへ渡す',async()=>{
    // 見出しと本文はmainで失わず、他席の画面に専用通知を混ぜない。
    prepared([['s7'],['h7','h3'],['jk','s3']]);let host=await boot();
    let state=hooks.createGame.mock.results[0].value.state;
    host.emit('input',1,{k:'tiles',ids:[logic.drawId(state,0)]});
    expect(host.pads.get(1).body).toBe('あなた：札なし。1位で上がりました');
    dispatchEvent(new Event('pagehide'));vi.resetModules();
    prepared([['s7'],['jk','h7'],['s3','h3']]);host=await boot();
    state=hooks.createGame.mock.results.at(-1).value.state;
    host.emit('input',1,{k:'tiles',ids:[logic.drawId(state,0)]});
    expect(host.pads.get(1).title).toBe('ジョーカーをひきました');
    for(const id of [2,3]) expect(JSON.stringify(host.pads.get(id))).not.toMatch(/ジョーカー|JK/);
    expect(host.vibrate).toHaveBeenCalledWith([60],1);
  });
  it('退出終了では古いひく画面を最終waitへ替え、結果へ記録なしを渡す',async()=>{
    // mainは結果まで演出を待つので、その間も押せる旧padを残してはいけない。
    prepared([[],['s3'],['jk','h3']],[1]);const host=await boot();
    vi.useFakeTimers();expect(host.pads.get(2).k).toBe('tiles');
    host.emit('players',players.filter((p)=>p.id!==3),1);
    for(const id of [1,2]) expect(host.pads.get(id)).toMatchObject({k:'wait',title:'勝負が終わりました'});
    expect(host.pads.get(2).body).toBe('あなた：♠3 JK。2位');
    expect(document.documentElement.dataset.phase).toBe('ended');
    await vi.runAllTimersAsync();
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0][0].map((r)=>r.label)).toEqual(['1番目に上がり','ジョーカーが残った','記録なし']);
    expect(host.setPad.mock.invocationCallOrder.at(-1)).toBeLessThan(host.end.mock.invocationCallOrder[0]);
  });
});
