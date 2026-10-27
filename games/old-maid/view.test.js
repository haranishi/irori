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
function fakeHost(roster=players) {
  const listeners=new Map();const pads=new Map();
  return {
    players:roster,leader:1,environment:{connected:true,visible:true},paused:false,
    capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:()=>undefined,ready:vi.fn(),cue:vi.fn(),vibrate:vi.fn(),end:vi.fn(),pads,
    setPad:vi.fn((spec,to)=>pads.set(to,spec)),
    on:(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);},
    emit:(name,...args)=>listeners.get(name)?.(...args),
  };
}
async function boot(roster=players) {
  const host=fakeHost(roster);hooks.connect.mockResolvedValue(host);await import('./main.js');
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
    const expected={k:'wait',title:'札をひいています',body:'参加者1さんが参加者2さんから\nあなた：JK ♦6'};
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
    expect(host.pads.get(1)).toMatchObject({k:'wait',title:'勝負が終わりました'});
    expect(host.pads.get(2)).toMatchObject({k:'wait',title:'退出した人の札が2枚、配られました'});
    expect(host.pads.get(2).body).toBe('あなた：JK。勝負なし（相手が退出）');
    expect(document.documentElement.dataset.phase).toBe('ended');
    await vi.runAllTimersAsync();
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0][0].map((r)=>r.label)).toEqual(['1番目に上がり','勝負なし','記録なし']);
    expect(host.setPad.mock.invocationCallOrder.at(-1)).toBeLessThan(host.end.mock.invocationCallOrder[0]);
  });
});

describe('追補D5：退出で成立した結果の画面接続',()=>{
  it('上がり2人の順位は残し、最後の人を負けと表示せず、結果まで最終waitを送る',async()=>{
    // 成立した退出終了にも「勝敗なし」を出すと、残した上がり順位と矛盾していた。
    const roster=Array.from({length:4},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));
    prepared([[],[],['s3'],['h3','jk']],[1,2]);const host=await boot(roster);
    vi.useFakeTimers();host.emit('players',roster.slice(0,3),1);
    expect(host.pads.get(3)).toEqual({k:'wait',title:'退出した人の札が2枚、配られました',body:'あなた：JK。勝負なし（相手が退出）'});
    await vi.runAllTimersAsync();
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0]).toEqual([
      [{p:1,score:2,ranked:true,label:'1番目に上がり'},{p:2,score:1,ranked:true,label:'2番目に上がり'},
        {p:3,score:0,ranked:false,label:'勝負なし'},{p:4,score:0,ranked:false,label:'記録なし'}],
      {display:'record',outcome:'complete'},
    ]);
    expect(document.querySelector('.turn-line').textContent).toBe('参加者が退出したため、上がった人の順位で終わります');
    expect(document.getElementById('status').textContent).toContain('上がった人の順位で終わります');
    expect(document.querySelector('.seat-joker')).toBeNull();
  });
});
