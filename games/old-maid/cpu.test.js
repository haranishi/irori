// @ts-check
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createGame,updateGame,viewFor} from './logic.js';
import {decide,fillSeats,thinkMs} from './cpu.js';
import {makeRng} from './cards.js';
import {createCpuDriver} from './cpu-driver.js';
const humans=(n)=>Array.from({length:n},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));
const init=(players,seed=1)=>createGame({players,leader:players[0].id,seed,nonce:'cpu1',paused:false,environment:{connected:true,visible:true}}).state;
function run(players,seed) {
  let state=init(players,seed),steps=0;
  const rng=makeRng(seed^0xaabbccdd);
  while (state.phase !== 'ended' && steps++<20000) {
    const p=state.phase === 'intro' ? state.leader : state.turn.from;
    const input=decide(viewFor(state,p),p,rng);
    if (!input) throw Error(`操作なし seed=${seed} step=${steps}`);
    const next=updateGame(state,{t:'input',p,input});
    if (next.state === state || JSON.stringify(next.state.refused) !== JSON.stringify(state.refused)) throw Error('非合法手');
    state=next.state;
  }
  if (state.phase !== 'ended' || state.outcome !== 'complete') throw Error(`未終了 seed=${seed}`);
  return state.seats.map((s)=>({id:s.id,rank:s.rank}));
}
afterEach(()=>vi.useRealTimers());
describe('CPUの補充と本人用の情報',()=>{
  it('最小人数未満だけ4席へ補い、正の人IDと重ならない',()=>{
    for (let h=0;h<=8;h++) {
      const cpus=fillSeats(h);
      expect(cpus).toHaveLength(h<2 ? 4-h : 0);
      expect(new Set(cpus.map((p)=>p.id)).size).toBe(cpus.length);
      expect(cpus.every((p)=>p.id<0 && p.cpu && p.online && p.name.startsWith('CPU '))).toBe(true);
    }
    for (const n of [-1,1.5,9,NaN]) expect(()=>fillSeats(n)).toThrow(RangeError);
  });
  it('種つきの席位置は人の前後4通りを使い、IDが重ならない',()=>{
    const positions=new Set();
    for(let seed=0;seed<2000;seed++){const rng=makeRng(seed^0x98abcdef),a=fillSeats(1,rng);expect(a).toEqual(fillSeats(1,makeRng(seed^0x98abcdef)));positions.add(a.filter(p=>p.id<1).length);expect(new Set([1,...a.map(p=>p.id)]).size).toBe(4);}
    expect(positions.size).toBe(4);
  });
  it('思考時間は0.8〜2.0秒で種から再現する',()=>{
    const a=makeRng(9),b=makeRng(9);
    for (let i=0;i<2000;i++) {const ms=thinkMs(a);expect(ms).toBe(thinkMs(b));expect(ms).toBeGreaterThanOrEqual(800);expect(ms).toBeLessThanOrEqual(2000);}
    expect(thinkMs(()=>0)).toBe(800);expect(thinkMs(()=>.999999)).toBe(2000);
  });
  it('他席の手札を変えても本人用ビューは変わらず、生の秘密や乱数を含まない',()=>{
    let state=init(humans(4));
    state=updateGame(state,{t:'input',p:1,input:decide(viewFor(state,1),1,()=>0)}).state;
    const own=viewFor(state,1),changed=structuredClone(state);
    for (const seat of changed.seats) if (seat.id!==1) seat.hand=seat.hand.map(()=> 'hidden');
    expect(viewFor(changed,1)).toEqual(own);
    for (const key of ['rngState','seed','stock','excluded','feedback','received','control']) expect(own).not.toHaveProperty(key);
    expect(own.seats.every((s)=>!('hand' in s))).toBe(true);
    own.hand.length=0;expect(state.seats.find((s)=>s.id===1).hand.length).toBeGreaterThan(0);
    expect(()=>decide(viewFor(state,1),2,()=>0)).toThrow();
  });
  it('停止中・番でない席・終了後は入力しない',()=>{
    let state=init(humans(4));state=updateGame(state,{t:'input',p:1,input:decide(viewFor(state,1),1,()=>0)}).state;
    const p=state.turn.from;
    const other=state.seats.find((s)=>s.id!==p).id;
    expect(decide(viewFor(state,other),other,()=>0)).toBeNull();
    state=updateGame(state,{t:'menu',paused:true}).state;
    expect(decide(viewFor(state,p),p,()=>0)).toBeNull();
    state.phase='ended';expect(decide(viewFor(state,p),p,()=>0)).toBeNull();
  });
});
describe('全段階の合法手と有限進行',()=>{
  for (let n=2;n<=8;n++) it(`${n}席で2000局が終了し、同じ種の結果が一致する`,()=>{
    const players=humans(n),wins=Array(n).fill(0);
    for (let seed=0;seed<2000;seed++) {
      const result=run(players,seed);wins[result.findIndex((s)=>s.rank===1)]++;
      if (seed<10) expect(run(players,seed)).toEqual(result);
    }
    console.info(`${n}席の1位回数: ${wins.join(',')}`);
  },120000);
  it('人1＋CPUを2000局、CPUだけを2000局、人だけを1局、自動入力で終える',()=>{
    const cpus=fillSeats(0);
    let wins=0;
    for (let seed=0;seed<2000;seed++) {
      const mixed=[...humans(1),...fillSeats(1,makeRng(seed^0x98abcdef))];
      const result=run(mixed,seed);if (result.find((s)=>s.id===1).rank===1) wins++;
      run(cpus,seed);
    }
    expect(wins/2000).toBeGreaterThanOrEqual(.21);
    expect(wins/2000).toBeLessThanOrEqual(.29);
    run(humans(2),91);
    console.info(`人席を同じ方針で操作した1位: ${wins}/2000`);
  },120000);
});
describe('CPUの予約',()=>{
  it('古い予約を取消し、発火時の最新ビューだけを使う',()=>{
    vi.useFakeTimers();const players=fillSeats(0);let state=init(players);const send=vi.fn();
    const driver=createCpuDriver(players.map((p)=>p.id),1,(p)=>viewFor(state,p),send);
    driver.sync();driver.sync();expect(vi.getTimerCount()).toBe(1);
    state=updateGame(state,{t:'menu',paused:true}).state;
    vi.advanceTimersByTime(2000);expect(send).not.toHaveBeenCalled();
    driver.sync();expect(vi.getTimerCount()).toBe(0);
    state=updateGame(state,{t:'menu',paused:false}).state;
    driver.sync();vi.advanceTimersByTime(2000);expect(send).toHaveBeenCalledTimes(1);
    driver.sync();driver.cancel();vi.advanceTimersByTime(2000);expect(send).toHaveBeenCalledTimes(1);
  });
});
