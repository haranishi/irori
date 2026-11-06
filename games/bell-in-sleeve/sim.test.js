import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView} from './logic.js';
import {decide,fillSeats} from './cpu.js';
import {buildDeck,makeRng} from './cards.js';
// 共有部品を読み込まず、公開されたpadの上限を独立に確かめる。
function validPad(pad) {
  if (!['wait','tiles'].includes(pad.k)) return false;
  const allowed=pad.k==='wait'?['k','title','body']:['k','token','tiles','min','max','ok','disabled','note','hint'];
  if (Object.keys(pad).some((k)=>!allowed.includes(k))) return false;
  for(const [key,max] of [['title',24],['body',120],['note',120],['ok',12],['hint',40]])if(pad[key]!==undefined&&[...pad[key]].length>max)return false;
  if(pad.k==='wait')return true;
  const tiles=pad.tiles;
  if(!/^[a-z0-9_-]{1,24}$/.test(pad.token)||tiles.length>20||new Set(tiles.map((t)=>t.id)).size!==tiles.length)return false;
  if(!Number.isInteger(pad.min)||!Number.isInteger(pad.max)||pad.min<0||pad.min>pad.max||pad.max>Math.min(8,tiles.filter((t)=>!t.off).length))return false;
  return tiles.every((t)=>Object.keys(t).every((k)=>['id','label','sub','off'].includes(k))&&/^[a-z0-9_-]{1,24}$/.test(t.id)&&[...t.label].length<=12&&[...t.sub??''].length<=12);
}


function simulate(n,seed,humans=0,verify=true) {
  const players=humans ? [{id:1,name:'試す人',online:true},...fillSeats(1)] : Array.from({length:n},(_,i)=>({id:`cpu${i+1}`,name:`CPU ${i+1}`,online:true,cpu:true}));
  const rng=makeRng(seed^0x5eeda),leader=players[0].id;
  let r=createGame({players,leader,seed,nonce:'sim',environment:{connected:true,visible:true}}),ends=0,steps=0;
  const phases=new Set(),effects=new Set();let endResults=[];
  while(!r.state.ended && steps++<500) {
    const s=r.state;phases.add(s.phase);
    if (verify) {
      const cards=s.seats.flatMap((v)=>v.hand).concat(s.events.filter((e)=>e.type==='play').map((e)=>e.card));
      if(s.phase!=='intro'&&cards.sort().join()!==buildDeck(players.length).sort().join())throw Error(`札の保存 n=${n} seed=${seed}`);
      if(s.phase!=='intro'&&s.seats.filter((v)=>v.hand.includes('bell')).length!==1)throw Error('鈴が1枚でない');
      for(const e of r.effects) {
        effects.add(e.t);if(e.t!=='pad')continue;
        if(!validPad(e.spec))throw Error(`不正pad ${JSON.stringify(e.spec)}`);
        if(!s.seats.some((v)=>v.id===e.to))throw Error('全員宛に秘密');
      }
    }
    let input=null,p=null;
    for(const own of s.seats) {
      const v=viewFor(s,own.id),decision=decide(v,own.id,rng);
      if(verify) {
        if(v.seats.some((v)=>'hand' in v)||'slots' in v||'picks' in v||'votes' in v)throw Error('隠れた情報');
        if(s.phase!=='result'&&publicView(s).holder!==null)throw Error('鈴の位置');
        if(v.observations.some((o)=>!s.observations[own.id]?.some((mine)=>JSON.stringify(mine)===JSON.stringify(o))))throw Error('他人の結果');
      }
      if(decision) {
        if(v.pad.k!=='tiles'||v.pad.disabled||decision.t!==v.pad.token||decision.ids.length!==1||!v.pad.tiles.some((t)=>t.id===decision.ids[0]&&!t.off))throw Error('CPUの違法手');
        input=decision;p=own.id;break;
      }
    }
    r=input ? updateGame(s,{t:'input',p,input}) : updateGame(s,{t:'tick',ms:Math.max(1,s.remaining)});
    ends+=r.effects.filter((e)=>e.t==='end').length;
    const end=r.effects.find((e)=>e.t==='end');if(end)endResults=end.results;
    if(input&&r.state.events.length===s.events.length&&r.state.phase===s.phase&&r.state.step===s.step&&JSON.stringify(r.state.votes)===JSON.stringify(s.votes)&&JSON.stringify(r.state.picks)===JSON.stringify(s.picks))throw Error('CPUが拒否された');
  }
  if(!r.state.ended||ends!==1||r.state.outcome!=='complete')throw Error(`終了失敗 n=${n} seed=${seed} ${r.state.phase}/${r.state.step}`);
  return {state:r.state,phases,effects,endResults};
}

describe('CPUだけの全人数・全局の合法手と終了',()=>{
  it.each([3,4,5,6,7,8])('%i人×2000局',(n)=>{
    let stall=0,bell=0;const phases=new Set(),effects=new Set();
    for(let seed=0;seed<2000;seed++) {
      const result=simulate(n,seed);
      if(result.state.winner==='stall')stall++;else bell++;
      result.phases.forEach((v)=>phases.add(v));result.effects.forEach((v)=>effects.add(v));
      if(seed<10)expect(simulate(n,seed,0,false).state).toEqual(result.state);
    }
    expect(stall+bell).toBe(2000);expect(stall/2000).toBeGreaterThanOrEqual(0.45);expect(stall/2000).toBeLessThanOrEqual(0.70);expect(phases).toEqual(new Set(['intro','deal','turn','talk','vote','result']));
    console.log(`勝率 ${n}人 屋台 ${stall}/2000 (${(stall/20).toFixed(2)}%) 鈴 ${bell}/2000 (${(bell/20).toFixed(2)}%)`);
  },240000);
  it('人1人＋CPU4席と人だけの局も、同じ入力で最後まで進む',()=>{
    for(let seed=0;seed<100;seed++) {
      const r=simulate(5,seed,1);expect(r.state.seats.filter((v)=>v.cpu)).toHaveLength(4);
      const shown=publicView(r.state).results;
      expect(shown.filter((v)=>v.cpu)).toHaveLength(4);
      for(const v of r.state.seats)expect(shown.find((row)=>row.p===v.id).cpu).toBe(v.cpu);
      // コンソールへ渡す end の結果は、人の席だけ。SDKが受け取る4項目だけ（余分な項目は、検証器が拒む）。
      expect(r.endResults.map((row)=>row.p)).toEqual([1]);
      expect(r.endResults.every((row)=>Object.keys(row).sort().join() === 'label,p,ranked,score')).toBe(true);
    }
    // 人の席にも同じ公開情報の方針で入力を送る。判定はCPUかどうかで手を変えない。
    const original=createGame({players:[1,2,3].map((id)=>({id,name:`席${id}`,online:true})),leader:1,seed:1,nonce:'human',environment:{connected:true,visible:true}});
    let s=original.state;const rng=makeRng(5);
    for(let i=0;i<500&&!s.ended;i++) {
      const action=s.seats.map((v)=>({p:v.id,input:decide(viewFor(s,v.id),v.id,rng)})).find((v)=>v.input);
      s=updateGame(s,action?{t:'input',...action}:{t:'tick',ms:Math.max(1,s.remaining)}).state;
    }
    expect(s.ended).toBe(true);expect(s.seats.every((v)=>!v.cpu)).toBe(true);
  },60000);
});
