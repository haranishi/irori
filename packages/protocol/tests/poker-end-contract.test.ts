// 終了の効果を実際のSDKと同じ検証器へ渡す。ゲーム側から共有部品を読まない。
import {describe,it,expect} from 'vitest';
import {validateGameEnd} from '../src/end';
// @ts-ignore 素のJavaScriptの同梱ゲーム
import {createGame,updateGame,viewFor} from '../../../games/poker/logic.js';
// @ts-ignore
import {fillSeats,decide} from '../../../games/poker/cpu.js';
// @ts-ignore
import {makeRng} from '../../../games/poker/cards.js';
function play(n:number,leave:'none'|'one'|'all'='none'){
  const humans=Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
  const players=[...humans,...fillSeats(n)],rng=makeRng(5);
  let s:any=createGame({players,leader:players[0].id,seed:123,nonce:'contract',environment:{connected:true,visible:true}}).state,end:any=null,left=false;
  for(let step=0;step<2000&&!s.ended;step++){
    let event:any;
    if(leave!=='none'&&!left&&s.phase==='turn'){left=true;event={t:'players',players:leave==='all'?players.filter(p=>p.cpu):players.filter(p=>p.id!==1),leader:2};}
    else {const p=s.phase==='intro'?s.leader:s.turn;event=p!==null&&['intro','turn'].includes(s.phase)?{t:'input',p,input:decide(viewFor(s,p),p,rng)}:{t:'tick',ms:Math.max(1,s.remaining)};}
    const r=updateGame(s,event);s=r.state;const e=r.effects.find((e:any)=>e.t==='end');if(e){expect(end).toBeNull();end=e;}
  }
  expect(s.ended).toBe(true);expect(end).not.toBeNull();expect(validateGameEnd(end.results,end.options).ok).toBe(true);
  expect(end.results.map((v:any)=>v.p)).toEqual(humans.map(v=>v.id));
  expect(end.results.every((v:any)=>Object.keys(v).sort().join()==='label,p,ranked,score')).toBe(true);
  return {s,end};
}
describe('持ち点ポーカーの終了契約',()=>{
  it.each([0,1,2,3,4,5])('人%i人の通常終了',n=>{const {end}=play(n);expect(end.options).toEqual({display:'points',outcome:'complete'});});
  it('CPU入りはゲーム内の順位をラベルに残し、コンソールでは順位を付け直さない',()=>{const {s,end}=play(1);expect(end.results[0].ranked).toBe(false);expect(end.results[0].label).toBe(`${s.seats[0].rank}位(CPUこみ)`);const human=play(4).end;expect(human.results.every((v:any)=>v.ranked)).toBe(true);});
  it('途中の1席退出も残った人で通常終了し、退出した人の結果を残す',()=>{const {s,end}=play(3,'one');expect(s.seats[0].left).toBe(true);expect(end.options.outcome).toBe('complete');});
  it('最後の人が退出したら勝負なしで終了',()=>{const {end}=play(1,'all');expect(end.options.outcome).toBe('incomplete');expect(end.results[0]).toMatchObject({ranked:false,label:'勝負なし'});});
  it('余分な項目は拒まれる',()=>expect(validateGameEnd([{p:1,score:1000,label:'1位',ranked:true,cpu:false}],{display:'points',outcome:'complete'})).toEqual({ok:false,reason:'result-shape'}));
});

// 次へで早く終える経路も、通常の時間終了と同じ4項目に限定する。
it('全員の次へによるendもCPUを除く4項目で検証を通る',()=>{
  const players=[{id:1,name:'席1',online:true},...fillSeats(1)];
  let s:any=createGame({players,leader:1,seed:7,nonce:'next',environment:{connected:true,visible:true}}).state;
  s.phase='showdown';s.handNumber=6;s.remaining=1;
  s=updateGame(s,{t:'tick',ms:1}).state;
  const pad=viewFor(s,1).pad;
  const r=updateGame(s,{t:'input',p:1,input:{k:'tiles',t:pad.token,ids:[pad.tiles[0].id]}});
  const end:any=r.effects.find((e:any)=>e.t==='end');
  expect(end).toBeDefined();expect(validateGameEnd(end.results,end.options).ok).toBe(true);
  expect(end.results).toEqual([{p:1,score:1000,label:'1位(CPUこみ)',ranked:false}]);
});
