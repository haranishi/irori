// @ts-check
// 手は全員の確定後にだけ公開する。描画と通信を持たない同時解決の判定。
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').GameEndOptions} GameEndOptions */
/** @typedef {import('./irori.js').GameResult} GameResult */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
/** @typedef {'slash' | 'guard' | 'focus' | 'burst'} Move */
/** @typedef {'intro' | 'choose' | 'reveal' | 'recover' | 'ended'} Phase */
/** @typedef {{id:number,name:string,online:boolean,left:boolean,hp:number,energy:number}} Seat */
/** @typedef {{p:number,move:Move,damage:number,hpBefore:number,energyBefore:number}} Reveal */
/** @typedef {{phase:Phase,seats:Seat[],leader:number|null,paused:boolean,environment:HostEnvironment|null,nonce:string,seq:number,round:number,picks:Record<string,Move>,reveal:Reveal[],outcome:'complete'|'incomplete'}} GameState */
/** @typedef {{t:'input',p:number,input:GameInput}|{t:'players',players:readonly PlayerInfo[],leader:number|null}|{t:'menu',paused:boolean}|{t:'environment',value:Readonly<HostEnvironment>}} GameEvent */
/** @typedef {{t:'pad',to:number,spec:PadSpec}|{t:'end',results:GameResult[],options:GameEndOptions}} GameEffect */
/** @typedef {{state:GameState,effects:GameEffect[]}} Transition */
/** @typedef {{phase:Phase,seats:Seat[],leader:number|null,round:number,blockers:string[],canAct:boolean,actionLabel:string,finished:boolean,reveal:Reveal[],outcome:'complete'|'incomplete'}} GameViewModel */

export const MAX_ROUNDS = 10;
export const MAX_ENERGY = 3;
/** @type {Readonly<Record<Move,{label:string,cost:number,description:string}>>} */
export const MOVES = {
  slash: { label: '斬る', cost: 1, description: '気力1・1ダメージ' },
  guard: { label: '受ける', cost: 0, description: '斬るを防ぐ' },
  focus: { label: '溜める', cost: 0, description: '気力を1回復' },
  burst: { label: '大技', cost: 3, description: '気力3・防御を貫く2ダメージ' },
};
const ORDER = /** @type {const} */ (['slash', 'guard', 'focus', 'burst']);

/** @param {{players:readonly PlayerInfo[],leader:number|null,environment:HostEnvironment|null,paused:boolean,nonce:string}} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce)) throw new RangeError('Invalid game nonce');
  /** @type {GameState} */
  const state = {
    phase: 'intro', seats: init.players.map((p) => ({ ...p, left: false, hp: 4, energy: 1 })),
    leader: init.leader, paused: init.paused, environment: init.environment ? { ...init.environment } : null,
    nonce: init.nonce, seq: 1, round: 1, picks: {}, reveal: [], outcome: 'complete',
  };
  return transition(null, state);
}

/** @param {GameState} state @returns {string[]} */
export function blockersFor(state) {
  const reasons = [];
  if (state.paused) reasons.push('メニューを閉じるのを待っています');
  if (state.environment?.connected !== true) reasons.push('大画面の接続を待っています');
  if (state.environment?.visible === false) reasons.push('大画面に戻るのを待っています');
  if (state.seats.some((s) => !s.left && !s.online)) reasons.push('スマホの接続を待っています');
  return reasons;
}

/** @param {GameState} state */
function mayAct(state) {
  return blockersFor(state).length === 0 && state.seats.filter((s) => !s.left).length === 2
    && state.seats.some((s) => s.id === state.leader && s.online && !s.left);
}

/** @param {GameState} state */
export function controlId(state) { return `c_${state.nonce}_${state.seq.toString(36)}`; }
/** @param {GameState} state @param {Move} move */
export function choiceId(state, move) { return `m_${state.nonce}_${state.seq.toString(36)}_${move}`; }
/** @param {GameState} state */
export function isFinished(state) { return state.round >= MAX_ROUNDS || state.seats.some((s) => s.hp === 0); }

/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state, event) {
  if (state.phase === 'ended') return { state, effects: [] };
  if (event.t !== 'input') {
    let next = { ...state };
    if (event.t === 'players') {
      next.seats = state.seats.map((s) => {
        const current = event.players.find((p) => p.id === s.id);
        return { ...s, online: !s.left && current?.online === true, left: s.left || !current };
      });
      next.leader = event.leader;
    } else if (event.t === 'menu') next.paused = event.paused;
    else next.environment = { ...event.value };
    if (next.phase !== 'intro' && next.seats.some((s) => s.left)) {
      next = { ...next, phase: 'ended', picks: {}, outcome: 'incomplete' };
    } else if (next.phase === 'choose' && blockersFor(next).length > 0) {
      next = { ...next, phase: 'recover', picks: {} };
    }
    const changed = next.phase !== state.phase || next.leader !== state.leader
      || blockersFor(next).join() !== blockersFor(state).join()
      || next.seats.some((s, i) => s.left !== state.seats[i]?.left);
    if (changed) next.seq++;
    return transition(state, next);
  }
  const seat = state.seats.find((s) => s.id === event.p);
  if (!seat?.online || seat.left || blockersFor(state).length) return { state, effects: [] };
  if (state.phase === 'choose') {
    if (event.input.k !== 'pick' || state.picks[event.p]) return { state, effects: [] };
    const move = ORDER.find((m) => event.input.k === 'pick' && choiceId(state, m) === event.input.id);
    if (!move || MOVES[move].cost > seat.energy) return { state, effects: [] };
    const next = { ...state, picks: { ...state.picks, [event.p]: move } };
    return transition(state, Object.keys(next.picks).length === 2 ? resolveRound(next) : next);
  }
  if (event.input.k !== 'btn' || event.input.d !== 1 || !mayAct(state)
      || event.p !== state.leader || event.input.id !== controlId(state)) return { state, effects: [] };
  if (state.phase === 'reveal' && isFinished(state)) {
    return transition(state, { ...state, phase: 'ended', picks: {}, seq: state.seq + 1 });
  }
  const round = state.phase === 'reveal' ? state.round + 1 : state.round;
  return transition(state, { ...state, phase: 'choose', picks: {}, reveal: [], round, seq: state.seq + 1 });
}

/** @param {Move} move @param {Move} defending */
function damage(move, defending) {
  if (move === 'burst') return 2;
  return move === 'slash' && defending !== 'guard' ? 1 : 0;
}

/** @param {GameState} state @returns {GameState} */
function resolveRound(state) {
  const left = state.seats[0];
  const right = state.seats[1];
  if (!left || !right) throw new Error('Two seats required');
  const a = state.picks[left.id];
  const b = state.picks[right.id];
  if (!a || !b) throw new Error('Two moves required');
  const reveal = [
    { p: left.id, move: a, damage: damage(b, a), hpBefore: left.hp, energyBefore: left.energy },
    { p: right.id, move: b, damage: damage(a, b), hpBefore: right.hp, energyBefore: right.energy },
  ];
  const seats = state.seats.map((s) => {
    const record = reveal.find((r) => r.p === s.id);
    if (!record) return s;
    return { ...s, hp: Math.max(0, s.hp - record.damage),
      energy: Math.min(MAX_ENERGY, s.energy - MOVES[record.move].cost + (record.move === 'focus' ? 1 : 0)) };
  });
  return { ...state, phase: 'reveal', seats, reveal, picks: {}, seq: state.seq + 1 };
}

/** @param {GameState} state @param {Seat} seat @returns {PadSpec} */
function padFor(state, seat) {
  if (state.phase === 'choose') {
    const chosen = state.picks[seat.id];
    if (chosen) return { k: 'wait', title: '構えを決めました', body: `「${MOVES[chosen].label}」を受け付けました。大画面で一斉公開します。` };
    return { k: 'choices', hint: `第${state.round}手・体力${seat.hp}・気力${seat.energy}｜手を1つ選ぶ`,
      options: ORDER.filter((m) => MOVES[m].cost <= seat.energy).map((m) => ({
        id: choiceId(state, m), label: `${MOVES[m].label}${MOVES[m].cost ? ` 気${MOVES[m].cost}` : ''}`,
      })) };
  }
  const label = state.phase === 'intro' ? 'はじめる' : state.phase === 'recover' ? 'やり直す'
    : isFinished(state) ? '総合結果へ' : '次の手へ';
  if (state.phase !== 'ended' && seat.id === state.leader && mayAct(state)) {
    return { k: 'pad', stick: 'none', buttons: [{ id: controlId(state), label }], hint: label === 'やり直す' ? '同じ手をもう一度。体力・気力はそのまま' : '大画面を見てから進めよう' };
  }
  if (state.seats.filter((s) => !s.left).length !== 2) return { k: 'wait', title: '2人で遊ぶゲームです', body: '参加する人数を2人にして、ゲームを開き直してください。' };
  return { k: 'wait', title: state.phase === 'recover' ? 'この手はやり直し' : '大画面を見てね',
    body: blockersFor(state).join('。') || '進行役のスマホで次へ進みます。' };
}

/** @param {GameState|null} previous @param {GameState} state @returns {Transition} */
function transition(previous, state) {
  /** @type {GameEffect[]} */
  const effects = [];
  if (state.phase === 'ended') {
    if (previous?.phase !== 'ended') effects.push({ t: 'end',
      results: state.seats.map((s) => ({ p: s.id, score: s.hp, label: `体力${s.hp}`, ranked: state.outcome === 'complete' })),
      options: { display: 'record', outcome: state.outcome,
        note: state.outcome === 'incomplete' ? '参加者が退出したため、今回は勝敗なし。ここまでの体力を記録しています。'
          : '残り体力で勝負。同じ体力なら引き分け。' } });
  } else for (const seat of state.seats) {
    if (seat.left) continue;
    const spec = padFor(state, seat);
    const old = previous?.seats.find((s) => s.id === seat.id);
    if (!previous || !old || JSON.stringify(spec) !== JSON.stringify(padFor(previous, old))) {
      effects.push({ t: 'pad', to: seat.id, spec });
    }
  }
  return { state, effects };
}

/** 選択中の手・入力ID・確定状況は大画面へ渡さない。 @param {GameState} state @returns {GameViewModel} */
export function publicView(state) {
  return { phase: state.phase, seats: state.seats.map((s) => ({ ...s })), leader: state.leader,
    round: state.round, blockers: blockersFor(state), canAct: mayAct(state),
    actionLabel: state.phase === 'intro' ? 'はじめる' : state.phase === 'recover' ? 'やり直す'
      : isFinished(state) ? '総合結果へ' : '次の手へ',
    finished: isFinished(state), reveal: state.phase === 'reveal' ? state.reveal.map((r) => ({ ...r })) : [], outcome: state.outcome };
}
