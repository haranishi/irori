import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView} from './logic.js';
import {makeRng,buildDeck} from './cards.js';
import {decide,fillSeats} from './cpu.js';
function simulate(players,seed,verify=true){
  let s=createGame({players,leader:players[0].id,seed,nonce:'sim',environment:{connected:true,visible:true}}).state,ends=0,steps=0;
  const rng=makeRng(seed^0x87a762),n=players.length;
  while(!s.ended&&steps++<2000){
    if(verify){
      if(s.pot+s.seats.reduce((n,v)=>n+v.points,0)!==1000*n)throw Error('点の保存');
      if(s.seats.some(v=>v.points<0||!Number.isInteger(v.points)))throw Error('負数');
      if(s.phase!=='intro'&&[...s.seats.flatMap(v=>v.hand),...s.deck,...s.board].sort().join()!==buildDeck().sort().join())throw Error('札の保存');
      if(!s.revealed.length&&publicView(s).seats.some(v=>'hand'in v))throw Error('公開に手札');
    }
    const p=s.phase==='intro'?s.leader:s.turn;
    let r;
    if(p!==null&&['intro','turn'].includes(s.phase)){
      const view=viewFor(s,p),input=decide(view,p,rng);
      if(!input||input.t!==view.pad.token||!view.pad.tiles.some(t=>!t.off&&t.id===input.ids[0]))throw Error('違法手');
      r=updateGame(s,{t:'input',p,input});if(r.state.epochs[p]!==s.epochs[p]+1&&s.epochs[p]!==undefined)throw Error('入力不受理');
    }else r=updateGame(s,{t:'tick',ms:Math.max(1,s.remaining)});
    for(const e of r.effects){if(e.t==='end')ends++;if(verify&&e.t==='pad'){
      const pad=e.spec;if(pad.note.length>120||pad.tiles.length>20||pad.tiles.some(t=>[...t.label].length>12||!/^[a-z0-9_-]{1,24}$/.test(t.id))||pad.min>pad.max||pad.max>pad.tiles.filter(t=>!t.off).length)throw Error('pad上限');
      if(e.to===undefined)throw Error('全員宛て');
    }}
    s=r.state;
  }
  if(!s.ended||ends!==1||s.outcome!=='complete')throw Error(`終了失敗 ${seed}/${steps}/${s.phase}`);
  return s;
}
const cpuPlayers=n=>Array.from({length:n},(_,i)=>({id:`cpu${i+1}`,name:`CPU ${i+1}`,online:true,cpu:true}));
const humans=()=>Array.from({length:4},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
describe('全人数の自動対戦',()=>{
  it.each([2,3,4,5,6,7,8])('%i席×2000局：全手合法・保存・終了・再現',n=>{
    const wins=Array(n).fill(0),ranks=Array(n).fill(0);
    for(let seed=0;seed<2000;seed++){
      const s=simulate(cpuPlayers(n),seed);s.seats.forEach((v,i)=>{if(v.rank===1)wins[i]++;ranks[i]+=v.rank;});
      if(seed<3)expect(simulate(cpuPlayers(n),seed,false)).toEqual(s);
    }
    console.log(`CPU ${n}席 勝ち=${wins.join(',')} 平均順位=${ranks.map(v=>(v/2000).toFixed(4)).join(',')}`);
  },240000);
  it('人1＋CPU3と人4：各2000局の席ごとの順位差は0.15以内',()=>{
    const solo=[{id:1,name:'席1',online:true},...fillSeats(1)],ranks=Array(4).fill(0),wins=Array(4).fill(0);let soloRanks=0,soloWins=0;
    for(let seed=0;seed<2000;seed++){
      const a=simulate(humans(),seed,false),b=simulate(solo,seed,false);soloRanks+=b.seats[0].rank;if(b.seats[0].rank===1)soloWins++;
      a.seats.forEach((v,i)=>{ranks[i]+=v.rank;if(v.rank===1)wins[i]++;});
      // CPUの印とIDだけで方針や親・配札が変わらないことを全局で照合。
      expect(b.seats.map(v=>[v.points,v.rank])).toEqual(a.seats.map(v=>[v.points,v.rank]));
      expect(publicView(b).results.filter(v=>v.cpu)).toHaveLength(3);
    }
    console.log(`人1+CPU3 平均順位=${(soloRanks/2000).toFixed(4)} 勝ち=${soloWins}/2000`);
    for(let i=0;i<4;i++){const diff=soloRanks/2000-ranks[i]/2000;console.log(`人4 席${i+1} 平均順位=${(ranks[i]/2000).toFixed(4)} 勝ち=${wins[i]}/2000 差=${diff.toFixed(4)}`);expect(Math.abs(diff)).toBeLessThanOrEqual(0.15);}
  },240000);
});
