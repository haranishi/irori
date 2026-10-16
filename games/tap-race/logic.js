// @ts-check
// 連打レースの規則。画面にも通信にも触れない純粋な関数だけを置き、logic.test.js で試験する。
// 関数は「やること」（効果）の配列を返す。main.js がそれを irori.setPad / vibrate / end に渡す。
// 切断の扱い（4本でそろえている）：players の online が偽なのは「いま押せない」だけ。回数を保ち、戻れば続きから押せる。
// 席が players から消えたとき（猶予切れ・退出・外された）だけ、棄権にする。

/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').GameResult} GameResult */
/**
 * @typedef {{ t: 'pad', spec: PadSpec, to: number }
 *   | { t: 'buzz', ms: number[], to: number | 'all' }
 *   | { t: 'end', why: 'finish' | 'time' | 'left', results: GameResult[] }} Effect
 */
/** @typedef {{ taps: number, state: 'run' | 'done' | 'out', doneAt: number | null, doneT: number | null, online: boolean }} Runner */
/** @typedef {{ phase: 'count' | 'race' | 'over', goAt: number, runners: Map<number, Runner>, why: 'finish' | 'time' | 'left' | null }} Race */
/** @typedef {{ p: number, rank: number, points: number, label: string, taps: number, done: boolean, out: boolean }} Standing */

export const TAPS_TO_FINISH = 40;
export const COUNTDOWN_MS = 3000;
export const RACE_MS = 30000;
/** 順位ごとの得点。1位から800・600・500・400…。8位にも点を残す。ただし1回もたたかなかった人と棄権した人は0点。 */
export const POINTS = [800, 600, 500, 400, 300, 200, 100, 50];
/** 結果のラベル（棄権した人）。 */
export const OUT_LABEL = '棄権';

export const PADS = {
  /** @type {PadSpec} */
  ready: { k: 'wait', title: 'よーい', body: '「連打!」が出たら、40回たたこう' },
  /** @type {PadSpec} */
  race: { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' },
  /** @returns {PadSpec} */
  done: (/** @type {number} */ rank, /** @type {string} */ label) => ({ k: 'wait', title: `完走！ ${rank}位`, body: `${label}。ほかの人を待っています` }),
};

/**
 * 始めた時点の席を、全員走者にする（切れている席も。戻れば押せる）。あとから来た席は、このレースには入れない。
 * @param {readonly PlayerInfo[]} players
 * @param {number} now ゲームの時計（ミリ秒）
 * @returns {Race}
 */
export function createRace(players, now) {
  /** @type {Map<number, Runner>} */
  const runners = new Map();
  for (const p of players) runners.set(p.id, { taps: 0, state: 'run', doneAt: null, doneT: null, online: p.online });
  return { phase: 'count', goAt: now + COUNTDOWN_MS, runners, why: null };
}

/** 最初の画面。走者に「よーい」。走者がいなければ、すぐ終える。 */
export function begin(/** @type {Race} */ race) {
  /** @type {Effect[]} */
  const out = [];
  for (const p of race.runners.keys()) out.push({ t: 'pad', spec: PADS.ready, to: p });
  return [...out, ...checkEnd(race)];
}

/**
 * 時間で進むこと（スタートと時間切れ）。毎フレーム呼ぶ。
 * 切れている走者にも連打の画面を送る（コンソールが覚えていて、戻ったときに出す）。
 * @param {Race} race
 * @param {number} now
 * @returns {Effect[]}
 */
export function tick(race, now) {
  if (race.phase === 'count' && now >= race.goAt) {
    race.phase = 'race';
    /** @type {Effect[]} */
    const out = [];
    for (const [p, r] of race.runners) if (r.state === 'run') out.push({ t: 'pad', spec: PADS.race, to: p });
    out.push({ t: 'buzz', ms: [80], to: 'all' });
    return out;
  }
  if (race.phase === 'race' && now >= race.goAt + RACE_MS) return finish(race, 'time');
  return [];
}

/**
 * ボタンが押された。数えるのは押した瞬間（d:1）だけで、締切（スタートから30秒）ちょうど以降は数えない。
 * 完走の順位は、サーバーの受信時刻 T で決める（ホストに届いた順より安定する。docs/sdk.md）。
 * @param {Race} race
 * @param {number} p
 * @param {GameInput} input
 * @param {number} now
 * @param {number} [T] サーバーが受け取った時刻
 * @returns {Effect[]}
 */
export function tap(race, p, input, now, T) {
  if (race.phase !== 'race' || input.k !== 'btn' || input.id !== 'buzzer' || input.d !== 1) return [];
  const r = race.runners.get(p);
  if (!r || r.state !== 'run') return [];
  if (now >= race.goAt + RACE_MS) return finish(race, 'time');
  r.taps += 1;
  if (r.taps < TAPS_TO_FINISH) return [];
  r.state = 'done';
  r.doneAt = now;
  r.doneT = T ?? now;
  const me = standings(race).find((s) => s.p === p);
  /** @type {Effect[]} */
  const out = [
    { t: 'pad', spec: PADS.done(me?.rank ?? 1, me?.label ?? ''), to: p },
    { t: 'buzz', ms: [40, 60, 40], to: p },
  ];
  return [...out, ...checkEnd(race)];
}

/**
 * 席の一覧が変わった。切れた（online が偽）だけなら、回数を保って待つ。完走していない走者の席が一覧から消えたら、棄権にする。
 * あとから来た席は、このレースには入れない。
 * @param {Race} race
 * @param {readonly PlayerInfo[]} players
 * @returns {Effect[]}
 */
export function updatePlayers(race, players) {
  if (race.phase === 'over') return [];
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const [p, r] of race.runners) {
    const seat = byId.get(p);
    r.online = seat?.online === true;
    if (r.state === 'run' && !seat) r.state = 'out';
  }
  return checkEnd(race);
}

/**
 * 走っている人（切れている人を含む）がいなくなったら終える。完走した人がいれば全員完走、いなければ全員退出。
 * 切れている人は、戻るか時間切れになるまで待つ。
 */
function checkEnd(/** @type {Race} */ race) {
  if (race.phase === 'over') return [];
  const states = [...race.runners.values()].map((r) => r.state);
  if (states.includes('run')) return [];
  return finish(race, states.includes('done') ? 'finish' : 'left');
}

/**
 * @param {Race} race
 * @param {'finish' | 'time' | 'left'} why
 * @returns {Effect[]}
 */
function finish(race, why) {
  if (race.phase === 'over') return [];
  race.phase = 'over';
  race.why = why;
  return [{ t: 'end', why, results: results(race) }];
}

/**
 * いまの順位。完走した人は T の早い順、まだの人はたたいた回数の多い順で、同じなら同じ順位（1・2・2・4）。
 * 1回もたたかなかった人は0点、棄権した人は最後に0点で並べる。
 * @param {Race} race
 * @returns {Standing[]}
 */
export function standings(race) {
  const all = [...race.runners];
  const done = all.filter(([, r]) => r.state === 'done').sort((a, b) => /** @type {number} */ (a[1].doneT) - /** @type {number} */ (b[1].doneT));
  const running = all.filter(([, r]) => r.state === 'run').sort((a, b) => b[1].taps - a[1].taps || a[0] - b[0]);
  const gone = all.filter(([, r]) => r.state === 'out');
  /** @type {Standing[]} */
  const list = [];
  for (const [p, r] of done) {
    const rank = 1 + done.filter(([, o]) => /** @type {number} */ (o.doneT) < /** @type {number} */ (r.doneT)).length;
    const secs = (/** @type {number} */ (r.doneAt) - race.goAt) / 1000;
    list.push({ p, rank, points: POINTS[rank - 1] ?? 0, label: `${secs.toFixed(1)}秒`, taps: r.taps, done: true, out: false });
  }
  for (const [p, r] of running) {
    const rank = 1 + done.length + running.filter(([, o]) => o.taps > r.taps).length;
    list.push({ p, rank, points: r.taps === 0 ? 0 : POINTS[rank - 1] ?? 0, label: `${r.taps}回`, taps: r.taps, done: false, out: false });
  }
  for (const [p, r] of gone) list.push({ p, rank: done.length + running.length + 1, points: 0, label: OUT_LABEL, taps: r.taps, done: false, out: true });
  return list;
}

/**
 * コンソールに渡す結果：順位の得点と、完走の秒数・たたいた回数・棄権。
 * 棄権した人と、完走したあとで退出した人も載せる（コンソールが名前を控えていて「退出」の印を付ける）。
 */
export function results(/** @type {Race} */ race) {
  return standings(race).map((s) => ({ p: s.p, score: s.points, label: s.label }));
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
