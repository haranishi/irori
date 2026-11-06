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
import {createRace,tick,tap,standings} from './logic.js';
import {createPace} from './cpu.js';
function run(players,seed){
 const race=createRace(players,0);tick(race,3000);
 const streams=players.map(p=>{const rng=makeRng((seed+p.id*2654435761)>>>0);return {id:p.id,rng,profile:createPace(rng),at:3000};});
 for(const s of streams)s.at+=s.profile.nextMs(s.rng);
 let steps=0;
 while(race.phase!=='over'&&steps++<1000){streams.sort((a,b)=>a.at-b.at);const s=streams[0];const input=decide({self:s.id,pad:{k:'buzzer',label:'連打!'}},s.id,s.rng);const before=race.runners.get(s.id).taps;tap(race,s.id,input,s.at,s.at);if(race.runners.get(s.id).taps!==before+1)throw Error('非合法手');s.at=race.runners.get(s.id).state==='done'?Infinity:s.at+s.profile.nextMs(s.rng);}
 if(race.phase!=='over')throw Error('未終了');return standings(race);
}
it('平均95〜140ms、各打±30%で、人ごとに速さが違う',()=>{
 const means=new Set();for(let seed=0;seed<2000;seed++){const rng=makeRng(seed),pace=createPace(rng);means.add(pace.mean);expect(pace.mean>=95&&pace.mean<=140).toBe(true);for(let i=0;i<40;i++){const ms=pace.nextMs(rng);expect(ms>=pace.mean*.7&&ms<=pace.mean*1.3).toBe(true);}}
 expect(means.size).toBeGreaterThan(1000);
});
it('合図前・停止中・完走後は押さず、再描画で連打予定を延ばさない',()=>{
 let now=0,allowed=false;const rng=makeRng(7);const send=vi.fn();const read=p=>({self:p,pad:allowed?{k:'buzzer',label:'連打!'}:{k:'wait'}});const driver=createCpuDriver([-1],7,read,send);
 driver.sync(now);now=3000;driver.sync(now);expect(send).not.toHaveBeenCalled();allowed=true;
 for(let i=0;i<100;i++){driver.sync(now);now+=16;}expect(send.mock.calls.length).toBeGreaterThan(8);
 allowed=false;driver.cancel();driver.sync(now+30000);expect(decide(read(-1),-1,rng)).toBeNull();expect(()=>decide(read(-1),1,rng)).toThrow();
});
describe('全人数の合法手・有限進行・勝率',()=>{
 for(let n=2;n<=8;n++) it(`${n}席を各2000局、同じ種から同じ結果まで進める`,()=>{
  for(let seed=0;seed<2000;seed++){const result=run(humans(n),seed);if(seed<3)expect(run(humans(n),seed)).toEqual(result);}
 },120000);
 it('人1＋CPUとCPUだけを各2000局、最後まで進める',()=>{
  let wins=0,share=0;for(let seed=0;seed<2000;seed++){const result=run([...humans(1),...fillSeats(1)],seed);const first=result.filter(r=>r.rank===1);if(first.some(r=>r.p===1)){wins++;share+=1/first.length;}run(fillSeats(0),seed);}
  console.info(`tap-race 人席の1位: ${wins}/2000、同率1位を人数で分けた比率: ${(share/20).toFixed(2)}%`);
  expect(share/2000).toBeGreaterThan(.21);expect(share/2000).toBeLessThan(.29);
 },120000);
});
