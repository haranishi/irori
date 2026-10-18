// @ts-check
// 時刻とイベントだけを受ける判定。描画・SDK呼び出しは返した効果の利用側が担う。

/** @typedef {import('./irori.js').PlayerId} PlayerId */
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {Extract<PadSpec, { k: 'wait' }> & { title: string }} WaitPad */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
/** @typedef {import('./irori.js').GameResult} GameResult */
/** @typedef {import('./irori.js').GameEndOptions} GameEndOptions */
/** @typedef {'intro' | 'countdown' | 'counting' | 'reveal' | 'recover' | 'ended'} Phase */
/** @typedef {'menu' | 'host-offline' | 'hidden' | 'player-offline'} Blocker */
/** @typedef {{ id: PlayerId, name: string, online: boolean, left: boolean }} SeatState */
/** @typedef {{ kind: 'stopped', elapsedMs: number, tenths: number, deltaTenths: number, errorTenths: number }} StoppedRecord */
/** @typedef {StoppedRecord | { kind: 'timeout', errorTenths: 100 }} TrialRecord */
/** @typedef {{ p: PlayerId, record: StoppedRecord }} StoppedSeatRecord */
/** @typedef {{ p: PlayerId, record: TrialRecord }} SeatTrialRecord */
/** @typedef {{ roundIndex: number, attemptSeq: number, records: readonly SeatTrialRecord[] }} RoundRecord */
/** @typedef {{ action: 'begin' | 'next' | 'finish' | 'retry', p: PlayerId, id: string }} Control */
/** @typedef {{ attemptSeq: number, stopId: string, participants: readonly PlayerId[], startedAtMs: number, cue: 3 | 2 | 1 }} CountdownTrial */
/** @typedef {{ attemptSeq: number, stopId: string, participants: readonly PlayerId[], goAtMs: number, stops: readonly StoppedSeatRecord[] }} CountingTrial */
/**
 * @typedef {{ roundIndex: number, attemptSeq: number, nonce: string,
 *   seats: readonly SeatState[], players: readonly PlayerInfo[], leader: PlayerId | null,
 *   environment: HostEnvironment | null, paused: boolean, blockers: readonly Blocker[],
 *   controlSeq: number, control: Control | null, records: readonly RoundRecord[], recoverTarget: 'trial' | null }} CommonState
 */
/** @typedef {CommonState & { phase: 'intro', trial: null }} IntroState */
/** @typedef {CommonState & { phase: 'countdown', trial: CountdownTrial }} CountdownState */
/** @typedef {CommonState & { phase: 'counting', trial: CountingTrial }} CountingState */
/** @typedef {CommonState & { phase: 'reveal', trial: null }} RevealState */
/** @typedef {CommonState & { phase: 'recover', trial: null, recoverTarget: 'trial' }} RecoverState */
/** @typedef {CommonState & { phase: 'ended', trial: null, outcome: 'complete' | 'incomplete', endNote: string }} EndedState */
/** @typedef {IntroState | CountdownState | CountingState | RevealState | RecoverState | EndedState} GameState */
/**
 * @typedef {{ t: 'frame', nowMs: number }
 *   | { t: 'press', nowMs: number, p: PlayerId, id: string, down: boolean }
 *   | { t: 'players', nowMs: number, players: readonly PlayerInfo[], leader: PlayerId | null }
 *   | { t: 'environment', nowMs: number, value: HostEnvironment | null }
 *   | { t: 'menu', nowMs: number, paused: boolean }} GameEvent
 */
/** @typedef {{ t: 'pad', to: PlayerId, spec: PadSpec } | { t: 'end', results: GameResult[], options: GameEndOptions }} GameEffect */
/** @typedef {{ state: GameState, effects: readonly GameEffect[] }} Transition */
/** @typedef {{ players: readonly PlayerInfo[], leader: PlayerId | null, environment: HostEnvironment | null, paused: boolean, nonce: string, nowMs: number }} GameInit */
/**
 * @typedef {{ roundIndex: number, participants: SeatState[], waitingPlayers: { id: PlayerId, name: string }[],
 *   leader: PlayerId | null, blockers: Blocker[], instruction: string, precisionNote: string }} PublicCommon
 */
/**
 * @typedef {{ p: PlayerId, record: TrialRecord | null, rank: number | null,
 *   totalTenths: number, roundsCompleted: number, left: boolean }} RevealRow
 */
/**
 * @typedef {PublicCommon & (
 *   { phase: 'intro', canBegin: boolean, neededPlayers: number, minimumPlayers: number, maximumPlayers: number }
 *   | { phase: 'countdown', cue: string }
 *   | { phase: 'counting', cue: 'せーの' }
 *   | { phase: 'reveal', records: SeatTrialRecord[], rows: RevealRow[], canContinue: boolean,
 *       action: 'next' | 'finish', actionLabel: string }
 *   | { phase: 'recover', recoverTarget: 'trial', canRetry: boolean, action: 'retry', actionLabel: 'やり直す', message: string }
 *   | { phase: 'ended', outcome: 'complete' | 'incomplete' })} GameViewModel
 */

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 3000;
const DEADLINE_MS = 20000;
const INSTRUCTION = '10秒だと思ったら1回押す。3回の合計のズレで勝負';
const PRECISION_NOTE = '通信の遅れを含む目安です';

/**
 * 初回名簿のidentityを固定する。nonceはランタイムが用意するASCIIの1〜10文字。
 * @param {GameInit} init
 * @returns {Transition}
 */
export function createGame(init) {
  if (!/^[a-z0-9_-]{1,10}$/.test(init.nonce)) throw new RangeError('Invalid game nonce');
  if (!Number.isFinite(init.nowMs)) throw new RangeError('Invalid initial time');
  /** @type {IntroState} */
  const initial = {
    phase: 'intro', roundIndex: 0, attemptSeq: 0, nonce: init.nonce, trial: null,
    seats: init.players.map((p) => ({ ...p, left: false })),
    players: init.players.map((p) => ({ ...p })), leader: init.leader,
    environment: init.environment ? { ...init.environment } : null, paused: init.paused,
    blockers: [], controlSeq: 0, control: null, records: [], recoverTarget: null,
  };
  return transition(null, reconcile(initial, initial, true));
}

/**
 * nowMsは同じ単調時計から注入する。GOへの移行は描画フレームだけが行う。
 * @param {GameState} state
 * @param {GameEvent} event
 * @returns {Transition}
 */
export function updateGame(state, event) {
  if (state.phase === 'ended') return transition(state, state);
  if (!Number.isFinite(event.nowMs)) return transition(state, state);
  if (event.t === 'players') {
    const current = new Map(event.players.map((p) => [p.id, p]));
    const seats = state.seats.map((seat) => {
      const player = current.get(seat.id);
      return { ...seat, online: !seat.left && player?.online === true, left: seat.left || !player };
    });
    const next = { ...state, seats, players: event.players.map((p) => ({ ...p })), leader: event.leader };
    return transition(state, reconcile(state, next));
  }
  if (event.t === 'environment') {
    const next = { ...state, environment: event.value ? { ...event.value } : null };
    return transition(state, reconcile(state, next));
  }
  if (event.t === 'menu') {
    return transition(state, reconcile(state, { ...state, paused: event.paused }));
  }

  // 20,000msちょうどは、届いたボタンの種類・席・押下状態によらず受付終了。
  if (state.phase === 'counting' && event.nowMs - state.trial.goAtMs >= DEADLINE_MS) {
    return transition(state, closeTrial(state));
  }
  if (event.t === 'frame') {
    if (state.phase !== 'countdown') return transition(state, state);
    const elapsedMs = event.nowMs - state.trial.startedAtMs;
    if (elapsedMs < 0) return transition(state, state);
    if (elapsedMs >= COUNTDOWN_MS) return transition(state, openTrial(state, event.nowMs));
    const cue = /** @type {3 | 2 | 1} */ (3 - Math.floor(elapsedMs / 1000));
    return transition(state, cue === state.trial.cue ? state : { ...state, trial: { ...state.trial, cue } });
  }
  if (!event.down) return transition(state, state);
  if (state.phase === 'intro' || state.phase === 'reveal' || state.phase === 'recover') {
    const control = state.control;
    if (!control || control.p !== state.leader || event.p !== control.p || event.id !== control.id) {
      return transition(state, state);
    }
    if (state.phase === 'reveal' && control.action === 'finish') {
      return transition(state, { ...state, phase: 'ended', control: null, outcome: 'complete', endNote: PRECISION_NOTE });
    }
    return transition(state, startTrial(state, event.nowMs));
  }
  if (state.phase !== 'counting') return transition(state, state);
  const seat = state.seats.find((value) => value.id === event.p);
  const trial = state.trial;
  const elapsedMs = event.nowMs - trial.goAtMs;
  if (event.id !== trial.stopId || !seat?.online || seat.left || !trial.participants.includes(event.p)
      || elapsedMs < 0 || trial.stops.some((row) => row.p === event.p)) {
    return transition(state, state);
  }
  const tenths = Math.floor((elapsedMs + 50) / 100);
  const deltaTenths = tenths - 100;
  /** @type {StoppedRecord} */
  const record = { kind: 'stopped', elapsedMs, tenths, deltaTenths, errorTenths: Math.abs(deltaTenths) };
  /** @type {CountingState} */
  const next = { ...state, trial: { ...trial, stops: [...trial.stops, { p: event.p, record }] } };
  return transition(state, next.trial.stops.length === next.trial.participants.length ? closeTrial(next) : next);
}

/**
 * countingは時刻・試行ID・記録・回答状況を一切含めない。生のstateを画面へ渡さない。
 * @param {GameState} state
 * @returns {GameViewModel}
 */
export function publicView(state) {
  /** @type {PublicCommon} */
  const common = {
    roundIndex: state.roundIndex,
    participants: state.seats.map((seat) => ({ id: seat.id, name: seat.name, online: seat.online, left: seat.left })),
    waitingPlayers: state.players.filter((p) => !state.seats.some((seat) => seat.id === p.id && !seat.left))
      .map((p) => ({ id: p.id, name: p.name })),
    leader: state.leader, blockers: [...state.blockers], instruction: INSTRUCTION, precisionNote: PRECISION_NOTE,
  };
  switch (state.phase) {
    case 'intro':
      return {
        ...common, phase: 'intro', canBegin: state.control !== null,
        neededPlayers: Math.max(0, MIN_PLAYERS - state.seats.filter((seat) => !seat.left).length),
        minimumPlayers: MIN_PLAYERS, maximumPlayers: MAX_PLAYERS,
      };
    case 'countdown':
      return { ...common, phase: 'countdown', cue: String(state.trial.cue) };
    case 'counting':
      return { ...common, phase: 'counting', cue: 'せーの' };
    case 'reveal':
      return {
        ...common, phase: 'reveal',
        records: state.records.at(-1)?.records.map((row) => ({ p: row.p, record: { ...row.record } })) ?? [],
        rows: revealRows(state), canContinue: state.control !== null,
        action: state.roundIndex === 2 ? 'finish' : 'next',
        actionLabel: state.roundIndex === 2 ? '総合結果へ' : '次へ',
      };
    case 'recover':
      return {
        ...common, phase: 'recover', recoverTarget: state.recoverTarget, canRetry: state.control !== null,
        action: 'retry', actionLabel: 'やり直す', message: recoveryWait(state).title,
      };
    case 'ended':
      return { ...common, phase: 'ended', outcome: state.outcome };
  }
}

/** @param {number} previous @returns {number} */
function nextSequence(previous) {
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Game sequence exhausted');
  }
  return previous + 1;
}

/** @param {GameState} state @returns {Blocker[]} */
function blockersFor(state) {
  /** @type {Blocker[]} */
  const blockers = [];
  if (state.paused) blockers.push('menu');
  if (state.environment?.connected !== true) blockers.push('host-offline');
  if (state.environment?.visible === false) blockers.push('hidden');
  if (state.seats.some((seat) => !seat.left && !seat.online)) blockers.push('player-offline');
  return blockers;
}

/**
 * 役割・中断理由・提示する操作が変わったときだけ世代を進める。再描画は進めない。
 * @param {GameState} previous
 * @param {GameState} state
 * @param {boolean} [initial]
 * @returns {GameState}
 */
function reconcile(previous, state, initial = false) {
  const blockers = blockersFor(state);
  const remaining = state.seats.filter((seat) => !seat.left).length;
  if (state.phase !== 'intro' && remaining < MIN_PLAYERS) {
    state = {
      ...state, phase: 'ended', trial: null, recoverTarget: null, control: null,
      outcome: 'incomplete', endNote: `人数が足りないため、今回は勝敗なし。${PRECISION_NOTE}`,
    };
  } else if ((state.phase === 'countdown' || state.phase === 'counting')
      && (blockers.length > 0 || state.seats.some((seat, i) => seat.left && !previous.seats[i]?.left))) {
    // 中断した試行の回答は全員分捨てる。確定済みの過去ラウンドには触れない。
    state = { ...state, phase: 'recover', trial: null, recoverTarget: 'trial' };
  }
  const action = state.phase === 'intro' ? 'begin'
    : state.phase === 'reveal' ? (state.roundIndex === 2 ? 'finish' : 'next')
      : state.phase === 'recover' ? 'retry' : null;
  const actor = action !== null && blockers.length === 0 && remaining >= MIN_PLAYERS && remaining <= MAX_PLAYERS
    && state.players.some((p) => p.id === state.leader && p.online) ? state.leader : null;
  const changed = initial || previous.leader !== state.leader || previous.blockers.join() !== blockers.join()
    || (previous.control?.p ?? null) !== actor || (previous.control?.action ?? null) !== (actor === null ? null : action);
  if (!changed) return { ...state, blockers };
  const controlSeq = nextSequence(state.controlSeq);
  /** @type {Control | null} */
  const control = actor === null || action === null ? null : { action, p: actor, id: `c_${state.nonce}_${controlSeq.toString(36)}` };
  return { ...state, blockers, controlSeq, control };
}

/** @param {IntroState | RevealState | RecoverState} state @param {number} nowMs @returns {CountdownState} */
function startTrial(state, nowMs) {
  const attemptSeq = nextSequence(state.attemptSeq);
  return {
    ...state, phase: 'countdown', control: null, recoverTarget: null, attemptSeq,
    roundIndex: state.phase === 'reveal' ? state.roundIndex + 1 : state.roundIndex,
    trial: {
      attemptSeq, stopId: `s_${state.nonce}_${attemptSeq.toString(36)}`,
      participants: state.seats.filter((seat) => !seat.left).map((seat) => seat.id),
      startedAtMs: nowMs, cue: 3,
    },
  };
}

/** @param {CountdownState} state @param {number} nowMs @returns {CountingState} */
function openTrial(state, nowMs) {
  return {
    ...state, phase: 'counting',
    trial: { attemptSeq: state.trial.attemptSeq, stopId: state.trial.stopId, participants: state.trial.participants, goAtMs: nowMs, stops: [] },
  };
}

/** @param {CountingState} state @returns {RevealState} */
function closeTrial(state) {
  const trial = state.trial;
  const records = trial.participants.map((p) => {
    const stopped = trial.stops.find((row) => row.p === p);
    /** @type {TrialRecord} */
    const record = stopped ? { ...stopped.record } : { kind: 'timeout', errorTenths: 100 };
    return { p, record };
  });
  return /** @type {RevealState} */ (reconcile(state, {
    ...state, phase: 'reveal', trial: null,
    records: [...state.records, { roundIndex: state.roundIndex, attemptSeq: trial.attemptSeq, records }],
  }));
}

/** @param {GameState} state @param {PlayerId} p */
function totalsFor(state, p) {
  const records = state.records.flatMap((round) => round.records.filter((row) => row.p === p));
  return { totalTenths: records.reduce((sum, row) => sum + row.record.errorTenths, 0), roundsCompleted: records.length };
}

/** @param {RevealState} state @returns {RevealRow[]} */
function revealRows(state) {
  const latest = state.records.at(-1)?.records ?? [];
  const eligible = latest.filter((row) => state.seats.some((seat) => seat.id === row.p && !seat.left));
  return state.seats.map((seat) => {
    const record = latest.find((row) => row.p === seat.id)?.record ?? null;
    const rank = seat.left || record === null ? null
      : 1 + eligible.filter((row) => row.record.errorTenths < record.errorTenths).length;
    return { p: seat.id, record: record === null ? null : { ...record }, rank, ...totalsFor(state, seat.id), left: seat.left };
  });
}

/** @param {EndedState} state @returns {GameResult[]} */
function finalResults(state) {
  return state.seats.map((seat) => {
    const { totalTenths, roundsCompleted } = totalsFor(state, seat.id);
    const label = roundsCompleted === 0 ? '未計測'
      : `${roundsCompleted === 3 ? '合計' : '途中'}ズレ ${(totalTenths / 10).toFixed(1)}秒`;
    return { p: seat.id, score: totalTenths === 0 ? 0 : -totalTenths, label,
      ranked: state.outcome === 'complete' && !seat.left && roundsCompleted === 3 };
  });
}

/** @param {GameState} state @returns {WaitPad | null} */
function blockerWait(state) {
  if (state.blockers.includes('menu')) return { k: 'wait', title: 'いまはお休み中', body: state.phase === 'intro' ? '再開したら、進行役がはじめてね' : '再開したら、大画面を見て進めよう' };
  if (state.blockers.includes('host-offline')) return { k: 'wait', title: '大画面の接続を待っています' };
  if (state.blockers.includes('hidden')) return { k: 'wait', title: state.phase === 'intro' ? '大画面へ戻ってからはじめよう' : '大画面に戻るのを待っています' };
  if (state.blockers.includes('player-offline')) return { k: 'wait', title: 'つなぎ直しを待っています' };
  return null;
}

/** @param {RecoverState} state @returns {WaitPad} */
function recoveryWait(state) {
  return blockerWait(state) ?? { k: 'wait', title: '進行役の「やり直す」を待っています', body: '同じ回を、せーのからやり直そう' };
}

/** @param {GameState} state @returns {PadSpec} */
function introWait(state) {
  const blocked = blockerWait(state);
  if (blocked) return blocked;
  const remaining = state.seats.filter((seat) => !seat.left).length;
  if (remaining < MIN_PLAYERS) return { k: 'wait', title: `あと${MIN_PLAYERS - remaining}人で遊べます`, body: INSTRUCTION };
  if (remaining > MAX_PLAYERS) return { k: 'wait', title: '2〜8人で遊べます', body: INSTRUCTION };
  return { k: 'wait', title: '進行役の「はじめる」を待っています', body: INSTRUCTION };
}

/** @param {GameState} state @param {PlayerId} p @returns {PadSpec} */
function padFor(state, p) {
  if (state.control?.p === p) {
    const action = state.control.action;
    return {
      k: 'pad', stick: 'none', orient: 'portrait',
      buttons: [{ id: state.control.id, label: action === 'begin' ? 'はじめる' : action === 'next' ? '次へ' : action === 'retry' ? 'やり直す' : '総合結果へ' }],
      hint: action === 'begin' ? 'みんながそろったら、はじめよう' : action === 'retry' ? 'みんながそろったら、同じ回をやり直そう' : 'みんなの記録を見たら、進めよう',
    };
  }
  const seat = state.seats.find((value) => value.id === p);
  if (!seat || seat.left) return { k: 'wait', title: '次の勝負から参加できます', body: 'いまは大画面を見て待っていてね' };
  if (state.phase === 'intro') return introWait(state);
  if (state.phase === 'ended') return { k: 'wait', title: '総合結果', body: 'みんなの記録を大画面で見よう' };
  if (state.phase === 'recover') return recoveryWait(state);
  if (!seat.online) return { k: 'wait', title: 'つなぎ直しを待っています' };
  if (state.phase === 'reveal') return blockerWait(state) ?? { k: 'wait', title: '結果発表', body: 'みんなの記録を大画面で見よう' };
  if (state.phase === 'counting' && state.trial.stops.some((row) => row.p === p)) {
    return { k: 'wait', title: '受け付けました', body: '大画面を見てね' };
  }
  return {
    k: 'pad', stick: 'none', orient: 'portrait',
    buttons: [{ id: state.phase === 'counting' ? state.trial.stopId : 'guide', label: '10秒！' }],
    hint: state.phase === 'counting' ? '10秒だと思ったら1回押そう' : '大画面の「せーの」が出たら数えよう',
  };
}

/** @param {GameState | null} previous @param {GameState} state @returns {Transition} */
function transition(previous, state) {
  if (previous === state) return { state, effects: [] };
  /** @type {GameEffect[]} */
  const effects = [];
  for (const player of state.players) {
    const spec = padFor(state, player.id);
    if (!previous || !previous.players.some((p) => p.id === player.id)
        || JSON.stringify(padFor(previous, player.id)) !== JSON.stringify(spec)) {
      effects.push({ t: 'pad', to: player.id, spec });
    }
  }
  if (state.phase === 'ended' && previous?.phase !== 'ended') {
    effects.push({ t: 'end', results: finalResults(state),
      options: { display: 'record', outcome: state.outcome, note: state.endNote } });
  }
  return { state, effects };
}
