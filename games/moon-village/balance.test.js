import {describe,expect,it} from 'vitest';
import {createGame,publicView,updateGame} from './logic.js';
import {makeRng} from './roles.js';

const input=(s,p,value)=>updateGame(s,{t:'input',p,input:value}).state;
const tileId=(s,p,to)=>`w${s.nonce}_${s.epochs[p].toString(36)}_${to.toString(36)}`;
const submit=(s,p,to=null)=>input(s,p,{k:'tiles',ids:to===null?[]:[tileId(s,p,to)],...(to===null&&s.phase==='vote'?{pass:true}:{})});

// 村側の知識は、自分の役・生存者・生きた占い師が夜明けに伝える二択だけ。
// 人狼は自分と仲間を知る。全陣営とも、無作為に候補を選び、死亡者の役を参照しない。
function play(n,seed,informed){
  const random=makeRng(seed^0x51a1b);
  const pick=(values)=>values[Math.floor(random()*values.length)]??null;
  const players=Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
  let s=createGame({players,leader:1,environment:{connected:true,visible:true},paused:false,nonce:'balance',seed}).state;
  s=input(s,1,{k:'btn',id:tileId(s,1,1),d:1});
  for(let p=1;p<=n;p++){s=submit(s,p);s=submit(s,p);}
  const known=new Map();
  let seerClaim=null;
  let investigation=null;
  let steps=0;
  let peakDay=0;
  while(s.phase!=='ended'&&steps++<300){
    peakDay=Math.max(peakDay,s.day);
    if(s.phase==='dawn'){
      if(informed&&investigation!==null){
        const seer=s.seats.find((p)=>p.role==='seer');
        if(seer.alive&&s.reports[seer.id]?.includes('さんは')){
          seerClaim=seer.id;known.set(seer.id,false);
          known.set(investigation,s.reports[seer.id].endsWith('さんは人狼です。'));
        }
      }
      investigation=null;s=submit(s,s.leader);continue;
    }
    if(s.phase==='day'||s.phase==='exec'){s=submit(s,s.leader);continue;}
    const alive=s.seats.filter((p)=>p.alive);
    const seat=alive.find((p)=>!(p.id in s.picks));
    if(!seat)throw new Error('No undecided seat');
    let candidates=alive.filter((p)=>p.id!==seat.id&&(!s.runoff||s.candidates.includes(p.id)));
    if(s.phase==='night'){
      if(seat.role==='wolf')candidates=candidates.filter((p)=>p.role!=='wolf');
      if(seat.role==='knight')candidates=candidates.filter((p)=>p.id!==seat.lastGuard);
      if(informed&&seat.role==='seer'){
        const unknown=candidates.filter((p)=>!known.has(p.id));if(unknown.length)candidates=unknown;
      }
      let target=pick(candidates)?.id??null;
      if(informed&&seat.role==='knight'&&candidates.some((p)=>p.id===seerClaim))target=seerClaim;
      if(seat.role==='seer')investigation=target;
      // 行動の無い役も必ず決定する。候補が無い場合だけ、全員共通の時間切れで終える。
      if(target===null){s=updateGame(s,{t:'tick',ms:120000}).state;continue;}
      s=submit(s,seat.id,target);
    }else if(s.phase==='vote'){
      if(seat.role==='wolf'){
        const humans=candidates.filter((p)=>p.role!=='wolf');if(humans.length)candidates=humans;
      }else if(informed&&seat.role!=='madman'){
        const wolves=candidates.filter((p)=>known.get(p.id)===true);
        const unknown=candidates.filter((p)=>!known.has(p.id));
        if(wolves.length)candidates=wolves;else if(unknown.length)candidates=unknown;
      }
      s=submit(s,seat.id,pick(candidates)?.id??null);
    }else throw new Error(`Unexpected phase ${s.phase}`);
  }
  if(s.phase!=='ended')throw new Error(`Unfinished match: ${n}, ${seed}`);
  if(publicView(s).reveal.length!==n)throw new Error('Missing final roles');
  return {winner:s.winner,days:peakDay};
}

describe('配役ごとの無作為な対戦（勝率は規則の変更条件ではなく調整の目安）',()=>{
  for(const informed of [false,true])for(const n of [4,5,6,7,8]){
    it(`${n}人・${informed?'占い結果を使う村側':'無作為な村側'}・2000対戦が終了する`,()=>{
      let wolfWins=0,maxDays=0;
      for(let seed=0;seed<2000;seed++){
        const result=play(n,seed,informed);wolfWins+=result.winner==='wolf'?1:0;maxDays=Math.max(maxDays,result.days);
      }
      const wolfRate=wolfWins/2000,villageRate=1-wolfRate;
      console.info(JSON.stringify({players:n,policy:informed?'informed':'random',matches:2000,wolfWins,villageWins:2000-wolfWins,wolfRate,villageRate,maxDays}));
      if(informed)expect(villageRate).toBeGreaterThanOrEqual(0.4);
      else {expect(wolfRate).toBeGreaterThanOrEqual(0.05);expect(wolfRate).toBeLessThanOrEqual(0.95);}
    },120000);
  }
});
