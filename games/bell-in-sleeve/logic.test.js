import {describe,it,expect} from 'vitest';
import {createGame,updateGame,publicView,viewFor} from './logic.js';
import {CARD_NAMES} from './cards.js';
// 共有部品を読み込まず、公開されたpadの上限を独立に確かめる。
function validPad(pad) {
  if (!['wait','tiles'].includes(pad.k)) return false;
  const allowed=pad.k==='wait'?['k','title','body']:['k','token','tiles','min','max','ok','disabled','note'];
  if (Object.keys(pad).some((k)=>!allowed.includes(k))) return false;
  for(const [key,max] of [['title',24],['body',120],['note',120],['ok',12]])if(pad[key]!==undefined&&[...pad[key]].length>max)return false;
  if(pad.k==='wait')return true;
  const tiles=pad.tiles;
  if(!/^[a-z0-9_-]{1,24}$/.test(pad.token)||tiles.length>20||new Set(tiles.map((t)=>t.id)).size!==tiles.length)return false;
  if(!Number.isInteger(pad.min)||!Number.isInteger(pad.max)||pad.min<0||pad.min>pad.max||pad.max>Math.min(8,tiles.filter((t)=>!t.off).length))return false;
  return tiles.every((t)=>Object.keys(t).every((k)=>['id','label','sub','off'].includes(k))&&/^[a-z0-9_-]{1,24}$/.test(t.id)&&[...t.label].length<=12&&[...t.sub??''].length<=12);
}

const players=(n=3)=>Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
const init=(extra={})=>({players:players(),leader:1,seed:12,nonce:'unit',paused:false,environment:{connected:true,visible:true},...extra});
function pick(s,p,i=0) {
  const pad=viewFor(s,p).pad;
  return updateGame(s,{t:'input',p,input:{k:'tiles',ids:[pad.tiles[i].id],t:pad.token}});
}
function start(extra={}) {return pick(createGame(init(extra)).state,1);}
function scenario(hands,extra={}) {
  const s=updateGame(start().state,{t:'tick',ms:8000}).state;
  s.turn=1;s.step='pickCard';s.h=4;s.seats.forEach((v,i)=>{v.hand=[...hands[i]];v.played=2;});
  return Object.assign(s,extra);
}
const standard=()=>scenario([['peek','guard','swap'],['bell','catch','guard'],['whisper','catch','peek']]);
function effect(s,card,target=1) {
  let r=pick(s,1,s.seats[0].hand.indexOf(card));return pick(r.state,1,target);
}
function freeze(o) {Object.freeze(o);for (const value of Object.values(o)) if(value&&typeof value==='object'&&!Object.isFrozen(value))freeze(value);return o;}

describe('説明・配札・拒否',()=>{
  it('説明はtilesだけ、配札確認8秒のあと種で決まる番になる',()=>{
    const intro=createGame(init());expect(publicView(intro.state).canBegin).toBe(true);
    expect(intro.effects.map((e)=>e.spec.k)).toEqual(['tiles','tiles','tiles']);
    const r=pick(freeze(intro.state),1);expect(r.state.phase).toBe('deal');expect(r.effects.some((e)=>e.t==='cue'&&e.name==='deal')).toBe(true);
    let next=updateGame(r.state,{t:'tick',ms:7999});expect(next.state.phase).toBe('deal');
    next=updateGame(next.state,{t:'tick',ms:1});expect(next.state.phase).toBe('turn');expect(next.state.remaining).toBe(25000);
  });
  it.each(['bell','catch'])('最初の一周は%sを出せない',(card)=>{
    const s=standard();s.seats[0].played=0;s.seats[0].hand=[card,'guard','peek'];
    expect(viewFor(s,1).pad.tiles[0].off).toBe(true);
    const r=pick(freeze(s),1,0);expect(r.state.seats).toEqual(s.seats);expect(r.state.events).toEqual(s.events);
    expect(r.state.epochs[1]).toBe((s.epochs[1]??0)+1);
  });
  it.each([
    {p:2,input:{k:'tiles',ids:['bad'],t:'bad'}},
    {p:1,input:{k:'tiles',ids:['bad'],t:'bad'}},
    {p:1,input:{k:'tiles',ids:[],pass:true}},
    {p:1,input:{k:'btn',ids:[]}},
  ])('不正入力はゲームの中身を変えず、本人のtokenだけ進める',({p,input})=>{
    const s=freeze(standard()),r=updateGame(s,{t:'input',p,input});
    expect({...r.state,epochs:s.epochs}).toEqual(s);
    expect(r.effects).toHaveLength(1);expect(r.effects[0].to).toBe(p);
    expect(viewFor(r.state,p).pad.token).not.toBe(viewFor(s,p).pad.token);
    expect(viewFor(r.state,p===1?2:1).pad.token).toBe(viewFor(s,p===1?2:1).pad.token);
  });
  it('重複・範囲外・古い画面を拒み、押した後の再送で二度出さない',()=>{
    const s=standard(),pad=viewFor(s,1).pad;
    for(const ids of [[pad.tiles[0].id,pad.tiles[0].id],[pad.token+'_99']]) {
      const r=updateGame(freeze(s),{t:'input',p:1,input:{k:'tiles',ids,t:pad.token}});expect(r.state.events).toEqual(s.events);
    }
    const first=pick(s,1),again=updateGame(first.state,{t:'input',p:1,input:{k:'tiles',ids:[pad.tiles[0].id],t:pad.token}});
    expect(again.state.events).toEqual(first.state.events);expect(again.state.seats).toEqual(first.state.seats);
  });
  it('未知の席は無視する',()=>expect(updateGame(standard(),{t:'input',p:99,input:{k:'tiles'}}).effects).toEqual([]));
  it('出せる札が消えた初周は指名なしで札を捨てて進む',()=>{
    const s=standard();s.seats[0].hand=['bell','catch'];s.seats[0].played=0;
    const r=pick(s,1);expect(r.state.turn).toBe(2);expect(r.state.seats[0].hand).toEqual(['bell']);expect(r.state.events.at(-1).type).toBe('skip');
  });
});

describe('5つの札の効果',()=>{
  it('のぞき見の位置は中身を示さず、結果は本人だけ',()=>{
    let r=effect(freeze(standard()),'peek');const s=r.state;
    const pad=viewFor(s,1).pad;expect(pad.tiles.map((t)=>t.label)).toEqual(['1','2','3']);
    const i=s.slots.findIndex((at)=>s.seats[1].hand[at]==='bell');r=pick(freeze(s),1,i);
    expect(r.state.step).toBe('reveal');expect(viewFor(r.state,1).observations.at(-1)).toMatchObject({target:2,card:'bell'});
    expect(viewFor(r.state,2).observations).toEqual([]);expect(viewFor(r.state,3).observations).toEqual([]);
    expect(r.state.remaining).toBe(3000);expect(r.state.seats[1].hand).toEqual(s.seats[1].hand);
    const after=updateGame(r.state,{t:'tick',ms:3000}).state;expect(after.turn).toBe(2);
    expect(viewFor(after,1).notice).toBe('');expect(viewFor(after,1).observations.at(-1).card).toBe('bell');
  });
  it('すりかえで鈴を渡せて、双方に受取札だけ通知する',()=>{
    const s=scenario([['swap','bell','peek'],['guard','catch','whisper'],['peek','catch','guard']]);
    let r=effect(s,'swap');r=pick(r.state,1,0);const received=s.seats[1].hand[r.state.slot];r=pick(r.state,1,0);
    expect(r.state.seats[0].hand[0]).toBe(received);expect(r.state.seats[1].hand).toContain('bell');
    expect(viewFor(r.state,1).notice).toBe(`受け取った札：${CARD_NAMES[received]}`);
    expect(viewFor(r.state,2).notice).toBe('受け取った札：金の鈴');expect(viewFor(r.state,3).notice).toBe('');
    expect(viewFor(r.state,1).observations.at(-1)).toMatchObject({type:'swap',target:2,card:'bell'});
  });
  it.each([false,true])('ひそひそ話は順序%sでも両者が選ぶまで出さない',(reverse)=>{
    const s=scenario([['whisper','guard','peek'],['bell','catch','swap'],['guard','catch','peek']]);
    let r=effect(s,'whisper');expect(r.state.remaining).toBe(30000);
    const order=reverse?[2,1]:[1,2],token=viewFor(r.state,order[1]).pad.token;
    r=pick(r.state,order[0],0);expect(r.state.step).toBe('whisper');expect(viewFor(r.state,1).observations).toEqual([]);
    expect(viewFor(r.state,order[1]).pad.token).toBe(token);
    r=pick(r.state,order[1],0);expect(r.state.step).toBe('reveal');
    expect(viewFor(r.state,1).observations.at(-1).card).toBe('bell');expect(viewFor(r.state,2).observations.at(-1).card).toBe('guard');
    expect(r.state.seats.map((v)=>v.hand)).toEqual([['guard','peek'],s.seats[1].hand,s.seats[2].hand]);
  });
  it('ひそひそ話は未回答だけ時間切れで選ぶ',()=>{
    let r=effect(scenario([['whisper','guard','peek'],['bell','catch','swap'],['guard','catch','peek']]),'whisper');
    r=pick(r.state,1,0);r=updateGame(freeze(r.state),{t:'tick',ms:30000});
    expect(r.state.step).toBe('reveal');expect(viewFor(r.state,2).observations.at(-1).card).toBe('guard');
    expect(r.state.events.filter((e)=>e.type==='auto').map((e)=>e.p)).toEqual([2]);
  });
  it('つかまえるが当たれば得点を付け、8秒後に一度だけend',()=>{
    const s=scenario([['catch','guard'],['bell','peek'],['swap','guard']]);
    let r=effect(s,'catch');expect(r.state.phase).toBe('result');expect(r.state.winner).toBe('stall');
    expect(r.state.seats.map((v)=>v.score)).toEqual([3,0,1]);expect(r.state.seats.map((v)=>v.rank)).toEqual([1,3,2]);
    expect(r.effects.some((e)=>e.t==='end')).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:7999});expect(r.effects.some((e)=>e.t==='end')).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:1});expect(r.effects.filter((e)=>e.t==='end')).toHaveLength(1);
    expect(r.effects.find((e)=>e.t==='end').results).toMatchObject([{p:1,cpu:false},{p:2,cpu:false},{p:3,cpu:false}]);
    expect(updateGame(r.state,{t:'tick',ms:8000}).effects).toEqual([]);
  });
  it('外れた指名は減点し、すりかえの後は白印を消す',()=>{
    const s=scenario([['catch','swap','peek'],['guard','peek','whisper'],['bell','guard','catch']]);
    let r=effect(s,'catch');expect(r.state.seats[0].score).toBe(-1);expect(publicView(r.state).clear).toEqual([2]);
    r.state.turn=1;r.state.step='pickCard';r=effect(r.state,'swap');r=pick(r.state,1,0);r=pick(r.state,1,0);
    expect(publicView(r.state).clear).toEqual([]);
  });
  it('かばうは自分の次の番の終了まで残り、相手の指名を拒む',()=>{
    const s=scenario([['guard','catch','peek'],['catch','peek','guard'],['bell','swap','guard']]);
    let r=effect(s,'guard',0);expect(r.state.seats[0].guard).toBe(true);expect(r.state.turn).toBe(2);
    r=pick(r.state,2,0);const pad=viewFor(r.state,2).pad;
    expect(pad.tiles[0]).toMatchObject({off:true,sub:'守られています'});
    const refused=pick(r.state,2,0);expect(refused.state.seats).toEqual(r.state.seats);
    r.state.turn=1;r.state.step='pickCard';r=effect(r.state,'peek',1);r=pick(r.state,1,0);r=updateGame(r.state,{t:'tick',ms:3000});
    expect(r.state.seats[0].guard).toBe(false);
  });
  it('相手をかばうとその相手の次の番の終了で切れる',()=>{
    let r=effect(standard(),'guard');expect(r.state.seats[1].guard).toBe(true);
    r=pick(r.state,2,2);r=pick(r.state,2,0);expect(r.state.seats[1].guard).toBe(false);
  });
  it('全員が守られている場合は指名を起こさず進む',()=>{
    const s=scenario([['catch','guard'],['bell','peek'],['swap','guard']]);s.seats[1].guard=true;s.seats[2].guard=true;
    const r=pick(s,1);expect(r.state.turn).toBe(2);expect(r.state.events.at(-1).type).toBe('noTarget');
  });
});

describe('終盤・時間・席の出入り',()=>{
  it('全員H−1回出したら45秒の言い合いから30秒の投票へ進む',()=>{
    const s=scenario([['guard','peek'],['bell'],['swap']]);s.seats.forEach((v)=>{v.played=3;});s.seats[0].played=2;
    let r=effect(s,'guard',0);expect(r.state.phase).toBe('talk');expect(r.state.remaining).toBe(45000);
    r=updateGame(r.state,{t:'tick',ms:45000});expect(r.state.phase).toBe('vote');expect(r.state.remaining).toBe(30000);
    expect(viewFor(r.state,1).pad.tiles[0].off).toBe(true);
  });
  it.each([
    [[2,1,2],'stall',[2,0,2],[1,3,1]],
    [[2,3,1],'bell',[0,4,0],[2,1,2]],
    [[3,3,1],'bell',[0,4,0],[2,1,2]],
  ])('同時指名%jの集計と同順位を守る',(votes,winner,scores,ranks)=>{
    let s=scenario([['guard'],['bell'],['peek']],{phase:'vote',remaining:30000});
    for(let p=1;p<=3;p++) s=pick(s,p,votes[p-1]-1).state;
    expect(s.winner).toBe(winner);expect(s.seats.map((v)=>v.score)).toEqual(scores);expect(s.seats.map((v)=>v.rank)).toEqual(ranks);
  });
  it('減点と投票得点を重ねる',()=>{
    let s=scenario([['guard'],['bell'],['peek']],{phase:'vote'});s.seats[0].score=-1;
    for(const [p,i] of [[1,1],[2,0],[3,1]])s=pick(s,p,i).state;
    expect(s.seats.map((v)=>v.score)).toEqual([1,0,2]);
  });
  it.each(['deal','turn','talk','vote','result'])('%sで一時停止と非表示は時計を止める',(phase)=>{
    const s=standard();s.phase=phase;s.remaining=20000;
    for(const e of [{t:'menu',paused:true},{t:'environment',value:{connected:true,visible:false}},{t:'environment',value:null},{t:'environment',value:{connected:false,visible:true}}]) {
      const paused=updateGame(freeze(s),e).state;
      expect(updateGame(paused,{t:'tick',ms:99999}).state.remaining).toBe(20000);
    }
    let r=updateGame(s,{t:'menu',paused:true});r=updateGame(r.state,{t:'menu',paused:false});
    expect(updateGame(r.state,{t:'tick',ms:1234}).state.remaining).toBe(18766);
  });
  it('接続切れだけは時間で合法手を選び、CPUの席は名簿に無くても残す',()=>{
    const s=standard();s.seats[2].cpu=true;s.seats[2].id='cpu1';
    let r=updateGame(s,{t:'players',players:[{...players()[0],online:false},players()[1]],leader:1});
    expect(r.state.phase).toBe('turn');expect(r.state.seats[2].left).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:25000});expect(r.state.step).toBe('pickTarget');expect(r.state.events.at(-2).type).toBe('auto');
  });
  it.each(['intro','deal','turn','talk','vote','result'])('%s中の退出は勝負なしのendを一度だけ送る',(phase)=>{
    const s=standard();s.phase=phase;s.seats[0].score=-1;
    const r=updateGame(s,{t:'players',players:players().slice(1),leader:2});
    expect(r.state.phase).toBe('result');expect(r.state.outcome).toBe('incomplete');
    expect(r.effects.filter((e)=>e.t==='end')).toHaveLength(1);expect(r.state.seats.every((v)=>v.score===0&&v.rank===null)).toBe(true);
    expect(updateGame(r.state,{t:'tick',ms:99999}).effects).toEqual([]);
  });
  it('不正な時間は無視する',()=>{
    const s=standard();for(const ms of [-1,0,NaN,Infinity])expect(updateGame(s,{t:'tick',ms}).state).toBe(s);
  });
});

describe('秘匿とpadの契約',()=>{
  it('隠れた手札・位置・結果を入れ替えても公開状態と無関係な席のpadは同じ',()=>{
    const a=effect(standard(),'peek').state,b=structuredClone(a);
    [b.seats[0].hand[0],b.seats[1].hand[0]]=[b.seats[1].hand[0],b.seats[0].hand[0]];
    b.observations[1]=[{seq:999,type:'peek',target:2,card:'bell'}];b.notices[1]='秘密';b.slots.reverse();
    expect(publicView(a)).toEqual(publicView(b));expect(viewFor(a,3)).toEqual(viewFor(b,3));
    for(const foreign of viewFor(a,1).seats)expect(foreign).not.toHaveProperty('hand');
    expect(publicView(a)).not.toHaveProperty('observations');expect(publicView(a).holder).toBeNull();
    const before=structuredClone(a),v=viewFor(a,1);
    v.events[0].target=99;v.seats[0].name='変更';v.pad.tiles[0].label='変更';
    v.hand.pop();v.events.pop();expect(a).toEqual(before);expect(a.seats[0].hand).toHaveLength(2);expect(a.events).not.toHaveLength(0);
  });
  it('本人だけに秘密の結果を送る。他席へのpadは結果で変わらない',()=>{
    const s=effect(standard(),'peek').state;
    const a=pick(s,1,0),other=structuredClone(s);other.seats[1].hand[s.slots[0]]='whisper';const b=pick(other,1,0);
    expect(a.effects.find((e)=>e.t==='pad'&&e.to===3)).toEqual(b.effects.find((e)=>e.t==='pad'&&e.to===3));
    expect(viewFor(a.state,2).pad.note).toBe(viewFor(b.state,2).pad.note);
    for(const e of a.effects.filter((e)=>e.t==='pad'))expect(e.to).toBeDefined();
  });
  it('日本語と長い名前を含む全段階のpadが独立した上限の検査を通る',()=>{
    const samples=[createGame(init({players:players().map((p)=>({...p,name:'😀'.repeat(24)}))})),start()];
    let r=effect(standard(),'peek');samples.push(r);r=pick(r.state,1);samples.push(r);
    for(const phase of ['talk','vote','result']) {const s=standard();s.phase=phase;s.remaining=45000;samples.push({state:s,effects:s.seats.map((v)=>({t:'pad',to:v.id,spec:viewFor(s,v.id).pad}))});}
    for(const sample of samples)for(const e of sample.effects.filter((e)=>e.t==='pad'))expect(validPad(e.spec),JSON.stringify(e.spec)).toBe(true);
  });
});
