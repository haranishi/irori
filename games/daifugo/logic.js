// @ts-check
import {buildDeck, classify, isLegal, legalPlays, makeRng, shuffle, strength} from './cards.js';
/** @typedef {import('./irori.js').PlayerId} PlayerId */
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
// 同梱SDKの同期前にも検査できるよう、追加契約だけをローカルの型で補う。
/** @typedef {{k:'tiles',token:string,tiles:{id:string,label:string,color:'red'|'gray',off:boolean}[],min:number,max:number,ok:string,pass?:string,disabled:boolean,note:string}} TilesPadSpec */
/** @typedef {import('./irori.js').PadSpec|TilesPadSpec} PadSpec */
/** @typedef {Exclude<import('./irori.js').GameInput,{k:'tiles'}>|{k:'tiles',ids:string[],pass?:true,t?:string}} GameInput */
/** @typedef {PlayerInfo & {hand:string[], left:boolean, passed:boolean, rank:number|null}} Seat */
/** @typedef {{cards:string[], n:number, by:PlayerId}} Table */
/** @typedef {{seq:number, type:'play'|'pass'|'sweep'|'revolution'|'finish', p:PlayerId, cards?:string[], revolution?:boolean, reason?:string, rank?:number}} PublicEvent */
/** @typedef {{p:PlayerId, id:string, label:string}} Control */
/** @typedef {{phase:'intro'|'play'|'ended', seats:Seat[], players:PlayerInfo[], leader:PlayerId|null, nonce:string, revision:number, refused:Record<number,number>, seed:number, rngState:number, stock:string[], discard:string[], excluded:string[], table:Table|null, turn:PlayerId|null, revolution:boolean, finishOrder:PlayerId[], events:PublicEvent[], seq:number, environment:HostEnvironment|null, paused:boolean, control:Control|null, outcome:'complete'|'incomplete'}} GameState */
/** @typedef {{players:readonly PlayerInfo[], leader:PlayerId|null, environment:Readonly<HostEnvironment>|null, paused:boolean, nonce:string, seed:number}} GameInit */
/** @typedef {{t:'input',p:PlayerId,input:GameInput}|{t:'players',players:readonly PlayerInfo[],leader:PlayerId|null}|{t:'menu',paused:boolean}|{t:'environment',value:Readonly<HostEnvironment>|null}} GameEvent */
/** @typedef {{t:'pad',to:PlayerId,spec:PadSpec}|{t:'cue',name:'deal'|'place'|'sweep'|'revolution'|'win'|'lose',v?:number}|{t:'vibrate',to:PlayerId,ms:number[]}|{t:'end',results:import('./irori.js').GameResult[],options:import('./irori.js').GameEndOptions}} GameEffect */
/** @typedef {{state:GameState,effects:GameEffect[]}} Transition */

/** @param {PlayerInfo} p @returns {Seat} */
const newSeat = (p) => ({...p,hand:[],left:false,passed:false,rank:null});
/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce)) throw new RangeError('Invalid game nonce');
  /** @type {GameState} */
  const state = {phase:'intro',seats:init.players.map(newSeat),players:init.players.map((p)=>({...p})),leader:init.leader,
    nonce:init.nonce,revision:0,refused:{},seed:init.seed >>> 0,rngState:init.seed >>> 0,stock:buildDeck(),discard:[],excluded:[],
    table:null,turn:null,revolution:false,finishOrder:[],events:[],seq:0,
    environment:init.environment ? {...init.environment} : null,paused:init.paused,control:null,outcome:'complete'};
  setControl(state);
  return transition(state);
}

/** @param {GameState} state */
function blocked(state) {
  return state.paused || !state.environment?.connected || !state.environment.visible;
}
/** @param {GameState} state */
function canBegin(state) {
  return state.phase === 'intro' && !blocked(state) && state.seats.length >= 3 && state.seats.length <= 8
    && state.seats.every((s)=>s.online) && state.seats.some((s)=>s.id === state.leader);
}
/** @param {GameState} state */
function setControl(state) {
  state.control = canBegin(state) ? {p:/** @type {number} */ (state.leader),id:`d${state.nonce}_${state.revision.toString(36)}_start`,label:'はじめる'} : null;
}
/** @param {GameState} state @param {PlayerId} p @param {string} card */
export function cardId(state, p, card) { return `${tilesToken(state,p)}_${card}`; }
/** @param {GameState} state @param {PlayerId} p */
function tilesToken(state, p) { return `d${state.nonce}_${state.revision.toString(36)}_${(state.refused[p] ?? 0).toString(36)}`; }

/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state, event) {
  if (state.phase === 'ended') return {state,effects:[]};
  if (event.t !== 'input') {
    const next = structuredClone(state);
    if (event.t === 'menu') next.paused = event.paused;
    if (event.t === 'environment') next.environment = event.value ? {...event.value} : null;
    if (event.t === 'players') {
      next.players = event.players.map((p)=>({...p})); next.leader = event.leader;
      if (next.phase === 'intro') {
        if (!event.players.length && next.seats.length) {
          next.seats.forEach((s)=>{ s.left = true; s.online = false; });
          settle(next);
        } else next.seats = event.players.map(newSeat);
      }
      else {
        const roster = new Map(event.players.map((p)=>[p.id,p]));
        for (const seat of next.seats) {
          const player = roster.get(seat.id);
          seat.online = !seat.left && player?.online === true;
          if (player && !seat.left) seat.name = player.name;
          if (!player && !seat.left) {
            seat.left = true; seat.rank = null; seat.passed = false;
            next.excluded.push(...seat.hand); seat.hand = [];
          }
        }
        next.finishOrder = next.finishOrder.filter((id)=>!next.seats.find((s)=>s.id === id)?.left);
        next.finishOrder.forEach((id,i)=>{ const seat = next.seats.find((s)=>s.id === id); if (seat) seat.rank = i + 1; });
        settle(next);
        if (next.phase === 'play') {
          if (!active(next).some((s)=>s.id === next.turn)) next.turn = nextSeat(next,next.turn);
          sweepIfPassed(next);
        }
      }
    }
    if (JSON.stringify(next) === JSON.stringify(state)) return {state,effects:[]};
    next.revision++; setControl(next);
    return transition(next,state);
  }
  const {p,input} = event;
  if (state.phase === 'intro') {
    if (input.k !== 'btn' || input.d !== 1 || state.control?.p !== p || input.id !== state.control.id) return {state,effects:[]};
    const next = structuredClone(state);
    const rng = makeRng(next.rngState);
    const deck = shuffle(next.stock,rng); next.rngState = rng.state(); next.stock = [];
    deck.forEach((card,i)=>next.seats[i % next.seats.length]?.hand.push(card));
    for (const seat of next.seats) seat.hand.sort((a,b)=>strength(a,false)-strength(b,false) || a.localeCompare(b));
    next.phase = 'play'; next.turn = next.seats.find((s)=>s.hand.includes('d3'))?.id ?? null;
    next.revision++; next.control = null;
    return transition(next,state,[{t:'cue',name:'deal'}]);
  }
  if (input.k !== 'tiles') return {state,effects:[]};
  if (input.t !== tilesToken(state,p)) return {state,effects:[]};
  const seat = state.seats.find((s)=>s.id === p && !s.left);
  if (!seat) return {state,effects:[]};
  // 旧画面の札は、現在のtokenと混ぜて送られても再送や拒否回数の更新をしない。
  if (input.ids.some((id)=>!id.startsWith(`${tilesToken(state,p)}_`))) return {state,effects:[]};
  if (blocked(state) || !state.seats.find((s)=>s.id === state.turn)?.online) return reject(state,seat,'接続と再開を待っています');
  if (state.turn !== p || !seat.online || seat.rank !== null) return reject(state,seat,'あなたの番を待ってください');
  if (input.pass === true) {
    if (input.ids.length || !state.table) return reject(state,seat,'場があるときだけパスできます');
    const next = structuredClone(state);
    const passing = /** @type {Seat} */ (next.seats.find((s)=>s.id === p));
    passing.passed = true; record(next,{type:'pass',p});
    next.turn = nextSeat(next,p); sweepIfPassed(next); next.revision++;
    return transition(next,state);
  }
  const cards = input.ids.map((id)=>seat.hand.find((card)=>cardId(state,p,card) === id));
  if (cards.some((c)=>c === undefined) || new Set(input.ids).size !== input.ids.length) return reject(state,seat,'今の手札から重複せず選んでください');
  const play = /** @type {string[]} */ (cards);
  if (!isLegal(play,state.table,state.revolution)) return reject(state,seat,'同じ数を1〜4枚、場より強く出してください');
  const next = structuredClone(state);
  const playing = /** @type {Seat} */ (next.seats.find((s)=>s.id === p));
  playing.hand = playing.hand.filter((c)=>!play.includes(c));
  if (next.table) next.discard.push(...next.table.cards);
  next.table = {cards:[...play],n:play.length,by:p};
  next.seats.forEach((s)=>{ s.passed = false; });
  record(next,{type:'play',p,cards:[...play]});
  if (play.length === 4) {
    next.revolution = !next.revolution; record(next,{type:'revolution',p,revolution:next.revolution});
  }
  if (!playing.hand.length) {
    next.finishOrder.push(p); playing.rank = next.finishOrder.length;
    record(next,{type:'finish',p,rank:playing.rank});
  }
  next.turn = nextSeat(next,p);
  if (classify(play)?.rank === '8') sweep(next,p,'eight');
  settle(next); next.revision++;
  return transition(next,state,[{t:'cue',name:'place'}]);
}

/** @param {GameState} state */
function active(state) { return state.seats.filter((s)=>!s.left && s.rank === null); }
/** @param {GameState} state @param {PlayerId|null} after @returns {PlayerId|null} */
function nextSeat(state, after) {
  const start = state.seats.findIndex((s)=>s.id === after);
  for (let i = 1; i <= state.seats.length; i++) {
    const seat = state.seats[(start+i) % state.seats.length];
    if (seat && !seat.left && seat.rank === null) return seat.id;
  }
  return null;
}
/** @param {GameState} state @param {Omit<PublicEvent,'seq'>} event */
function record(state, event) { state.events.push({...event,seq:++state.seq}); }
/** @param {GameState} state @param {PlayerId} by @param {string} reason */
function sweep(state, by, reason) {
  if (!state.table) return;
  state.discard.push(...state.table.cards); state.table = null;
  state.seats.forEach((s)=>{ s.passed = false; });
  state.turn = active(state).some((s)=>s.id === by) ? by : nextSeat(state,by);
  record(state,{type:'sweep',p:by,reason});
}
/** @param {GameState} state */
function sweepIfPassed(state) {
  if (state.table && active(state).filter((s)=>s.id !== state.table?.by).every((s)=>s.passed)) sweep(state,state.table.by,'passes');
}
/** @param {GameState} state */
function settle(state) {
  const remaining = active(state);
  if (remaining.length >= 2) return;
  const last = remaining[0];
  if (last) { state.finishOrder.push(last.id); last.rank = state.finishOrder.length; }
  state.phase = 'ended'; state.turn = null; state.control = null;
  state.outcome = state.finishOrder.length >= 2 ? 'complete' : 'incomplete';
  if (state.outcome === 'incomplete') state.seats.forEach((s)=>{ s.rank = null; });
  else if (last) record(state,{type:'finish',p:last.id,rank:/** @type {number} */ (last.rank)});
}

/** @param {GameState} state @param {Seat} seat @param {string} [reason] @returns {PadSpec} */
function padFor(state, seat, reason) {
  if (state.phase === 'intro') return state.control?.p === seat.id
    ? {k:'pad',stick:'none',buttons:[{id:state.control.id,label:state.control.label}],hint:'手札を早く出し切った順に上がります'}
    : {k:'wait',title:'大富豪',body:canBegin(state) ? '進行役の開始を待っています' : '3〜8人の接続と再開を待っています'};
  if (seat.left || seat.rank !== null || state.phase === 'ended') return {k:'wait',title:seat.left ? '退出' : seat.rank ? `${seat.rank}位で上がりました` : '今回は未成立'};
  const disabled = blocked(state) || !state.seats.find((s)=>s.id === state.turn)?.online || !seat.online || state.turn !== seat.id;
  const playable = disabled ? new Set(seat.hand) : new Set(legalPlays(seat.hand,state.table,state.revolution).flat());
  const name = state.seats.find((s)=>s.id === state.turn)?.name ?? '';
  const table = state.table ? state.table.cards.map(cardLabel).join(' ') : 'なし';
  const note = `${reason ? reason + '｜' : ''}${blocked(state) ? '再開待ち' : state.turn === seat.id ? 'あなたの番' : `${name}の番`}｜場 ${table}${state.revolution ? '｜革命中' : ''}`;
  const count = seat.hand.filter((c)=>playable.has(c)).length;
  return {k:'tiles',token:tilesToken(state,seat.id),tiles:seat.hand.map((c)=>({id:cardId(state,seat.id,c),label:cardLabel(c),color:/** @type {'red'|'gray'} */ (c[0] === 'h' || c[0] === 'd' ? 'red' : 'gray'),off:!playable.has(c)})),
    min:count ? 1 : 0,max:Math.min(4,count),ok:'出す',...(state.table ? {pass:'パス'} : {}),disabled,note:[...note].slice(0,120).join('')};
}
/** @param {string} card */
export function cardLabel(card) {
  if (card.startsWith('jk')) return `ジョーカー${card.slice(2)}`;
  const symbols = /** @type {Record<string,string>} */ ({s:'♠',h:'♥',d:'♦',c:'♣'});
  return `${symbols[card[0] ?? ''] ?? ''}${card.slice(1).toUpperCase()}`;
}
/** @param {GameState} state @param {Seat} seat @param {string} reason @returns {Transition} */
function reject(state, seat, reason) {
  const next = {...state,refused:{...state.refused,[seat.id]:(state.refused[seat.id] ?? 0) + 1}};
  return {state:next,effects:[{t:'pad',to:seat.id,spec:padFor(next,seat,reason)}]};
}

/** @param {number} rank @param {number} count */
function rankLabel(rank, count) {
  if (rank === 1) return '大富豪';
  if (rank === count) return '大貧民';
  if (count >= 4 && rank === 2) return '富豪';
  if (count >= 4 && rank === count-1) return '貧民';
  return '平民';
}
/** @param {GameState} next @param {GameState} [before] @param {GameEffect[]} [initial] @returns {Transition} */
function transition(next, before, initial = []) {
  const effects = [...initial];
  for (const event of next.events.filter((e)=>e.seq > (before?.seq ?? 0))) {
    if (event.type === 'sweep' || event.type === 'revolution') effects.push({t:'cue',name:event.type});
    if (event.type === 'finish' && next.seats.find((s)=>s.id === event.p)?.hand.length === 0) effects.push({t:'cue',name:'win'});
  }
  if (next.phase === 'ended') {
    const count = next.finishOrder.length;
    // 残る手札が一斉に退出した場合も、在席の上がり順から最下位が確定する。
    if (next.outcome === 'complete') effects.push({t:'cue',name:'lose'});
    effects.push({t:'end',results:next.seats.map((s)=>({p:s.id,score:s.rank === null ? 0 : count-s.rank+1,
      ranked:!s.left && next.outcome === 'complete',label:s.left ? '退出' : s.rank === null ? '未成立' : rankLabel(s.rank,count)})),
    options:{display:'record',outcome:next.outcome,note:next.outcome === 'incomplete' ? '順位を付けられる人が2人未満のため未成立です' : '手札を出し切った順の順位です'}});
  } else {
    for (const seat of next.seats.filter((s)=>!s.left)) effects.push({t:'pad',to:seat.id,spec:padFor(next,seat)});
    for (const player of next.players.filter((p)=>!next.seats.some((s)=>s.id === p.id && !s.left))) effects.push({t:'pad',to:player.id,spec:{k:'wait',title:'次の勝負から参加できます'}});
  }
  return {state:next,effects};
}

/** @param {GameState} state */
export function publicView(state) {
  return {phase:state.phase,seats:state.seats.map((s)=>({id:s.id,name:s.name,count:s.hand.length,passed:s.passed,rank:s.rank,left:s.left,online:s.online})),
    table:state.table ? {...state.table,cards:[...state.table.cards]} : null,turn:state.turn,revolution:state.revolution,
    events:state.events.map((e)=>({...e,...(e.cards ? {cards:[...e.cards]} : {})})),leader:state.leader,canBegin:canBegin(state),outcome:state.outcome};
}
/** @typedef {ReturnType<typeof publicView>} GameViewModel */
