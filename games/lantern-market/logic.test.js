import {describe,expect,it} from 'vitest';
import {CARDS,PRIZES,choiceId,createGame,evaluateBids,publicView,updateGame} from './logic.js';

const players=(n=3,offline=[])=>Array.from({length:n},(_,i)=>({id:i+1,name:`P${i+1}`,online:!offline.includes(i+1)}));
const init=(overrides={})=>({players:players(),leader:1,environment:{connected:true,visible:true},paused:false,nonce:'market12',...overrides});
const input=(s,p,value)=>updateGame(s,{t:'input',p,input:value});
const control=(s)=>input(s,s.control.p,{k:'btn',id:s.control.id,d:1});
const start=(overrides={})=>control(createGame(init(overrides)).state).state;
const pick=(s,p,card)=>input(s,p,{k:'pick',id:choiceId(s,p,card)});
const round=(s,cards)=>cards.reduce((next,card,i)=>pick(next,i+1,card).state,s);
const event=(s,overrides)=>updateGame(s,overrides).state;
const freeze=(o)=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};

describe('開始とSDKの境界',()=>{
  it.each([2,3,8])('%i人に各6枚を配り、進行役だけに開始を渡す',(n)=>{
    const original=init({players:players(n)});const {state,effects}=createGame(original);
    expect(state.seats.map((s)=>s.hand)).toEqual(Array.from({length:n},()=>[1,2,3,4,5,6]));
    expect(effects.filter((e)=>e.spec.k==='pad').map((e)=>e.to)).toEqual([1]);
    expect(effects.every((e)=>typeof e.to==='number')).toBe(true);
    original.players[0].name='changed';expect(state.seats[0].name).toBe('P1');
    expect(state.seats[0].hand).not.toBe(state.seats[1].hand);
  });
  it.each([0,1,9])('%i人では開始させない',(n)=>{
    const {state,effects}=createGame(init({players:players(n)}));expect(state.control).toBeNull();
    expect(publicView(state).canBegin).toBe(false);expect(effects.every((e)=>e.spec.k==='wait')).toBe(true);
  });
  it.each([{paused:true},{environment:null},{environment:{connected:false,visible:true}},{environment:{connected:true,visible:false}},{players:players(3,[2])}])('中断中は開始しない: %j',(overrides)=>{
    expect(createGame(init(overrides)).state.control).toBeNull();
  });
  it('進行役以外、古いID、離し入力は進行できない',()=>{
    const s=createGame(init()).state;
    for(const [p,id,d] of [[2,s.control.id,1],[1,'start',1],[1,s.control.id,0]]) {
      expect(input(s,p,{k:'btn',id,d})).toEqual({state:s,effects:[]});
    }
    const choosing=control(s).state;expect(choosing.phase).toBe('choose');
    expect(input(choosing,1,{k:'btn',id:s.control.id,d:1}).effects).toEqual([]);
  });
  it('8人でも6市を進め切り、最後の1枚は自動公開する',()=>{
    let s=createGame(init({players:players(8)}));
    const check=(effects)=>effects.filter((e)=>e.t==='pad').forEach((e)=>{
      expect(typeof e.to).toBe('number');
      if(e.spec.k==='choices') expect(e.spec.options.length).toBeGreaterThanOrEqual(2);
    });
    check(s.effects);s=control(s.state);check(s.effects);
    for(let r=0;r<5;r++) {
      for(let p=1;p<=8;p++){s=pick(s.state,p,r+1);check(s.effects);}
      s=control(s.state);check(s.effects);
    }
    expect(s.state.phase).toBe('reveal');expect(s.state.roundIndex).toBe(5);
    expect(s.state.seats.every((seat)=>seat.hand.length===0)).toBe(true);
    const ended=control(s.state);expect(ended.effects[0].t).toBe('end');
  });
});

describe('同時選択と公開',()=>{
  it('一人の選択は公開モデルを一切変えず、本人だけのpadを差し替える',()=>{
    const s=start();const next=pick(s,1,6);
    expect(publicView(next.state)).toEqual(publicView(s));
    expect(next.effects).toEqual([{t:'pad',to:1,spec:{k:'wait',title:'札を伏せました',body:'6の札を受け付けました。全員が選ぶまで、大画面には出ません。'}}]);
    expect(next.state.seats).toEqual(s.seats);
  });
  it('同じ入力・他席のID・使用済みの札・不正な札を無視する',()=>{
    let s=start();const locked=pick(s,1,4).state;
    expect(pick(locked,1,5).state.picks).toEqual({1:4});
    expect(input(s,2,{k:'pick',id:choiceId(s,1,6)})).toEqual({state:s,effects:[]});
    for(const card of [0,7,-1,NaN])expect(pick(s,1,card).effects).toEqual([]);
    s=control(round(s,[4,5,6])).state;
    expect(pick(s,1,4).effects).toEqual([]);
  });
  it('最後の人まで手札と点数を変えず、公開で同時に1枚ずつ消費する',()=>{
    const s=start();let next=pick(s,1,6).state;next=pick(next,2,6).state;
    expect(next.seats).toEqual(s.seats);expect(next.phase).toBe('choose');
    next=pick(next,3,4).state;
    expect(next.phase).toBe('reveal');expect(next.seats.map((x)=>x.hand.length)).toEqual([5,5,5]);
    expect(next.seats.map((x)=>x.score)).toEqual([0,0,3]);expect(next.reveal.winner).toBe(3);
    expect(next.reveal.bids).toEqual([{p:1,card:6,duplicate:true},{p:2,card:6,duplicate:true},{p:3,card:4,duplicate:false}]);
  });
  it('解決順が逆でも同じ結果になり、呼出元の状態を変更しない',()=>{
    const s=freeze(start());const a=round(s,[6,6,5]);
    let b=pick(s,3,5).state;b=pick(b,2,6).state;b=pick(b,1,6).state;
    expect(a).toEqual(b);expect(s.seats.every((seat)=>seat.hand.length===6)).toBe(true);
  });
  it('全ての3人の札の組合せで、重複を除いた最大値だけが勝つ',()=>{
    for(const a of CARDS)for(const b of CARDS)for(const c of CARDS){
      const values=[a,b,c];const unique=values.filter((v)=>values.filter((n)=>n===v).length===1);
      const winner=unique.length?values.indexOf(Math.max(...unique))+1:null;
      expect(evaluateBids(values.map((card,i)=>({p:i+1,card}))).winner).toBe(winner);
    }
  });
  it('8人で同じ札が3枚以上でも、その全てを失格にする',()=>{
    const {winner,bids}=evaluateBids([6,6,6,5,5,4,3,2].map((card,i)=>({p:i+1,card})));
    expect(winner).toBe(6);expect(bids.slice(0,5).every((b)=>b.duplicate)).toBe(true);
  });
  it('市が変わったら古い札IDは受け付けない',()=>{
    const first=start();const old=choiceId(first,1,5);const second=control(round(first,[6,5,4])).state;
    expect(input(second,1,{k:'pick',id:old}).effects).toEqual([]);
    expect(second.revision).toBeGreaterThan(first.revision);
  });
});

describe('持ち越し、最終札、勝負の終了',()=>{
  it('全札が重なった灯を持ち越し、次の勝者にまとめて渡す',()=>{
    let s=round(start(),[6,6,6]);expect(s.carry).toBe(3);expect(s.seats.map((x)=>x.score)).toEqual([0,0,0]);
    s=round(control(s).state,[5,5,4]);expect(s.carry).toBe(0);expect(s.seats[2].score).toBe(9);
    expect(s.reveal).toMatchObject({prize:6,carried:3,awarded:9,winner:3});
  });
  it('最後の1枚は自動で公開し、総合結果まで到達する',()=>{
    let s=start({players:players(2)});const bids=[[6,1],[5,2],[4,3],[3,4],[2,5]];
    for(const pair of bids){s=round(s,pair);s=control(s).state;}
    expect(s.phase).toBe('reveal');expect(s.roundIndex).toBe(5);
    expect(s.reveal.bids.map((b)=>b.card)).toEqual([1,6]);
    expect(s.seats.map((x)=>x.hand)).toEqual([[],[]]);expect(s.seats.map((x)=>x.score)).toEqual([11,22]);
    const end=control(s);expect(end.state.phase).toBe('ended');
    expect(end.effects).toMatchObject([{t:'end',results:[{p:1,score:11,ranked:true},{p:2,score:22,ranked:true}],options:{outcome:'complete'}}]);
    expect(control({...end.state,control:s.control}).effects).toEqual([]);
  });
  it('最終市も重なった灯は誰も獲得せず、同点のまま結果へ渡す',()=>{
    let s=start({players:players(2)});
    for(let card=1;card<=5;card++)s=control(round(s,[card,card])).state;
    expect(s.carry).toBe(33);expect(s.seats.map((x)=>x.score)).toEqual([0,0]);
    const {effects}=control(s);expect(effects[0].options.note).toContain('33点');
    expect(effects[0].results.map((x)=>x.score)).toEqual([0,0]);
  });
  it('任意の有効な2〜8人の勝負で、獲得点+残った灯=全灯の価値となる',()=>{
    for(let n=2;n<=8;n++) {
      let s=start({players:players(n)});
      for(let r=0;r<5;r++) {
        s=round(s,s.seats.map((seat)=>seat.hand[(r+seat.id)%seat.hand.length]));s=control(s).state;
      }
      expect(s.phase).toBe('reveal');expect(s.seats.reduce((sum,seat)=>sum+seat.score,0)+s.carry).toBe(PRIZES.reduce((a,b)=>a+b));
      expect(s.seats.every((seat)=>seat.hand.length===0)).toBe(true);
    }
  });
});

describe('中断、復帰、名簿の変化',()=>{
  it('説明中の退出席を除き、残った2人だけで全員選択を解決できる',()=>{
    let s=createGame(init()).state;
    s=event(s,{t:'players',players:players(2),leader:1});
    expect(s.seats.map((seat)=>seat.id)).toEqual([1,2]);expect(s.control.label).toBe('はじめる');
    s=control(s).state;s=round(s,[6,5]);
    expect(s.phase).toBe('reveal');expect(s.reveal.winner).toBe(1);
    expect(s.reveal.bids).toHaveLength(2);
  });
  it.each(['menu','offline','hidden','player'])('未公開の選択を取り消して明示的な復帰を待つ: %s',(cause)=>{
    let s=pick(start(),1,6).state;const previousId=choiceId(s,2,5);
    const before=structuredClone(s.seats);
    if(cause==='menu')s=event(s,{t:'menu',paused:true});
    if(cause==='offline')s=event(s,{t:'environment',value:{connected:false,visible:true}});
    if(cause==='hidden')s=event(s,{t:'environment',value:{connected:true,visible:false}});
    if(cause==='player')s=event(s,{t:'players',players:players(3,[2]),leader:1});
    expect(s.phase).toBe('recover');expect(s.picks).toEqual({});expect(s.seats.map((x)=>x.hand)).toEqual(before.map((x)=>x.hand));
    expect(s.control).toBeNull();expect(input(s,2,{k:'pick',id:previousId}).effects).toEqual([]);
    s=event(s,{t:'menu',paused:false});s=event(s,{t:'environment',value:{connected:true,visible:true}});s=event(s,{t:'players',players:players(),leader:1});
    expect(s.phase).toBe('recover');expect(s.control.label).toBe('やり直す');
    s=control(s).state;expect(s.phase).toBe('choose');expect(choiceId(s,2,5)).not.toBe(previousId);
    expect(s.seats).toEqual(before);
  });
  it('公開済みの結果に戻っても札や得点を再適用しない',()=>{
    let s=round(start(),[6,5,4]);const seats=structuredClone(s.seats);const reveal=structuredClone(s.reveal);
    s=event(s,{t:'menu',paused:true});expect(s.recoverTarget).toBe('reveal');
    s=event(s,{t:'menu',paused:false});expect(s.control.label).toBe('結果に戻る');
    s=control(s).state;expect(s.phase).toBe('reveal');expect(s.seats).toEqual(seats);expect(s.reveal).toEqual(reveal);
  });
  it('複数の中断理由の全てが解消するまで復帰させない',()=>{
    let s=event(start(),{t:'menu',paused:true});s=event(s,{t:'environment',value:{connected:false,visible:false}});
    s=event(s,{t:'menu',paused:false});expect(s.control).toBeNull();
    s=event(s,{t:'environment',value:{connected:true,visible:false}});expect(s.control).toBeNull();
    s=event(s,{t:'environment',value:{connected:true,visible:true}});expect(s.control.label).toBe('やり直す');
  });
  it('進行役の交代で旧操作は失効し、新進行役だけが進める',()=>{
    let s=round(start(),[6,5,4]);const old=s.control;
    s=event(s,{t:'players',players:players(),leader:2});expect(s.control.p).toBe(2);expect(s.control.id).not.toBe(old.id);
    expect(input(s,1,{k:'btn',id:s.control.id,d:1}).effects).toEqual([]);
    expect(input(s,2,{k:'btn',id:old.id,d:1}).effects).toEqual([]);
    expect(control(s).state.roundIndex).toBe(1);
  });
  it('途中参加者を手札と選択対象へ追加しない',()=>{
    const s=start();const {state,effects}=updateGame(s,{t:'players',players:players(4),leader:1});
    expect(state.seats).toEqual(s.seats);expect(effects).toEqual([{t:'pad',to:4,spec:{k:'wait',title:'次の勝負から参加できます'}}]);
    expect(pick(state,4,6).effects).toEqual([]);
  });
  it.each([1,2,3])('%i番席が退出したら全員の記録を残して勝敗なしで終了する',(left)=>{
    const s=round(start(),[6,5,4]);const next=updateGame(s,{t:'players',players:players().filter((p)=>p.id!==left),leader:left===1?2:1});
    expect(next.state.phase).toBe('ended');expect(next.effects).toMatchObject([{t:'end',options:{outcome:'incomplete'}}]);
    expect(next.effects[0].results).toHaveLength(3);expect(next.effects[0].results.every((r)=>r.ranked===false)).toBe(true);
    expect(next.effects[0].results.map((r)=>r.score)).toEqual([3,0,0]);
    expect(updateGame(next.state,{t:'players',players:[],leader:null}).effects).toEqual([]);
  });
});
