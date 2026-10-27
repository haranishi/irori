// @ts-check
import {describe,expect,it} from 'vitest';
import {buildDeck,cardText,makeRng} from './cards.js';
import {createGame,drawId,publicView,updateGame} from './logic.js';

const players=(n=3,offline=[]) => Array.from({length:n},(_,i) => ({id:i+1,name:`P${i+1}`,online:!offline.includes(i+1)}));
const init=(overrides={}) => ({players:players(),leader:1,environment:{connected:true,visible:true},paused:false,nonce:'old123',seed:56,...overrides});
const input=(state,p,value) => updateGame(state,{t:'input',p,input:value});
const begin=(result) => {const effect=result.effects.find((e) => e.t==='pad' && e.spec.k==='pad');return effect ? input(result.state,effect.to,{k:'btn',id:effect.spec.buttons[0].id,d:1}) : result;};
const start=(overrides={}) => begin(createGame(init(overrides)));
const draw=(s,index=0) => input(s,s.turn?.from,{k:'tiles',ids:[drawId(s,index)]});
const freeze=(o) => {if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
const deckSet=new Set(buildDeck());
const conserved=(s) => {
  const all=[...s.seats.flatMap((seat) => seat.hand),...s.discard,...s.excluded];
  if(all.length!==53 || new Set(all).size!==53 || all.filter((c) => c==='jk').length!==1 || all.some((c) => !deckSet.has(c))) throw Error('札の保存違反');
  if(s.discard.length%2 || s.discard.some((c,i) => c==='jk' || c.slice(1)!==s.discard[i-i%2].slice(1))) throw Error('ペア以外の捨て札');
};
// 特定の規則を孤立させる盤面。未使用札も除外に置き保存則を維持する。
const scenario=(hands,order=[]) => {
  const s=start({players:players(hands.length)}).state;
  s.seats.forEach((seat,i) => {seat.hand=[...hands[i]];seat.rank=order.includes(seat.id)?order.indexOf(seat.id)+1:null;});
  s.order=[...order];s.discard=[];s.excluded=buildDeck().filter((c) => !hands.flat().includes(c));s.phase='play';s.events=[];s.feedback=null;
  const active=s.seats.filter((seat) => seat.hand.length);s.turn={from:active[0].id,to:active[1]?.id??active[0].id};
  return s;
};

describe('開始・入力の拒否・純粋性',() => {
  it.each([2,3,8])('%i人ではリーダーだけが開始でき、席番号昇順で進む',(n) => {
    const result=createGame(init({players:players(n).reverse()}));
    expect(result.effects.filter((e) => e.t==='pad' && e.spec.k==='pad').map((e) => e.to)).toEqual([1]);
    expect(publicView(result.state).canBegin).toBe(true);
    const next=begin(result);expect(['play','ended']).toContain(next.state.phase);conserved(next.state);
    expect(next.state.seats.map((s) => s.id)).toEqual(players(n).map((p) => p.id));
    expect(next.effects).toContainEqual({t:'cue',name:'deal'});
  });
  it.each([0,1,9])('%i人では開始できない',(n) => {
    const result=createGame(init({players:players(n)}));expect(publicView(result.state).canBegin).toBe(false);
    expect(result.effects.every((e) => e.t==='pad' && e.spec.k==='wait')).toBe(true);
  });
  it.each([{paused:true},{environment:null},{environment:{connected:false,visible:true}},{environment:{connected:true,visible:false}},{players:players(3,[2])}])('中断中は開始不可: %j',(overrides) => {
    expect(publicView(createGame(init(overrides)).state).canBegin).toBe(false);
  });
  it('他席の開始、古い開始、離し入力、開始の再送を無視する',() => {
    const result=createGame(init());const spec=result.effects.find((e) => e.t==='pad' && e.spec.k==='pad').spec;
    const s=result.state;const id=spec.buttons[0].id;
    for(const [p,key,d] of [[2,id,1],[1,'old',1],[1,id,0]]) expect(input(s,p,{k:'btn',id:key,d})).toEqual({state:s,effects:[]});
    const next=begin(result).state;expect(input(next,1,{k:'btn',id,d:1})).toEqual({state:next,effects:[]});
  });
  it('番外・他席・古い識別子・範囲外・重複・パス・未知種類は状態を変えない',() => {
    const s=start().state;const id=drawId(s,0);
    for(const [p,value] of [[99,{k:'tiles',ids:[id]}],[s.turn.to,{k:'tiles',ids:[id]}],[s.turn.from,{k:'tiles',ids:[drawId(s,100)]}],
      [s.turn.from,{k:'tiles',ids:[]}],[s.turn.from,{k:'tiles',ids:[id,id]}],[s.turn.from,{k:'tiles',ids:[id],pass:true}],[s.turn.from,{k:'pick',id}]]) {
      const next=input(s,p,value);expect(next.state).toBe(s);expect(next.effects).toEqual([]);
    }
    const next=draw(s).state;expect(input(next,s.turn.from,{k:'tiles',ids:[id]})).toEqual({state:next,effects:[]});
  });
  it('同じ状態と入力から同じ結果、呼出元の状態・名簿を変更しない',() => {
    const original=init();const result=createGame(original);original.players[0].name='changed';expect(result.state.seats[0].name).toBe('P1');
    const s=freeze(begin(result).state);expect(draw(s)).toEqual(draw(s));expect(() => createGame(init({nonce:'TOO_LONG_NONCE'}))).toThrow(RangeError);
  });
  it('古い識別子は同じ席へ番が戻っても無効（番外チェックだけで拒否を証明しない）',() => {
    // 直後の再送だけでは番外という別の条件が効き、改訂番号の欠落を見逃す。
    let s=scenario([['s3'],['h4','h5'],['jk','d6','d7']]);const old=drawId(s,0);
    for(let i=0;i<3;i++) s=draw(s).state;
    expect(s.turn.from).toBe(1);expect(drawId(s,0)).not.toBe(old);
    expect(input(s,1,{k:'tiles',ids:[old]})).toEqual({state:s,effects:[]});
    expect(draw(s).state).not.toBe(s);
  });
});

describe('引く・ペア・上がり・結果',() => {
  it('引かれた席の上がりを先に記録し、引いた席も上がれば続けて記録する',() => {
    // 2席とも同じ手で空になるとき、引かれた側の上がりを落とすバグを防ぐ。
    const s=scenario([['s7'],['h7'],['jk']]);const next=draw(s);
    expect(next.state.order).toEqual([2,1,3]);expect(next.state.seats.map((s) => s.rank)).toEqual([2,1,3]);
    expect(next.effects.find((e) => e.t==='end')).toMatchObject({results:[{p:1,score:2,label:'2番目に上がり',ranked:true},{p:2,score:3,label:'1番目に上がり',ranked:true},{p:3,score:1,label:'ジョーカーが残った',ranked:true}],options:{display:'record',outcome:'complete'}});
    expect(next.state.events.map((e) => e.type)).toEqual(['draw','pair','out','out','out']);conserved(next.state);
    expect(next.effects.filter((e) => e.t==='cue').map((e) => e.name)).toEqual(expect.arrayContaining(['flip','place','win','lose']));
    expect(next.effects.filter((e) => e.t==='pad')).toMatchObject([1,2,3].map((to)=>({to,spec:{k:'wait',title:'勝負が終わりました'}})));
  });
  it('ジョーカーを引くと本人にだけ振動し、番号では札の中身を示さない',() => {
    const s=scenario([['s7'],['jk','h7'],['s3','h3']]);const next=draw(s);
    expect(next.effects.filter((e) => e.t==='vibrate')).toEqual([{t:'vibrate',to:1,ms:[60]}]);
    expect(next.effects.find((e) => e.t==='pad' && e.to===1).spec).toMatchObject({k:'wait',title:'ジョーカーをひきました'});
    expect(next.state.turn).toEqual({from:2,to:3});conserved(next.state);
  });
  it('空の席を飛ばし席順の末尾から先頭に戻り、引かれる手札を毎番並べ替える',() => {
    let s=scenario([['s3'],[],['s4'],['jk','h3','h4']],[2]);
    s.turn={from:4,to:1};s=draw(s).state;
    expect(s.turn).toEqual({from:3,to:4});expect(s.revision).toBeGreaterThan(0);
    const next=draw(s).state;expect(next.rngState).not.toBe(s.rngState);
    expect(next.seats[1].rank).toBe(1);conserved(next);
  });
  it('配札だけで上がった席も順位に入り、即終了もendは1回',() => {
    let result;
    for(let seed=0;seed<2000;seed++){result=start({players:players(2),seed});if(result.state.phase==='ended')break;}
    expect(result.state.phase).toBe('ended');expect(result.state.order).toHaveLength(2);conserved(result.state);
    for(const event of [{t:'menu',paused:true},{t:'players',players:[],leader:null},{t:'environment',value:null},{t:'input',p:1,input:{k:'tiles',ids:['old']}}]) {
      expect(updateGame(result.state,event)).toEqual({state:result.state,effects:[]});
    }
  });
  it.each([2,3,4,5,6,7,8])('%i人×2000種の無作為対戦は終わり、毎手53枚を保ち、最後はジョーカー持ち',(n) => {
    let totalTurns=0;
    for(let seed=0;seed<2000;seed++) {
      const rng=makeRng(seed^0xa312bf);let result=start({players:players(n),seed});let turns=0;
      conserved(result.state);
      while(result.state.phase==='play' && turns<10000) {
        const s=result.state;const target=s.seats.find((seat) => seat.id===s.turn.to);
        result=draw(s,Math.floor(rng()*target.hand.length));conserved(result.state);turns++;
      }
      if(result.state.phase!=='ended')throw Error(`未終了: ${n}人 seed=${seed}`);
      if(result.state.order.length!==n || new Set(result.state.order).size!==n)throw Error('順位の欠落または重複');
      const last=result.state.seats.find((seat) => seat.id===result.state.order.at(-1));
      if(last.hand.length!==1 || last.hand[0]!=='jk')throw Error('最下位の札が不正');
      if(result.effects.filter((e) => e.t==='end').length!==1)throw Error('endの欠落または重複');
      totalTurns+=turns;
    }
    expect(totalTurns).toBeGreaterThan(0);
  },120000);
});

describe('接続・中断・退出',() => {
  it.each(['menu','connection','visible','player'])('%sで手札と順位を保って待ち、再開で古い入力を捨てる',(cause) => {
    const s=start().state;const old=drawId(s,0);
    const stop=cause==='menu'?{t:'menu',paused:true}:cause==='player'?{t:'players',players:players(3,[2]),leader:1}:{t:'environment',value:{connected:cause!=='connection',visible:cause!=='visible'}};
    let next=updateGame(s,stop);expect(next.state.seats.map((s) => s.hand)).toEqual(s.seats.map((s) => s.hand));
    expect(next.state.order).toEqual(s.order);expect(draw(next.state).state).toBe(next.state);conserved(next.state);
    expect(next.effects.filter((e) => e.t==='pad').every((e) => e.spec.k==='wait')).toBe(true);
    const resume=cause==='menu'?{t:'menu',paused:false}:cause==='player'?{t:'players',players:players(),leader:1}:{t:'environment',value:{connected:true,visible:true}};
    next=updateGame(next.state,resume);expect(next.state.turn).toEqual(s.turn);
    expect(input(next.state,s.turn.from,{k:'tiles',ids:[old]}).state).toBe(next.state);expect(draw(next.state).state).not.toBe(next.state);
  });
  it('複数の中断理由が全部解消するまで待つ',() => {
    let s=start().state;s=updateGame(s,{t:'menu',paused:true}).state;s=updateGame(s,{t:'environment',value:null}).state;
    s=updateGame(s,{t:'menu',paused:false}).state;expect(draw(s).state).toBe(s);
    s=updateGame(s,{t:'environment',value:{connected:true,visible:true}}).state;expect(draw(s).state).not.toBe(s);
  });
  it('説明中は名簿を更新し、開始後の追加席は次回を待つ。リーダー交代は旧開始を失効させる',() => {
    const first=createGame(init());const old=first.effects.find((e) => e.t==='pad' && e.spec.k==='pad').spec.buttons[0].id;
    let next=updateGame(first.state,{t:'players',players:players(2),leader:2});expect(next.state.seats).toHaveLength(2);
    expect(input(next.state,2,{k:'btn',id:old,d:1}).effects).toEqual([]);
    next=begin(next);const hands=next.state.seats.map((s) => s.hand);
    next=updateGame(next.state,{t:'players',players:players(4),leader:2});expect(next.state.seats.map((s) => s.hand)).toEqual(hands);
    expect(next.effects.filter((e) => e.t==='pad' && e.to>2).map((e) => e.spec.title)).toEqual(['次の勝負から参加できます','次の勝負から参加できます']);
  });
  it.each([1,2,3])('%i席の消失は通常札を除外し、ジョーカーは残った席へ再現可能に移す',(id) => {
    const s=scenario([['s3'],['h3'],['jk']]);const event={t:'players',players:players().filter((p) => p.id!==id),leader:id===1?2:1};
    const a=updateGame(freeze(s),event);expect(a).toEqual(updateGame(s,event));conserved(a.state);
    expect(a.state.seats.find((s) => s.id===id)).toMatchObject({left:true,hand:[],rank:null});
    expect(a.state.seats.some((s) => !s.left && s.hand.includes('jk'))).toBe(true);
  });
  it('2人から1人になり上がり済みが無ければ全員順位なしで未成立',() => {
    const s=scenario([['s3'],['jk']]);const next=updateGame(s,{t:'players',players:players(1),leader:1});
    expect(next.state.outcome).toBe('incomplete');conserved(next.state);
    expect(next.effects.find((e) => e.t==='end')).toMatchObject({results:[{ranked:false,label:'未成立'},{ranked:false,label:'記録なし'}],options:{outcome:'incomplete'}});
  });
  it('上がった席と最後の席が残るなら成立。退出済みの上がり順位を詰める',() => {
    const s=scenario([[],['s3'],['jk'],[]],[4,1]);
    const next=updateGame(s,{t:'players',players:players(4).filter((p) => ![2,4].includes(p.id)),leader:1});conserved(next.state);
    expect(next.state.order).toEqual([1,3]);expect(next.state.outcome).toBe('complete');
    expect(next.effects.find((e) => e.t==='end').results.map((r) => [r.p,r.label,r.ranked])).toEqual([[1,'1番目に上がり',true],[2,'記録なし',false],[3,'ジョーカーが残った',true],[4,'記録なし',false]]);
  });
  it('全席同時消失でも札は失わず未成立、endは1回',() => {
    const next=updateGame(start().state,{t:'players',players:[],leader:null});conserved(next.state);
    expect(next.state.outcome).toBe('incomplete');expect(next.effects.filter((e) => e.t==='end')).toHaveLength(1);
    expect(next.effects.find((e) => e.t==='end').results.every((r) => !r.ranked && r.label==='記録なし')).toBe(true);
    expect(updateGame(next.state,{t:'players',players:[],leader:null}).effects).toEqual([]);
  });
  it('退出で相方が除外された通常札は最後の人の手札に残して終了する',() => {
    // 除外後にジョーカー以外の札が残っても、最後の1人になる終了条件を妨げない。
    const s=scenario([[],['s3'],['h3','jk']],[1]);
    const next=updateGame(s,{t:'players',players:players(3).filter((p) => p.id!==2),leader:1});
    conserved(next.state);expect(next.state.phase).toBe('ended');expect(next.state.order).toEqual([1,3]);
    expect(next.state.seats[2].hand).toEqual(['h3','jk']);expect(next.state.excluded).toContain('s3');
  });
});

describe('公開モデルと席ごとの秘密',() => {
  it('公開モデルのキーを限定し、手札の入れ替えとジョーカーの所在を漏らさない',() => {
    const s=start().state;const view=publicView(s);
    expect(Object.keys(view).sort()).toEqual(['phase','seats','turn','discard','events','leader','canBegin','outcome'].sort());
    expect(Object.keys(view.seats[0]).sort()).toEqual(['id','name','count','rank','left','online'].sort());
    const other=structuredClone(s);const a=other.seats.find((s) => s.hand.includes('jk'));const b=other.seats.find((s) => s!==a && s.hand.length);
    [a.hand[a.hand.indexOf('jk')],b.hand[0]]=[b.hand[0],'jk'];expect(publicView(other)).toEqual(view);
    view.discard.length=0;expect(s.discard.length).toBeGreaterThan(0);
  });
  it('全席のpadは他席の手札も引く札の中身も含まず、引く人は番号だけを選ぶ',() => {
    const result=start({players:players(8)});const s=result.state;
    for(const effect of result.effects.filter((e) => e.t==='pad')) {
      expect(typeof effect.to).toBe('number');const own=s.seats.find((seat) => seat.id===effect.to);
      const text=JSON.stringify(effect.spec);
      for(const seat of s.seats.filter((seat) => seat.id!==effect.to)) for(const card of seat.hand) expect(text).not.toContain(cardText(card));
      expect(text).toContain(own.hand.map(cardText).join(' '));
      if(effect.spec.k==='tiles') {
        expect(effect.spec.max).toBe(1);expect(effect.spec.ok).toBe('ひく');expect(effect.spec.disabled??false).toBe(effect.to!==s.turn.from);
        effect.spec.tiles.forEach((tile,i) => {expect(tile).toEqual({id:drawId(s,i),label:String(i+1)});expect(tile.id).toMatch(/^[a-z0-9_-]{1,24}$/);});
      }
    }
  });
  it('公開drawに札は入らず、個別通知だけに引いた札が入り、pairは2枚だけ公開する',() => {
    const s=scenario([['s7','s4'],['h7','h3'],['jk','d3','h4']]);const next=draw(s);
    const drawEvent=publicView(next.state).events.find((e) => e.type==='draw');expect(drawEvent).toEqual({seq:s.seq+1,type:'draw',from:1,to:2});
    expect(publicView(next.state).events.find((e) => e.type==='pair').cards).toEqual(['s7','h7']);
    expect(next.effects.find((e) => e.t==='pad' && e.to===1).spec.title).toBe('ひいた札：♥7。ペア成立！');
    for(const e of next.effects.filter((e) => e.t==='pad' && e.to!==1)) expect(JSON.stringify(e.spec)).not.toContain('♥7');
    const seq=next.state.events.map((e) => e.seq);expect(seq).toEqual(seq.map((_,i) => s.seq+i+1));
    const again=draw(next.state);expect(again.state.events[0].seq).toBe(next.state.seq+1);
  });
});


describe('introの全員退出',()=>{
  it.each([1, 2, 8])('%i席が開始前に全員退出しても名簿を残しendをちょうど1回送る',(n)=>{
    // introで空の名簿から席を作り直すと、退出者の記録も終了経路も消えていた。
    const before=freeze(createGame(init({players:players(n)})).state);
    const next=updateGame(before,{t:'players',players:[],leader:null});
    expect(next.state.phase).toBe('ended');expect(next.state.outcome).toBe('incomplete');
    expect(next.state.seats.map((s)=>s.id)).toEqual(before.seats.map((s)=>s.id));
    expect(next.state.seats.every((s)=>s.left && !s.online && s.rank === null)).toBe(true);
    expect(before.seats.every((s)=>!s.left)).toBe(true);
    const ends=next.effects.filter((e)=>e.t === 'end');expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({options:{outcome:'incomplete'},results:before.seats.map((s)=>({p:s.id,score:0,ranked:false,label:'記録なし'}))});
    expect(publicView(next.state).canBegin).toBe(false);
    for(const event of [
      {t:'players',players:[],leader:null},{t:'players',players:players(n),leader:1},
      {t:'input',p:1,input:{k:'btn',id:'old_start',d:1}},
      {t:'input',p:1,input:{k:'tiles',ids:[]}},
    ]) expect(updateGame(freeze(next.state),event)).toEqual({state:next.state,effects:[]});
  });
  it('最初から席がない名簿では終了せず、後から席ができて全員退出した場合だけ終了する',()=>{
    let next=createGame(init({players:[],leader:null}));
    for(let i=0;i<3;i++) {
      expect(next.state.phase).toBe('intro');expect(next.effects.filter((e)=>e.t === 'end')).toHaveLength(0);
      next=updateGame(freeze(next.state),{t:'players',players:[],leader:null});
    }
    expect(next.effects.filter((e)=>e.t === 'end')).toHaveLength(0);
    next=updateGame(next.state,{t:'players',players:players(),leader:1});
    next=updateGame(next.state,{t:'players',players:[],leader:null});
    expect(next.effects.filter((e)=>e.t === 'end')).toHaveLength(1);
  });
});

describe('追補D3：待機・空の手札・終了の案内',()=>{
  const pad=(result,p)=>result.effects.find((e)=>e.t==='pad' && e.to===p)?.spec;
  it('第三者は開始・再接続・再開のたびに誰が誰から引くかと自分の手札で待つ',()=>{
    // 第三者にも番号だけのdisabled tilesを送り、何を待つかが分からなかった。
    const first=start();
    const observer=first.state.seats.find((s)=>s.id!==first.state.turn.from && s.id!==first.state.turn.to);
    expect(pad(first,observer.id).k).toBe('wait');
    let result={state:scenario([['s3'],['h4','h5'],['jk','d6']]),effects:[]};
    for(const event of [
      {t:'players',players:players(3,[3]),leader:1}, {t:'players',players:players(),leader:1},
      {t:'menu',paused:true},{t:'menu',paused:false},
      {t:'environment',value:null},{t:'environment',value:{connected:true,visible:true}},
    ]) {
      result=updateGame(freeze(result.state),event);
      const spec=pad(result,3);expect(spec.k).toBe('wait');expect(spec.body).toBe('あなた：JK ♦6');
      if(!result.state.paused && result.state.environment?.visible && result.state.seats.every((s)=>s.online)) {
        expect(spec.title).toBe('P1さんがP2さんから札をひいています');
        expect(result.effects.filter((e)=>e.t==='pad' && e.spec.k==='tiles').map((e)=>e.to)).toEqual([1]);
      }
      for(const card of ['s3','h4','h5']) expect(JSON.stringify(spec)).not.toContain(cardText(card));
    }
  });
  it('第三者の長い名前は24文字に収め、引かれる札を入れ替えても待機文を変えない',()=>{
    const s=scenario([['s3'],['h4','h5'],['jk','d6']]);
    const roster=players().map((p)=>({...p,name:(p.id===1?'あ':'😀').repeat(24)}));
    const a=updateGame(s,{t:'players',players:roster,leader:1});
    const other=structuredClone(s);[other.seats[1].hand[0],other.seats[2].hand[0]]=['jk','h4'];
    const b=updateGame(other,{t:'players',players:roster,leader:1});
    expect(pad(a,3).k).toBe('wait');expect([...pad(a,3).title].length).toBeLessThanOrEqual(24);
    expect(pad(a,3).title).toContain('あ');expect(pad(a,3).title).toContain('😀');
    expect(pad(a,3).title).toBe(pad(b,3).title);expect(publicView(a.state)).toEqual(publicView(b.state));
  });
  it('空の手札は札なしと表示し、引いて上がった本人に1位で上がりましたと伝える',()=>{
    // 空の手札を連結すると「あなた：。1位」になっていた。
    const result=draw(scenario([['s7'],['h7','h3'],['jk','s3']]));
    expect(pad(result,1)).toMatchObject({k:'wait',body:'あなた：札なし。1位で上がりました'});
    expect(pad(result,1).title).toBe('ひいた札：♥7。ペア成立！');
    const stopped=updateGame(result.state,{t:'menu',paused:true});
    expect(pad(stopped,1).body).toBe('あなた：札なし');
    const resumed=updateGame(stopped.state,{t:'menu',paused:false});
    expect(pad(resumed,1)).toMatchObject({k:'wait',title:'1位で上がりました'});
    expect(pad(resumed,1).body).toContain('あなた：札なし');conserved(result.state);
  });
  it('退出で終了するとfeedbackがなくても在席全員の最終waitをendより前に送る',()=>{
    // 上がり済み1人＋2人の局面でジョーカー持ちが退出すると、旧「ひく」が残っていた。
    const s=scenario([[],['s3'],['h3','jk']],[1]);
    const result=updateGame(freeze(s),{t:'players',players:players().filter((p)=>p.id!==3),leader:1});
    expect(result.state.phase).toBe('ended');expect(result.state.order).toEqual([1,2]);
    expect(result.state.feedback).toBeNull();expect(result.state.seats[1].hand).toEqual(['s3','jk']);
    const pads=result.effects.filter((e)=>e.t==='pad');expect(pads.map((e)=>e.to)).toEqual([1,2]);
    expect(pads.map((e)=>e.spec)).toEqual([
      {k:'wait',title:'勝負が終わりました',body:'あなた：札なし。1位で上がりました'},
      {k:'wait',title:'勝負が終わりました',body:'あなた：♠3 JK。2位'},
    ]);
    const end=result.effects.findIndex((e)=>e.t==='end');
    expect(result.effects.filter((e)=>e.t==='end')).toHaveLength(1);
    for(const effect of pads) expect(result.effects.indexOf(effect)).toBeLessThan(end);
    expect(updateGame(result.state,{t:'players',players:[],leader:null}).effects).toEqual([]);conserved(result.state);
  });
  it('ジョーカーの通知と振動は引いた本人だけに届き、公開モデルには所在を加えない',()=>{
    // JKだけの通常通知ではジョーカーを引いたことが目立たなかった。
    const s=scenario([['s7'],['jk','h7'],['s3','h3']]);const result=draw(s);
    expect(pad(result,1)).toMatchObject({k:'wait',title:'ジョーカーをひきました'});
    expect(result.effects.filter((e)=>e.t==='vibrate')).toEqual([{t:'vibrate',to:1,ms:[60]}]);
    for(const e of result.effects.filter((e)=>e.t==='pad' && e.to!==1)) expect(JSON.stringify(e.spec)).not.toMatch(/ジョーカー|JK/);
    expect(JSON.stringify(publicView(result.state))).not.toMatch(/ジョーカー|jk|feedback/);conserved(result.state);
  });
  it('結果の記録は上がり順・ジョーカー残り・退出の記録なしを順位と別に伝える',()=>{
    // 旧labelは順位を繰り返し、退出印にも「退出」を重ねていた。
    const result=draw(scenario([['s7'],['h7'],['jk']]));
    expect(result.effects.find((e)=>e.t==='end').results.map((r)=>r.label)).toEqual(['2番目に上がり','1番目に上がり','ジョーカーが残った']);
    const left=updateGame(scenario([[],['s3'],['jk']],[1]),{t:'players',players:players().filter((p)=>p.id!==2),leader:1});
    expect(left.effects.find((e)=>e.t==='end').results.map((r)=>r.label)).toEqual(['1番目に上がり','記録なし','ジョーカーが残った']);
    const incomplete=updateGame(scenario([['s3'],['jk']]),{t:'players',players:players(1),leader:1});
    expect(incomplete.effects.find((e)=>e.t==='end').results.map((r)=>r.label)).toEqual(['未成立','記録なし']);
    for(const r of result.effects.find((e)=>e.t==='end').results) expect([...r.label].length).toBeLessThanOrEqual(12);
  });
});
