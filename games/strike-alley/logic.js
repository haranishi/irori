// @ts-check
// ストライク横丁の進行。純粋関数で、DOM と SDK を読まず、時計も乱数も使わない。
// 投げた瞬間に物理を1回だけ走らせて結果を決め、画面は再生するだけ。再生が終わったら画面が settled を、
// 字幕を見せ終えたら next を送る。結果は投げた時点で決まっているので、再生の速さや端末の遅さで変わらない。
import { HINT, previewThrow, readThrow } from './gesture.js';
import { ALL_STANDING, simulate } from './physics.js';
import { nextTurn, scoreCard } from './scoring.js';

/** @typedef {import('./irori.js').PlayerId} PlayerId */
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
/** @typedef {import('./irori.js').GameResult} GameResult */
/** @typedef {import('./irori.js').GameEndOptions} GameEndOptions */
/** @typedef {import('./physics.js').RollResult} RollResult */
/** @typedef {import('./physics.js').Shot} Shot */
/** @typedef {import('./gesture.js').ThrowShape} ThrowShape */

/** @typedef {'intro'|'aim'|'rolling'|'settled'|'ended'} Phase */
/** @typedef {'strike'|'spare'|'gutter'|'miss'|'pins'} RollKind */
/** @typedef {'roll'|'pins'|'strike'|'spare'|'gutter'} CueName */
/** @typedef {PlayerInfo & {left: boolean, rolls: number[]}} Seat */
/** @typedef {{x: number, y: number}} Point */
/** @typedef {{s: Point, last: Point}} Gesture */
/** @typedef {{p: PlayerId, frame: number, ball: number}} Turn */
/**
 * @typedef {{id: number, p: PlayerId, frame: number, ball: number, shot: Shot, standing: boolean[], pinsBefore: number,
 *   result: RollResult, kind: RollKind}} Roll
 */
/**
 * @typedef {{phase: Phase, nonce: string, revision: number, frames: number, seats: Seat[], players: PlayerInfo[],
 *   leader: PlayerId|null, environment: HostEnvironment|null, paused: boolean, blockers: string[], waiting: boolean,
 *   started: boolean, startCount: number, chooser: PlayerId|null, outcome: 'complete'|'incomplete', turn: Turn|null,
 *   standing: boolean[], gesture: Gesture|null, retry: boolean, roll: Roll|null, throws: number}} GameState
 */
/**
 * @typedef {{t: 'input', p: PlayerId, input: GameInput}|{t: 'players', players: readonly PlayerInfo[], leader: PlayerId|null}
 *   |{t: 'menu', paused: boolean}|{t: 'environment', value: Readonly<HostEnvironment>|null}
 *   |{t: 'settled', id: number}|{t: 'next', id: number}} GameEvent
 */
/**
 * @typedef {{t: 'pad', to: PlayerId, spec: PadSpec}|{t: 'cue', name: CueName, v: number}|{t: 'vibrate', to: PlayerId, ms: number[]}
 *   |{t: 'end', results: GameResult[], options: GameEndOptions}} GameEffect
 */
/** @typedef {{state: GameState, effects: GameEffect[]}} Transition */
/** @typedef {{players: readonly PlayerInfo[], leader: PlayerId|null, environment: Readonly<HostEnvironment>|null, paused: boolean, nonce: string}} GameInit */

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;
/** 遊ぶ長さ（フレーム数）。 */
export const MODES = Object.freeze({ long: 10, short: 5 });
/** 投げた人のスマホへの振動。重要な出来事ほど長い。 */
export const BUZZ = Object.freeze({ release: [15], strike: [40, 50, 160], spare: [40, 40, 70], pins: [30], miss: [12] });

/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce)) throw new RangeError('Invalid game nonce');
  /** @type {GameState} */
  const state = {
    phase: 'intro', nonce: init.nonce, revision: 0, frames: 0,
    seats: init.players.map((p) => ({ ...p, left: false, rolls: [] })),
    players: init.players.map((p) => ({ ...p })), leader: init.leader,
    environment: init.environment ? { ...init.environment } : null, paused: init.paused,
    blockers: [], waiting: false, started: false, startCount: 0, chooser: null, outcome: 'complete',
    turn: null, standing: [...ALL_STANDING], gesture: null, retry: false, roll: null, throws: 0,
  };
  return transition(null, reconcile(state));
}

/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state, event) {
  if (state.phase === 'ended') return { state, effects: [] };
  if (event.t === 'players') return onPlayers(state, event.players, event.leader);
  if (event.t === 'menu') return transition(state, reconcile({ ...state, paused: event.paused }));
  if (event.t === 'environment') return transition(state, reconcile({ ...state, environment: event.value ? { ...event.value } : null }));
  // 止まっている間は、再生の終わりも字幕の終わりも受け付けない（画面の時計も止まっている）。
  if (state.blockers.length) return { state, effects: [] };
  if (event.t === 'settled') return settle(state, event.id);
  if (event.t === 'next') return advance(state, event.id);
  const { p, input } = event;
  if (state.phase === 'intro') return pickMode(state, p, input);
  if (state.phase === 'aim') return aim(state, p, input);
  return { state, effects: [] };
}

/** 長さの選択肢の id。進行役や選べる状態が変わると revision が進み、前の id は受け付けない。 @param {GameState} state @param {number} frames */
export function modeId(state, frames) {
  return `m${state.nonce}_${state.revision.toString(36)}_${frames}`;
}

/** @param {GameState} state @param {PlayerId} p @param {GameInput} input @returns {Transition} */
function pickMode(state, p, input) {
  if (state.chooser === null || input.k !== 'pick' || p !== state.chooser) return { state, effects: [] };
  const frames = input.id === modeId(state, MODES.long) ? MODES.long : input.id === modeId(state, MODES.short) ? MODES.short : 0;
  if (!frames) return { state, effects: [] };
  const first = /** @type {Seat} */ (state.seats[0]);
  return transition(state, reconcile({
    ...state, phase: 'aim', frames, started: true, startCount: state.seats.length, chooser: null,
    turn: { p: first.id, frame: 0, ball: 0 }, standing: [...ALL_STANDING], revision: state.revision + 1,
  }));
}

/** 指の s・m・e。番の席の、s から始まった指だけを読む。 @param {GameState} state @param {PlayerId} p @param {GameInput} input @returns {Transition} */
function aim(state, p, input) {
  const turn = state.turn;
  if (!turn || p !== turn.p || state.waiting || input.k !== 'ptr' || input.id !== 'touch') return { state, effects: [] };
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return { state, effects: [] };
  const at = { x: input.x, y: input.y };
  if (input.ph === 's') return transition(state, { ...state, gesture: { s: at, last: at } });
  const gesture = state.gesture;
  // s のない m と e は無視する（古い指や、止まる前の指の続き）。
  if (!gesture) return { state, effects: [] };
  if (input.ph === 'm') {
    if (gesture.last.x === at.x && gesture.last.y === at.y) return { state, effects: [] };
    return transition(state, { ...state, gesture: { s: gesture.s, last: at } });
  }
  const shape = readThrow([{ ...gesture.s, ph: 's' }, { ...at, ph: 'e' }]);
  // 引きが足りなければ投げない。案内を変えて、もう一度引けるようにする。
  if (!shape.ok) return transition(state, { ...state, gesture: null, retry: true });
  return release(state, turn, shape);
}

/** 投げる。物理はここで1回だけ走る。 @param {GameState} state @param {Turn} turn @param {ThrowShape} shape @returns {Transition} */
function release(state, turn, shape) {
  /** @type {Shot} */
  const shot = { startX: shape.startX, hook: shape.hook, power: shape.power };
  const result = simulate(shot, state.standing);
  const seat = /** @type {Seat} */ (state.seats.find((s) => s.id === turn.p));
  const fresh = nextTurn(seat.rolls, state.frames).reset;
  const pinsBefore = state.standing.filter(Boolean).length;
  /** @type {RollKind} */
  const kind = result.knocked === pinsBefore && pinsBefore > 0 ? (fresh ? 'strike' : 'spare')
    : result.gutter ? 'gutter' : result.knocked === 0 ? 'miss' : 'pins';
  const id = state.throws + 1;
  /** @type {Roll} */
  const roll = { id, p: turn.p, frame: turn.frame, ball: turn.ball, shot, standing: [...state.standing], pinsBefore, result, kind };
  return transition(state, { ...state, phase: 'rolling', gesture: null, retry: false, roll, throws: id }, [
    { t: 'cue', name: 'roll', v: Math.round((0.4 + 0.5 * shot.power) * 100) / 100 },
    { t: 'vibrate', to: turn.p, ms: [...BUZZ.release] },
  ]);
}

/** 再生が終わった。倒した本数を記録して、字幕を出す。 @param {GameState} state @param {number} id @returns {Transition} */
function settle(state, id) {
  const roll = state.roll;
  if (state.phase !== 'rolling' || !roll || roll.id !== id) return { state, effects: [] };
  const knocked = roll.result.knocked;
  const seats = state.seats.map((s) => (s.id === roll.p ? { ...s, rolls: [...s.rolls, knocked] } : s));
  /** @type {GameEffect[]} */
  const effects = [];
  if (roll.kind === 'strike' || roll.kind === 'spare') effects.push({ t: 'cue', name: roll.kind, v: roll.kind === 'strike' ? 1 : 0.8 });
  const buzz = roll.kind === 'strike' ? BUZZ.strike : roll.kind === 'spare' ? BUZZ.spare : knocked > 0 ? BUZZ.pins : BUZZ.miss;
  if (seats.some((s) => s.id === roll.p && !s.left)) effects.push({ t: 'vibrate', to: roll.p, ms: [...buzz] });
  const standing = roll.result.down.map((d) => !d);
  return transition(state, { ...state, phase: 'settled', seats, standing }, effects);
}

/** 字幕を見せ終えた。同じ席がもう一度か、次の席か、終わりか。 @param {GameState} state @param {number} id @returns {Transition} */
function advance(state, id) {
  const roll = state.roll;
  if (state.phase !== 'settled' || !roll || roll.id !== id) return { state, effects: [] };
  const seat = state.seats.find((s) => s.id === roll.p);
  if (seat && !seat.left) {
    const nt = nextTurn(seat.rolls, state.frames);
    if (!nt.done && nt.frame === roll.frame) {
      return transition(state, reconcile({
        ...state, phase: 'aim', turn: { p: seat.id, frame: nt.frame, ball: nt.ball },
        standing: nt.reset ? [...ALL_STANDING] : state.standing,
      }));
    }
  }
  const index = state.seats.findIndex((s) => s.id === roll.p);
  return transition(state, moveOn(state, roll.frame, index + 1));
}

/**
 * 次に投げる席を、固定の順番で探す（退出した席は飛ばす）。いなければ全員が投げ終えたので終わる。
 * @param {GameState} state @param {number} frame @param {number} from @returns {GameState}
 */
function moveOn(state, frame, from) {
  for (let f = frame; f < state.frames; f++) {
    for (let i = f === frame ? from : 0; i < state.seats.length; i++) {
      const seat = /** @type {Seat} */ (state.seats[i]);
      if (seat.left) continue;
      const nt = nextTurn(seat.rolls, state.frames);
      if (!nt.done && nt.frame <= f) {
        return reconcile({ ...state, phase: 'aim', turn: { p: seat.id, frame: nt.frame, ball: nt.ball }, standing: [...ALL_STANDING], gesture: null, retry: false });
      }
    }
  }
  return { ...state, phase: 'ended', turn: null, gesture: null };
}

/** @param {GameState} state @param {readonly PlayerInfo[]} players @param {PlayerId|null} leader @returns {Transition} */
function onPlayers(state, players, leader) {
  // 開始前の席を取り除く前に、全員退出の記録を残して未成立にする。
  if (state.phase === 'intro' && players.length === 0 && state.seats.length > 0) {
    return transition(state, { ...state, phase: 'ended', outcome: 'incomplete', players: [], leader: null, chooser: null,
      seats: state.seats.map((s) => ({ ...s, online: false, left: true })), turn: null, gesture: null });
  }
  const roster = new Map(players.map((p) => [p.id, p]));
  // 始める前に抜けた席は名簿から外す。始めたあとは、抜けた席も記録のために残す。
  const seats = state.seats
    .map((s) => ({ ...s, online: !s.left && roster.get(s.id)?.online === true, left: s.left || !roster.has(s.id) }))
    .filter((s) => state.started || !s.left);
  let next = { ...state, seats, players: players.map((p) => ({ ...p })), leader };
  if (next.started) {
    const ranked = seats.filter((s) => !s.left).length;
    // 2人以上で始めて、順位を付けられる席が1人以下になったら、未成立で終える。1人で始めた勝負は続ける。
    if (ranked === 0 || (state.startCount >= 2 && ranked <= 1)) {
      return transition(state, { ...next, phase: 'ended', outcome: 'incomplete', turn: null, gesture: null });
    }
    const turn = next.turn;
    const current = turn && seats.find((s) => s.id === turn.p);
    if (next.phase === 'aim' && turn && current?.left) {
      // 番の席が消えたら、その席の残りを飛ばして次の席へ。
      next = moveOn(next, turn.frame, seats.findIndex((s) => s.id === turn.p) + 1);
    }
  }
  return transition(state, reconcile(next));
}

/** 止まる理由と、長さを選べるかを整える。止まったら、指の途中経過を捨てる。 @param {GameState} state @returns {GameState} */
function reconcile(state) {
  if (state.phase === 'ended') return state;
  const blockers = [
    ...(state.paused ? ['menu'] : []),
    ...(!state.environment?.connected ? ['host-offline'] : []),
    ...(!state.environment?.visible ? ['hidden'] : []),
  ];
  const turnSeat = state.turn ? state.seats.find((s) => s.id === state.turn?.p) : undefined;
  // 番の席の接続が切れている間は、戻るまで待つ（点も順番も保つ）。
  const waiting = state.phase === 'aim' && !!turnSeat && !turnSeat.online;
  /** @type {GameState} */
  let next = { ...state, blockers, waiting };
  if ((blockers.length || waiting) && next.gesture) next = { ...next, gesture: null };
  if (next.phase === 'intro') {
    const count = next.seats.length;
    const leaderSeat = next.seats.find((s) => s.id === next.leader);
    const canStart = !blockers.length && !!leaderSeat?.online && count >= MIN_PLAYERS && count <= MAX_PLAYERS;
    const chooser = canStart ? next.leader : null;
    // 選ぶ人が変わったとき（選べるようになった・止まった・進行役の交代）は id を新しくし、前に出した選択肢は受け付けない。
    if (chooser !== state.chooser) next = { ...next, chooser, revision: next.revision + 1 };
  }
  return next;
}

/** @param {string} name */
function short(name) {
  const chars = Array.from(name);
  return chars.length > 12 ? `${chars.slice(0, 11).join('')}…` : name;
}

/** @param {GameState} state @param {Seat} seat */
function totalOf(state, seat) {
  return state.frames ? scoreCard(seat.rolls, state.frames).total : 0;
}

/** @param {GameState} state @param {Seat} seat @returns {PadSpec} */
export function padFor(state, seat) {
  if (state.phase === 'intro') {
    if (state.chooser !== null && seat.id === state.chooser) {
      return {
        k: 'choices', hint: '遊ぶ長さを選んでね',
        options: [{ id: modeId(state, MODES.long), label: '10フレーム' }, { id: modeId(state, MODES.short), label: '5フレーム' }],
      };
    }
    const leader = state.seats.find((s) => s.id === state.leader);
    const body = state.seats.length > MAX_PLAYERS ? `${MAX_PLAYERS}人までで遊べます。` : state.chooser !== null && leader ? `${short(leader.name)}さんが、遊ぶ長さを選んでいます。` : '準備ができるのを待っています。';
    return { k: 'wait', title: 'ストライク横丁', body };
  }
  const turn = state.turn;
  const where = turn ? `第${turn.frame + 1}フレーム・${turn.ball + 1}投目` : '';
  const total = `あなたの合計 ${totalOf(state, seat)}点`;
  if (turn && turn.p === seat.id) {
    if (state.phase === 'aim') {
      if (state.blockers.length) return { k: 'wait', title: 'ひと休み中', body: `再開したら、続きから投げられます。${total}` };
      return { k: 'touch', mode: 'swipe', hint: `${where}　${state.retry ? 'もう少し長く、下に引いてはなす' : HINT}` };
    }
    return { k: 'wait', title: '大画面を見よう', body: `${where}。${total}` };
  }
  const thrower = turn ? state.seats.find((s) => s.id === turn.p) : undefined;
  return { k: 'wait', title: thrower ? `${short(thrower.name)}さんの番` : 'ストライク横丁', body: `${where}。${total}` };
}

/** @param {GameState} state @returns {GameEffect} */
function endEffect(state) {
  const results = state.seats.map((s) => ({
    p: s.id, score: totalOf(state, s), ranked: state.outcome === 'complete' && !s.left,
  }));
  const note = state.outcome === 'incomplete'
    ? '参加者が抜けたため、今回は順位なしです。ここまでの点を残しています。'
    : `${state.frames}フレームの合計点です。同点は同じ順位です。`;
  return { t: 'end', results, options: { display: 'points', outcome: state.outcome, note } };
}

/** @param {GameState|null} before @param {GameState} next @param {GameEffect[]} [extra] @returns {Transition} */
function transition(before, next, extra = []) {
  /** @type {GameEffect[]} */
  const effects = [];
  if (next.phase === 'ended') {
    if (before?.phase !== 'ended') effects.push(endEffect(next));
    return { state: next, effects };
  }
  for (const seat of next.seats) {
    if (seat.left) continue;
    const spec = padFor(next, seat);
    const previous = before?.seats.find((s) => s.id === seat.id);
    if (!before || !previous || JSON.stringify(padFor(before, previous)) !== JSON.stringify(spec)) effects.push({ t: 'pad', to: seat.id, spec });
  }
  for (const player of next.players) {
    if (next.seats.some((s) => s.id === player.id)) continue;
    if (!before?.players.some((p) => p.id === player.id)) effects.push({ t: 'pad', to: player.id, spec: { k: 'wait', title: '次の勝負から参加できます' } });
  }
  effects.push(...extra);
  return { state: next, effects };
}

/**
 * 共用画面のための形。指の途中経過は、狙い線のための予想（位置・強さ・曲がり）だけを出す。
 * 再生データは参照のまま渡す（大きいので写さない）。
 * @param {GameState} state
 */
export function publicView(state) {
  const frames = state.frames || MODES.long;
  const turn = state.turn;
  const roll = state.roll;
  const showRoll = roll && (state.phase === 'rolling' || state.phase === 'settled');
  return {
    phase: state.phase, frames, started: state.started, outcome: state.outcome,
    participants: state.seats.map((s) => {
      const card = scoreCard(s.rolls, frames);
      return { id: s.id, name: s.name, online: s.online, left: s.left, total: card.total, card: card.frames, complete: card.complete };
    }),
    leader: state.leader, leaderName: state.seats.find((s) => s.id === state.leader)?.name ?? '',
    canStart: state.chooser !== null, tooMany: state.phase === 'intro' && state.seats.length > MAX_PLAYERS,
    blockers: [...state.blockers], waiting: state.waiting,
    turn: turn ? { ...turn } : null,
    throwerName: turn ? state.seats.find((s) => s.id === turn.p)?.name ?? '' : '',
    standing: [...state.standing],
    aim: state.phase === 'aim' && state.gesture
      ? previewThrow([{ ...state.gesture.s, ph: 's' }, { ...state.gesture.last, ph: 'm' }])
      : null,
    retry: state.retry,
    roll: showRoll && roll ? {
      id: roll.id, p: roll.p, frame: roll.frame, ball: roll.ball, kind: roll.kind, shot: { ...roll.shot },
      knocked: roll.result.knocked, pinsBefore: roll.pinsBefore, result: roll.result,
    } : null,
  };
}
/** @typedef {ReturnType<typeof publicView>} GameViewModel */
