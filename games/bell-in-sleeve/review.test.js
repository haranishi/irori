import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView} from './logic.js';
import {buildDeck} from './cards.js';
const players=(n)=>Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
function pick(s,p,i) {
  const pad=viewFor(s,p).pad;
  return updateGame(s,{t:'input',p,input:{k:'tiles',ids:[pad.tiles[i].id],t:pad.token}});
}
function start(n=3,seed=9) {
  return pick(createGame({players:players(n),leader:1,seed,nonce:'review',environment:{connected:true,visible:true}}).state,1,0).state;
}
const tick=(s)=>updateGame(s,{t:'tick',ms:Math.max(1,s.remaining)});
function vote(n=3) {
  const s=start(n);s.phase='vote';s.step='reveal';s.remaining=30000;
  s.seats.forEach((v)=>{v.hand=[v.id===2?'bell':'peek'];});return s;
}
describe('レビューで見つかった進行と結果の境界',()=>{
  it.each([3,4,5,6,7,8])('%i人のつかまえるは人数に応じた周からだけ使える',(n)=>{
    const s=start(n);s.phase='turn';s.turn=1;s.step='pickCard';s.h=n<=5?4:3;
    s.seats[0].hand=['catch','guard','bell'];
    const unlock=n<=4?2:1;
    for(let played=0;played<unlock;played++) {
      s.seats[0].played=played;const before=structuredClone(s);
      expect(viewFor(s,1).pad.tiles[0].off).toBe(true);
      const r=pick(s,1,0);expect({...r.state,epochs:s.epochs}).toEqual(before);
    }
    s.seats[0].played=unlock;expect(viewFor(s,1).pad.tiles[0].off).toBe(false);
    expect(pick(s,1,0).state.step).toBe('pickTarget');
    s.seats[0].played=unlock-1;s.seats[0].hand=['catch','bell'];
    expect(viewFor(s,1).pad.tiles[0].label).toBe('見送る');
    const skipped=pick(s,1,0).state;expect(skipped.seats[0].hand).toEqual(['bell']);expect(skipped.events.at(-1).type).toBe('skip');
  });
  it.each([3,4,5,6,7,8])('%i人の全員切断20局が投票を含めて自動終了する',(n)=>{
    for(let seed=0;seed<20;seed++) {
      let s=start(n,seed),ends=0;
      s=updateGame(s,{t:'players',players:players(n).map((p)=>({...p,online:false})),leader:1}).state;
      for(let i=0;i<500&&!s.ended;i++) {
        const r=tick(s);s=r.state;ends+=r.effects.filter((e)=>e.t==='end').length;
        expect(s.seats.flatMap((v)=>v.hand).concat(s.events.filter((e)=>e.type==='play').map((e)=>e.card)).sort()).toEqual(buildDeck(n).sort());
      }
      expect(s.ended,`seed=${seed}`).toBe(true);expect(ends).toBe(1);expect(s.outcome).toBe('complete');
    }
  });
  it('接続中の放置も全員の時間切れ投票を経て終了する',()=>{
    let s=start(),sawVote=false;
    for(let i=0;i<500&&!s.ended;i++){sawVote ||= s.phase==='vote';s=tick(s).state;}
    expect(sawVote).toBe(true);expect(s.ended).toBe(true);expect(Object.keys(s.votes)).toHaveLength(3);
  });
  it.each(['peek','swap','whisper','guard','catch'])('最後が%sでも全員または一部の未回答票だけ補完する',(card)=>{
    for(const answered of [false,true]) {
      let s=vote();s.card=card;s.step=['guard','catch'].includes(card)?'pickTarget':'reveal';
      if(answered)s=pick(s,1,1).state;
      expect(updateGame(s,{t:'tick',ms:29999}).state.phase).toBe('vote');
      const r=tick(s);expect(r.state.phase).toBe('result');expect(Object.keys(r.state.votes)).toHaveLength(3);
      expect(r.state.events.filter((e)=>e.type==='auto').map((e)=>e.p)).toEqual(answered?[2,3]:[1,2,3]);
      if(answered)expect(r.state.votes[1]).toBe(2);
    }
  });
  it('一斉指名で外した屋台側にも1点を与える',()=>{
    let s=vote(4);for(const [i,target] of [2,3,2,1].entries())s=pick(s,i+1,target-1).state;
    expect(s.winner).toBe('stall');expect(s.seats.map((v)=>v.score)).toEqual([2,0,2,1]);
    expect(s.seats.map((v)=>v.rank)).toEqual([1,4,1,3]);
  });
  it('公開結果とend結果のCPU印を保持し、終了後は全イベントで不変',()=>{
    let s=vote();s.seats[2].id='cpu1';s.seats[2].cpu=true;
    s=pick(s,1,1).state;s=pick(s,2,0).state;s=pick(s,'cpu1',1).state;
    expect(publicView(s).results.find((v)=>v.p==='cpu1').cpu).toBe(true);
    const r=tick(s);s=r.state;expect(r.effects.find((e)=>e.t==='end').results.find((v)=>v.p==='cpu1').cpu).toBe(true);
    const before=structuredClone(s);
    for(const e of [{t:'tick',ms:99999},{t:'input',p:1,input:{k:'tiles',ids:[],t:'old'}},{t:'players',players:[],leader:null},{t:'menu',paused:true},{t:'environment',value:null}]) {
      expect(updateGame(s,e)).toEqual({state:before,effects:[]});expect(s).toEqual(before);
    }
  });
});
