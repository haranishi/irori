// @ts-check
import {cardText, dealAndPair, makeRng, pairOff, shuffle} from './cards.js';
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
/** @typedef {PlayerInfo & {left:boolean, hand:string[], rank:number|null}} Seat */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {{seq:number,type:'draw',from:number,to:number}|{seq:number,type:'pair',p:number,cards:string[]}|{seq:number,type:'out',p:number,rank:number}} PublicEvent */
/** @typedef {{phase:'intro'|'play'|'ended',seats:Seat[],players:PlayerInfo[],leader:number|null,nonce:string,revision:number,rngState:number,discard:string[],excluded:string[],order:number[],turn:{from:number,to:number}|null,events:PublicEvent[],seq:number,environment:HostEnvironment|null,paused:boolean,outcome:'complete'|'incomplete',feedback:{p:number,text:string}|null}} GameState */
/** @typedef {{players:readonly PlayerInfo[],leader:number|null,environment:Readonly<HostEnvironment>|null,paused:boolean,nonce:string,seed:number}} GameInit */
/** @typedef {{t:'input',p:number,input:import('./irori.js').GameInput}|{t:'players',players:readonly PlayerInfo[],leader:number|null}|{t:'menu',paused:boolean}|{t:'environment',value:Readonly<HostEnvironment>|null}} GameEvent */
/** @typedef {{t:'pad',to:number,spec:PadSpec}|{t:'cue',name:'deal'|'flip'|'place'|'win'|'lose',v?:number}|{t:'vibrate',to:number,ms:number[]}|{t:'end',results:import('./irori.js').GameResult[],options:import('./irori.js').GameEndOptions}} GameEffect */
/** @typedef {{state:GameState,effects:GameEffect[]}} Transition */

/** @param {GameState} state */
function blocked(state) {
  return state.paused || !state.environment?.connected || !state.environment.visible || state.seats.some((s) => !s.left && !s.online);
}
/** @param {GameState} state */
function canBegin(state) {
  return state.phase === 'intro' && state.seats.length >= 2 && state.seats.length <= 8 && !blocked(state) && state.seats.some((s) => s.id === state.leader);
}
/** @param {GameState} state @param {number} index */
export function drawId(state, index) { return `o${state.nonce}_${state.revision.toString(36)}_${index.toString(36)}`; }
/** @param {GameState} state */
function beginId(state) { return `o${state.nonce}_${state.revision.toString(36)}_go`; }

/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce)) throw new RangeError('Invalid nonce');
  /** @type {GameState} */
  const state = {phase:'intro',seats:init.players.map((p) => ({...p,left:false,hand:[],rank:null})).sort((a,b) => a.id-b.id),
    players:init.players.map((p) => ({...p})),leader:init.leader,nonce:init.nonce,revision:0,rngState:init.seed >>> 0,
    discard:[],excluded:[],order:[],turn:null,events:[],seq:0,environment:init.environment ? {...init.environment} : null,
    paused:init.paused,outcome:'complete',feedback:null};
  return transition(null,state);
}

/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state,event) {
  if (state.phase === 'ended') return {state,effects:[]};
  if (event.t !== 'input') {
    const next = copy(state);
    next.revision++;
    next.feedback = null;
    if (event.t === 'menu') next.paused = event.paused;
    if (event.t === 'environment') next.environment = event.value ? {...event.value} : null;
    if (event.t === 'players') {
      next.players = event.players.map((p) => ({...p}));
      next.leader = event.leader;
      if (next.phase === 'intro') next.seats = next.players.map((p) => ({...p,left:false,hand:[],rank:null})).sort((a,b) => a.id-b.id);
      else {
        for (const seat of next.seats) {
          const player = next.players.find((p) => p.id === seat.id);
          seat.online = !seat.left && player?.online === true;
          if (player) seat.name = player.name;
        }
        const leaving = next.seats.filter((s) => !s.left && !next.players.some((p) => p.id === s.id));
        const joker = leaving.some((s) => s.hand.includes('jk'));
        for (const seat of leaving) {
          seat.left = true; seat.rank = null;
          next.excluded.push(...seat.hand.filter((c) => !joker || c !== 'jk'));
          seat.hand = [];
        }
        next.order = next.order.filter((id) => !next.seats.find((s) => s.id === id)?.left);
        if (joker) {
          const remaining = next.seats.filter((s) => !s.left);
          const active = remaining.filter((s) => s.hand.length > 0);
          const candidates = active.length ? active : remaining;
          const rng = makeRng(next.rngState);
          const recipient = candidates[Math.floor(rng() * candidates.length)];
          next.rngState = rng.state;
          if (recipient) {
            recipient.hand.push('jk'); recipient.rank = null;
            next.order = next.order.filter((id) => id !== recipient.id);
          } else next.excluded.push('jk');
        }
        next.order.forEach((id,i) => { const seat = next.seats.find((s) => s.id === id); if (seat) seat.rank = i+1; });
        if (leaving.length) openTurn(next,state.turn?.from ?? 0,true);
      }
    }
    return transition(state,next);
  }
  if (blocked(state)) return {state,effects:[]};
  const {p,input} = event;
  if (state.phase === 'intro') {
    if (!canBegin(state) || p !== state.leader || input.k !== 'btn' || input.d !== 1 || input.id !== beginId(state)) return {state,effects:[]};
    const next = copy(state);
    const dealt = dealAndPair(next.seats.map((s) => s.id),next.rngState);
    next.phase = 'play'; next.discard = dealt.discard; next.rngState = dealt.rngState;
    next.seats.forEach((s) => { s.hand = /** @type {string[]} */ (dealt.hands[s.id]); });
    next.events = [];
    // 配札の捨て札は discard にまとめ、イベント列は配札での上がりから始める。
    for (const id of dealt.out) markOut(next,/** @type {Seat} */ (next.seats.find((s) => s.id === id)));
    openTurn(next,0,true);
    return transition(state,next,[{t:'cue',name:'deal'}]);
  }
  if (input.k !== 'tiles' || input.pass || !Array.isArray(input.ids) || input.ids.length !== 1 || p !== state.turn?.from) return {state,effects:[]};
  const target = state.seats.find((s) => s.id === state.turn?.to);
  const index = target?.hand.findIndex((_,i) => drawId(state,i) === input.ids[0]) ?? -1;
  if (index < 0) return {state,effects:[]};
  const next = copy(state);
  next.events = [];
  const from = /** @type {Seat} */ (next.seats.find((s) => s.id === p));
  const to = /** @type {Seat} */ (next.seats.find((s) => s.id === target?.id));
  const card = /** @type {string} */ (to.hand.splice(index,1)[0]);
  const paired = pairOff([...from.hand,card]);
  from.hand = paired.hand; next.discard.push(...paired.discard);
  emit(next,{type:'draw',from:p,to:to.id});
  if (paired.discard.length) emit(next,{type:'pair',p,cards:paired.discard});
  markOut(next,to); markOut(next,from);
  next.feedback = {p,text:`ひいた札：${cardText(card)}。${paired.discard.length ? 'ペア成立！' : ''}`};
  openTurn(next,p,false);
  /** @type {GameEffect[]} */
  const effects = [{t:'cue',name:'flip'}];
  if (paired.discard.length) effects.push({t:'cue',name:'place'});
  if (card === 'jk') effects.push({t:'vibrate',to:p,ms:[60]});
  return transition(state,next,effects);
}

/** @param {GameState} state @returns {GameState} */
function copy(state) {
  return {...state,seats:state.seats.map((s) => ({...s,hand:[...s.hand]})),discard:[...state.discard],excluded:[...state.excluded],order:[...state.order],events:[]};
}
/** @param {GameState} state @param {Omit<PublicEvent,'seq'> & {p?:number,cards?:string[],rank?:number,from?:number,to?:number}} event */
function emit(state,event) { state.events.push(/** @type {PublicEvent} */ ({...event,seq:++state.seq})); }
/** @param {GameState} state @param {Seat} seat */
function markOut(state,seat) {
  if (seat.left || seat.rank !== null || seat.hand.length !== 0) return;
  seat.rank = state.order.push(seat.id);
  emit(state,{type:'out',p:seat.id,rank:seat.rank});
}
/** @param {GameState} state @param {number} after @param {boolean} keep */
function openTurn(state,after,keep) {
  state.revision++;
  const active = state.seats.filter((s) => !s.left && s.hand.length);
  if (active.length <= 1 || state.seats.filter((s) => !s.left).length < 2) {
    const last = active[0];
    if (last) { last.rank = state.order.push(last.id); emit(state,{type:'out',p:last.id,rank:last.rank}); }
    state.phase = 'ended'; state.turn = null;
    state.outcome = state.order.length >= 2 ? 'complete' : 'incomplete';
    if (state.outcome === 'incomplete') state.seats.forEach((s) => { s.rank = null; });
    return;
  }
  const from = /** @type {Seat} */ ((keep ? active.find((s) => s.id === after) : null) ?? active.find((s) => s.id > after) ?? active[0]);
  const to = /** @type {Seat} */ (active.find((s) => s.id > from.id) ?? active[0]);
  const rng = makeRng(state.rngState);
  to.hand = shuffle(to.hand,rng); state.rngState = rng.state;
  state.turn = {from:from.id,to:to.id};
}

/** @param {GameState} state @param {Seat} seat @returns {PadSpec} */
function padFor(state,seat) {
  const hand = `あなた：${seat.hand.map(cardText).join(' ')}`;
  if (blocked(state)) return {k:'wait',title:'再開を待っています',body:hand};
  if (state.phase === 'intro') {
    if (seat.id === state.leader && canBegin(state)) return {k:'pad',stick:'none',buttons:[{id:beginId(state),label:'はじめる'}]};
    return {k:'wait',title:'ババ抜き',body:state.seats.length >= 2 && state.seats.length <= 8 ? '進行役がはじめます' : '2〜8人で遊べます'};
  }
  if (state.feedback?.p === seat.id) return {k:'wait',title:state.feedback.text,body:`${hand}${seat.rank ? `。${seat.rank}位` : ''}`};
  if (seat.rank !== null) return {k:'wait',title:`${seat.rank}位`,body:'大画面で勝負を見守ろう'};
  const from = state.seats.find((s) => s.id === state.turn?.from);
  const to = state.seats.find((s) => s.id === state.turn?.to);
  if (seat.id === to?.id) return {k:'wait',title:`${[...(from?.name ?? '')].slice(0,12).join('')}さんが札をひいています`,body:hand};
  return {k:'tiles',tiles:(to?.hand ?? []).map((_,i) => ({id:drawId(state,i),label:String(i+1)})),max:1,ok:'ひく',note:hand,...(seat.id !== from?.id ? {disabled:true} : {})};
}

/** @param {GameState|null} before @param {GameState} state @param {GameEffect[]} extra @returns {Transition} */
function transition(before,state,extra=[]) {
  const effects = [...extra];
  for (const event of state.events) if (event.type === 'out' && !state.seats.find((s) => s.id === event.p)?.hand.length) effects.push({t:'cue',name:'win'});
  if (state.phase === 'ended') {
    if (state.feedback) {
      const seat = state.seats.find((s) => s.id === state.feedback?.p);
      if (seat) effects.push({t:'pad',to:seat.id,spec:padFor(state,seat)});
    }
    if (state.outcome === 'complete') effects.push({t:'cue',name:'lose'});
    effects.push({t:'end',results:state.seats.map((s) => ({p:s.id,score:s.rank === null ? 0 : state.order.length-s.rank+1,ranked:!s.left && state.outcome === 'complete',label:s.left ? '退出' : s.rank === null ? '未成立' : s.rank === state.order.length ? '最下位' : `${s.rank}位`})),options:{display:'record',outcome:state.outcome}});
    return {state,effects};
  }
  for (const seat of state.seats.filter((s) => !s.left)) effects.push({t:'pad',to:seat.id,spec:padFor(state,seat)});
  for (const p of state.players.filter((p) => !state.seats.some((s) => s.id === p.id && !s.left))) effects.push({t:'pad',to:p.id,spec:{k:'wait',title:'次の勝負から参加できます'}});
  return {state,effects};
}

/** @param {GameState} state */
export function publicView(state) {
  return {phase:state.phase,seats:state.seats.map((s) => ({id:s.id,name:s.name,count:s.hand.length,rank:s.rank,left:s.left,online:s.online})),
    turn:state.turn ? {...state.turn} : null,discard:[...state.discard],events:state.events.map((e) => e.type === 'pair' ? {...e,cards:[...e.cards]} : {...e}),
    leader:state.leader,canBegin:canBegin(state),outcome:state.outcome};
}
/** @typedef {ReturnType<typeof publicView>} GameViewModel */
