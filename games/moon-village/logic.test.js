import {describe,expect,it} from 'vitest';
import {createGame,publicView,updateGame} from './logic.js';

const players=(n=6,offline=[])=>Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:!offline.includes(i+1)}));
const init=(overrides={})=>({players:players(),leader:1,environment:{connected:true,visible:true},paused:false,nonce:'moon1234',seed:42,...overrides});
const input=(s,p,i)=>updateGame(s,{t:'input',p,input:i});
const id=(s,p,target=p)=>`w${s.nonce}_${s.epochs[p].toString(36)}_${target.toString(36)}`;
const token=(s,p)=>`w${s.nonce}_${(s.epochs[p]??0).toString(36)}`;
const choose=(s,p,to=null,pass=false)=>input(s,p,{k:'tiles',t:token(s,p),ids:to===null?[]:[id(s,p,to)],...(pass?{pass:true}:{})});
const next=(s)=>choose(s,s.leader).state;
const begin=(overrides={})=>{const s=createGame(init(overrides)).state;return input(s,s.leader,{k:'btn',id:id(s,s.leader),d:1}).state;};
const night=(roles=['wolf','wolf','seer','knight','villager','villager'])=>{
  let s=begin({players:players(roles.length)});
  s={...s,seats:s.seats.map((seat,i)=>({...seat,role:roles[i]}))};
  for(const seat of s.seats){s=choose(s,seat.id).state;s=choose(s,seat.id).state;}
  return s;
};
const decisions=(s,targets)=>{
  for(const seat of s.seats.filter((p)=>p.alive&&!p.left))if(!(seat.id in s.picks))s=choose(s,seat.id,targets[seat.id]??null,targets[seat.id]===null).state;
  return s;
};
const toVote=(s)=>next(next(s));
const ev=(s,event)=>updateGame(s,event).state;
const deepFreeze=(o)=>{if(o&&typeof o==='object'){Object.values(o).forEach(deepFreeze);Object.freeze(o);}return o;};

// 通信の実装を読まない独立した上限の検査。ゲームは自分のフォルダとSDKだけを読む。
function checkPadContract(spec){
  const keys={wait:['k','title','body'],pad:['k','stick','buttons','hint'],tiles:['k','tiles','min','max','ok','pass','note','token']};
  expect(Object.keys(keys)).toContain(spec.k);
  expect(Object.keys(spec).every((k)=>keys[spec.k].includes(k))).toBe(true);
  for(const [key,limit] of [['title',24],['body',120],['note',120],['hint',40],['ok',12],['pass',12]])if(spec[key]!==undefined)expect([...spec[key]].length).toBeLessThanOrEqual(limit);
  const items=spec.tiles??spec.buttons??[];
  expect(new Set(items.map((p)=>p.id)).size).toBe(items.length);
  for(const item of items){expect(item.id).toMatch(/^[a-z0-9_-]{1,24}$/);expect([...item.label].length).toBeLessThanOrEqual(12);expect(Object.keys(item).sort()).toEqual(['id','label']);}
  if(spec.k==='tiles'){
    expect(spec.token).toMatch(/^w[a-z0-9]{1,8}_[a-z0-9]+$/);expect(spec.token.length).toBeLessThanOrEqual(24);
    expect(items.length).toBeLessThanOrEqual(20);expect(spec.min).toBeGreaterThanOrEqual(0);expect(spec.max).toBeLessThanOrEqual(Math.min(8,items.length));expect(spec.min).toBeLessThanOrEqual(spec.max);
  }
}

// 許可された他席の情報だけを原文と比較する。日本語の役名の有無だけで漏洩を判断しない。
const roleWords={wolf:'人狼',seer:'占い師',knight:'騎士',madman:'狂人',villager:'村人'};
function checkPrivacy(transition){
  const {state:s,effects}=transition;
  const view=publicView(s);
  expect(Object.keys(view).sort()).toEqual(['phase','day','seats','announce','timer','decided','votes','reveal','leader','canBegin','outcome'].sort());
  expect(view.seats).toEqual(s.seats.map(({id,name,alive,left,online})=>({id,name,alive,left,online})));
  if(s.phase!=='ended'){
    expect(view.reveal).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/"(?:role|picks|reports|checked|showRole|rng|seed|epochs)"/);
  }
  for(const e of effects.filter((e)=>e.t==='pad')){
    expect(typeof e.to).toBe('number');
    checkPadContract(e.spec);
    if(e.spec.k==='tiles')expect(e.spec.token).toBe(token(s,e.to));
    if(s.phase==='ended')continue;
    const receiver=s.seats.find((p)=>p.id===e.to);
    const text=JSON.stringify(e.spec);
    for(const other of s.seats.filter((p)=>p.id!==e.to)){
      expect(text).not.toContain(`${other.name}：${roleWords[other.role]}`);
      if(!(receiver?.role==='wolf'&&other.role==='wolf'))expect(text).not.toContain(`仲間：${other.name}`);
    }
    if(e.spec.note?.startsWith('あなたは')){
      const jobs={villager:'話し合いで人狼を探します。',wolf:'夜に1人を襲います。',seer:'夜に1人が人狼か占います。',knight:'自分以外を守ります。同じ人は2夜続けて守れません。',madman:'人間として数えますが、人狼の勝ちを願います。'};
      const allies=s.seats.filter((p)=>p.id!==e.to&&p.role==='wolf').map((p)=>p.name);
      expect(e.spec.note).toBe(`あなたは【${roleWords[receiver.role]}】。${receiver.role==='wolf'&&allies.length?`仲間：${allies.join('、')}。`:''}${jobs[receiver.role]}`);
      const friends=s.seats.filter((p)=>p.id!==e.to&&p.role==='wolf');
      if(receiver.role==='wolf'&&friends.length)expect(e.spec.note).toContain(`仲間：${friends.map((p)=>p.name).join('、')}`);
      else expect(e.spec.note).not.toContain('仲間：');
    }
    if(s.phase==='dawn'&&receiver&&!receiver.left&&!s.blockers.length&&!s.resumeRequired){
      if(e.to===s.leader)expect(e.spec).toMatchObject({k:'tiles',tiles:[],min:0,max:0,ok:'つづける',note:[s.announce,s.reports[e.to]].filter(Boolean).join('\n')});
      else expect(e.spec).toEqual({k:'wait',title:'夜が明けました',body:s.reports[e.to]??s.announce});
    }
    if(e.spec.body?.includes('さんは')||e.spec.note?.includes('さんは')){
      expect(receiver.role).toBe('seer');expect(s.phase).toBe('dawn');
      expect(e.spec.body??e.spec.note).toBe(e.to===s.leader?[s.announce,s.reports[e.to]].filter(Boolean).join('\n'):s.reports[e.to]);
    }
  }
}

describe('開始と役の確認',()=>{
  it.each([1,4,8])('%i席のintroで全員退出：名簿の作り直しでendに届かず、席も失われていた',(n)=>{
    const s=deepFreeze(createGame(init({players:players(n)})).state);
    const offline=updateGame(s,{t:'players',players:players(n,players(n).map((p)=>p.id)),leader:1});
    expect(offline.state.phase).toBe('intro');expect(offline.effects.some((e)=>e.t==='end')).toBe(false);
    const tr=updateGame(s,{t:'players',players:[],leader:null});
    expect(tr.state).toMatchObject({phase:'ended',outcome:'incomplete',winner:null});
    expect(tr.state.seats).toEqual(s.seats.map((p)=>({...p,left:true,online:false,alive:false})));
    const ends=tr.effects.filter((e)=>e.t==='end');expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({results:s.seats.map((p)=>({p:p.id,score:0,ranked:false,label:'退出'})),options:{display:'record',outcome:'incomplete'}});
    expect(publicView(tr.state).reveal).toBeNull();
    expect(tr.effects.filter((e)=>e.t==='pad').every((e)=>!e.spec.body)).toBe(true);
    for(const event of [
      {t:'players',players:[],leader:null},{t:'players',players:players(n),leader:1},
      {t:'input',p:1,input:{k:'btn',id:id(s,1),d:1}},{t:'input',p:1,input:{k:'tiles',t:token(s,1),ids:[]}},
      {t:'tick',ms:999999},{t:'menu',paused:true},{t:'environment',value:null},
    ]) {const after=updateGame(tr.state,event);expect(after.state).toBe(tr.state);expect(after.effects).toEqual([]);}
  });
  it('最初から席がないintroは全員退出と区別して待ち、その後の参加を受け付ける',()=>{
    const empty=createGame(init({players:[],leader:null}));expect(empty.effects).toEqual([]);
    const tr=updateGame(empty.state,{t:'players',players:[],leader:null});
    expect(tr.state.phase).toBe('intro');expect(tr.effects).toEqual([]);
    expect(ev(tr.state,{t:'players',players:players(4),leader:1}).seats).toHaveLength(4);
  });
  it.each([4,5,6,7,8])('%i人の開始・確認・夜に進み、役は本人にだけ送る',(n)=>{
    let tr=createGame(init({players:players(n)}));checkPrivacy(tr);
    expect(publicView(tr.state).canBegin).toBe(true);
    expect(tr.effects.filter((e)=>e.spec?.k==='pad').map((e)=>e.to)).toEqual([1]);
    let s=tr.state;tr=input(s,1,{k:'btn',id:id(s,1),d:1});checkPrivacy(tr);s=tr.state;
    for(const seat of s.seats){tr=choose(s,seat.id);checkPrivacy(tr);s=tr.state;tr=choose(s,seat.id);checkPrivacy(tr);s=tr.state;}
    expect(s.phase).toBe('night');expect(s.day).toBe(1);
    expect(tr.effects.some((e)=>e.t==='cue'&&e.name==='night')).toBe(true);
  });
  it.each([0,1,2,3,9])('%i人では開始不可',(n)=>expect(publicView(createGame(init({players:players(n)})).state).canBegin).toBe(false));
  it.each([{paused:true},{environment:null},{environment:{connected:false,visible:true}},{environment:{connected:true,visible:false}},{players:players(6,[2])}])('中断中は開始しない %j',(overrides)=>{
    const s=createGame(init(overrides)).state;expect(s.blockers.length).toBeGreaterThan(0);expect(publicView(s).canBegin).toBe(false);
  });
  it('開始前の名簿を更新し、進行役以外・古い開始・離し入力を無視する',()=>{
    let s=createGame(init()).state;
    for(const [p,key,d] of [[2,id(s,1),1],[1,'wrong',1],[1,id(s,1),0]])expect(input(s,p,{k:'btn',id:key,d})).toEqual({state:s,effects:[]});
    const old=id(s,1);s=ev(s,{t:'players',players:players(4),leader:2});
    expect(s.seats).toHaveLength(4);expect(input(s,1,{k:'btn',id:old,d:1}).effects).toEqual([]);
    expect(input(s,2,{k:'btn',id:id(s,2),d:1}).state.phase).toBe('reveal');
  });
  it('nonce・種・議論時間・重複席を検証し、呼出元から状態を切り離す',()=>{
    for(const overrides of [{nonce:'UPPER'},{seed:NaN},{discussMs:0},{discussMs:Infinity},{players:[...players(),players()[0]]}])expect(()=>createGame(init(overrides))).toThrow(RangeError);
    const original=init();const s=createGame(original).state;original.players[0].name='変更';original.environment.visible=false;
    expect(s.seats[0].name).toBe('席1');expect(s.environment.visible).toBe(true);
  });
});

describe('夜と夜明けの全組合せ',()=>{
  it('初日・最多票・票割れ・護衛・連続護衛・占いを3750局面で解決する',()=>{
    const base=night();let cases=0;
    for(const day of [1,2])for(const lastGuard of [null,5,6])
      for(const a of [2,3,4,5,6])for(const b of [1,3,4,5,6])for(const c of [1,2,4,5,6])for(const d of [1,2,3,5,6]){
        const s={...base,day,seats:base.seats.map((p)=>({...p,lastGuard:p.role==='knight'?lastGuard:null}))};
        const after=decisions(s,{1:a,2:b,3:c,4:d,5:6,6:5});
        const targets=[a===2?null:a,b===1?null:b].filter((x)=>x!==null);
        const possible=[...new Set(targets)];
        const dead=after.seats.filter((p)=>!p.alive).map((p)=>p.id);
        const guard=d===lastGuard?null:d;
        expect(after.phase).toBe('dawn');
        if(day===1||!possible.length)expect(dead).toEqual([]);
        else if(possible.length===1)expect(dead).toEqual(possible[0]===guard?[]:possible);
        else {expect(dead.length).toBeLessThanOrEqual(1);if(dead.length)expect(possible).toContain(dead[0]);else expect(possible).toContain(guard);}
        expect(after.seats[3].lastGuard).toBe(guard);
        expect(after.reports[3]).toBe(`席${c}さんは${c<=2?'人狼':'人狼ではない'}です。`);
        if(d===lastGuard)expect(after.reports[4]).toContain('続けて守れない');
        expect(after.rng).toBe(decisions(s,{1:a,2:b,3:c,4:d,5:6,6:5}).rng);
        expect(publicView(after).reveal).toBeNull();cases++;
      }
    expect(cases).toBe(3750);
  },20000);
  it('割れた人狼票を種つきで選び、両候補が選ばれ、入力順には依存しない',()=>{
    const seen=new Set();
    for(let rng=0;rng<80;rng++){
      const s={...night(),day:2,rng};
      const a=decisions(s,{1:5,2:6,3:1,4:3,5:6,6:5});seen.add(a.seats.find((p)=>!p.alive).id);
      let b=s;for(const p of [6,5,4,3,2,1])b=choose(b,p,{1:5,2:6,3:1,4:3,5:6,6:5}[p]).state;
      expect(a).toEqual(b);
    }
    expect([...seen].sort()).toEqual([5,6]);
  });
  it('狂人の占いは人狼ではなく、守りと占いは同時に有効、襲われた占い師も結果を受け取る',()=>{
    let s={...night(['wolf','wolf','seer','knight','madman','villager','villager']),day:2};
    let tr;for(const [p,target] of [[1,3],[2,3],[3,5],[4,5],[5,6],[6,7],[7,6]]){tr=choose(s,p,target);s=tr.state;}
    expect(s.seats[2].alive).toBe(false);expect(s.reports[3]).toBe('席5さんは人狼ではないです。');
    expect(tr.effects.find((e)=>e.t==='pad'&&e.to===3).spec.body).toBe(s.reports[3]);checkPrivacy(tr);
    s={...night(),day:2};s=decisions(s,{1:5,2:5,3:5,4:5,5:6,6:5});expect(s.seats[4].alive).toBe(true);expect(s.reports[3]).toBe('席5さんは人狼ではないです。');
  });
  it('選べない仲間と連続護衛の理由を確定前には返さず、夜明けに本人だけへ返す',()=>{
    let s=night();s={...s,seats:s.seats.map((p)=>({...p,lastGuard:p.id===4?5:null}))};
    const tr=choose(s,1,2);expect(tr.effects).toEqual([{t:'pad',to:1,spec:{k:'wait',title:'全員の決定を待っています'}}]);
    s=decisions(tr.state,{2:1,3:1,4:5,5:6,6:5});
    expect(s.reports[1]).toContain('仲間');expect(s.reports[4]).toContain('続けて');expect(publicView(s).announce).toBe('今朝は誰も襲われませんでした');
  });
  it('役を見る操作は未決定のままで、全役の夜の画面は同じ形',()=>{
    const s=night(['wolf','wolf','seer','knight','madman','villager','villager']);
    const waiting=ev(ev(s,{t:'menu',paused:true}),{t:'menu',paused:false});
    const resumed=choose(waiting,waiting.leader);
    const specs=resumed.effects.filter((e)=>e.t==='pad').map((e)=>e.spec);
    expect(specs).toHaveLength(7);
    expect(new Set(specs.map(({k,note,ok,pass,min,max})=>JSON.stringify({k,note,ok,pass,min,max}))).size).toBe(1);
    expect(specs.every((p)=>p.tiles.length===6&&p.tiles.every((t)=>!('off' in t)))).toBe(true);
    let tr=choose(s,3,null,true);expect(tr.state.picks).toEqual({});expect(tr.effects[0].spec.note).toContain('あなたは【占い師】');
    tr=choose(tr.state,3);expect(tr.effects[0].spec.k).toBe('tiles');expect(tr.effects[0].spec.pass).toBe('役を見る');
    const t=ev(tr.state,{t:'tick',ms:120000});expect(t.phase).toBe('dawn');expect(Object.keys(t.reports)).toHaveLength(7);
  });
});

describe('昼・投票・決選・勝敗',()=>{
  it('議論は既定180秒、進行役が1分延長・省略でき、経過時間だけで進む',()=>{
    let s=next(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));
    expect(s.phase).toBe('day');expect(publicView(s).timer).toEqual({remaining:180000,total:180000});
    expect(choose(s,2).effects).toEqual([]);
    s=choose(s,s.leader,null,true).state;expect(s.remaining).toBe(240000);expect(s.total).toBe(240000);
    s=ev(s,{t:'tick',ms:239999});expect(s.phase).toBe('day');s=ev(s,{t:'tick',ms:1});expect(s.phase).toBe('vote');
    expect(publicView(s).votes).toBeNull();
    const short=next({...s,phase:'dawn',discussMs:7000});expect(short.remaining).toBe(7000);expect(next(short).phase).toBe('vote');
  });
  it('投票がそろうまで票を隠し、同数の人だけで決選を1回、再同数は処刑なし',()=>{
    let s=toVote(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));
    const targets={1:5,2:5,3:6,4:6,5:6,6:5};
    for(let p=1;p<6;p++){s=choose(s,p,targets[p]).state;expect(publicView(s).votes).toBeNull();}
    const tr=choose(s,6,5);s=tr.state;expect(s.phase).toBe('vote');expect(s.runoff).toBe(true);expect(s.candidates).toEqual([5,6]);
    expect(publicView(s).votes).toEqual(Object.entries(targets).map(([from,to])=>({from:Number(from),to})));
    expect(tr.effects.filter((e)=>e.t==='cue').map((e)=>e.name)).toEqual(['reveal','vote']);
    expect(choose(s,1,3).effects).toEqual([]);
    s=decisions(s,targets);expect(s.phase).toBe('exec');expect(s.seats.every((p)=>p.alive)).toBe(true);expect(s.announce).toContain('処刑しません');
    expect(next(s).phase).toBe('night');expect(next(s).day).toBe(2);
  });
  it('棄権は票を持たず、全棄権なら決選なし。決選の最多票の1人だけを処刑する',()=>{
    const vote=toVote(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));
    const none=decisions(vote,{1:null,2:null,3:null,4:null,5:null,6:null});
    expect(none.phase).toBe('exec');expect(none.votes.every((v)=>v.to===null)).toBe(true);expect(none.runoff).toBe(false);
    const runoff=decisions(vote,{1:5,2:5,3:6,4:6,5:6,6:5});
    const resolved=decisions(runoff,{1:5,2:5,3:5,4:5,5:6,6:5});expect(resolved.seats.filter((p)=>!p.alive).map((p)=>p.id)).toEqual([5]);
    expect(publicView(resolved).reveal).toBeNull();
  });
  it('夜・投票の2分は最後の決定から。役の確認だけでは延長せず、未決定は行動なし・棄権',()=>{
    let s=ev(night(),{t:'tick',ms:119999});s=choose(s,1,5).state;expect(s.remaining).toBe(120000);
    s=ev(s,{t:'tick',ms:119999});s=choose(s,2,null,true).state;expect(s.remaining).toBe(1);
    s=ev(s,{t:'tick',ms:1});expect(s.phase).toBe('dawn');expect(s.seats.every((p)=>p.alive)).toBe(true);
    s=toVote(s);s=ev(s,{t:'tick',ms:119999});s=choose(s,1,5).state;expect(s.remaining).toBe(120000);
    s=ev(s,{t:'tick',ms:120000});expect(s.phase).toBe('exec');expect(s.seats[4].alive).toBe(false);expect(s.votes.filter((v)=>v.to===null)).toHaveLength(5);
  });
  it('夜明けと処刑後に直ちに判定し、狂人は人間の人数、人狼側の勝敗に入れる',()=>{
    let s={...night(['wolf','seer','knight','madman','villager']),day:2};
    s={...s,seats:s.seats.map((p)=>({...p,alive:[1,2,4].includes(p.id)}))};
    s=decisions(s,{1:2,2:1,4:2});expect(s.phase).toBe('ended');expect(s.winner).toBe('wolf');
    s=toVote(decisions(night(['wolf','seer','villager','villager']),{1:3,2:1,3:4,4:3}));
    let tr;for(const p of [1,2,3,4]){tr=choose(s,p,p===1?2:1);s=tr.state;}
    expect(s.phase).toBe('ended');expect(s.winner).toBe('village');
    const end=tr.effects.find((e)=>e.t==='end');expect(end.options).toMatchObject({display:'record',outcome:'complete'});
    expect(end.results.map((r)=>[r.score,r.label,r.ranked])).toEqual([[0,'人狼・負け',true],[1,'村人・勝ち',true],[1,'村人・勝ち',true],[1,'村人・勝ち',true]]);
    expect(publicView(s).reveal).toHaveLength(4);
    for(const event of [{t:'tick',ms:1},{t:'players',players:[],leader:null},{t:'menu',paused:true}])expect(updateGame(s,event)).toEqual({state:s,effects:[]});
  });
  it('4〜8人の生死の全組合せ496局面と各人間職で、0狼・同数・狂人の人数を判定する',()=>{
    let cases=0;
    for(let n=4;n<=8;n++)for(const humanRole of ['villager','seer','knight','madman']){
      const base=night(Array.from({length:n},(_,i)=>i<(n>=6?2:1)?'wolf':humanRole));
      for(let mask=0;mask<(1<<n);mask++){
        const s={...base,seats:base.seats.map((p,i)=>({...p,alive:!!(mask&(1<<i))}))};
        const wolves=s.seats.filter((p)=>p.alive&&p.role==='wolf').length;
        const humans=s.seats.filter((p)=>p.alive&&p.role!=='wolf').length;
        const after=ev(s,{t:'players',players:players(n),leader:1});
        expect(after.winner).toBe(wolves===0?'village':wolves>=humans?'wolf':null);
        cases++;
      }
    }
    expect(cases).toBe(1984);
  });
});

describe('夜明け・処刑後のスマホ進行',()=>{
  const announcement=(phase,roles)=>{
    const dawn=decisions(night(roles),{1:5,2:5,3:1,4:3,5:6,6:5});
    return phase==='dawn'?dawn:decisions(toVote(dawn),{1:null,2:null,3:null,4:null,5:null,6:null});
  };
  it.each(['dawn','exec'])('%sはリーダーだけに空の「つづける」を送り、本人の入力で進む',(phase)=>{
    const before=announcement(phase);
    // 全画面を再送させ、リーダー以外の操作がないことも調べる。
    const s=next(ev(ev(before,{t:'menu',paused:true}),{t:'menu',paused:false}));
    const tr=updateGame(s,{t:'players',players:players(),leader:3});
    const leaderPad=tr.effects.find((e)=>e.t==='pad'&&e.to===3).spec;
    expect(leaderPad).toEqual({k:'tiles',tiles:[],min:0,max:0,ok:'つづける',note:[s.announce,phase==='dawn'?s.reports[3]:null].filter(Boolean).join('\n'),token:token(tr.state,3)});
    expect(tr.effects.find((e)=>e.t==='pad'&&e.to===1).spec.k).toBe('wait');checkPrivacy(tr);
    const accepted=choose(tr.state,3);expect(accepted.state.phase).toBe(phase==='dawn'?'day':'night');
    expect(accepted.state.day).toBe(phase==='dawn'?1:2);checkPrivacy(accepted);
    expect(input(accepted.state,3,{k:'tiles',t:leaderPad.token,ids:[]})).toEqual({state:accepted.state,effects:[]});
  });
  it.each(['dawn','exec'])('%sで他席・古いt・tなし・札あり・パスは無視する',(phase)=>{
    const s=deepFreeze(announcement(phase));
    const invalid=[
      [2,{k:'tiles',t:token(s,2),ids:[]}],
      [1,{k:'tiles',t:'old',ids:[]}],
      [1,{k:'tiles',ids:[]}],
      [1,{k:'tiles',t:token(s,1),ids:[id(s,1,2)]}],
      [1,{k:'tiles',t:token(s,1),ids:[],pass:true}],
    ];
    for(const [p,value] of invalid){const tr=input(s,p,value);expect(tr.state).toBe(s);expect(tr.effects).toEqual([]);}
    expect(next(s).phase).toBe(phase==='dawn'?'day':'night');
  });
  it.each(['dawn','exec'])('%sで脱落したリーダーにも進行を残す',(phase)=>{
    let s=ev(night(),{t:'players',players:players(),leader:5});
    let tr;
    if(phase==='dawn'){
      s={...s,day:2};
      for(const p of [1,2,3,4,5,6]){tr=choose(s,p,{1:5,2:5,3:1,4:3,5:6,6:5}[p]);s=tr.state;}
    }else{
      s=toVote(decisions(s,{1:5,2:5,3:1,4:3,5:6,6:5}));
      for(const p of [1,2,3,4,5,6]){tr=choose(s,p,p===5?6:5);s=tr.state;}
    }
    expect(s.phase).toBe(phase);expect(s.seats[4].alive).toBe(false);expect(s.leader).toBe(5);
    expect(tr.effects.find((e)=>e.t==='pad'&&e.to===5).spec).toMatchObject({k:'tiles',tiles:[],ok:'つづける',note:s.announce});
    checkPrivacy(tr);expect(next(s).phase).toBe(phase==='dawn'?'day':'night');
  });
  it.each(['dawn','exec'])('%sで退出したリーダーの代わりは最小番号の生存席になる',(phase)=>{
    const base=announcement(phase,['villager','villager','wolf','knight','seer','villager']);
    // 席2は脱落済み。名簿順・ホストの候補が脱落席でも、生存席3に渡す。
    const s={...base,seats:[...base.seats].reverse().map((p)=>({...p,alive:p.id!==2}))};
    const roster=players().filter((p)=>p.id!==1).reverse();
    for(const hint of [2,6,1,null]){
      const tr=updateGame(s,{t:'players',players:roster,leader:hint});
      expect(tr.state.leader).toBe(3);expect(tr.state.phase).toBe(phase);
      expect(tr.effects.find((e)=>e.t==='pad'&&e.to===3).spec).toMatchObject({k:'tiles',tiles:[],ok:'つづける'});
      expect(choose(tr.state,1).effects).toEqual([]);expect(choose(tr.state,2).effects).toEqual([]);
      // 次の名簿通知で脱落席へ操作が戻ってしまう回帰も防ぐ。
      expect(ev(tr.state,{t:'players',players:roster,leader:2}).leader).toBe(3);
      checkPrivacy(tr);expect(next(tr.state).phase).toBe(phase==='dawn'?'day':'night');
    }
  });
  it.each(['dawn','exec'])('%sで脱落リーダーが切断したら接続中の生存席へ渡す',(phase)=>{
    const base=announcement(phase);
    const s={...base,leader:5,seats:base.seats.map((p)=>({...p,alive:p.id!==5}))};
    const tr=updateGame(s,{t:'players',players:players(6,[5]),leader:5});
    expect(tr.state.leader).toBe(1);expect(tr.state.blockers).toEqual([]);expect(tr.state.phase).toBe(phase);
    expect(tr.state.seats[4]).toMatchObject({alive:false,left:false,online:false});
    expect(tr.effects.find((e)=>e.t==='pad'&&e.to===1).spec).toMatchObject({k:'tiles',tiles:[],ok:'つづける'});
    expect(choose(tr.state,5).effects).toEqual([]);checkPrivacy(tr);
    expect(next(tr.state).phase).toBe(phase==='dawn'?'day':'night');
  });
  it.each(['dawn','exec'])('%sでリーダーの切断中は待ち、復帰確認後に新しいtで進む',(phase)=>{
    const s=announcement(phase);const old={k:'tiles',t:token(s,1),ids:[]};
    const stopped=updateGame(s,{t:'players',players:players(6,[1]),leader:1});
    expect(stopped.state.phase).toBe(phase);expect(stopped.state.seats[0].alive).toBe(true);
    expect(stopped.state.blockers).toContain('player-offline');
    expect(stopped.effects.filter((e)=>e.t==='pad').every((e)=>e.spec.k==='wait')).toBe(true);
    expect(input(stopped.state,1,old).effects).toEqual([]);
    const reconnected=updateGame(stopped.state,{t:'players',players:players(),leader:1});
    expect(reconnected.state.resumeRequired).toBe(true);expect(reconnected.state.phase).toBe(phase);
    expect(input(reconnected.state,1,old).effects).toEqual([]);
    const resumed=choose(reconnected.state,1);expect(resumed.state.phase).toBe(phase);
    const spec=resumed.effects.find((e)=>e.t==='pad'&&e.to===1).spec;
    expect(spec).toMatchObject({k:'tiles',tiles:[],ok:'つづける'});expect(spec.token).not.toBe(old.t);
    expect(input(resumed.state,1,old).effects).toEqual([]);checkPrivacy(resumed);
    expect(next(resumed.state).phase).toBe(phase==='dawn'?'day':'night');
  });
});

describe('画面tokenと遅延した空入力',()=>{
  it('夜の「役を見る」が遅れて投票の棄権になるのを防ぐ',()=>{
    const original=night();const p=3;
    const old={k:'tiles',t:token(original,p),ids:[],pass:true};
    const shown=input(original,p,old);expect(shown.effects[0].spec.note).toContain('あなたは');
    const hidden=choose(shown.state,p).state;
    const vote=toVote(decisions(hidden,{1:5,2:5,3:1,4:3,5:6,6:5}));
    expect(vote.phase).toBe('vote');
    expect(input(vote,p,old)).toEqual({state:vote,effects:[]});
    expect(choose(vote,p,null,true).state.picks[p]).toBeNull();
  });
  it('昼の「＋1分」が遅れて投票の棄権になるのを防ぐ',()=>{
    const day=next(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));const p=day.leader;
    const old={k:'tiles',t:token(day,p),ids:[],pass:true};
    const extended=input(day,p,old);expect(extended.state.remaining).toBe(240000);
    const vote=next(extended.state);expect(vote.phase).toBe('vote');
    expect(input(vote,p,old)).toEqual({state:vote,effects:[]});
    expect(choose(vote,p,null,true).state.picks[p]).toBeNull();
  });
  it('役の確認の決定が遅れて夜の役表示を閉じるのを防ぐ',()=>{
    let s=begin();const old={k:'tiles',t:token(s,3),ids:[]};
    for(const seat of s.seats){s=choose(s,seat.id).state;s=choose(s,seat.id).state;}
    expect(s.phase).toBe('night');s=choose(s,3,null,true).state;
    expect(s.showRole[3]).toBe(true);
    expect(input(s,3,old)).toEqual({state:s,effects:[]});
    expect(choose(s,3).state.showRole[3]).toBe(false);
  });
  it('全段階でtなし・不一致・他席のtokenを拒み、現在のtokenだけ受ける',()=>{
    const reveal=begin();const shown=choose(reveal,3).state;const base=night();
    const role=choose(base,3,null,true).state;
    const dawn=decisions(base,{1:5,2:5,3:1,4:3,5:6,6:5});const day=next(dawn);const vote=next(day);
    const runoff=decisions(vote,{1:5,2:5,3:6,4:6,5:6,6:5});
    const exec=decisions(vote,{1:null,2:null,3:null,4:null,5:null,6:null});
    const resume=ev(ev(base,{t:'menu',paused:true}),{t:'menu',paused:false});
    const cases=[[reveal,3,[],false],[shown,3,[],false],[base,3,[id(base,3,1)],false],
      [base,3,[],true],[role,3,[],false],[dawn,1,[],false],[day,1,[],false],[day,1,[],true],
      [vote,3,[id(vote,3,1)],false],[vote,3,[],true],[runoff,3,[],true],[exec,1,[],false],[resume,1,[],false]];
    for(const [s,p,ids,pass] of cases){
      const value={k:'tiles',ids,...(pass?{pass:true}:{})};const snapshot=structuredClone(s);
      for(const invalid of [undefined,'wrong',token(s,p===1?2:1)]){
        const tr=input(s,p,{...value,...(invalid===undefined?{}:{t:invalid})});
        expect(tr.state).toBe(s);expect(tr.effects).toEqual([]);expect(s).toEqual(snapshot);
      }
      expect(input(s,p,{...value,t:token(s,p)}).state).not.toEqual(s);
    }
  });
  it('同じ文面の昼の再送でもtokenを更新し、時間経過や他席の決定では保つ',()=>{
    const base=night();const nightToken=token(base,3);
    let s=ev(base,{t:'tick',ms:1000});s=choose(s,1,5).state;
    expect(token(s,3)).toBe(nightToken);expect(choose(s,3,1).state.picks[3]).toBe(1);
    const day=next(decisions(base,{1:5,2:5,3:1,4:3,5:6,6:5}));
    const tr=choose(day,day.leader,null,true);const spec=tr.effects.find((e)=>e.t==='pad').spec;
    expect(spec.token).toBe(token(tr.state,day.leader));expect(spec.token).not.toBe(token(day,day.leader));
    const old={k:'tiles',t:token(day,day.leader),ids:[],pass:true};
    expect(input(tr.state,day.leader,old)).toEqual({state:tr.state,effects:[]});
    expect(choose(tr.state,day.leader,null,true).state.remaining).toBe(300000);
  });
  it('通常投票の棄権・中断前のパスを決選・再開後に再利用できない',()=>{
    const vote=toVote(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));
    const old={k:'tiles',t:token(vote,3),ids:[],pass:true};
    const runoff=decisions(vote,{1:5,2:5,3:6,4:6,5:6,6:5});
    expect(runoff.runoff).toBe(true);expect(token(runoff,3)).not.toBe(old.t);
    expect(input(runoff,3,old)).toEqual({state:runoff,effects:[]});
    const resumed=next(ev(ev(vote,{t:'menu',paused:true}),{t:'menu',paused:false}));
    expect(input(resumed,3,old)).toEqual({state:resumed,effects:[]});
    expect(choose(resumed,3,null,true).state.picks[3]).toBeNull();
  });
});

describe('秘匿・入力・中断・退出',()=>{
  it('全段階・各席のpadを許可表と照合し、公開用の型は秘密を含まない',()=>{
    let tr=createGame(init({players:players(7)}));checkPrivacy(tr);
    tr=input(tr.state,1,{k:'btn',id:id(tr.state,1),d:1});checkPrivacy(tr);
    let s={...tr.state,seats:tr.state.seats.map((p,i)=>({...p,role:['wolf','wolf','seer','knight','madman','villager','villager'][i]}))};
    const phases=new Set(['intro','reveal']);
    for(let steps=0;s.phase!=='ended'&&steps<150;steps++){
      const phase=s.phase;phases.add(phase);
      if(phase==='reveal'){const p=s.seats.find((p)=>s.checked[p.id]!=='done').id;tr=choose(s,p);}
      else if(phase==='night'){
        const p=s.seats.find((p)=>p.alive&&!(p.id in s.picks)).id;
        const target=s.seats.find((q)=>q.alive&&q.id!==p&&q.role==='wolf')??s.seats.find((q)=>q.alive&&q.id!==p);
        tr=choose(s,p,target.id);
      }else if(phase==='vote'){
        const p=s.seats.find((p)=>p.alive&&!(p.id in s.picks)).id;
        const candidates=s.seats.filter((q)=>q.alive&&q.id!==p&&(!s.runoff||s.candidates.includes(q.id)));
        const target=candidates.find((q)=>q.role==='wolf')??candidates[0];tr=choose(s,p,target?.id??null,!target);
      }else tr=choose(s,s.leader);
      checkPrivacy(tr);s=tr.state;
    }
    expect(s.phase).toBe('ended');phases.add(s.phase);expect([...phases].sort()).toEqual(['intro','reveal','night','dawn','day','vote','exec','ended'].sort());
    const view=publicView(s);view.seats[0].name='改変';view.reveal[0].role='bad';expect(s.seats[0].name).toBe('席1');expect(s.seats[0].role).toBe('wolf');
  });
  it('他席・古いID・重複・不正な選択は状態と効果を変えず、確定は本人のpadだけを変える',()=>{
    const s=night();const first=choose(s,1,5);expect(first.effects.map((e)=>e.to)).toEqual([1]);expect(publicView(first.state).decided).toEqual({count:1,total:6});
    for(const [p,i] of [[2,{k:'tiles',ids:[id(s,1,5)]}],[1,{k:'tiles',ids:[id(s,1,5)]}],[3,{k:'tiles',ids:['old']}],[3,{k:'tiles',ids:[id(s,3,1),id(s,3,2)]}],[3,{k:'tiles',ids:[id(s,3,1)],pass:true}],[3,{k:'tiles',ids:[]}],[3,{k:'tiles',ids:[id(s,3,3)]}],[7,{k:'tiles',ids:[id(s,3,1)]}]])expect(input(first.state,p,{...i,t:token(first.state,p)})).toEqual({state:first.state,effects:[]});
    const advanced=toVote(decisions(first.state,{2:5,3:1,4:3,5:6,6:5}));expect(input(advanced,3,{k:'tiles',t:token(advanced,3),ids:[id(s,3,1)]}).effects).toEqual([]);
    for(const ms of [0,-1,NaN,Infinity])expect(updateGame(s,{t:'tick',ms})).toEqual({state:s,effects:[]});
  });
  it.each(['menu','offline','hidden','player'])('中断 %s で選択を捨て、時計・役・生死を保ち、復帰のIDを更新する',(cause)=>{
    const original=ev(night(),{t:'tick',ms:30000});let s=choose(original,1,5).state;const old=id(s,2,5);const seats=structuredClone(s.seats);
    const event=cause==='menu'?{t:'menu',paused:true}:cause==='player'?{t:'players',players:players(6,[2]),leader:1}:{t:'environment',value:{connected:cause!=='offline',visible:cause!=='hidden'}};
    s=ev(s,event);expect(s.blockers.length).toBeGreaterThan(0);expect(s.picks).toEqual({});
    const wait=s;expect(ev(s,{t:'tick',ms:500000})).toBe(wait);expect(choose(s,2,5).effects).toEqual([]);
    s=ev(s,{t:'menu',paused:false});s=ev(s,{t:'environment',value:{connected:true,visible:true}});s=ev(s,{t:'players',players:players(),leader:1});
    expect(s.blockers).toEqual([]);expect(s.resumeRequired).toBe(true);expect(ev(s,{t:'tick',ms:500000})).toBe(s);
    expect(choose(s,2,5).effects).toEqual([]);s=next(s);expect(s.resumeRequired).toBe(false);expect(s.seats).toEqual(seats);expect(s.remaining).toBe(120000);expect(id(s,2,5)).not.toBe(old);expect(input(s,2,{k:'tiles',t:token(s,2),ids:[old]}).effects).toEqual([]);
  });
  it('複数の中断・脱落者の切断・昼の時計・投票の中断を扱う',()=>{
    let s=toVote(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));s=choose(s,1,5).state;
    s=ev(s,{t:'menu',paused:true});s=ev(s,{t:'environment',value:{connected:true,visible:false}});s=ev(s,{t:'menu',paused:false});expect(s.blockers).toEqual(['hidden']);expect(s.picks).toEqual({});
    s=ev(s,{t:'environment',value:{connected:true,visible:true}});expect(s.phase).toBe('vote');
    s={...s,phase:'day',remaining:11000,total:180000,seats:s.seats.map((p)=>({...p,alive:p.id!==6}))};
    s=ev(s,{t:'players',players:players(6,[6]),leader:1});expect(s.blockers).toEqual([]);
    s=ev(s,{t:'menu',paused:true});s=ev(s,{t:'tick',ms:100000});expect(s.remaining).toBe(11000);s=ev(s,{t:'menu',paused:false});expect(s.remaining).toBe(11000);expect(s.resumeRequired).toBe(true);s=next(s);expect(s.phase).toBe('day');expect(s.remaining).toBe(11000);
  });
  it('夜の退出は行動なし。新規参加者を入れず、退出した人狼の勝敗を判定し全記録を残す',()=>{
    let s=choose(night(),1,5).state;s=choose(s,3,1).state;
    let tr=updateGame(s,{t:'players',players:players().filter((p)=>p.id!==1),leader:2});s=tr.state;
    expect(s.seats[0]).toMatchObject({left:true,alive:false});expect(s.phase).toBe('night');
    s=decisions(s,{2:5,3:1,4:3,5:6,6:5});expect(s.reports[3]).toContain('行動なし');
    tr=updateGame(s,{t:'players',players:players().filter((p)=>![1,2].includes(p.id)),leader:3});s=tr.state;expect(s.phase).toBe('ended');
    expect(tr.effects.find((e)=>e.t==='end').results).toHaveLength(6);expect(tr.effects.find((e)=>e.t==='end').results.slice(0,2).every((r)=>!r.ranked)).toBe(true);
    const added=updateGame(night(),{t:'players',players:players(7),leader:1});expect(added.state.seats).toHaveLength(6);expect(added.effects.find((e)=>e.to===7).spec.k).toBe('wait');
  });
  it('選択済みの退出席は数えないため、残り全員の決定で夜と投票が解決する',()=>{
    let s=night(['wolf','wolf','seer','knight','madman','villager','villager','villager']);
    for(const p of [1,2,3,4,5,6,7])s=choose(s,p,p<=2?5:p===3?1:p===6?7:6).state;
    s=ev(s,{t:'players',players:players(7),leader:1});expect(s.phase).toBe('dawn');
    s=toVote(s);for(const p of [1,2,3,4,5,6])s=choose(s,p,p===5?6:5).state;
    s=ev(s,{t:'players',players:players(6),leader:1});expect(s.phase).toBe('exec');expect(s.votes).toHaveLength(6);
  });
  it('決選候補が退出すると残った候補の札が空になるため、空の決定を棄権として受理する',()=>{
    const base=night(['wolf','wolf','seer','knight','madman','villager','villager','villager']);
    let s=toVote(decisions(base,{1:5,2:5,3:1,4:3,5:6,6:7,7:8,8:7}));
    s=decisions(s,{1:5,2:5,3:5,4:6,5:6,6:5,7:6,8:6});expect(s.runoff).toBe(true);
    const tr=updateGame(s,{t:'players',players:players(8).filter((p)=>p.id!==5),leader:1});s=tr.state;
    expect(tr.effects.find((e)=>e.to===6).spec).toMatchObject({k:'tiles',tiles:[],min:0,max:0});
    const accepted=choose(s,6);expect(accepted.state.picks[6]).toBeNull();expect(accepted.effects.find((e)=>e.to===6).spec.k).toBe('wait');
    s=decisions(accepted.state,{1:6,2:6,3:6,4:6,7:6,8:6});expect(s.phase).toBe('exec');expect(s.seats[5].alive).toBe(false);
  });
  it('接続と表示が戻っただけでは時計を再開せず、進行役の確認後に同じ場面へ戻る',()=>{
    let s=next(decisions(night(),{1:5,2:5,3:1,4:3,5:6,6:5}));s=ev(s,{t:'tick',ms:40000});
    s=ev(s,{t:'environment',value:{connected:false,visible:false}});s=ev(s,{t:'environment',value:{connected:true,visible:true}});
    expect(s.phase).toBe('day');expect(s.resumeRequired).toBe(true);expect(ev(s,{t:'tick',ms:180000})).toBe(s);expect(choose(s,2).effects).toEqual([]);
    s=next(s);expect(s.remaining).toBe(140000);expect(s.phase).toBe('day');expect(ev(s,{t:'tick',ms:140000}).phase).toBe('vote');
  });
  it('2人未満の退出は未成立、脱落した進行役も操作可能、二度endしない',()=>{
    const base=night();const tr=updateGame(base,{t:'players',players:players(1),leader:1});
    expect(tr.state.outcome).toBe('incomplete');expect(tr.effects.filter((e)=>e.t==='end')).toHaveLength(1);
    expect(tr.effects.find((e)=>e.t==='end').results.every((r)=>!r.ranked&&r.score===0)).toBe(true);
    expect(updateGame(tr.state,{t:'players',players:[],leader:null}).effects).toEqual([]);
    const dawn=decisions(base,{1:5,2:5,3:1,4:3,5:6,6:5});const s={...dawn,seats:dawn.seats.map((p)=>({...p,alive:p.id!==1}))};expect(next(s).phase).toBe('day');
    const changed=ev(next(s),{t:'players',players:players().filter((p)=>p.id!==1),leader:2});expect(changed.leader).toBe(2);expect(choose(changed,1).effects).toEqual([]);expect(next(changed).phase).toBe('vote');
  });
  it('退出で決着した場合は夜明け・公開・処刑を解決した音を出さない',()=>{
    let s=night(['wolf','seer','villager','villager']);
    for(const phase of ['night','vote']){
      const tr=updateGame({...s,phase},{t:'players',players:players(4).filter((p)=>p.id!==1),leader:2});
      expect(tr.state.phase).toBe('ended');expect(tr.effects.filter((e)=>e.t==='cue').map((e)=>e.name)).toEqual(['win']);
    }
  });
  it('進行役自身の夜の無効行動も、夜明けの本人宛tilesで発表と理由を返す',()=>{
    let s=night();let tr;
    for(const p of [1,2,3,4,5,6]){tr=choose(s,p,{1:2,2:1,3:1,4:5,5:6,6:5}[p]);s=tr.state;}
    const leaderPad=tr.effects.find((e)=>e.t==='pad'&&e.to===s.leader);
    expect(leaderPad.spec.k).toBe('tiles');expect(leaderPad.spec.note).toContain(s.announce);expect(leaderPad.spec.note).toContain('仲間');checkPrivacy(tr);
    expect(next(s).phase).toBe('day');
  });
  it('入力が呼出元の凍結済みの状態を変更しない',()=>{
    const s=deepFreeze(night());expect(()=>choose(s,1,5)).not.toThrow();expect(s.picks).toEqual({});
    expect(()=>updateGame(s,{t:'players',players:players(5),leader:2})).not.toThrow();
  });
  // 実ホストの通しの疑い1：他席の投票で、まだ選んでいる人のスマホが作り直され選択が消える。
  // スマホは同じ指定の再送では作り直さないので、判定が未決定の席へ送らず、token と札IDを変えなければ選択は残る。
  it('投票中の他席の決定と時間経過では、未決定の席へ画面を送らず、tokenと札IDを保つ',()=>{
    let s=toVote(decisions(night(['wolf','wolf','seer','knight','madman','villager','villager','villager']),{1:5,2:5,3:1,4:3,5:6,6:7,7:8,8:7}));
    expect(s.phase).toBe('vote');
    const kept=(t)=>Object.fromEntries(t.seats.map((p)=>[p.id,[token(t,p.id),id(t,p.id,p.id===1?2:1)]]));
    const before=kept(s);
    for(const p of [3,1,8,2,7]){
      let tr=updateGame(s,{t:'tick',ms:500});expect(tr.effects).toEqual([]);s=tr.state;
      tr=choose(s,p,p===4?5:4);
      expect(tr.effects.filter((e)=>e.t==='pad').map((e)=>e.to)).toEqual([p]);
      s=tr.state;
      for(const q of s.seats.filter((q)=>!(q.id in s.picks)))expect(kept(s)[q.id]).toEqual(before[q.id]);
    }
  });
  // 疑い2：終了の全役の画面が end のあとに送られて捨てられる。判定は全席の画面を end より前に出す（end は最後に1回）。
  it('決着の遷移では、全席の全役の画面をendより前に出し、endは最後に1回だけ',()=>{
    let s=toVote(decisions(night(['wolf','seer','villager','villager']),{1:3,2:1,3:1,4:1}));
    for(const p of [2,3,4])s=choose(s,p,1).state;
    const tr=choose(s,1,2);
    expect(tr.state.phase).toBe('ended');
    const kinds=tr.effects.map((e)=>e.t);
    expect(kinds.filter((k)=>k==='end')).toHaveLength(1);
    expect(kinds.indexOf('end')).toBe(kinds.length-1);
    const pads=tr.effects.filter((e)=>e.t==='pad');
    expect(pads.map((e)=>e.to).sort()).toEqual([1,2,3,4]);
    for(const e of pads)expect(e.spec).toEqual({k:'wait',title:'勝負が終わりました',body:'席1：人狼、席2：占い師、席3：村人、席4：村人'});
  });
  it('8人の長い名前でも終了本文を符号位置120文字に収め、全役は公開データに残す',()=>{
    const base=night(['wolf','wolf','seer','knight','madman','villager','villager','villager']);
    const seats=base.seats.map((p)=>({...p,name:'🌙'.repeat(12)}));
    const tr=updateGame({...base,seats},{t:'players',players:seats.filter((p)=>p.id>2),leader:3});
    expect(tr.state.phase).toBe('ended');expect(tr.state.winner).toBe('village');
    const pads=tr.effects.filter((e)=>e.t==='pad');expect(pads).toHaveLength(8);
    for(const e of pads){checkPadContract(e.spec);expect([...e.spec.body]).toHaveLength(120);expect(e.spec.body).not.toContain('\ufffd');}
    // 全役は公開データに保持し、スマホ本文の長さに依存しない。
    expect(publicView(tr.state).reveal.map((p)=>p.role)).toEqual(seats.map((p)=>p.role));
  });
});
