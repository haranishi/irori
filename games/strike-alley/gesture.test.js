import { describe, expect, it } from 'vitest';
import { GESTURE, HINT, previewThrow, readThrow } from './gesture.js';

const s = (x, y) => ({ x, y, ph: 's' });
const m = (x, y) => ({ x, y, ph: 'm' });
const e = (x, y) => ({ x, y, ph: 'e' });

describe('投げるかどうか', () => {
  it('引きが0.12以上でだけ投げる（ちょうど0.12は投げる）', () => {
    expect(readThrow([s(0.5, 0.2), e(0.5, 0.32)]).ok).toBe(true);
    const short = readThrow([s(0.5, 0.2), e(0.5, 0.319)]);
    expect(short).toMatchObject({ ok: false, reason: 'short' });
    expect(readThrow([s(0.5, 0.6), e(0.5, 0.2)])).toMatchObject({ ok: false, reason: 'short' });
  });
  it('s のない e、s のない m、e の無い途中は投げない', () => {
    expect(readThrow([e(0.5, 0.9)])).toMatchObject({ ok: false, reason: 'no-start' });
    expect(readThrow([m(0.5, 0.5), e(0.5, 0.9)])).toMatchObject({ ok: false, reason: 'no-start' });
    expect(readThrow([s(0.5, 0.1), m(0.5, 0.9)])).toMatchObject({ ok: false, reason: 'no-end' });
    expect(readThrow([])).toMatchObject({ ok: false, reason: 'no-start' });
  });
  it('置き直したら（2つ目の s）、最後に置いた点から読む', () => {
    const r = readThrow([s(0.1, 0.1), m(0.2, 0.5), s(0.8, 0.2), e(0.8, 0.9)]);
    expect(r.ok).toBe(true);
    expect(r.startX).toBeCloseTo((0.8 * 2 - 1) * 0.85, 12);
  });
  it('壊れた値の点は使わない', () => {
    expect(readThrow([s(Number.NaN, 0.1), e(0.5, 0.9)]).ok).toBe(false);
    expect(readThrow([s(0.5, 0.1), e(0.5, Number.POSITIVE_INFINITY)]).ok).toBe(false);
  });
});

describe('置く位置・強さ・曲がり', () => {
  it('置く位置は 0〜1 を −0.85〜+0.85 に写す', () => {
    expect(readThrow([s(0, 0.1), e(0, 0.9)]).startX).toBeCloseTo(-0.85, 12);
    expect(readThrow([s(1, 0.1), e(1, 0.9)]).startX).toBeCloseTo(0.85, 12);
    expect(readThrow([s(0.5, 0.1), e(0.5, 0.9)]).startX).toBe(0);
  });
  it('強さは (引き−0.12)/0.63 を 0〜1 に切る', () => {
    expect(readThrow([s(0.5, 0.1), e(0.5, 0.22)]).power).toBe(0);
    expect(readThrow([s(0.5, 0.1), e(0.5, 0.85)]).power).toBeCloseTo(1, 12);
    expect(readThrow([s(0.5, 0.0), e(0.5, 1.0)]).power).toBe(1);
    expect(readThrow([s(0.5, 0.1), e(0.5, 0.535)]).power).toBeCloseTo(0.5, 12);
  });
  it('曲がりは横のずれ/0.35 を −1〜1 に切り、±0.04 以下は 0', () => {
    expect(readThrow([s(0.3, 0.1), e(0.65, 0.9)]).hook).toBeCloseTo(1, 12);
    expect(readThrow([s(0.65, 0.1), e(0.3, 0.9)]).hook).toBeCloseTo(-1, 12);
    expect(readThrow([s(0.1, 0.1), e(0.9, 0.9)]).hook).toBe(1);
    // 指は0.001刻み。0.014（＝0.04×0.35）までのずれは0、0.015からは曲がる。
    expect(readThrow([s(0.5, 0.1), e(0.514, 0.9)]).hook).toBe(0);
    expect(readThrow([s(0.5, 0.1), e(0.486, 0.9)]).hook).toBe(0);
    expect(readThrow([s(0.5, 0.1), e(0.515, 0.9)]).hook).toBeCloseTo(15 / 350, 12);
    expect(readThrow([s(0.5, 0.1), e(0.485, 0.9)]).hook).toBeCloseTo(-15 / 350, 12);
    expect(GESTURE.hookDead).toBe(0.04);
  });
  it('途中の指（m）や送られた回数は、はなした結果を変えない（時間は使わない）', () => {
    const plain = readThrow([s(0.4, 0.15), e(0.55, 0.8)]);
    const wiggly = readThrow([s(0.4, 0.15), m(0.9, 0.3), m(0.1, 0.95), m(0.4, 0.4), m(0.4, 0.4), e(0.55, 0.8)]);
    expect(wiggly).toEqual(plain);
  });
});

describe('大画面の予想', () => {
  it('途中の指から、はなしたときと同じ形を返す', () => {
    const points = [s(0.3, 0.2), m(0.35, 0.5), m(0.42, 0.7)];
    const preview = previewThrow(points);
    const thrown = readThrow([s(0.3, 0.2), e(0.42, 0.7)]);
    expect(preview).toEqual(thrown);
  });
  it('引きが足りない間は ok が偽、置いただけでも置く位置は出す', () => {
    const p = previewThrow([s(0.75, 0.3)]);
    expect(p).toMatchObject({ ok: false, reason: 'short', power: 0, hook: 0 });
    expect(p.startX).toBeCloseTo(0.425, 12);
    expect(previewThrow([m(0.5, 0.5)])).toMatchObject({ ok: false, reason: 'no-start' });
  });
  it('案内の文は40文字以内（コントローラーのヒントの上限）', () => {
    expect([...HINT].length).toBeLessThanOrEqual(40);
  });
});
