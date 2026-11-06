// @ts-check
import {CARD_NAMES,compareSeats,deal,makeRng,shuffle} from './cards.js';
/** @typedef {import('./cards.js').Card} Card */
/** @typedef {import('./cards.js').SeatId} SeatId */
/** @typedef {{id:SeatId,name:string,online:boolean,cpu?:boolean}} Player */
/** @typedef {{connected:boolean,visible:boolean}} Environment */
/** @typedef {Player & {cpu:boolean,hand:Card[],played:number,guard:boolean,guardUntil:number,score:number,rank:number|null,left:boolean}} Seat */
/** @typedef {{seq:number,type:string,p:SeatId,target?:SeatId,card?:Card,auto?:boolean}} PublicEvent */
/** @typedef {{seq:number,type:'peek'|'swap'|'whisper',target:SeatId,card:Card}} Observation */
/** @typedef {{id:string,label:string,sub?:string,off?:boolean}} Tile */
/** @typedef {{k:'wait',title:string,body?:string}|{k:'tiles',token:string,tiles:Tile[],min:number,max:number,ok:string,disabled:boolean,note:string}} PadSpec */
/** @typedef {{k:string,ids?:string[],t?:string,pass?:boolean}} GameInput */
/** @typedef {{players:readonly Player[],leader:SeatId|null,seed:number,nonce:string,paused?:boolean,environment?:Environment|null}} GameInit */
/** @typedef {{t:'input',p:SeatId,input:GameInput}|{t:'tick',ms:number}|{t:'players',players:readonly Player[],leader:SeatId|null}|{t:'menu',paused:boolean}|{t:'environment',value:Environment|null}} GameEvent */
/** @typedef {{p:SeatId,score:number,rank:number|null,cpu:boolean,ranked:boolean,label:string}} Result */
/** コンソールへ渡す結果の行。SDKの検証器（packages/protocol の validateGameEnd）は、この4項目以外を持つ行を拒む。 @typedef {{p:number,score:number,label:string,ranked:boolean}} EndRow */
/** @typedef {{t:'pad',to:SeatId,spec:PadSpec}|{t:'cue',name:'deal'|'flip'|'place'|'win'|'lose'}|{t:'vibrate',to:SeatId,ms:number[]}|{t:'end',results:EndRow[],options:{display:'points',outcome:'complete'|'incomplete'}}} GameEffect */
/** @typedef {{phase:'intro'|'deal'|'turn'|'talk'|'vote'|'result',step:'pickCard'|'pickTarget'|'pickSlot'|'pickGive'|'whisper'|'reveal',seats:Seat[],leader:SeatId|null,nonce:string,rngState:number,h:number,turn:SeatId|null,card:Card|null,target:SeatId|null,slots:number[],slot:number|null,remaining:number,paused:boolean,environment:Environment|null,epochs:Record<SeatId,number>,events:PublicEvent[],seq:number,observations:Record<SeatId,Observation[]>,notices:Record<SeatId,string>,picks:Record<SeatId,number>,votes:Record<SeatId,SeatId>,winner:'stall'|'bell'|null,holder:SeatId|null,outcome:'complete'|'incomplete',ended:boolean}} GameState */
/** @typedef {{state:GameState,effects:GameEffect[]}} Transition */
/** @param {GameState} s */
const blocked=(s)=>s.paused || !s.environment?.connected || !s.environment.visible;
/** @param {GameState} s @param {SeatId} p @returns {Seat} */
const seat=(s,p)=>/** @type {Seat} */ (s.seats.find((v)=>v.id === p));
/** @param {GameState} s */
const actor=(s)=>seat(s,/** @type {SeatId} */ (s.turn));
/** @param {GameState} s */
const catchLocked=(s)=>actor(s).played < (s.seats.length <= 4 ? 2 : 1);
/** @param {GameState} s */
const canBegin=(s)=>s.phase === 'intro' && !blocked(s) && s.seats.length >= 3 && s.seats.length <= 8 && s.seats.some((v)=>v.id === s.leader && v.online);
/** @param {GameState} s @param {SeatId} p */
const token=(s,p)=>`b${s.nonce}_${(s.epochs[p] ?? 0).toString(36)}`;
/** @param {GameState} s */
function bump(s) { for (const v of s.seats) s.epochs[v.id]=(s.epochs[v.id] ?? 0)+1; }
/** @param {GameState} s @param {Omit<PublicEvent,'seq'>} e */
function record(s,e) { s.events.push({...e,seq:++s.seq}); }
/** @param {GameState} s @param {number} n */
function randomIndex(s,n) { const rng=makeRng(s.rngState),i=Math.floor(rng()*n);s.rngState=rng.state;return i; }
/** @param {GameState} s @param {SeatId} p @param {Observation['type']} type @param {SeatId} target @param {Card} card */
function observe(s,p,type,target,card) {
  (s.observations[p] ??= []).push({seq:s.seq,type,target,card});
  s.notices[p]=`${type === 'swap' ? '渡した札' : '見えた札'}：${CARD_NAMES[card]}`;
}
/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce) || !Number.isFinite(init.seed)) throw new RangeError('種か識別子が不正です');
  const ids=init.players.map((p)=>p.id);
  if (new Set(ids).size !== ids.length || ids.some((id)=>typeof id === 'number' ? !Number.isSafeInteger(id) || id < 1 : !/^cpu[1-9]\d*$/.test(id))) throw new RangeError('席IDが不正です');
  /** @type {GameState} */
  const state={phase:'intro',step:'pickCard',seats:init.players.map((p)=>({...p,cpu:p.cpu === true || typeof p.id === 'string',hand:[],played:0,guard:false,guardUntil:0,score:0,rank:null,left:false})).sort((a,b)=>compareSeats(a.id,b.id)),
    leader:init.leader,nonce:init.nonce,rngState:init.seed >>> 0,h:0,turn:null,card:null,target:null,slots:[],slot:null,remaining:0,paused:init.paused ?? false,
    environment:init.environment ? {...init.environment} : null,epochs:{},events:[],seq:0,observations:{},notices:{},picks:{},votes:{},winner:null,holder:null,outcome:'complete',ended:false};
  return transition(null,state);
}
/** @param {GameState} s @param {SeatId} p @returns {PadSpec} */
function padFor(s,p) {
  const own=seat(s,p),t=token(s,p);
  if (blocked(s)) return {k:'wait',title:'再開を待っています'};
  if (s.phase === 'talk') return {k:'wait',title:'みんなで言い合おう',body:`あと${Math.ceil(s.remaining/1000)}秒。鈴は誰のふところ？`};
  if (s.phase === 'result') return {k:'wait',title:s.outcome === 'incomplete' ? '今回は勝負なし' : s.winner === 'stall' ? '鈴が見つかりました' : '鈴は逃げ切りました',body:`${own.score}点${own.rank === null ? '' : `・${own.rank}位`}`};
  /** @type {Tile[]} */
  let tiles=own.hand.map((card,i)=>({id:`${t}_${i}`,label:CARD_NAMES[card],off:true}));
  let active=false,note=s.notices[p] ?? '',ok='決定';
  if (s.phase === 'intro') {
    active=p === s.leader && canBegin(s);
    tiles=[{id:`${t}_0`,label:'はじめる',off:!active}];
    note='札を出して鈴を探そう。鈴は出せません';
  } else if (s.phase === 'vote') {
    active=!(p in s.votes);
    tiles=s.seats.map((v,i)=>({id:`${t}_${i}`,label:short(v.name,12),off:v.id === p}));
    note=active ? '鈴を持つ人を一斉指名' : '指名を受け付けました';
  } else if (s.phase === 'turn') {
    const from=actor(s);
    note=[note,`${short(from.name,12)}さんの番：${s.card ? CARD_NAMES[s.card] : '札を選ぶ'}`].filter(Boolean).join('｜');
    active=p === s.turn && s.step !== 'whisper' && s.step !== 'reveal';
    if (active && s.step === 'pickCard') {
      tiles=own.hand.map((card,i)=>({id:`${t}_${i}`,label:CARD_NAMES[card],off:card === 'bell' || card === 'catch' && catchLocked(s),sub:card === 'catch' && catchLocked(s) ? s.seats.length <= 4 ? '三周目から' : '二周目から' : ''}));ok='出す';
      if (tiles.every((v)=>v.off)) {tiles=[{id:`${t}_0`,label:'見送る'}];note='出せる札がないため指名せず札を捨てます';ok='見送る';}
    } else if (active && s.step === 'pickTarget') {
      tiles=s.seats.map((v,i)=>({id:`${t}_${i}`,label:short(v.name,12),off:s.card !== 'guard' && v.id === p || s.card === 'catch' && v.guard,sub:s.card === 'catch' && v.guard ? '守られています' : ''}));
      note='相手を1人選んでください';
    } else if (active && s.step === 'pickSlot') {
      tiles=s.slots.map((_,i)=>({id:`${t}_${i}`,label:String(i+1)}));note='伏せた札の位置を選んでください';
    } else if (active && s.step === 'pickGive') {
      tiles=own.hand.map((card,i)=>({id:`${t}_${i}`,label:CARD_NAMES[card]}));note='差し出す札を選んでください';
    } else if (s.step === 'whisper' && (p === s.turn || p === s.target)) {
      active=!(p in s.picks);
      tiles=own.hand.map((card,i)=>({id:`${t}_${i}`,label:CARD_NAMES[card]}));note=active ? '相手にだけ見せる札を選ぼう' : '相手が選ぶのを待っています';
    }
  } else note='手札を確かめよう';
  const count=active ? tiles.filter((tile)=>!tile.off).length : 0;
  return {k:'tiles',token:t,tiles,min:count ? 1 : 0,max:count ? 1 : 0,ok,disabled:!active,note:short(note,120)};
}
/** @param {string} text @param {number} max */
function short(text,max) { return [...text].slice(0,max).join(''); }
/** @param {GameState} s */
function start(s) {
  const d=deal(s.seats.map((v)=>v.id),s.rngState);
  s.h=d.h;s.rngState=d.rngState;s.turn=d.first;s.phase='deal';s.remaining=8000;
  for (const v of s.seats) v.hand=/** @type {Card[]} */ (d.hands[v.id]);
}
/** @param {GameState} s */
function openTurn(s) { s.phase='turn';s.step='pickCard';s.card=null;s.target=null;s.slot=null;s.slots=[];s.picks={};s.remaining=25000; }
/** @param {GameState} s */
function finishTurn(s) {
  if (s.step === 'reveal' && s.turn !== null) {s.notices[s.turn]='';if (s.target !== null) s.notices[s.target]='';}
  actor(s).played++;if (actor(s).played >= actor(s).guardUntil) actor(s).guard=false;
  if (s.seats.every((v)=>v.played >= s.h-1)) {s.phase='talk';s.remaining=45000;s.turn=null;return;}
  const i=s.seats.findIndex((v)=>v.id === s.turn);
  for (let j=1;j<=s.seats.length;j++) {
    const next=/** @type {Seat} */ (s.seats[(i+j)%s.seats.length]);
    if (next.played < s.h-1) {s.turn=next.id;openTurn(s);return;}
  }
}
/** @param {GameState} s */
function reveal(s) { s.step='reveal';s.remaining=3000; }
/** @param {GameState} s @param {'stall'|'bell'|null} winner @param {SeatId|null} catcher */
function settle(s,winner,catcher=null) {
  s.phase='result';s.winner=winner;s.remaining=8000;
  s.holder=s.seats.find((v)=>v.hand.includes('bell'))?.id ?? null;
  if (!winner) {s.outcome='incomplete';s.seats.forEach((v)=>{v.score=0;v.rank=null;});return;}
  for (const v of s.seats) {
    if (winner === 'bell') v.score+=v.id === s.holder ? 4 : 0;
    else if (v.id !== s.holder) v.score+=catcher !== null ? v.id === catcher ? 3 : 1 : s.votes[v.id] === s.holder ? 2 : 1;
  }
  for (const v of s.seats) v.rank=1+s.seats.filter((other)=>other.score > v.score).length;
}
/** @param {GameState} s */
function tally(s) {
  const counts=s.seats.map((v)=>({id:v.id,count:Object.values(s.votes).filter((p)=>p === v.id).length}));
  const best=Math.max(...counts.map((v)=>v.count)),top=counts.filter((v)=>v.count === best);
  settle(s,top.length === 1 && seat(s,/** @type {SeatId} */ (top[0]?.id)).hand.includes('bell') ? 'stall' : 'bell');
}
/** @param {GameState} s @param {SeatId} p @param {number} i */
function choose(s,p,i) {
  const own=seat(s,p);
  if (s.phase === 'intro') {start(s);return;}
  if (s.phase === 'vote') {s.votes[p]=/** @type {Seat} */ (s.seats[i]).id;if (Object.keys(s.votes).length === s.seats.length) tally(s);return;}
  if (s.step === 'whisper') {
    s.picks[p]=i;
    if (s.turn !== null && s.target !== null && s.turn in s.picks && s.target in s.picks) {
      const a=actor(s),b=seat(s,s.target);
      record(s,{type:'whisper',p:a.id,target:b.id});
      observe(s,a.id,'whisper',b.id,/** @type {Card} */ (b.hand[s.picks[b.id] ?? 0]));
      observe(s,b.id,'whisper',a.id,/** @type {Card} */ (a.hand[s.picks[a.id] ?? 0]));reveal(s);
    }
    return;
  }
  if (s.step === 'pickCard') {
    s.notices[p]='';
    if (own.hand.every((c)=>c === 'bell' || c === 'catch') && catchLocked(s)) {
      own.hand.splice(own.hand.indexOf('catch'),1);record(s,{type:'play',p,card:'catch'});record(s,{type:'skip',p});finishTurn(s);return;
    }
    s.card=/** @type {Card} */ (own.hand.splice(i,1)[0]);
    record(s,{type:'play',p,card:s.card});s.step='pickTarget';s.remaining=25000;
    if (!padOptions(s,p).length) {record(s,{type:'noTarget',p});finishTurn(s);}
  } else if (s.step === 'pickTarget') {
    s.target=/** @type {Seat} */ (s.seats[i]).id;const target=seat(s,s.target);
    if (s.card === 'guard') {target.guard=true;target.guardUntil=target.played+(target.id === p ? 2 : 1);record(s,{type:'guard',p,target:target.id});finishTurn(s);}
    else if (s.card === 'catch') {
      if (target.hand.includes('bell')) {record(s,{type:'caught',p,target:target.id});settle(s,'stall',p);}
      else {own.score--;record(s,{type:'miss',p,target:target.id});finishTurn(s);}
    } else if (s.card === 'whisper') {s.step='whisper';s.picks={};s.remaining=30000;}
    else {const rng=makeRng(s.rngState);s.slots=shuffle(target.hand.map((_,j)=>j),rng);s.rngState=rng.state;s.step='pickSlot';s.remaining=25000;}
  } else if (s.step === 'pickSlot') {
    s.slot=/** @type {number} */ (s.slots[i]);
    if (s.card === 'peek') {
      const target=seat(s,/** @type {SeatId} */ (s.target));record(s,{type:'peek',p,target:target.id});
      observe(s,p,'peek',target.id,/** @type {Card} */ (target.hand[s.slot]));reveal(s);
    } else {s.step='pickGive';s.remaining=25000;}
  } else if (s.step === 'pickGive') {
    const target=seat(s,/** @type {SeatId} */ (s.target)),at=/** @type {number} */ (s.slot);
    const given=/** @type {Card} */ (own.hand[i]),received=/** @type {Card} */ (target.hand[at]);
    own.hand[i]=received;target.hand[at]=given;record(s,{type:'swap',p,target:target.id});
    observe(s,p,'swap',target.id,given);observe(s,target.id,'swap',p,received);
    s.notices[p]=`受け取った札：${CARD_NAMES[received]}`;s.notices[target.id]=`受け取った札：${CARD_NAMES[given]}`;reveal(s);
  }
}
/** @param {GameState} s @param {SeatId} p */
function padOptions(s,p) { const pad=padFor(s,p);return pad.k === 'tiles' && !pad.disabled ? pad.tiles.flatMap((tile,i)=>tile.off ? [] : [i]) : []; }
/** @param {GameState} s */
function timeout(s) {
  if (s.phase === 'deal') {openTurn(s);return;}
  if (s.phase === 'talk') {s.phase='vote';s.remaining=30000;return;}
  if (s.phase === 'turn' && s.step === 'reveal') {finishTurn(s);return;}
  const pending=s.phase === 'vote' ? s.seats.filter((v)=>!(v.id in s.votes)).map((v)=>v.id)
    : s.step === 'whisper' ? [s.turn,s.target].filter((p)=>p !== null && !(p in s.picks)) : [s.turn];
  for (const p of pending) {
    if (p === null || s.phase === 'result' || s.phase === 'turn' && s.step === 'reveal') break;
    const options=padOptions(s,p);
    if (options.length) {record(s,{type:'auto',p,auto:true});choose(s,p,/** @type {number} */ (options[randomIndex(s,options.length)]));}
  }
}
/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state,event) {
  if (state.ended) return {state,effects:[]};
  if (event.t === 'tick') {
    if (blocked(state) || !Number.isFinite(event.ms) || event.ms <= 0 || state.phase === 'intro') return {state,effects:[]};
    const next=structuredClone(state);next.remaining=Math.max(0,next.remaining-event.ms);
    if (next.remaining === 0) {
      if (next.phase === 'result') next.ended=true;
      else {timeout(next);bump(next);}
    }
    return transition(state,next);
  }
  if (event.t === 'input') {
    if (!state.seats.some((v)=>v.id === event.p && !v.left)) return {state,effects:[]};
    const p=event.p,input=event.input,pad=padFor(state,p),options=padOptions(state,p);
    const i=pad.k === 'tiles' ? pad.tiles.findIndex((v)=>v.id === input.ids?.[0]) : -1;
    if (blocked(state) || !seat(state,p).online || input.k !== 'tiles' || input.pass || input.t !== token(state,p) || input.ids?.length !== 1 || !options.includes(i)) {
      const next=structuredClone(state);next.epochs[p]=(next.epochs[p] ?? 0)+1;
      return {state:next,effects:pad.k === 'tiles' ? [{t:'pad',to:p,spec:padFor(next,p)}] : []};
    }
    const next=structuredClone(state);choose(next,p,i);
    // 他方の未確定の選択は変えず、同時選択の古いtokenを作らない。
    if (state.phase === 'vote' && next.phase === 'vote' || state.step === 'whisper' && next.step === 'whisper') next.epochs[p]=(next.epochs[p] ?? 0)+1;
    else bump(next);
    const cue=state.phase === 'intro' ? 'deal' : next.phase === 'result' ? next.winner === 'stall' ? 'win' : 'lose' : state.step === 'pickCard' ? 'place' : 'flip';
    return transition(state,next,[{t:'cue',name:cue}]);
  }
  const next=structuredClone(state);
  if (event.t === 'menu') next.paused=event.paused;
  if (event.t === 'environment') next.environment=event.value ? {...event.value} : null;
  if (event.t === 'players') {
    next.leader=event.leader;
    for (const v of next.seats.filter((v)=>!v.cpu)) {
      const player=event.players.find((p)=>p.id === v.id);
      v.online=player?.online === true;if (player) v.name=player.name;else v.left=true;
    }
    if (next.seats.some((v)=>v.left)) {settle(next,null);next.ended=true;}
  }
  if (JSON.stringify(state) === JSON.stringify(next)) return {state,effects:[]};
  bump(next);return transition(state,next);
}
/** @param {GameState|null} before @param {GameState} state @param {GameEffect[]} [extra] @returns {Transition} */
function transition(before,state,extra=[]) {
  const effects=[...extra];
  for (const v of state.seats.filter((v)=>!v.left)) {
    const spec=padFor(state,v.id);
    if (!before || JSON.stringify(spec) !== JSON.stringify(padFor(before,v.id))) effects.push({t:'pad',to:v.id,spec});
  }
  if (state.ended && !before?.ended) effects.push({t:'end',results:endRows(state),options:{display:'points',outcome:state.outcome}});
  if (state.step === 'reveal' && before?.step !== 'reveal' && state.turn !== null) effects.push({t:'vibrate',to:state.turn,ms:[60]});
  return {state,effects};
}
/**
 * 終了の合図の結果。人の席だけ、SDKが受け取る4項目だけにする。順位とCPUの印は、画面用の publicView の results に残る。
 * 余分な項目があるとコンソールが黙って拒み、「もう一度」が出なくなる（2026-11-06に実際に起きた）。
 * @param {GameState} state @returns {EndRow[]}
 */
function endRows(state) { return state.seats.filter((v)=>!v.cpu && typeof v.id === 'number').map((v)=>({p:/** @type {number} */ (v.id),score:v.score,label:state.outcome === 'incomplete' ? '勝負なし' : `${v.rank}位`,ranked:state.outcome === 'complete'})); }
/** @param {GameState} state @returns {Result[]} */
function results(state) { return state.seats.map((v)=>({p:v.id,score:v.score,rank:v.rank,cpu:v.cpu,ranked:state.outcome === 'complete',label:state.outcome === 'incomplete' ? '勝負なし' : `${v.rank}位`})); }
/** @param {GameState} s */
export function publicView(s) {
  return {phase:s.phase,step:s.step,seats:s.seats.map((v)=>({id:v.id,name:v.name,online:v.online,cpu:v.cpu,left:v.left,count:v.hand.length,guard:v.guard,played:v.played})),
    turn:s.turn,leader:s.leader,canBegin:canBegin(s),remaining:s.remaining,paused:s.paused,blocked:blocked(s),
    discard:s.events.filter((e)=>e.type === 'play').map((e)=>e.card),events:s.events.map((e)=>({...e})),
    clear:s.events.filter((e)=>e.type === 'miss' && !s.events.some((later)=>later.seq > e.seq && later.type === 'swap' && (later.p === e.target || later.target === e.target))).map((e)=>e.target),
    outcome:s.outcome,winner:s.winner,holder:s.phase === 'result' && s.outcome === 'complete' ? s.holder : null,results:s.phase === 'result' ? results(s) : []};
}
/** 返り値は複製。自分の手札と自分宛ての情報だけを足す。 @param {GameState} state @param {SeatId} p */
export function viewFor(state,p) {
  if (!state.seats.some((v)=>v.id === p)) throw new RangeError('席がありません');
  return {...publicView(state),self:p,hand:[...seat(state,p).hand],observations:(state.observations[p] ?? []).map((v)=>({...v})),notice:state.notices[p] ?? '',pad:padFor(state,p)};
}
/** @typedef {ReturnType<typeof publicView>} GameViewModel */
/** @typedef {ReturnType<typeof viewFor>} SeatView */
