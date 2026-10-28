// @ts-check
import {describe,expect,it} from 'vitest';
import {buildDeck,legalPlays,makeRng,strength} from './cards.js';
import {cardId,createGame,publicView,updateGame} from './logic.js';

const players = (n=3,offline=[]) => Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:!offline.includes(i+1)}));
const init = (overrides={}) => ({players:players(),leader:1,environment:{connected:true,visible:true},paused:false,nonce:'test1234',seed:1,...overrides});
const input = (s,p,value) => updateGame(s,{t:'input',p,input:value});
const begin = (s) => input(s,s.control.p,{k:'btn',id:s.control.id,d:1});
const start = (overrides={}) => begin(createGame(init(overrides)).state);
const token = (s,p=s.turn) => `d${s.nonce}_${s.revision.toString(36)}_${(s.refused[p] ?? 0).toString(36)}`;
const unchangedGame = (before,after) => expect({...after,refused:before.refused}).toEqual(before);
const play = (s,cards,p=s.turn) => input(s,p,{k:'tiles',t:token(s,p),ids:cards.map((c)=>cardId(s,p,c))});
const pass = (s,p=s.turn) => input(s,p,{k:'tiles',t:token(s,p),ids:[],pass:true});
const event = (s,e) => updateGame(s,e);
const freeze = (o) => { if(o && typeof o === 'object') {Object.values(o).forEach(freeze);Object.freeze(o);} return o; };
const allCards = (s) => [...s.stock,...s.seats.flatMap((x)=>x.hand),...(s.table?.cards ?? []),...s.discard,...s.excluded];
const conservation = (s) => {
  const cards = allCards(s);
  expect(cards).toHaveLength(54); expect(new Set(cards).size).toBe(54); expect([...cards].sort()).toEqual(buildDeck().sort());
};
// 小さい局面でも残りを捨て札へ置き、架空の複製札で試験しない。
const scenario = (hands,overrides={}) => {
  const s = start({players:players(hands.length)}).state;
  s.seats.forEach((seat,i)=>{seat.hand=[...hands[i]];}); Object.assign(s,{turn:1,...overrides});
  s.stock=[];s.excluded=[];
  const used=[...s.seats.flatMap((x)=>x.hand),...(s.table?.cards ?? [])];
  expect(new Set(used).size).toBe(used.length);
  s.discard=buildDeck().filter((c)=>!used.includes(c)); return s;
};
const checkPrivacy = (s,effects) => {
  for (const effect of effects.filter((e)=>e.t === 'pad')) {
    expect(typeof effect.to).toBe('number');
    if (effect.spec.k !== 'tiles') continue;
    const seat = s.seats.find((x)=>x.id === effect.to);
    expect(effect.spec.token).toBe(token(s,seat.id));
    expect(effect.spec.token).toMatch(/^[a-z0-9_-]{1,24}$/);
    expect(effect.spec.tiles.map((t)=>t.id)).toEqual(seat.hand.map((c)=>cardId(s,seat.id,c)));
    const exposed = effect.spec.tiles.map((t)=>t.id.split('_').at(-1));
    expect(exposed.every((c)=>seat.hand.includes(c))).toBe(true);
    expect(effect.spec.tiles.every((t)=>/^[a-z0-9_-]{1,24}$/.test(t.id))).toBe(true);
    expect(effect.spec.tiles.length).toBeLessThanOrEqual(20);
    const enabled=effect.spec.tiles.filter((t)=>!t.off).length;
    expect(effect.spec.max).toBeLessThanOrEqual(Math.min(4,enabled));
    expect(effect.spec.min).toBeLessThanOrEqual(effect.spec.max);
    expect([...effect.spec.note].length).toBeLessThanOrEqual(120);
  }
  const view = publicView(s);
  expect(Object.keys(view).sort()).toEqual(['phase','seats','table','turn','revolution','events','leader','canBegin','outcome'].sort());
  for (const seat of view.seats) expect(Object.keys(seat).sort()).toEqual(['id','name','count','passed','rank','left','online'].sort());
};

describe('開始・配札・公開と個人の画面',()=>{
  it.each([3,4,5,6,7,8])('%i人へ54枚を配りダイヤ3から始め、全padが本人の手札だけを含む',(n)=>{
    const original = init({players:players(n)}); const intro = createGame(original);
    expect(intro.state.control.p).toBe(1); expect(publicView(intro.state).canBegin).toBe(true);
    expect(intro.effects.filter((e)=>e.spec?.k === 'pad').map((e)=>e.to)).toEqual([1]);
    conservation(intro.state);
    original.players[0].name='変更'; expect(intro.state.seats[0].name).toBe('席1');
    const next = begin(freeze(intro.state)); const s = next.state;
    expect(s.phase).toBe('play'); expect(s.seats.find((x)=>x.id === s.turn).hand).toContain('d3');
    expect(s.seats.map((x)=>x.hand.length)).toEqual(Array.from({length:n},(_,i)=>Math.floor(54/n)+(i<54%n?1:0)));
    for (const seat of s.seats) expect(seat.hand.map((c)=>strength(c,false))).toEqual(seat.hand.map((c)=>strength(c,false)).sort((a,b)=>a-b));
    expect(next.effects.filter((e)=>e.t === 'cue')).toEqual([{t:'cue',name:'deal'}]);
    expect(s.rngState).not.toBe(s.seed); conservation(s);checkPrivacy(s,next.effects);
    const active = next.effects.find((e)=>e.t === 'pad' && e.to === s.turn).spec;
    expect(active).toMatchObject({k:'tiles',max:4,min:1,ok:'出す',disabled:false});expect(active).not.toHaveProperty('pass');
    expect(next.effects.filter((e)=>e.t === 'pad' && e.to !== s.turn).every((e)=>e.spec.disabled)).toBe(true);
    for (const effect of next.effects.filter((e)=>e.spec?.k === 'tiles')) for (const tile of effect.spec.tiles) {
      const card=tile.id.split('_').at(-1);
      expect(tile.color).toBe(['h','d'].includes(card[0])?'red':'gray');
      expect(tile.label).toMatch(/^(?:[♠♥♦♣](?:[2-9]|10|J|Q|K|A)|ジョーカー[12])$/);
    }
  });
  it.each([0,1,2,9])('%i人では開始できない',(n)=>{
    const {state,effects}=createGame(init({players:players(n)}));expect(state.control).toBeNull();expect(publicView(state).canBegin).toBe(false);
    expect(effects.every((e)=>e.spec.k === 'wait')).toBe(true);
    expect(input(state,1,{k:'btn',id:'start',d:1}).state).toBe(state);
  });
  it.each([{paused:true},{environment:null},{environment:{connected:false,visible:true}},{environment:{connected:true,visible:false}},{players:players(3,[2])},{leader:null}])('開始条件がそろわない: %j',(overrides)=>expect(createGame(init(overrides)).state.control).toBeNull());
  it('開始の離し入力・他席・古いIDを拒み、nonceの形式を守る',()=>{
    const s=createGame(init()).state;
    for (const [p,id,d] of [[2,s.control.id,1],[1,s.control.id,0],[1,'start',1]]) expect(input(s,p,{k:'btn',id,d})).toEqual({state:s,effects:[]});
    for (const nonce of ['', 'UPPER','123456789','x-y']) expect(()=>createGame(init({nonce}))).toThrow(RangeError);
    expect(start({seed:100})).toEqual(start({seed:100}));expect(start({seed:101}).state.seats).not.toEqual(start({seed:100}).state.seats);
  });
  it('説明中の人数増減と進行役交代は開始ボタンを更新する',()=>{
    let s=createGame(init({players:players(2)})).state;
    s=event(s,{t:'players',players:players(4),leader:2}).state;
    expect(s.seats).toHaveLength(4);expect(s.control.p).toBe(2);const old=s.control.id;
    s=event(s,{t:'players',players:players(3),leader:3}).state;
    expect(s.seats).toHaveLength(3);expect(s.control.p).toBe(3);
    expect(input(s,2,{k:'btn',id:old,d:1}).state).toBe(s);expect(begin(s).state.phase).toBe('play');
  });
  it('公開モデルと入力後の状態は参照を共有せず、呼出元を変えない',()=>{
    const s=freeze(scenario([['s3','s4'],['h4','h5'],['d5','d6']]));
    const next=play(s,['s3']); expect(s.seats[0].hand).toEqual(['s3','s4']);
    const view=publicView(next.state);view.seats[0].name='変更';view.table.cards.push('jk1');view.events[0].cards.push('jk2');
    expect(next.state.table.cards).toEqual(['s3']);expect(next.state.events[0].cards).toEqual(['s3']);expect(next.state.seats[0].name).toBe('席1');
  });
});

describe('出す・パス・8切り・革命',()=>{
  it('札を場へ移し、置き換えた場を捨て札に保存する',()=>{
    let s=scenario([['s3','s4'],['h4','h5'],['d5','d6']]);
    let next=play(s,['s3']);expect(next.state.table).toEqual({cards:['s3'],n:1,by:1});expect(next.state.turn).toBe(2);conservation(next.state);
    next=play(next.state,['h4']);expect(next.state.discard).toContain('s3');expect(next.state.seats[1].hand).toEqual(['h5']);conservation(next.state);
    expect(next.effects.filter((e)=>e.t === 'cue')).toEqual([{t:'cue',name:'place'}]);
    expect(next.state.events.map((e)=>e.seq)).toEqual([1,2]);expect(next.state.events.map((e)=>e.type)).toEqual(['play','play']);
  });
  it('パスした席も次の番で出せ、成功した出札で連続パスを解除する',()=>{
    let s=scenario([['s3','s6','s7'],['h4','h7'],['d5','d6']]);
    s=play(s,['s3']).state;s=pass(s).state;expect(s.seats[1].passed).toBe(true);
    s=play(s,['d5']).state;expect(s.seats.every((x)=>!x.passed)).toBe(true);
    s=play(s,['s6']).state;expect(s.turn).toBe(2);
    s=play(s,['h7']).state;expect(s.table.by).toBe(2);expect(s.events.filter((e)=>e.type === 'pass')).toHaveLength(1);conservation(s);
  });
  it('最後に出した人以外の全員の連続パスで流し、本人が先に出す',()=>{
    let s=play(scenario([['s3','s4'],['h4','h5'],['d5','d6']]),['s3']).state;
    const first=pass(s);s=first.state;expect(s.table).not.toBeNull();expect(first.effects.some((e)=>e.t === 'cue')).toBe(false);
    const next=pass(s);s=next.state;expect(s.table).toBeNull();expect(s.turn).toBe(1);expect(s.seats.every((x)=>!x.passed)).toBe(true);
    expect(next.effects.filter((e)=>e.t === 'cue')).toEqual([{t:'cue',name:'sweep'}]);conservation(s);
  });
  it('最後の出し手が上がっていれば残った全員のパス後に次の席から出す',()=>{
    let next=play(scenario([['s3'],['h4','h5'],['d5','d6'],['c4','c5']]),['s3']);
    expect(next.state.seats[0].rank).toBe(1);expect(next.effects.filter((e)=>e.t === 'cue').map((e)=>e.name)).toEqual(['place','win']);
    next=pass(next.state);next=pass(next.state);expect(next.state.table).not.toBeNull();next=pass(next.state);
    expect(next.state.table).toBeNull();expect(next.state.turn).toBe(2);conservation(next.state);
  });
  it.each([['s8'],['s8','jk1'],['s8','jk1','jk2']])('8をジョーカーで補っても流して同じ人が先に出す: %j',(...cards)=>{
    const s=scenario([[...cards,'s9'],['h3','h4'],['d3','d4']]);const next=play(s,cards);
    expect(next.state.table).toBeNull();expect(next.state.turn).toBe(1);expect(next.state.revolution).toBe(false);
    expect(next.effects.filter((e)=>e.t === 'cue').map((e)=>e.name)).toEqual(['place','sweep']);conservation(next.state);
  });
  it('ジョーカー単独・2枚組は8に化けず、場に残る',()=>{
    for(const cards of [['jk1'],['jk1','jk2']]) {
      const next=play(scenario([[...cards,'s9'],['h3','h4'],['d3','d4']]),cards);
      expect(next.state.table.cards).toEqual(cards);expect(next.state.turn).toBe(2);
      const forced=next.effects.find((e)=>e.t === 'pad' && e.to === 2).spec;
      expect(forced.tiles.every((t)=>t.off)).toBe(true);expect(forced).toMatchObject({min:0,max:0,pass:'パス'});
    }
  });
  it('4枚で革命し、もう一度の4枚で通常へ戻る（ジョーカーも含められる）',()=>{
    let s=scenario([['s6','h6','d6','jk1','s9'],['s3','h3','d3','c3','h9'],['d4','c4']]);
    const first=play(s,['s6','h6','d6','jk1']);s=first.state;expect(s.revolution).toBe(true);
    expect(first.effects.filter((e)=>e.t === 'cue').map((e)=>e.name)).toEqual(['place','revolution']);
    s=play(s,['s3','h3','d3','c3']).state;expect(s.revolution).toBe(false);expect(s.events.filter((e)=>e.type === 'revolution').map((e)=>e.revolution)).toEqual([true,false]);conservation(s);
  });
  it('4枚の8は革命と8切りが両方起き、上がった出し手の次へ進む',()=>{
    const next=play(scenario([['s8','h8','jk1','jk2'],['s3','h3'],['d4','c4']]),['s8','h8','jk1','jk2']);
    expect(next.state.revolution).toBe(true);expect(next.state.table).toBeNull();expect(next.state.turn).toBe(2);expect(next.state.seats[0].rank).toBe(1);
    expect(next.effects.filter((e)=>e.t === 'cue').map((e)=>e.name)).toEqual(['place','revolution','win','sweep']);conservation(next.state);
  });
});

describe('拒否は手札・場・番を保ち、本人の画面を更新する',()=>{
  it('同じ不正出札を5回断っても本人の画面は毎回変わり、他席を保って正しい札を受ける',()=>{
    // 同じJSONの再送はホストが省き、tilesが「送りました」から戻れなかった。
    const initial=start();let s=freeze(initial.state);const p=s.turn;
    const hand=s.seats.find((seat)=>seat.id === p).hand.filter((c)=>!c.startsWith('jk'));
    const bad=[hand[0],hand.find((c)=>c.slice(1) !== hand[0].slice(1))];
    const originalView=publicView(s);const initialState=s;
    const seen=new Set([JSON.stringify(initial.effects.find((e)=>e.t === 'pad' && e.to === p).spec)]);
    for(let i=0;i<5;i++) {
      const before=s;const next=play(s,bad);s=freeze(next.state);
      unchangedGame(before,s);expect(publicView(s)).toEqual(originalView);
      expect(s.refused).toEqual({[p]:i+1});expect(before.refused[p] ?? 0).toBe(i);
      expect(next.effects).toHaveLength(1);expect(next.effects[0].to).toBe(p);
      const spec=next.effects[0].spec;const json=JSON.stringify(spec);
      expect(seen.has(json)).toBe(false);seen.add(json);
      expect(spec.token).not.toBe(token(before,p));
      expect(spec.tiles.map((t)=>t.id)).toEqual(s.seats.find((seat)=>seat.id === p).hand.map((c)=>cardId(s,p,c)));
      for(const seat of s.seats.filter((seat)=>seat.id !== p)) {
        const original=initial.effects.find((e)=>e.t === 'pad' && e.to === seat.id).spec;
        expect(token(s,seat.id)).toBe(original.token);
        expect(seat.hand.map((c)=>cardId(s,seat.id,c))).toEqual(original.tiles.map((t)=>t.id));
      }
      checkPrivacy(s,next.effects);conservation(s);
    }
    expect(initialState.refused).toEqual({});
    const accepted=play(s,[bad[0]]);
    expect(accepted.state.table.cards).toEqual([bad[0]]);expect(accepted.state.turn).not.toBe(p);
    conservation(accepted.state);checkPrivacy(accepted.state,accepted.effects);
  });
  it('断った後の旧token・旧札IDは画面も状態も変えずに無視する',()=>{
    const before=freeze(scenario([['s3','s4'],['h4','h5'],['d5','d6']]));
    const s=freeze(play(before,['s3','s4']).state);
    // 旧札IDを新tokenと混ぜた再送でも、拒否回数を増やしてはいけない。
    for(const [t,id] of [[token(before),cardId(before,1,'s3')],[token(before),cardId(s,1,'s3')],[token(s),cardId(before,1,'s3')]]) {
      expect(input(s,1,{k:'tiles',t,ids:[id]})).toEqual({state:s,effects:[]});
    }
    expect(input(s,1,{k:'tiles',t:token(before),ids:[],pass:true})).toEqual({state:s,effects:[]});
    expect(play(s,['s3']).state.table.cards).toEqual(['s3']);
  });
  it.each(['出す','パス'])('token検査：%sのtなし・旧版・別ゲームを理由の再送なしで無視する',(action)=>{
    const s=freeze(scenario([['s4','s7'],['h5','h9'],['d6','d10']],{table:{cards:['c3'],n:1,by:3}}));
    const payload=action === 'パス' ? {ids:[],pass:true} : {ids:[cardId(s,1,'s4')]};
    // パスはidsが空なので、札IDだけの検査では古い画面を見分けられなかった。
    for(const t of [undefined,'',token({...s,revision:s.revision-1}),token({...s,nonce:'other'})]) {
      const next=input(s,1,{k:'tiles',...payload,...(t === undefined ? {} : {t})});
      expect(next.state).toBe(s);expect(next.effects).toEqual([]);
    }
    expect(input(s,1,{k:'tiles',...payload,t:token(s)}).state).not.toBe(s);
  });
  it.each(['出す','パス'])('token検査：番が一周して同じ席に戻っても旧画面の%sを無視する',(action)=>{
    let s=scenario([['s4','s7'],['h5','h9'],['d6','d10']],{table:{cards:['c3'],n:1,by:3}});
    const oldToken=token(s);const oldId=cardId(s,1,'s7');
    s=play(s,['s4']).state;s=play(s,['h5']).state;const next=play(s,['d6']);s=freeze(next.state);
    expect(s.turn).toBe(1);
    const current=next.effects.find((e)=>e.t === 'pad' && e.to === 1).spec;
    expect(current.token).not.toBe(oldToken);checkPrivacy(s,next.effects);
    const payload=action === 'パス' ? {ids:[],pass:true} : {ids:[cardId(s,1,'s7')]};
    // 現在の合法な札IDと旧tokenの組でも拒否し、札ID検査だけの成功を防ぐ。
    const stale=input(s,1,{k:'tiles',...payload,t:oldToken});
    expect(stale.state).toBe(s);expect(stale.effects).toEqual([]);
    if(action === '出す') expect(input(s,1,{k:'tiles',ids:[oldId],t:oldToken})).toEqual({state:s,effects:[]});
    expect(input(s,1,{k:'tiles',...payload,t:current.token}).state).not.toBe(s);
  });
  it('token検査：待機・中断・復帰・理由の再送でも全tilesに現在のtokenを付ける',()=>{
    let next=start();checkPrivacy(next.state,next.effects);
    for(const e of [
      {t:'players',players:players(3,[2]),leader:1},
      {t:'players',players:players(),leader:1},
      {t:'menu',paused:true},{t:'menu',paused:false},
      {t:'environment',value:null},{t:'environment',value:{connected:true,visible:true}},
    ]) {
      const old=next;next=event(next.state,e);
      checkPrivacy(next.state,next.effects);expect(token(next.state)).not.toBe(token(old.state));
      const stale=input(next.state,next.state.turn,{k:'tiles',ids:[],pass:true,t:token(old.state)});
      expect(stale.state).toBe(next.state);expect(stale.effects).toEqual([]);
    }
    const invalid=input(next.state,next.state.turn,{k:'tiles',ids:[],t:token(next.state)});
    unchangedGame(next.state,invalid.state);expect(invalid.effects).toHaveLength(1);checkPrivacy(invalid.state,invalid.effects);
  });
  it('枚数違い・弱い・同値・数混在・他席・重複・空・5枚を理由つきで拒否する',()=>{
    const s=freeze(scenario([['s3','s5','s6','h6','d6','c6','jk1'],['h4','h5'],['d4','d5']],{table:{cards:['c5'],n:1,by:3}}));
    const original=structuredClone(s);
    const bad=[
      [1,['s6','h6'].map((c)=>cardId(s,1,c))], [1,[cardId(s,1,'s3')]], [1,[cardId(s,1,'s5')]],
      [1,['s5','s6'].map((c)=>cardId(s,1,c))], [1,[cardId(s,1,'h4')]],
      [2,[cardId(s,2,'h5')]],
      [1,[cardId(s,1,'s6'),cardId(s,1,'s6')]], [1,[]], [1,['s6','h6','d6','c6','jk1'].map((c)=>cardId(s,1,c))],
    ];
    for(const [p,ids] of bad) {
      const next=input(s,p,{k:'tiles',t:token(s,p),ids});unchangedGame(s,next.state);expect(s).toEqual(original);
      expect(next.effects).toHaveLength(1);expect(next.effects[0].to).toBe(p);expect(next.effects[0].spec.note).toMatch(/ください/);
      expect(next.effects[0].spec.tiles.map((t)=>t.id)).toEqual(next.state.seats.find((x)=>x.id === p).hand.map((c)=>cardId(next.state,p,c)));
    }
    const accepted=play(s,['s6']);expect(accepted.state).not.toBe(s);
    const duplicate=play(accepted.state,['s6'],1);unchangedGame(accepted.state,duplicate.state);
    expect(input(s,99,{k:'tiles',t:token(s),ids:['x']})).toEqual({state:s,effects:[]});
  });
  it('空の場へのパスと札つきパスを拒み、適正な札をoffにしない',()=>{
    let s=scenario([['s3','s4'],['h4','h5'],['d5','d6']]);unchangedGame(s,pass(s).state);
    s=play(s,['s3']).state;
    unchangedGame(s,input(s,2,{k:'tiles',t:token(s,2),ids:[cardId(s,2,'h4')],pass:true}).state);
    const next=pass(s);checkPrivacy(next.state,next.effects);
    const own=next.effects.find((e)=>e.t === 'pad' && e.to === 3).spec;
    const legal=new Set(legalPlays(next.state.seats[2].hand,next.state.table,next.state.revolution).flat());
    for(const tile of own.tiles) expect(tile.off).toBe(!legal.has(tile.id.split('_').at(-1)));
  });
});

describe('中断・接続・退出・順位・終了',()=>{
  it.each(['menu','hidden','host'])('%sの間は入力を受けず、再開すると手札を保って古い画面を無効にする',(cause)=>{
    const s=scenario([['s3','s4'],['h4','h5'],['d5','d6']]); const old=cardId(s,1,'s3');
    const stop=cause === 'menu' ? {t:'menu',paused:true} : {t:'environment',value:{connected:cause !== 'host',visible:cause !== 'hidden'}};
    let next=event(freeze(s),stop);expect(next.state.seats).toEqual(s.seats);expect(next.state.turn).toBe(1);
    expect(next.effects.filter((e)=>e.spec?.k === 'tiles').every((e)=>e.spec.disabled)).toBe(true);
    unchangedGame(next.state,play(next.state,['s3']).state);
    next=event(next.state,cause === 'menu' ? {t:'menu',paused:false} : {t:'environment',value:{connected:true,visible:true}});
    expect(input(next.state,1,{k:'tiles',t:token(next.state),ids:[old]}).state).toBe(next.state);
    expect(play(next.state,['s3']).state.seats[0].hand).toEqual(['s4']);conservation(next.state);
  });
  it('複数の中断理由が解消するまで進めない',()=>{
    let s=start().state;s=event(s,{t:'menu',paused:true}).state;s=event(s,{t:'environment',value:null}).state;
    s=event(s,{t:'menu',paused:false}).state;const seat=s.seats.find((x)=>x.id === s.turn);
    unchangedGame(s,play(s,[seat.hand[0]]).state);s=event(s,{t:'environment',value:{connected:true,visible:true}}).state;
    expect(play(s,[seat.hand[0]]).state).not.toBe(s);
  });
  it('online偽は退出扱いせず、その席の番で待ち、復帰後に同じ手札で続ける',()=>{
    let s=scenario([['s3','s4'],['h4','h5'],['d5','d6']]);
    s=event(s,{t:'players',players:players(3,[2]),leader:1}).state;
    expect(s.seats[1]).toMatchObject({online:false,left:false,hand:['h4','h5']});
    s=play(s,['s3']).state;expect(s.turn).toBe(2);unchangedGame(s,play(s,['h4']).state);unchangedGame(s,pass(s).state);
    s=event(s,{t:'players',players:players(),leader:1}).state;
    expect(play(s,['h4']).state.table.cards).toEqual(['h4']);conservation(s);
  });
  it('途中参加者は待機し、終了者・退出者の席を復活させない',()=>{
    let s=start().state;let next=event(s,{t:'players',players:players(4),leader:1});
    expect(next.state.seats).toEqual(s.seats);expect(next.effects.find((e)=>e.to === 4).spec.k).toBe('wait');
    expect(input(next.state,4,{k:'tiles',t:token(next.state),ids:[]})).toEqual({state:next.state,effects:[]});
    s=event(next.state,{t:'players',players:players().filter((p)=>p.id !== 2),leader:1}).state;
    s=event(s,{t:'players',players:players(),leader:1}).state;
    expect(s.seats[1]).toMatchObject({left:true,online:false,hand:[],rank:null});
    expect(event(s,{t:'players',players:players(),leader:1}).state).toBe(s);conservation(s);
  });
  it('番の席が消えたら札を除外して次へ進み、最後の出し手が消えても流せる',()=>{
    let s=scenario([['s3','s4'],['h4','h5'],['d5','d6'],['c4','c6']]);
    s=play(s,['s3']).state;s=event(s,{t:'players',players:players(4).filter((p)=>p.id !== 2),leader:1}).state;
    expect(s.turn).toBe(3);expect(s.excluded.sort()).toEqual(['h4','h5']);conservation(s);
    s=event(s,{t:'players',players:players(4).filter((p)=>![1,2].includes(p.id)),leader:3}).state;
    expect(s.table.by).toBe(1);s=pass(s).state;s=pass(s).state;expect(s.table).toBeNull();expect(s.turn).toBe(3);conservation(s);
  });
  it('残ったパス者以外が消えた瞬間も場を流す（番送りだけでは余分な1巡が生じる）',()=>{
    let s=scenario([['s3','s4'],['h4','h5'],['d5','d6'],['c4','c6']]);s=play(s,['s3']).state;s=pass(s).state;
    s=event(s,{t:'players',players:players(4).filter((p)=>![3,4].includes(p.id)),leader:1}).state;
    expect(s.table).toBeNull();expect(s.turn).toBe(1);conservation(s);
  });
  it.each([3,4,5,6,7,8])('%i人の結果は上がり順の全順位・ラベル・scoreを返し、endを1回だけ送る',(n)=>{
    const hands=Array.from({length:n},(_,i)=>[buildDeck().filter((c)=>!c.startsWith('jk') && c.slice(1) !== '8')[i]]);
    let s=scenario(hands);s.table=null;
    // 各人が空の場から出すことで、数の強弱と独立に順位ラベルを確認する。
    for(let i=0;i<n-1;i++) {
      if(s.table){s.discard.push(...s.table.cards);s.table=null;}
      const next=play(s,s.seats[i].hand);s=next.state;
      if(i<n-2) expect(next.effects.some((e)=>e.t === 'end')).toBe(false);
      else {
        const end=next.effects.find((e)=>e.t === 'end');expect(end.options).toMatchObject({display:'record',outcome:'complete'});
        expect(end.results.map((r)=>r.score)).toEqual(Array.from({length:n},(_,j)=>n-j));
        const labels=n===3?['大富豪','平民','大貧民']:['大富豪','富豪',...Array(n-4).fill('平民'),'貧民','大貧民'];
        expect(end.results.map((r)=>r.label)).toEqual(labels);expect(end.results.every((r)=>r.ranked)).toBe(true);
        expect(next.effects.filter((e)=>e.t === 'cue').map((e)=>e.name)).toEqual(['place','win','lose']);
      }
    }
    expect(s.finishOrder).toEqual(Array.from({length:n},(_,i)=>i+1));expect(s.seats.map((x)=>x.rank)).toEqual(Array.from({length:n},(_,i)=>i+1));
    for(const e of [{t:'players',players:[],leader:null},{t:'menu',paused:true},{t:'environment',value:null},{t:'input',p:1,input:{k:'tiles',t:token(s),ids:[]}}]) expect(event(s,e)).toEqual({state:s,effects:[]});
    conservation(s);
  });
  it('上がった人の退出で順位を詰め、上がり1人と最後の1人なら成立する',()=>{
    let s=scenario([['s3'],['h4','h5'],['d5','d6'],['c4','c6']]);s=play(s,['s3']).state;
    s=event(s,{t:'players',players:players(4).filter((p)=>p.id !== 1),leader:2}).state;
    expect(s.finishOrder).toEqual([]);expect(s.seats[0].rank).toBeNull();
    // 既に上がっていて在席する人と残る1人の組合せも成立する。
    s=scenario([['s3'],['h4','h5'],['d5','d6']]);s=play(s,['s3']).state;
    const next=event(s,{t:'players',players:players().filter((p)=>p.id !== 2),leader:1});
    expect(next.state.phase).toBe('ended');expect(next.state.finishOrder).toEqual([1,3]);
    expect(next.effects.find((e)=>e.t === 'end').results).toEqual([
      {p:1,score:2,ranked:true,label:'大富豪'},{p:2,score:0,ranked:false,label:'記録なし'},{p:3,score:1,ranked:true,label:'大貧民'}]);conservation(next.state);
  });
  it.each([[],[1]])('順位を付けられる人が2人未満なら全員順位なしで一度だけ終了: %j',(...remaining)=>{
    const s=start().state;const next=event(s,{t:'players',players:players().filter((p)=>remaining.includes(p.id)),leader:remaining[0] ?? null});
    expect(next.state.phase).toBe('ended');expect(next.state.outcome).toBe('incomplete');expect(next.state.seats.every((x)=>x.rank === null)).toBe(true);
    const end=next.effects.find((e)=>e.t === 'end');expect(end.results).toHaveLength(3);expect(end.results.every((r)=>!r.ranked)).toBe(true);
    conservation(next.state);expect(event(next.state,{t:'players',players:[],leader:null}).effects).toEqual([]);
  });
  it('全員の手札が退出し、在席の上がり2人だけでもその順位で終わる',()=>{
    let s=scenario([['s3'],['h4'],['d5','d6'],['c4','c6']]);s=play(s,['s3']).state;s=play(s,['h4']).state;
    const next=event(s,{t:'players',players:players(2),leader:1});expect(next.state.outcome).toBe('complete');expect(next.state.finishOrder).toEqual([1,2]);conservation(next.state);
    // 退出によって既に上がった人の最下位が確定する経路でも、loseは一度だけ必要。
    expect(next.effects.filter((e)=>e.t === 'cue')).toEqual([{t:'cue',name:'lose'}]);
  });
});

// CIの長い周回は IRORI_SIM_GAMES=2000 で再現する。0件や不正値では成功にしない。
const simGames = Number(process.env.IRORI_SIM_GAMES ?? 300);
if (!Number.isSafeInteger(simGames) || simGames < 1) throw new RangeError('IRORI_SIM_GAMES must be a positive integer');

describe('無作為な対戦の保存則',()=>{
  it.each([3,4,5,6,7,8])(`%i人×${simGames}種：各手で54枚・一意性・秘匿、必ず終了して順位が全員の並べ替えになる`,(n)=>{
    const deck=buildDeck().sort().join(',');
    for(let seed=0;seed<simGames;seed++) {
      const rng=makeRng(seed+n*10000);let next=start({players:players(n),seed});let steps=0,ends=0;
      while(next.state.phase !== 'ended') {
        const s=next.state;const seat=s.seats.find((x)=>x.id === s.turn);
        const legal=legalPlays(seat.hand,s.table,s.revolution);
        const cards=allCards(s);
        if(cards.length !== 54 || new Set(cards).size !== 54 || [...cards].sort().join(',') !== deck) throw Error(`札の保存 n=${n} seed=${seed} step=${steps}`);
        for(const e of next.effects.filter((e)=>e.t === 'pad' && e.spec.k === 'tiles')) {
          const own=s.seats.find((x)=>x.id === e.to).hand;
          if(e.spec.tiles.some((tile)=>!own.includes(tile.id.split('_').at(-1)))) throw Error(`他席の札 n=${n} seed=${seed}`);
        }
        next=s.table && (!legal.length || rng()<0.22) ? pass(s) : play(s,legal[Math.floor(rng()*legal.length)]);
        if(next.state === s) throw Error(`合法手が拒否された n=${n} seed=${seed}`);
        ends+=next.effects.filter((e)=>e.t === 'end').length;
        if(++steps>1500) throw Error(`終了しない n=${n} seed=${seed}`);
      }
      conservation(next.state);expect(ends).toBe(1);expect(next.state.finishOrder.slice().sort((a,b)=>a-b)).toEqual(players(n).map((p)=>p.id));
      expect(next.state.seats.map((x)=>x.rank).sort((a,b)=>a-b)).toEqual(players(n).map((p)=>p.id));
      const end=next.effects.find((e)=>e.t === 'end');expect(end.results.every((r)=>r.ranked)).toBe(true);expect(end.options.outcome).toBe('complete');
    }
  },300000);
});


describe('introの全員退出',()=>{
  it.each([1, 3, 8])('%i席が開始前に全員退出しても名簿を残しendをちょうど1回送る',(n)=>{
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

describe('追補D3：出せない番と退出の記録',()=>{
  it('出せる札0枚の番は出せませんと表示し、空送信を5回断ってもパスを案内して画面を更新する',()=>{
    // 選べる札がなくても出すボタンが現れ、一般的な出札規則しか返していなかった。
    let s=scenario([['s3','h3'],['s4','h4'],['s5','h5']],{table:{cards:['jk1'],n:1,by:3}});
    s=event(s,{t:'menu',paused:true}).state;
    let next=event(s,{t:'menu',paused:false});s=next.state;
    const seen=new Set();
    for(let i=0;i<5;i++) {
      const spec=next.effects.find((e)=>e.t==='pad' && e.to===1).spec;
      expect(spec).toMatchObject({k:'tiles',ok:'出せません',pass:'パス',min:0,max:0,disabled:false});
      expect(spec.tiles.every((t)=>t.off)).toBe(true);
      expect(seen.has(spec.token)).toBe(false);seen.add(spec.token);
      const before=freeze(s);next=play(s,[]);s=next.state;unchangedGame(before,s);
      expect(s.refused[1]).toBe(i+1);expect(next.effects).toHaveLength(1);
      expect(next.effects[0].spec.note).toContain('出せる札がありません。パスしてください');
      expect(next.effects[0].spec.token).not.toBe(spec.token);checkPrivacy(s,next.effects);conservation(s);
    }
    expect(pass(s).state.seats[0].passed).toBe(true);
  });
  it('場がない空送信は出す札を選んでくださいと断り、現在の札を選び直せる',()=>{
    // 空配列も一般的な組合せエラーに入り、何をすればよいか分からなかった。
    const s=freeze(scenario([['s3','h3'],['s4','h4'],['s5','h5']]));const next=play(s,[]);
    unchangedGame(s,next.state);expect(next.effects[0].spec.note).toContain('出す札を選んでください');
    expect(next.effects[0].spec).toMatchObject({ok:'出す',min:1});expect(next.effects[0].spec.pass).toBeUndefined();
    expect(next.effects[0].spec.token).not.toBe(token(s));
    expect(play(next.state,['s3']).state.table.cards).toEqual(['s3']);checkPrivacy(next.state,next.effects);
  });
  it('退出者の結果labelは記録なしとし、退出の印と重ねない',()=>{
    // 結果の共通画面が退出印を付けるため、label「退出」は重複していた。
    const result=event(start().state,{t:'players',players:players(1),leader:1});
    const end=result.effects.find((e)=>e.t==='end');
    expect(end.results.map((r)=>[r.ranked,r.label])).toEqual([[false,'未成立'],[false,'記録なし'],[false,'記録なし']]);
    conservation(result.state);
  });
});
