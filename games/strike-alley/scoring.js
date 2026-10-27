// @ts-check
// ボウリングの得点。純粋関数で、DOM と SDK を読まない。
// rolls は1人が倒した本数を投げた順に並べたもの。frames は 10（ふつう）か 5（みじかめ）。短いモードも、最後のフレームは同じ規則で数える。

export const PINS = 10;

/** @typedef {{marks: string[], score: number|null, cumulative: number|null, done: boolean}} FrameCell */
/** @typedef {{frames: FrameCell[], total: number, complete: boolean}} ScoreCard */
/** @typedef {{done: boolean, frame: number, ball: number, reset: boolean, pinsLeft: number}} NextTurn */

/** @param {number} frames */
function checkFrames(frames) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 10) throw new RangeError('frames must be 1..10');
}

/** 最後のフレームで投げられる数。ストライクかスペアなら3投。 @param {readonly number[]} balls */
function finalNeed(balls) {
  if (balls.length < 2) return 2;
  return balls[0] === PINS || /** @type {number} */ (balls[0]) + /** @type {number} */ (balls[1]) === PINS ? 3 : 2;
}

/**
 * 投げた順の本数を、フレームごとに切り分ける。ラックに残っていない本数や、投げられない球があれば RangeError。
 * @param {readonly number[]} rolls @param {number} frames
 * @returns {{start: number, balls: number[]}[]}
 */
function split(rolls, frames) {
  checkFrames(frames);
  /** @type {{start: number, balls: number[]}[]} */
  const parts = [];
  let i = 0;
  for (let f = 0; f < frames; f++) {
    const start = i;
    /** @type {number[]} */
    const balls = [];
    const last = f === frames - 1;
    let left = PINS;
    while (i < rolls.length && balls.length < (last ? finalNeed(balls) : balls[0] === PINS ? 1 : 2)) {
      const n = /** @type {number} */ (rolls[i]);
      if (!Number.isInteger(n) || n < 0 || n > left) throw new RangeError(`roll ${i} is out of range`);
      balls.push(n);
      i += 1;
      left -= n;
      // 最後のフレームでは、倒し切ったらピンを立て直す。
      if (left === 0 && last) left = PINS;
    }
    parts.push({ start, balls });
  }
  if (i < rolls.length) throw new RangeError('too many rolls');
  return parts;
}

/**
 * 1球の表示。新しいラックを全部倒せば X、残りを全部倒せば /、0本は −、それ以外は数字。
 * @param {number} n @param {number} left 投げる前に立っていた本数 @param {boolean} fresh 立て直したばかりのラックか
 */
function markOf(n, left, fresh) {
  if (fresh && n === PINS) return 'X';
  if (!fresh && n === left) return '/';
  if (n === 0) return '−';
  return String(n);
}

/** @param {readonly number[]} balls @param {boolean} last */
function marksOf(balls, last) {
  if (!last) {
    if (balls[0] === PINS) return ['', 'X'];
    /** @type {string[]} */
    const out = ['', ''];
    if (balls.length > 0) out[0] = markOf(/** @type {number} */ (balls[0]), PINS, true);
    if (balls.length > 1) out[1] = markOf(/** @type {number} */ (balls[1]), PINS - /** @type {number} */ (balls[0]), false);
    return out;
  }
  /** @type {string[]} */
  const out = ['', '', ''];
  let left = PINS;
  let fresh = true;
  balls.forEach((n, k) => {
    out[k] = markOf(n, left, fresh);
    left -= n;
    fresh = left === 0;
    if (left === 0) left = PINS;
  });
  return out;
}

/**
 * 得点表。各フレームの表示（X・/・−）と、そのフレームまでの累計（ボーナスの球がそろうまでは null）、
 * いま分かっている合計（ボーナスは投げた分だけ足す。終われば最終の点と同じ）、すべて終わったか、を返す。
 * @param {readonly number[]} rolls @param {number} frames @returns {ScoreCard}
 */
export function scoreCard(rolls, frames) {
  const parts = split(rolls, frames);
  /** @type {FrameCell[]} */
  const cells = [];
  let total = 0;
  /** @type {number|null} */
  let running = 0;
  parts.forEach(({ start, balls }, f) => {
    const last = f === frames - 1;
    const pins = balls.reduce((a, b) => a + b, 0);
    /** @type {number|null} */
    let score = null;
    let provisional = pins;
    let done;
    if (last) {
      done = balls.length > 0 && balls.length === finalNeed(balls);
      if (done) score = pins;
    } else if (balls[0] === PINS) {
      done = true;
      const b1 = rolls[start + 1];
      const b2 = rolls[start + 2];
      provisional = PINS + (b1 ?? 0) + (b2 ?? 0);
      if (b1 !== undefined && b2 !== undefined) score = provisional;
    } else if (balls.length === 2 && pins === PINS) {
      done = true;
      const b = rolls[start + 2];
      provisional = PINS + (b ?? 0);
      if (b !== undefined) score = provisional;
    } else {
      done = balls.length === 2;
      if (done) score = pins;
    }
    total += provisional;
    running = running === null || score === null ? null : running + score;
    cells.push({ marks: marksOf(balls, last), score, cumulative: running, done });
  });
  const lastCell = cells[cells.length - 1];
  return { frames: cells, total, complete: lastCell?.done === true };
}

/**
 * 次の投球。何フレーム目の何球目か、ピンを立て直すか、何本立っているか。全部投げ終えたら done。
 * @param {readonly number[]} rolls @param {number} frames @returns {NextTurn}
 */
export function nextTurn(rolls, frames) {
  const parts = split(rolls, frames);
  for (let f = 0; f < frames; f++) {
    const { balls } = /** @type {{balls: number[]}} */ (parts[f]);
    if (f < frames - 1) {
      if (balls.length === 0) return { done: false, frame: f, ball: 0, reset: true, pinsLeft: PINS };
      if (balls[0] !== PINS && balls.length === 1) return { done: false, frame: f, ball: 1, reset: false, pinsLeft: PINS - /** @type {number} */ (balls[0]) };
      continue;
    }
    if (balls.length < finalNeed(balls)) {
      let left = PINS;
      for (const n of balls) {
        left -= n;
        if (left === 0) left = PINS;
      }
      return { done: false, frame: f, ball: balls.length, reset: left === PINS, pinsLeft: left };
    }
  }
  return { done: true, frame: frames, ball: 0, reset: true, pinsLeft: PINS };
}

/** フレームを最初から全部倒したときの点（10フレームは300、5フレームは150）。 @param {number} frames */
export function perfectScore(frames) {
  checkFrames(frames);
  return frames * 30;
}
