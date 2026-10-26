// @ts-check
// 札を消費するのは一斉公開の瞬間だけ。中断中の仮選択は得点にも手札にも影響しない。
/** @typedef {import('./irori.js').PlayerId} PlayerId */
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
/** @typedef {PlayerInfo & {left: boolean, hand: number[], score: number}} Seat */
/** @typedef {'intro'|'choose'|'reveal'|'recover'|'ended'} Phase */
/** @typedef {{p: PlayerId, card: number, duplicate: boolean}} Bid */
/** @typedef {{bids: Bid[], winner: PlayerId|null, prize: number, carried: number, awarded: number}} Reveal */
/** @typedef {{p: PlayerId, id: string, label: string}} Control */
/** @typedef {{phase: Phase, nonce: string, revision: number, roundIndex: number, seats: Seat[], leader: PlayerId|null, players: PlayerInfo[], picks: Record<number,number>, carry: number, reveal: Reveal|null, environment: HostEnvironment|null, paused: boolean, blockers: string[], started: boolean, control: Control|null, recoverTarget: 'choose'|'reveal'|null, outcome: 'complete'|'incomplete'}} GameState */
/** @typedef {{t:'input', p: PlayerId, input: GameInput}|{t:'players', players: readonly PlayerInfo[], leader: PlayerId|null}|{t:'menu', paused:boolean}|{t:'environment', value: Readonly<HostEnvironment>|null}} GameEvent */
/** @typedef {{t:'pad', to: PlayerId, spec: PadSpec}|{t:'end', results: import('./irori.js').GameResult[], options: import('./irori.js').GameEndOptions}} GameEffect */
/** @typedef {{state:GameState, effects:GameEffect[]}} Transition */
/** @typedef {{players:readonly PlayerInfo[], leader:PlayerId|null, environment:Readonly<HostEnvironment>|null, paused:boolean, nonce:string}} GameInit */

export const PRIZES = Object.freeze([3, 6, 2, 8, 4, 10]);
export const CARDS = Object.freeze([1, 2, 3, 4, 5, 6]);

/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce)) throw new RangeError('Invalid game nonce');
  /** @type {GameState} */
  const state = {
    phase:'intro', nonce:init.nonce, revision:0, roundIndex:0,
    seats:init.players.map((p)=>({...p, left:false, hand:[...CARDS], score:0})),
    players:init.players.map((p)=>({...p})), leader:init.leader, picks:{}, carry:0, reveal:null,
    environment:init.environment ? {...init.environment} : null, paused:init.paused,
    blockers:[], started:false, control:null, recoverTarget:null, outcome:'complete',
  };
  return transition(null, reconcile(state));
}

/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state, event) {
  if (state.phase === 'ended') return {state, effects:[]};
  if (event.t === 'players') {
    const roster = new Map(event.players.map((p)=>[p.id,p]));
    // 説明中の退出はまだ記録のない席を除く。勝負開始後だけ名簿を固定して全員分を残す。
    const seats = state.seats.map((s)=>({ ...s, online:!s.left && roster.get(s.id)?.online === true, left:s.left || !roster.has(s.id) }))
      .filter((s)=>state.started || !s.left);
    let next = {...state, seats, players:event.players.map((p)=>({...p})), leader:event.leader};
    if (next.started && seats.some((s)=>s.left)) next = {...next, phase:'ended', outcome:'incomplete', control:null};
    return transition(state, reconcile(next));
  }
  if (event.t === 'menu') return transition(state, reconcile({...state, paused:event.paused}));
  if (event.t === 'environment') return transition(state, reconcile({...state, environment:event.value ? {...event.value} : null}));
  if (state.blockers.length) return {state, effects:[]};
  const {p,input} = event;
  if (input.k === 'btn' && input.d === 1 && state.control?.p === p && input.id === state.control.id) {
    if (state.phase === 'intro') return transition(state, openRound({...state, started:true}));
    if (state.phase === 'recover') {
      if (state.recoverTarget === 'reveal') return transition(state, reconcile({...state, phase:'reveal', recoverTarget:null, revision:state.revision+1}));
      return transition(state, openRound(state));
    }
    if (state.phase === 'reveal') {
      if (state.roundIndex === PRIZES.length - 1) return transition(state, {...state, phase:'ended', control:null});
      return transition(state, openRound({...state, roundIndex:state.roundIndex+1}));
    }
  }
  if (state.phase !== 'choose' || input.k !== 'pick' || state.picks[p] !== undefined) return {state,effects:[]};
  const seat = state.seats.find((s)=>s.id === p && !s.left && s.online);
  const card = seat?.hand.find((n)=>choiceId(state,p,n) === input.id);
  if (card === undefined) return {state,effects:[]};
  let next = {...state, picks:{...state.picks,[p]:card}};
  if (next.seats.every((s)=>next.picks[s.id] !== undefined)) next = resolveRound(next);
  return transition(state,next);
}

/** @param {GameState} state @param {PlayerId} p @param {number} card */
export function choiceId(state,p,card) { return `m${state.nonce}_${state.revision.toString(36)}_${p}_${card}`; }

/** 全札の重複を取り除いてから、残った最大値を決める。 @param {readonly {p:PlayerId,card:number}[]} entries */
export function evaluateBids(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.card,(counts.get(entry.card) ?? 0)+1);
  const bids = entries.map((entry)=>({...entry,duplicate:counts.get(entry.card)>1}));
  const unique = bids.filter((bid)=>!bid.duplicate).sort((a,b)=>b.card-a.card);
  return {bids,winner:unique[0]?.p ?? null};
}

/** @param {GameState} state @returns {GameState} */
function openRound(state) {
  /** @type {GameState} */
  let next = {...state,phase:'choose',picks:{},reveal:null,control:null,recoverTarget:null,revision:state.revision+1};
  // 1枚のchoicesはSDKの範囲外。最後の札はゲームの規則として自動で確定する。
  for (const seat of next.seats) if (seat.hand.length === 1) next.picks[seat.id] = /** @type {number} */ (seat.hand[0]);
  if (next.seats.every((s)=>next.picks[s.id] !== undefined)) next = resolveRound(next);
  return reconcile(next);
}

/** @param {GameState} state @returns {GameState} */
function resolveRound(state) {
  const evaluation = evaluateBids(state.seats.map((s)=>({p:s.id,card:/** @type {number} */ (state.picks[s.id])})));
  const prize = /** @type {number} */ (PRIZES[state.roundIndex]);
  const awarded = evaluation.winner === null ? 0 : prize+state.carry;
  const seats = state.seats.map((s)=>({...s,hand:s.hand.filter((n)=>n !== state.picks[s.id]),score:s.score+(s.id === evaluation.winner ? awarded : 0)}));
  return reconcile({...state,phase:'reveal',seats,picks:{},carry:evaluation.winner === null ? state.carry+prize : 0,
    reveal:{...evaluation,prize,carried:state.carry,awarded},revision:state.revision+1});
}

/** @param {GameState} state @returns {GameState} */
function reconcile(state) {
  const blockers = [
    ...(state.paused ? ['menu'] : []),
    ...(!state.environment?.connected ? ['host-offline'] : []),
    ...(!state.environment?.visible ? ['hidden'] : []),
    ...(state.seats.some((s)=>!s.left && !s.online) ? ['player-offline'] : []),
  ];
  /** @type {GameState} */
  let next = {...state,blockers};
  if (blockers.length && (state.phase === 'choose' || state.phase === 'reveal')) {
    next = {...next,phase:'recover',recoverTarget:state.phase,picks:{},revision:state.revision+1};
  }
  const validCount = next.seats.filter((s)=>!s.left).length;
  const leaderReady = next.seats.some((s)=>s.id === next.leader && !s.left && s.online);
  const allowed = !blockers.length && leaderReady && (next.phase !== 'intro' || validCount >= 2 && validCount <= 8);
  const label = next.phase === 'intro' ? 'はじめる' : next.phase === 'recover'
    ? next.recoverTarget === 'reveal' ? '結果に戻る' : 'やり直す'
    : next.roundIndex === PRIZES.length-1 ? '総合結果へ' : '次の市へ';
  const needsControl = allowed && ['intro','recover','reveal'].includes(next.phase);
  const desired = needsControl ? {p:/** @type {number} */ (next.leader),label} : null;
  const sameControl = desired && next.control?.p === desired.p && next.control.label === desired.label;
  // 状態は同じでも、進行役や中断理由が変わったら以前の操作を受け付けない。
  if (desired && !sameControl) next = {...next,revision:next.revision+1,control:{...desired,id:`m${next.nonce}_${(next.revision+1).toString(36)}_go`}};
  else if (!desired) next = {...next,control:null};
  return next;
}

/** @param {GameState} state @param {Seat} seat @returns {PadSpec} */
function padFor(state,seat) {
  if (seat.left) return {k:'wait',title:'この勝負は終了しました'};
  if (state.control?.p === seat.id) return {k:'pad',stick:'none',orient:'portrait',buttons:[{id:state.control.id,label:state.control.label}],hint:state.phase === 'intro' ? '札がかぶると失格。灯を集めよう' : '大画面の結果を見て進めよう'};
  if (state.phase === 'choose') {
    const chosen = state.picks[seat.id];
    if (chosen !== undefined) return {k:'wait',title:'札を伏せました',body:`${chosen}の札を受け付けました。全員が選ぶまで、大画面には出ません。`};
    return {k:'choices',options:seat.hand.map((n)=>({id:choiceId(state,seat.id,n),label:`${n}の札`})),hint:`第${state.roundIndex+1}市・灯${/** @type {number} */ (PRIZES[state.roundIndex])+state.carry}点。同じ数字は失格`};
  }
  if (state.phase === 'recover') return {k:'wait',title:state.blockers.length ? 'つなぎ直しを待っています' : '進行役の操作を待っています',body:'ここまでの得点と使った札は、そのまま残ります。'};
  return {k:'wait',title:state.phase === 'intro' ? '灯市のかけひき' : '大画面を見よう',body:'進行役が手元で進めます。最後の1枚は自動で出します。'};
}

/** @param {GameState|null} before @param {GameState} next @returns {Transition} */
function transition(before,next) {
  /** @type {GameEffect[]} */
  const effects=[];
  if (next.phase === 'ended') {
    if (before?.phase !== 'ended') effects.push({t:'end',results:next.seats.map((s)=>({p:s.id,score:s.score,ranked:next.outcome === 'complete'})),options:{display:'points',outcome:next.outcome,note:next.outcome === 'incomplete' ? '参加者が退出したため、今回は勝敗なしです。確定済みの得点を残しています。' : next.carry ? `最後に残った${next.carry}点の灯は、誰も獲得しませんでした。` : '6つの市で集めた灯の合計です。同点は同順位です。'}});
    return {state:next,effects};
  }
  for (const seat of next.seats) {
    const spec=padFor(next,seat);
    const previous=before?.seats.find((s)=>s.id === seat.id);
    if (!before || !previous || JSON.stringify(padFor(before,previous)) !== JSON.stringify(spec)) effects.push({t:'pad',to:seat.id,spec});
  }
  for (const player of next.players.filter((p)=>!next.seats.some((s)=>s.id === p.id && !s.left))) {
    if (!before?.players.some((p)=>p.id === player.id)) effects.push({t:'pad',to:player.id,spec:{k:'wait',title:'次の勝負から参加できます'}});
  }
  return {state:next,effects};
}

/** 公開前の選択は番号だけでなく、IDや手札の減り方からも漏らさない。 @param {GameState} state */
export function publicView(state) {
  return {
    phase:state.phase,roundIndex:state.roundIndex,prizes:[...PRIZES],carry:state.carry,
    participants:state.seats.map((s)=>({id:s.id,name:s.name,online:s.online,left:s.left,score:s.score,
      remaining:s.hand.length,used:CARDS.filter((n)=>!s.hand.includes(n))})),
    leader:state.leader,leaderName:state.seats.find((s)=>s.id === state.leader)?.name ?? '進行役',
    blockers:[...state.blockers],canContinue:state.control !== null,actionLabel:state.control?.label ?? '',
    canBegin:state.phase === 'intro' && state.control !== null,
    reveal:state.phase === 'reveal' && state.reveal ? {...state.reveal,bids:state.reveal.bids.map((b)=>({...b}))} : null,
    outcome:state.outcome,recoverTarget:state.recoverTarget,
  };
}
/** @typedef {ReturnType<typeof publicView>} GameViewModel */
