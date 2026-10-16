// @ts-check
// 4択クイズの規則。画面にも通信にも触れない純粋な関数だけを置き、logic.test.js で試験する。
// 関数は「やること」（効果）の配列を返す。main.js がそれを irori.setPad / end に渡す。
// 切断の扱い（4本でそろえている）：players の online が偽なのは「いま答えられない」だけ。点と答えを保ち、戻れば続きから。
// 切れているあいだに締め切られた問題は0点（減点しない）。席が players から消えたときだけ、参加者から外す。

/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').GameResult} GameResult */
/** @typedef {import('./questions.js').Question} Question */
/**
 * @typedef {{ t: 'pad', spec: PadSpec, to: number }
 *   | { t: 'end', why: 'done' | 'left', results: GameResult[] }} Effect
 */
/** @typedef {{ id: string, text: string, choices: { id: string, label: string }[], answer: string }} Round */
/**
 * @typedef {{ score: number, correct: number, online: boolean, seated: boolean,
 *   pick: string | null, pickedAfter: number | null, delta: number | null, away: boolean }} Seat
 *   away：この問題が締め切られたとき、切れていた（0点にした）
 */
/**
 * @typedef {{ phase: 'intro' | 'question' | 'reveal' | 'over', at: number, index: number,
 *   rounds: Round[], seats: Map<number, Seat>, why: 'done' | 'left' | null }} Quiz
 */

export const ROUNDS = 8;
export const INTRO_MS = 3000;
export const ANSWER_MS = 15000;
export const REVEAL_MS = 3500;
/** 正解の点は、出題の瞬間の MAX_POINTS から、締切の直前の MIN_POINTS まで直線で下がる。 */
export const MAX_POINTS = 1000;
export const MIN_POINTS = 200;
export const WRONG_POINTS = -200;
export const TIMEOUT_POINTS = -200;
/** 切れているあいだに締め切られた問題の点（減点しない）。 */
export const AWAY_POINTS = 0;

/** 正解したときの点。elapsed は出題からのミリ秒（0 以上、ANSWER_MS 未満）。 */
export function pointsFor(/** @type {number} */ elapsed) {
  const t = Math.min(Math.max(elapsed, 0), ANSWER_MS) / ANSWER_MS;
  return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * t);
}

/** 0 以上 1 未満を返す、種から決まる乱数（試験で同じ並びを再現するため）。 */
export function makeRng(/** @type {number} */ seed) {
  // 小さな種でも全体に散らす。散らさないと、種 1〜40 の最初の値がどれも0に近く、混ぜても並びが変わらない。
  let x = (Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x6a09e667) >>> 0 || 1;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

/** @template T @param {T[]} list @param {() => number} rng @returns {T[]} */
export function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = /** @type {[T, T]} */ ([out[j], out[i]]);
  }
  return out;
}

/**
 * 出す問題を、重ならないように n 問選ぶ。avoid（前回に出した id）は、足りるかぎり避ける。
 * @param {Question[]} pool
 * @param {number} n
 * @param {() => number} rng
 * @param {readonly string[]} [avoid]
 */
export function pickQuestions(pool, n, rng, avoid = []) {
  const fresh = shuffle(pool.filter((q) => !avoid.includes(q.id)), rng);
  const again = shuffle(pool.filter((q) => avoid.includes(q.id)), rng);
  return [...fresh, ...again].slice(0, n);
}

/**
 * 次の回のために覚える、出した問題の id（新しい順）。直前の回だけを避けると、1回おきに同じ問題が出やすい。
 * そこで「問題の数 − 1回の問題数」まで覚える（26問・8問なら18問で、およそ前の2回ぶん）。
 * @param {readonly string[]} history 前に覚えていた id（新しい順）
 * @param {readonly string[]} picked この回に出す id
 * @param {number} keep 覚える数
 */
export function nextHistory(history, picked, keep) {
  return [...picked, ...history.filter((id) => !picked.includes(id))].slice(0, Math.max(0, keep));
}

/**
 * 1問ぶんの出題。選択肢の並びを混ぜ、id を c0〜c3 にする（正解が毎回同じ場所に来ないように）。
 * @param {Question} q
 * @param {() => number} rng
 * @returns {Round}
 */
export function toRound(q, rng) {
  const labels = shuffle([q.a, ...q.w], rng);
  return { id: q.id, text: q.q, choices: labels.map((label, i) => ({ id: `c${i}`, label })), answer: `c${labels.indexOf(q.a)}` };
}

export const PADS = {
  /** @type {PadSpec} */
  intro: { k: 'wait', title: '4択クイズ', body: '全8問。早く正解するほど高得点。答えは1回だけで、押し直しはできない。まちがいと時間切れは-200点' },
  /**
   * 出題の画面。picked（選んだ選択肢の id）を渡すと、押せなくして、ヒントに「あなたの答え：…」を出す。
   * @returns {PadSpec}
   */
  ask: (/** @type {Round} */ r, /** @type {number} */ n, /** @type {string | null} */ picked = null) => {
    if (picked === null) return { k: 'choices', options: r.choices, hint: `第${n}問　15秒以内に選ぼう` };
    const label = r.choices.find((c) => c.id === picked)?.label ?? '';
    return { k: 'choices', options: r.choices, hint: `あなたの答え：${label}`, disabled: true };
  },
  /** @returns {PadSpec} */
  reveal: (/** @type {Round} */ r, /** @type {Seat} */ s) => {
    const answer = `答え：${r.choices.find((c) => c.id === r.answer)?.label ?? ''}`;
    if (s.away) return { k: 'wait', title: 'この問題は0点', body: `つながっていなかったので、減点はしません。${answer}` };
    return {
      k: 'wait',
      title: s.pick === null ? `時間切れ ${TIMEOUT_POINTS}` : s.pick === r.answer ? `正解！ +${s.delta}` : `ざんねん ${WRONG_POINTS}`,
      body: answer,
    };
  },
};

/**
 * 始めた時点の席を、全員参加者にする（切れている席も。戻れば答えられる）。あとから来た席は、このクイズには入れない。
 * @param {readonly PlayerInfo[]} players
 * @param {Round[]} rounds
 * @param {number} now
 * @returns {Quiz}
 */
export function createQuiz(players, rounds, now) {
  /** @type {Map<number, Seat>} */
  const seats = new Map();
  for (const p of players) {
    seats.set(p.id, { score: 0, correct: 0, online: p.online, seated: true, pick: null, pickedAfter: null, delta: null, away: false });
  }
  return { phase: 'intro', at: now, index: -1, rounds, seats, why: null };
}

/** 最初の画面。参加者に説明。参加者がいなければ、すぐ終える。 */
export function begin(/** @type {Quiz} */ quiz) {
  /** @type {Effect[]} */
  const out = [];
  for (const p of quiz.seats.keys()) out.push({ t: 'pad', spec: PADS.intro, to: p });
  return quiz.seats.size === 0 ? [...out, ...finish(quiz, 'left')] : out;
}

/**
 * 時間で進むこと：説明 → 出題 → 締切 → 答え合わせ → 次の問題 → … → 終わり。毎フレーム呼ぶ。
 * @param {Quiz} quiz
 * @param {number} now
 * @returns {Effect[]}
 */
export function tick(quiz, now) {
  if (quiz.phase === 'intro' && now >= quiz.at + INTRO_MS) return ask(quiz, 0, now);
  if (quiz.phase === 'question' && now >= quiz.at + ANSWER_MS) return close(quiz, now);
  if (quiz.phase === 'reveal' && now >= quiz.at + REVEAL_MS) {
    const next = quiz.index + 1;
    return next < quiz.rounds.length ? ask(quiz, next, now) : finish(quiz, 'done');
  }
  return [];
}

/**
 * 選んだ。1問に1回だけ受け、締切（出題から15秒）ちょうど以降は受けない。
 * @param {Quiz} quiz
 * @param {number} p
 * @param {GameInput} input
 * @param {number} now
 * @returns {Effect[]}
 */
export function answer(quiz, p, input, now) {
  if (quiz.phase !== 'question' || input.k !== 'pick') return [];
  const seat = quiz.seats.get(p);
  const round = quiz.rounds[quiz.index];
  if (!seat || !round || seat.pick !== null || !round.choices.some((c) => c.id === input.id)) return [];
  if (now >= quiz.at + ANSWER_MS) return close(quiz, now);
  seat.pick = input.id;
  seat.pickedAfter = now - quiz.at;
  // 押した選択肢を、そのスマホに残す（押せなくして、ヒントに「あなたの答え：…」）。
  /** @type {Effect[]} */
  const out = [{ t: 'pad', spec: PADS.ask(round, quiz.index + 1, seat.pick), to: p }];
  return everyoneAnswered(quiz) ? [...out, ...close(quiz, now)] : out;
}

/**
 * 席の一覧が変わった。切れている人は待たずに締め切れるようにし、全員の席が消えたら終える（切れているだけなら続ける）。
 * あとから来た席は入れない。
 * @param {Quiz} quiz
 * @param {readonly PlayerInfo[]} players
 * @param {number} now
 * @returns {Effect[]}
 */
export function updatePlayers(quiz, players, now) {
  if (quiz.phase === 'over') return [];
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const [p, seat] of quiz.seats) {
    seat.seated = byId.has(p);
    seat.online = byId.get(p)?.online === true;
  }
  if (![...quiz.seats.values()].some((s) => s.seated)) return finish(quiz, 'left');
  return quiz.phase === 'question' && everyoneAnswered(quiz) ? close(quiz, now) : [];
}

/** @returns {Effect[]} */
function ask(/** @type {Quiz} */ quiz, /** @type {number} */ index, /** @type {number} */ now) {
  const round = /** @type {Round} */ (quiz.rounds[index]);
  quiz.phase = 'question';
  quiz.index = index;
  quiz.at = now;
  /** @type {Effect[]} */
  const out = [];
  for (const [p, seat] of quiz.seats) {
    seat.pick = null;
    seat.pickedAfter = null;
    seat.delta = null;
    seat.away = false;
    if (seat.seated) out.push({ t: 'pad', spec: PADS.ask(round, index + 1), to: p });
  }
  return out;
}

/** つながっている参加者が全員答えたか。切れている人は待たない。 */
function everyoneAnswered(/** @type {Quiz} */ quiz) {
  const here = [...quiz.seats.values()].filter((s) => s.online);
  return here.length > 0 && here.every((s) => s.pick !== null);
}

/** 締め切って点をつける。正解は早いほど高く、まちがいと時間切れ（答えなかった人）は減点。切れていて答えなかった人は0点。 */
function close(/** @type {Quiz} */ quiz, /** @type {number} */ now) {
  const round = /** @type {Round} */ (quiz.rounds[quiz.index]);
  /** @type {Effect[]} */
  const out = [];
  for (const [p, seat] of quiz.seats) {
    if (seat.pick === null && !seat.online) {
      seat.delta = AWAY_POINTS;
      seat.away = true;
    } else if (seat.pick === null) {
      seat.delta = TIMEOUT_POINTS;
    } else if (seat.pick === round.answer) {
      seat.delta = pointsFor(/** @type {number} */ (seat.pickedAfter));
      seat.correct += 1;
    } else {
      seat.delta = WRONG_POINTS;
    }
    seat.score += seat.delta;
    if (seat.seated) out.push({ t: 'pad', spec: PADS.reveal(round, seat), to: p });
  }
  quiz.phase = 'reveal';
  quiz.at = now;
  return out;
}

/** @returns {Effect[]} */
function finish(/** @type {Quiz} */ quiz, /** @type {'done' | 'left'} */ why) {
  if (quiz.phase === 'over') return [];
  quiz.phase = 'over';
  quiz.why = why;
  return [{ t: 'end', why, results: results(quiz) }];
}

/**
 * 参加者の札の右に出す短い印。席が消えた人は「退出」（点はそのまま見せる）、切れていて0点にした問題は「切断 0」、
 * 出題中は「回答済み」、答え合わせでは増減。
 * @param {Quiz} quiz
 * @param {number} p
 * @returns {{ text: string, good: boolean }}
 */
export function seatTag(quiz, p) {
  const seat = quiz.seats.get(p);
  if (!seat) return { text: '', good: false };
  if (!seat.seated) return { text: '退出', good: false };
  if (quiz.phase === 'question') return { text: seat.pick ? '回答済み' : '', good: false };
  if (quiz.phase !== 'reveal' || seat.delta === null) return { text: '', good: false };
  if (seat.away) return { text: '切断 0', good: false };
  return { text: seat.delta > 0 ? `+${seat.delta}` : String(seat.delta), good: seat.delta > 0 };
}

/**
 * 合計点の高い順。途中で席が消えた人も、そのときの点のまま載せる（4本でそろえている）。
 * 名前はコンソールが控えていて、結果に「退出」の印を付ける。
 */
export function results(/** @type {Quiz} */ quiz) {
  const everyone = [...quiz.seats];
  return everyone
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .map(([p, s]) => ({ p, score: s.score, label: `${s.correct}問正解` }));
}

/**
 * 一時停止のあいだ止まる時計。ゲームの時刻はすべてこれで測る（pause のあいだ、締切も進まない）。
 * @param {() => number} realNow
 */
export function createClock(realNow) {
  /** @type {number | null} */
  let pausedAt = null;
  let lost = 0;
  return {
    now: () => (pausedAt ?? realNow()) - lost,
    get paused() {
      return pausedAt !== null;
    },
    pause() {
      if (pausedAt === null) pausedAt = realNow();
    },
    resume() {
      if (pausedAt === null) return;
      lost += realNow() - pausedAt;
      pausedAt = null;
    },
  };
}
