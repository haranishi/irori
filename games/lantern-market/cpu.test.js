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
import {createGame,updateGame,viewFor} from './logic.js';
const init=players=>createGame({players,leader:players[0].id,environment,paused:false,nonce:'cpu2'}).state;
function run(players,seed){
 let state=init(players),steps=0;const rngs=new Map(players.map(p=>[p.id,makeRng((seed+p.id*2654435761)>>>0)]));
 while(state.phase!=='ended'&&steps++<100){const p=state.control?.p??state.seats.find(s=>state.picks[s.id]===undefined)?.id;const input=decide(viewFor(state,p),p,rngs.get(p));if(!input)throw Error('操作なし');const next=updateGame(state,{t:'input',p,input});if(next.state===state)throw Error('非合法手');state=next.state;}
 if(state.phase!=='ended')throw Error('未終了');const best=Math.max(...state.seats.map(s=>s.score));return state.seats.map(s=>({p:s.id,rank:s.score===best?1:2}));
}
it('他席の仮選択を読まず、公開済みの使用札と本人の手札だけを複製する',()=>{
 let state=init(humans(4));state=updateGame(state,{t:'input',p:1,input:decide(viewFor(state,1),1,()=>0)}).state;
 const own=viewFor(state,1),changed=structuredClone(state);changed.picks[2]=6;changed.seats[2].hand.reverse();expect(viewFor(changed,1)).toEqual(own);expect(own).not.toHaveProperty('picks');expect(own.participants.every(s=>!('hand'in s))).toBe(true);
 own.hand.length=0;expect(state.seats[0].hand.length).toBe(6);expect(()=>decide(viewFor(state,1),2,()=>0)).toThrow();
 const choices=new Set();for(let seed=0;seed<2000;seed++)choices.add(decide(viewFor(state,1),1,makeRng(seed)).id);expect(choices.size).toBe(6);
 state=updateGame(state,{t:'menu',paused:true}).state;expect(decide(viewFor(state,1),1,()=>0)).toBeNull();
});
it('同時選択の予約を他席の回答で延期せず、停止・終了で取消す',()=>{
 vi.useFakeTimers();let state=init(fillSeats(0));const send=vi.fn((p,input)=>{state=updateGame(state,{t:'input',p,input}).state;driver.sync();});const driver=createCpuDriver(state.seats.map(s=>s.id),7,p=>viewFor(state,p),send);
 driver.sync();vi.advanceTimersByTime(2000);expect(state.phase).toBe('choose');driver.sync();vi.advanceTimersByTime(2000);expect(state.phase).toBe('reveal');expect(send.mock.calls.length).toBe(5);
 driver.cancel();expect(vi.getTimerCount()).toBe(0);state=updateGame(state,{t:'menu',paused:true}).state;driver.sync();vi.advanceTimersByTime(30000);expect(send.mock.calls.length).toBe(5);
});
describe('全人数の合法手・有限進行・勝率',()=>{
 for(let n=2;n<=8;n++) it(`${n}席を各2000局、同じ種から同じ結果まで進める`,()=>{
  for(let seed=0;seed<2000;seed++){const result=run(humans(n),seed);if(seed<3)expect(run(humans(n),seed)).toEqual(result);}
 },120000);
 it('人1＋CPUとCPUだけを各2000局、最後まで進める',()=>{
  let wins=0,share=0;for(let seed=0;seed<2000;seed++){const result=run([...humans(1),...fillSeats(1)],seed);const first=result.filter(r=>r.rank===1);if(first.some(r=>r.p===1)){wins++;share+=1/first.length;}run(fillSeats(0),seed);}
  console.info(`lantern-market 人席の1位: ${wins}/2000、同率1位を人数で分けた比率: ${(share/20).toFixed(2)}%`);
  expect(share/2000).toBeGreaterThan(.21);expect(share/2000).toBeLessThan(.29);
 },120000);
});
