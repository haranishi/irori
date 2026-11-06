// @ts-check
import {afterEach,describe,expect,it,vi} from 'vitest';
import {decide,fillSeats,thinkMs,makeRng} from './cpu.js';
import {createCpuDriver} from './cpu-driver.js';
const humans=n=>Array.from({length:n},(_,i)=>({id:i+1,name:`P${i+1}`,online:true}));
const environment={connected:true,visible:true};
afterEach(()=>vi.useRealTimers());
it('最小人数未満だけ4席へ補充し、思考時間と乱数を再現する',()=>{
 for(let h=0;h<=8;h++){const seats=fillSeats(h);expect(seats.length).toBe(h<2?4-h:0);expect(seats.every(s=>s.cpu&&s.online&&s.id<0)).toBe(true);expect(new Set(seats.map(s=>s.id)).size).toBe(seats.length);}
 for(const h of [-1,1.5,9,NaN]) expect(()=>fillSeats(h)).toThrow();
 const a=makeRng(1),b=makeRng(1);for(let i=0;i<2000;i++){const t=thinkMs(a);expect(t).toBe(thinkMs(b));expect(t>=800&&t<=2000).toBe(true);}
});
import {createGame,updateGame,publicView,viewFor} from './logic.js';
import {createTiming} from './cpu.js';
const init=(players)=>createGame({players,leader:players[0].id,environment,paused:false,nonce:'cpu2',nowMs:0}).state;
function run(players,seed){
 let state=init(players),now=0;
 const streams=players.map(p=>{const rng=makeRng((seed+p.id*2654435761)>>>0);return {id:p.id,rng,profile:createTiming(rng)};});
 for(let round=0;round<3;round++){
  const p=state.leader,input=decide(viewFor(state,p),p,()=>0);state=updateGame(state,{t:'press',p,id:input.id,down:true,nowMs:now}).state;
  now+=3000;state=updateGame(state,{t:'frame',nowMs:now}).state;
  const events=streams.map(s=>({...s,at:now+s.profile.nextMs(s.rng)})).sort((a,b)=>a.at-b.at);
  for(const s of events){const v=viewFor(state,s.id),input=decide(v,s.id,s.rng);if(!input)throw Error('操作なし');const next=updateGame(state,{t:'press',p:s.id,id:input.id,down:true,nowMs:s.at});if(next.state===state)throw Error('非合法手');state=next.state;}
  now+=21000;
 }
 const rows=publicView(state).rows;const input=decide(viewFor(state,state.leader),state.leader,()=>0);state=updateGame(state,{t:'press',p:state.leader,id:input.id,down:true,nowMs:now}).state;
 if(state.phase!=='ended')throw Error('未終了');
 const best=Math.min(...rows.map(r=>r.totalTenths));return rows.map(r=>({p:r.p,rank:r.totalTenths===best?1:2}));
}
it('約0.35秒の標準偏差と席の偏りを持ち、0〜20秒に収める',()=>{
 const rng=makeRng(92),timing=createTiming(rng);const values=Array.from({length:20000},()=>timing.nextMs(rng));const mean=values.reduce((a,b)=>a+b)/values.length;const sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
 expect(Math.abs(mean-10000-timing.bias)).toBeLessThan(15);expect(sd).toBeGreaterThan(300);expect(sd).toBeLessThan(400);expect(values.every(v=>v>=0&&v<20000)).toBe(true);
});
it('本人用ビューに時刻・他席の回答はなく、合図前と回答後には押さない',()=>{
 let state=init(humans(4));const input=decide(viewFor(state,1),1,()=>0);state=updateGame(state,{t:'press',p:1,id:input.id,down:true,nowMs:0}).state;
 expect(decide(viewFor(state,1),1,()=>0)).toBeNull();state=updateGame(state,{t:'frame',nowMs:3000}).state;
 const own=viewFor(state,1),other=decide(viewFor(state,2),2,()=>0);const changed=updateGame(state,{t:'press',p:2,id:other.id,down:true,nowMs:12345}).state;
 expect(viewFor(changed,1)).toEqual(own);for(const key of ['trial','stops','goAtMs','nowMs','records'])expect(own).not.toHaveProperty(key);
 own.participants[0].name='changed';expect(state.seats[0].name).toBe('P1');
 state=updateGame(state,{t:'menu',paused:true,nowMs:4000}).state;expect(decide(viewFor(state,1),1,()=>0)).toBeNull();expect(()=>decide(viewFor(state,1),2,()=>0)).toThrow();
});
it('再描画で10秒の予定を引き直さず、1回だけ押す。中断と終了で取消す',()=>{
 let state=init(fillSeats(0)),now=0;const send=vi.fn((p,input)=>{state=updateGame(state,{t:'press',p,id:input.id,down:true,nowMs:now}).state;});const driver=createCpuDriver(state.seats.map(s=>s.id),8,p=>viewFor(state,p),send);
 for(let i=0;i<2000&&state.phase!=='ended';i++){now+=16;state=updateGame(state,{t:'frame',nowMs:now}).state;driver.sync(now);if(state.phase==='reveal'){expect(state.records.at(-1).records.every(r=>r.record.elapsedMs>8500&&r.record.elapsedMs<11500)).toBe(true);break;}}
 expect(state.phase).toBe('reveal');expect(send.mock.calls.length).toBe(5);driver.cancel();const count=send.mock.calls.length;driver.sync(now+100);driver.cancel();
 state=updateGame(state,{t:'menu',paused:true,nowMs:now}).state;driver.sync(now+30000);expect(send.mock.calls.length).toBe(count);
});
describe('全人数の合法手・有限進行・勝率',()=>{
 for(let n=2;n<=8;n++) it(`${n}席を各2000局、同じ種から同じ結果まで進める`,()=>{
  for(let seed=0;seed<2000;seed++){const result=run(humans(n),seed);if(seed<3)expect(run(humans(n),seed)).toEqual(result);}
 },120000);
 it('人1＋CPUとCPUだけを各2000局、最後まで進める',()=>{
  let wins=0,share=0;for(let seed=0;seed<2000;seed++){const result=run([...humans(1),...fillSeats(1)],seed);const first=result.filter(r=>r.rank===1);if(first.some(r=>r.p===1)){wins++;share+=1/first.length;}run(fillSeats(0),seed);}
  console.info(`ten-seconds 人席の1位: ${wins}/2000、同率1位を人数で分けた比率: ${(share/20).toFixed(2)}%`);
  expect(share/2000).toBeGreaterThan(.21);expect(share/2000).toBeLessThan(.29);
 },120000);
});
