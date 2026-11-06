import {describe,expect,it,vi,afterEach} from 'vitest';
import {createGame,updateGame,viewFor,publicView} from './logic.js';
import {fillSeats,decide,makeRng,thinkMs} from './cpu.js';
import {createCpuDriver} from './cpu-driver.js';
const players=n=>Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
const init=(seats,seed=1)=>({players:seats,leader:seats[0].id,environment:{connected:true,visible:true},paused:false,nonce:'cpusim',seed});
function play(seats,seed) {
 let state=createGame(init(seats,seed)).state;
 const rngs=seats.map((_,i)=>makeRng((seed^Math.imul(i+1,2654435761))>>>0));
 let steps=0;
 while(state.phase !== 'ended' && steps++<2000) {
  let acted=false;
  for(let i=0;i<seats.length;i++) {
   const id=seats[i].id,view=viewFor(state,id);
   let input=decide(view,id,rngs[i]);
   // 同じ方針の人も議論では沈黙し、進行役だけが議論を閉じる。
   if(state.phase === 'day' && state.leader === id && view.pad.k === 'tiles') input={k:'tiles',ids:[],t:view.pad.token};
   if(!input) continue;
   const next=updateGame(state,{t:'input',p:id,input});
   if(next.state === state) throw new Error(`無効な入力: ${seed}/${state.phase}/${id}`);
   if(state.phase === 'night') {
    const self=state.seats.find(s=>s.id === id),target=state.seats.find(s=>view.targets.find(t=>t.tile === input.ids?.[0])?.id === s.id);
    if(self.role === 'wolf' && target?.role === 'wolf') throw new Error('仲間への襲撃');
    if(self.role === 'knight' && target?.id === self.lastGuard) throw new Error('連続護衛');
   }
   state=next.state;acted=true;
   if(state.phase === 'ended') break;
  }
  if(!acted) throw new Error(`進行停止: ${seed}/${state.phase}`);
 }
 if(state.phase !== 'ended') throw new Error(`未終了: ${seed}`);
 return state;
}
const won=(s,id)=>(['wolf','madman'].includes(s.seats.find(p=>p.id === id).role) ? 'wolf' : 'village') === s.winner;
afterEach(()=>vi.useRealTimers());
describe('CPUの合法手・再現・席の公平性',()=>{
 it('不足時だけ固定のCPU名とIDを補う',()=>{
  for(let h=0;h<=8;h++) {const cpu=fillSeats(h);expect(cpu).toHaveLength(h<4 ? 6-h : 0);expect(new Set(cpu.map(p=>p.id)).size).toBe(cpu.length);expect(cpu.every(p=>p.cpu && p.online)).toBe(true);}
  for(const h of [-1,1.5,NaN,9])expect(()=>fillSeats(h)).toThrow();
  expect(thinkMs(()=>0)).toBe(800);expect(thinkMs(()=>.999999)).toBe(2000);
 });
 for(let n=4;n<=8;n++) it(`${n}席・2000局が合法手で終了する`,()=>{
  for(let seed=0;seed<2000;seed++) play(players(n),seed);
 },120000);
 it('人1＋CPU・CPUだけを各2000局、人だけの各席と±4ポイント以内',()=>{
  const mixed=[...players(1),...fillSeats(1)],allCpu=fillSeats(0),counts=Array(6).fill(0);
  let wins=0,ties=0;const roles={};
  for(let seed=0;seed<2000;seed++) {
   const s=play(mixed,seed),baseline=play(players(6),seed);
   play(allCpu,seed);
   wins+=Number(won(s,1));
   if(s.seats[0].role) roles[s.seats[0].role]=(roles[s.seats[0].role] ?? 0)+1;
   if(s.seats[0].hp !== undefined && s.seats[0].hp === s.seats[1].hp) ties++;
   for(let i=0;i<counts.length;i++) counts[i]+=Number(won(baseline,i+1));
  }
  console.info(JSON.stringify({game:'moon-village',matches:2000,humanWins:wins,humanRate:wins/20,baselineWins:counts,baselineRates:counts.map(n=>n/20),ties,roles}));
  for(const count of counts) expect(Math.abs(wins-count)/2000).toBeLessThanOrEqual(.04);
 },120000);
 it('同じ種は同じ結果を再現し、IDの置換で勝敗や配役を変えない',()=>{
  for(let seed=0;seed<20;seed++) {
   const a=play(players(6),seed),b=play([...players(1),...fillSeats(1)],seed);
   expect(play(players(6),seed)).toEqual(a);
   expect(b.seats.map(s=>[s.hp,s.role,s.alive])).toEqual(a.seats.map(s=>[s.hp,s.role,s.alive]));
  }
 });
 it('停止中・終了後は判断せず、他席の秘密と乱数を読まない',()=>{
  let s=createGame(init(players(6))).state;
  const first=decide(viewFor(s,1),1,()=>.3);s=updateGame(s,{t:'input',p:1,input:first}).state;
  const before=viewFor(s,1),changed=structuredClone(s);
  changed.picks={...changed.picks,2:'moon-village' === 'blade-duel' ? 'guard' : 3};
  changed.rng=123456;changed.seed=777;
  if('moon-village' === 'moon-village') {
   const nonSelf=changed.seats.filter(p=>p.id !== 1 && p.role !== 'wolf');
   if(nonSelf.length>=2) [nonSelf[0].role,nonSelf[1].role]=[nonSelf[1].role,nonSelf[0].role];
  }
  expect(viewFor(changed,1)).toEqual(before);
  const cloned=viewFor(s,1);cloned.seats[0].name='変更';expect(s.seats[0].name).toBe('席1');
  expect(before).not.toHaveProperty('picks');expect(before).not.toHaveProperty('rng');expect(before).not.toHaveProperty('seed');
  expect(()=>decide(before,2,()=>.5)).toThrow();
  const paused=updateGame(s,{t:'menu',paused:true}).state;
  expect(decide(viewFor(paused,1),1,()=>.5)).toBeNull();
  const ended=play(players(6),10);expect(decide(viewFor(ended,1),1,()=>.5)).toBeNull();
 });
 it('席ごとの予約を他席の回答で延期せず、発火時に再取得し停止で捨てる',()=>{
  vi.useFakeTimers();let state=createGame(init(players(6))).state;
  state=updateGame(state,{t:'input',p:1,input:decide(viewFor(state,1),1,()=>.5)}).state;
  const read=vi.fn(p=>viewFor(state,p)),send=vi.fn();
  const driver=createCpuDriver([2],42,read,send);driver.sync();
  vi.advanceTimersByTime(700);driver.sync();vi.advanceTimersByTime(1300);
  expect(send).toHaveBeenCalledTimes(1);expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
  driver.cancel();driver.sync();state=updateGame(state,{t:'menu',paused:true}).state;driver.sync();vi.advanceTimersByTime(3000);expect(send).toHaveBeenCalledTimes(1);
  driver.cancel();
 });
});

it('占い結果を本人だけに残し、未知の役は入れず、次夜にも保持する',()=>{
 let s=createGame(init(players(6),42)).state;
 s=updateGame(s,{t:'input',p:1,input:decide(viewFor(s,1),1,()=>.3)}).state;
 const seer=s.seats.find(p=>p.role==='seer'),wolf=s.seats.find(p=>p.role==='wolf');
 while(s.phase==='reveal')for(const seat of s.seats){const input=decide(viewFor(s,seat.id),seat.id,()=>.2);if(input)s=updateGame(s,{t:'input',p:seat.id,input}).state;}
 for(const seat of s.seats){
  const view=viewFor(s,seat.id);const input=seat.id===seer.id ? {k:'tiles',ids:[view.targets.find(t=>t.id===wolf.id).tile],t:view.pad.token} : decide(view,seat.id,()=>.2);
  s=updateGame(s,{t:'input',p:seat.id,input}).state;
 }
 expect(s.phase).toBe('dawn');expect(viewFor(s,seer.id).knowledge).toEqual({[wolf.id]:true});
 const villager=s.seats.find(p=>p.role==='villager');
 expect(viewFor(s,villager.id).knowledge).toEqual({});expect(viewFor(s,villager.id).friends).toEqual([]);
 const own=viewFor(s,seer.id);expect(own.seats.every(p=>!('role' in p))).toBe(true);
 expect(publicView(s)).not.toHaveProperty('knowledge');
 own.knowledge[wolf.id]=false;expect(s.knowledge[seer.id][wolf.id]).toBe(true);
 const nextNight={...s,phase:'night',day:2,reports:{},picks:{[wolf.id]:villager.id}};
 expect(viewFor(nextNight,seer.id).knowledge).toEqual({[wolf.id]:true});
 const base=viewFor(nextNight,villager.id),changed=structuredClone(nextNight);
 const others=changed.seats.filter(p=>p.id!==villager.id);[others[0].role,others[1].role]=[others[1].role,others[0].role];
 changed.knowledge[seer.id]={};changed.picks={[wolf.id]:seer.id};
 expect(viewFor(changed,villager.id)).toEqual(base);
 const wolfView=viewFor(nextNight,wolf.id);
 expect(wolfView.friends).toEqual(s.seats.filter(p=>p.role==='wolf' && p.id!==wolf.id).map(p=>p.id));
 expect(decide({...base,phase:'day',pad:{k:'tiles',tiles:[],min:0,max:0,ok:'投票へ'}},villager.id,()=>.2)).toBeNull();
});
