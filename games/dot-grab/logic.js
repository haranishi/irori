// @ts-check
// あつめて点の規則。画面にも通信にも触れない純粋な関数だけを置き、logic.test.js で試験する。
// 関数は「やること」（効果）の配列を返す。main.js がそれを irori.setPad / vibrate / end に渡す。
// 切断の扱い（4本でそろえている）：players の online が偽なのは「いま動かせない」だけ。その場で止めて点を保ち、戻れば続きから。
// 席が players から消えたとき（猶予切れ・退出・外された）だけ、いない人として扱う。

/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').GameResult} GameResult */
/**
 * @typedef {{ t: 'pad', spec: PadSpec, to: number }
 *   | { t: 'buzz', ms: number[], to: number }
 *   | { t: 'end', why: 'time' | 'left', results: GameResult[] }} Effect
 */
/**
 * @typedef {{ x: number, y: number, ax: number, ay: number, axisAt: number, score: number,
 *   online: boolean, seated: boolean }} Mover
 */
/** @typedef {{ x: number, y: number, live: boolean, at: number }} Dot */
/**
 * @typedef {{ phase: 'intro' | 'play' | 'over', playAt: number, endAt: number, movers: Map<number, Mover>,
 *   dots: Dot[], rng: () => number, why: 'time' | 'left' | null }} Field
 */

export const W = 960;
export const H = 540;
/** 動ける範囲の、画面の縁からの余白。上は得点の帯のぶん広い。 */
export const BOUNDS = { left: 40, right: W - 40, top: 96, bottom: H - 40 };
export const INTRO_MS = 3000;
export const GAME_MS = 45000;
/** スティックを倒しきったときの速さ（px/秒）。 */
export const SPEED = 300;
export const MOVER_R = 22;
export const DOT_R = 10;
export const MAX_DOTS = 8;
/** 取られた点が出直すまでの時間。 */
export const RESPAWN_MS = 700;
/** 点は、誰かのすぐ近くには出さない。 */
export const SPAWN_GAP = 110;
/**
 * 最後のスティックの入力からこれだけたつと止める。スティックを倒している間は約1秒ごとに同じ値が届く
 * （HELD_REPEAT_MS）ので、その3倍。離した知らせ（0,0）が届かないまま切れても、走り続けないため。
 */
export const AXIS_HOLD_MS = 3000;
/** 1回に進める時間の上限（秒）。止まっていたタブが戻ったときに、壁を突き抜けて飛ばないように。 */
export const MAX_DT = 0.1;

export const PADS = {
  /** @type {PadSpec} */
  intro: { k: 'wait', title: 'あつめて点', body: 'スティックで動いて、光る点を集めよう。45秒で多く取った人の勝ち' },
  /** @type {PadSpec} */
  play: { k: 'pad', stick: 'stick', hint: 'スティックで動いて、点を集めよう' },
};

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

/**
 * 始めた時点の席を、真ん中を囲む円の上に置く（切れている席も置き、戻れば動ける）。
 * @param {readonly PlayerInfo[]} players
 * @param {number} now
 * @param {() => number} rng
 * @returns {Field}
 */
export function createField(players, now, rng) {
  const here = players;
  /** @type {Map<number, Mover>} */
  const movers = new Map();
  const cx = (BOUNDS.left + BOUNDS.right) / 2;
  const cy = (BOUNDS.top + BOUNDS.bottom) / 2;
  here.forEach((p, i) => {
    const a = (Math.PI * 2 * i) / here.length - Math.PI / 2;
    const r = here.length === 1 ? 0 : 140;
    movers.set(p.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ax: 0, ay: 0, axisAt: now, score: 0, online: p.online, seated: true });
  });
  const playAt = now + INTRO_MS;
  return { phase: 'intro', playAt, endAt: playAt + GAME_MS, movers, dots: [], rng, why: null };
}

/** 最初の画面。参加者に説明。参加者がいなければ、すぐ終える。 */
export function begin(/** @type {Field} */ field) {
  /** @type {Effect[]} */
  const out = [];
  for (const p of field.movers.keys()) out.push({ t: 'pad', spec: PADS.intro, to: p });
  return field.movers.size === 0 ? [...out, ...finish(field, 'left')] : out;
}

/**
 * スティックの向きを覚える。動かすのは step。
 * @param {Field} field
 * @param {number} p
 * @param {GameInput} input
 * @param {number} now
 */
export function handleInput(field, p, input, now) {
  const m = field.movers.get(p);
  if (!m || field.phase !== 'play' || input.k !== 'axis') return;
  m.ax = input.x;
  m.ay = input.y;
  m.axisAt = now;
}

/**
 * 1フレーム進める。dt は前のフレームからの秒数で、速さは dt を掛けて決める（端末の速さで変わらない）。
 * @param {Field} field
 * @param {number} dt
 * @param {number} now
 * @returns {Effect[]}
 */
export function step(field, dt, now) {
  if (field.phase === 'intro') {
    if (now < field.playAt) return [];
    field.phase = 'play';
    for (const m of field.movers.values()) m.axisAt = now;
    for (let i = 0; i < MAX_DOTS; i++) field.dots.push(spawn(field, now));
    /** @type {Effect[]} */
    const out = [];
    for (const [p, m] of field.movers) if (m.seated) out.push({ t: 'pad', spec: PADS.play, to: p });
    return out;
  }
  if (field.phase !== 'play') return [];
  if (now >= field.endAt) return finish(field, 'time');
  const d = Math.min(Math.max(dt, 0), MAX_DT);
  /** @type {Map<number, [number, number, number, number]>} 席 → 動く前と後の位置 */
  const paths = new Map();
  for (const [p, m] of field.movers) {
    const fresh = m.online && now - m.axisAt < AXIS_HOLD_MS;
    const vx = fresh ? m.ax : 0;
    const vy = fresh ? m.ay : 0;
    const x0 = m.x;
    const y0 = m.y;
    m.x = clamp(m.x + vx * SPEED * d, BOUNDS.left, BOUNDS.right);
    m.y = clamp(m.y + vy * SPEED * d, BOUNDS.top, BOUNDS.bottom);
    paths.set(p, [x0, y0, m.x, m.y]);
  }
  /** @type {Effect[]} */
  const out = [];
  for (const [i, dot] of field.dots.entries()) {
    if (!dot.live) {
      if (now >= dot.at) field.dots[i] = spawn(field, now);
      continue;
    }
    // 動いた道すじ（線分）が点に触れたかで見る。速く動いても、すり抜けない。
    let best = -1;
    let bestDist = MOVER_R + DOT_R;
    for (const [p, [x0, y0, x1, y1]] of paths) {
      const dist = segmentDistance(dot.x, dot.y, x0, y0, x1, y1);
      if (dist <= bestDist && (best === -1 || dist < bestDist || p < best)) {
        best = p;
        bestDist = dist;
      }
    }
    if (best === -1) continue;
    const m = /** @type {Mover} */ (field.movers.get(best));
    m.score += 1;
    field.dots[i] = { x: dot.x, y: dot.y, live: false, at: now + RESPAWN_MS };
    out.push({ t: 'buzz', ms: [30], to: best });
  }
  return out;
}

/**
 * 席の一覧が変わった。切れた人はその場で止め、全員の席が消えたら終える（切れているだけなら続ける）。あとから来た席は入れない。
 * @param {Field} field
 * @param {readonly PlayerInfo[]} players
 * @returns {Effect[]}
 */
export function updatePlayers(field, players) {
  if (field.phase === 'over') return [];
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const [p, m] of field.movers) {
    m.seated = byId.has(p);
    m.online = byId.get(p)?.online === true;
    if (!m.online) m.ax = m.ay = 0;
  }
  return [...field.movers.values()].some((m) => m.seated) ? [] : finish(field, 'left');
}

/** 取った数の多い順。席が消えた人は外す（コンソールが名前を引けないため）。 */
export function results(/** @type {Field} */ field) {
  return [...field.movers]
    .filter(([, m]) => m.seated)
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .map(([p, m]) => ({ p, score: m.score, label: `${m.score}こ` }));
}

/** @returns {Effect[]} */
function finish(/** @type {Field} */ field, /** @type {'time' | 'left'} */ why) {
  if (field.phase === 'over') return [];
  field.phase = 'over';
  field.why = why;
  return [{ t: 'end', why, results: results(field) }];
}

/** 新しい点。誰かのすぐ近くと、ほかの点の上は避ける（20回試して見つからなければ、最後の候補）。 */
function spawn(/** @type {Field} */ field, /** @type {number} */ now) {
  const m = DOT_R + 6;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 20; i++) {
    x = BOUNDS.left + m + field.rng() * (BOUNDS.right - BOUNDS.left - 2 * m);
    y = BOUNDS.top + m + field.rng() * (BOUNDS.bottom - BOUNDS.top - 2 * m);
    const nearMover = [...field.movers.values()].some((o) => Math.hypot(o.x - x, o.y - y) < SPAWN_GAP);
    const nearDot = field.dots.some((d) => d.live && Math.hypot(d.x - x, d.y - y) < DOT_R * 4);
    if (!nearMover && !nearDot) break;
  }
  return { x, y, live: true, at: now };
}

/** 点 (px, py) と線分 (x0, y0)-(x1, y1) の距離。 */
export function segmentDistance(
  /** @type {number} */ px, /** @type {number} */ py,
  /** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

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
