// @ts-check
// スマホの「指をおいて、下に引いて、はなす」を投げ方に読み替える。純粋関数で、DOM と SDK を読まない。
// 時間は使わず、指の位置（なぞる面の内側を0〜1にした値）だけで決める。回線の遅れや指の速さは結果に響かない。

export const GESTURE = Object.freeze({
  /** これより短い引き（y の差）は投げない。 */
  minPull: 0.12,
  /** 最小の引きから、強さ1になるまでの長さ。 */
  pullSpan: 0.63,
  /** 置く位置の端。レーンの半幅を1とする。 */
  startSpan: 0.85,
  /** 曲がりが1になる横のずれ。 */
  hookSpan: 0.35,
  /** これ以下の曲がりは0にする（まっすぐ引いたつもりの、指のぶれ）。 */
  hookDead: 0.04,
});

export const HINT = '指をおいて、下に引いて、はなす';

/** @typedef {{x: number, y: number, ph: 's'|'m'|'e'}} Sample */
/** @typedef {'ok'|'no-start'|'no-end'|'short'} ThrowReason */
/**
 * 投げ方。startX はレーンの半幅を1とした置く位置（−0.85〜0.85）、power は強さ（0〜1）、hook は曲がり（−1〜1、右が正）。
 * @typedef {{ok: boolean, reason: ThrowReason, startX: number, power: number, hook: number, pull: number}} ThrowShape
 */

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 指の位置は、スマホが0.001刻みで送る。千分の1の整数にそろえてから比べると、境目（0.12・±0.04）が小数の誤差でずれない。
const MIN_PULL = Math.round(GESTURE.minPull * 1000);
const PULL_SPAN = Math.round(GESTURE.pullSpan * 1000);
const HOOK_SPAN = Math.round(GESTURE.hookSpan * 1000);
const HOOK_DEAD = Math.round(GESTURE.hookDead * GESTURE.hookSpan * 1000);

/** 0〜1の値を、千分の1の整数（0〜1000）にする。壊れた値は null。 @param {unknown} v */
function unit(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, 0, 1) * 1000) : null;
}

/**
 * 置いた点と、いまの点（どちらも千分の1の整数）から投げ方を作る。
 * @param {{x: number, y: number}} s @param {{x: number, y: number}} p @param {boolean} ended
 * @returns {ThrowShape}
 */
function shape(s, p, ended) {
  const pull = p.y - s.y;
  const dx = p.x - s.x;
  const startX = ((s.x * 2 - 1000) / 1000) * GESTURE.startSpan;
  const power = clamp((pull - MIN_PULL) / PULL_SPAN, 0, 1);
  const hook = Math.abs(dx) <= HOOK_DEAD ? 0 : clamp(dx / HOOK_SPAN, -1, 1);
  const long = pull >= MIN_PULL;
  /** @type {ThrowReason} */
  const reason = !long ? 'short' : ended ? 'ok' : 'no-end';
  return { ok: long && ended, reason, startX, power, hook, pull: pull / 1000 };
}

/** @returns {ThrowShape} */
function nothing() {
  return { ok: false, reason: 'no-start', startX: 0, power: 0, hook: 0, pull: 0 };
}

/**
 * 置いた点（最後の s）を探す。値の壊れた点は使わない。
 * @param {readonly Sample[]} samples
 */
function lastStart(samples) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const v = samples[i];
    if (v?.ph !== 's') continue;
    const x = unit(v.x);
    const y = unit(v.y);
    if (x === null || y === null) return null;
    return { i, at: { x, y } };
  }
  return null;
}

/**
 * はなした指から、投げ方を決める。s と e がそろい、引きが0.12以上のときだけ ok。
 * それ以外は ok が偽で、もう一度引ける。s のない e、e の無い途中の指は投げない。
 * @param {readonly Sample[]} samples @returns {ThrowShape}
 */
export function readThrow(samples) {
  const start = lastStart(samples);
  if (!start) return nothing();
  for (let i = start.i + 1; i < samples.length; i++) {
    const v = samples[i];
    if (v?.ph !== 'e') continue;
    const x = unit(v.x);
    const y = unit(v.y);
    if (x === null || y === null) break;
    return shape(start.at, { x, y }, true);
  }
  return { ...shape(start.at, start.at, false), ok: false, reason: 'no-end' };
}

/**
 * 途中の指から、同じ形を返す（大画面の狙い線・強さの目盛り・曲がりの予想線に使う）。
 * ok は「いまはなせば投げになる」こと。
 * @param {readonly Sample[]} samples @returns {ThrowShape}
 */
export function previewThrow(samples) {
  const start = lastStart(samples);
  if (!start) return nothing();
  let at = start.at;
  for (let i = start.i + 1; i < samples.length; i++) {
    const v = samples[i];
    const x = unit(v?.x);
    const y = unit(v?.y);
    if (x !== null && y !== null) at = { x, y };
  }
  const s = shape(start.at, at, false);
  const long = at.y - start.at.y >= MIN_PULL;
  return { ...s, ok: long, reason: long ? 'ok' : 'short' };
}
