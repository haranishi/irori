import { describe, expect, it } from 'vitest';
import { validateGameEnd } from '../src/index';

describe('ゲーム終了の共通契約', () => {
  it('省略値を追加せず旧endを保つ', () => {
    expect(validateGameEnd()).toEqual({ ok: true });
    expect(validateGameEnd([])).toEqual({ ok: true, results: [] });
    const results = [{ p: 1, score: 42, label: '記録' }, { p: 2, score: 0 }];
    expect(validateGameEnd(results)).toEqual({ ok: true, results });
  });

  it('記録・順位除外・勝敗なしを一緒に受け、新しいオブジェクトへコピーする', () => {
    const results = [{ p: 1, score: -4, label: '合計ズレ 0.4秒' }, { p: 2, score: -1, label: '途中ズレ 0.1秒', ranked: false }];
    const options = { display: 'record', outcome: 'incomplete', note: '通信の遅れを含む目安です' };
    const r = validateGameEnd(results, options);
    expect(r).toEqual({ ok: true, results, options });
    if (!r.ok) throw Error(r.reason);
    expect(r.results).not.toBe(results);
    expect(r.results![0]).not.toBe(results[0]);
    expect(r.options).not.toBe(options);
  });

  it('8席・12文字のラベル・120文字の注記を境界まで受ける', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({ p: i + 1, score: i, label: 'あ'.repeat(12), ranked: true }));
    expect(validateGameEnd(results, { display: 'record', outcome: 'complete', note: 'あ'.repeat(120) }).ok).toBe(true);
    expect(validateGameEnd([], { display: 'points' }).ok).toBe(true);
  });

  it('null-prototypeオブジェクトも既知の値だけで返す', () => {
    const row = Object.assign(Object.create(null) as Record<string, unknown>, { p: 1, score: 0, ranked: false });
    expect(validateGameEnd([row], Object.create(null))).toEqual({ ok: true, results: [{ p: 1, score: 0, ranked: false }], options: {} });
  });

  it.each([
    null, {}, 'results', Array.from({ length: 9 }, (_, i) => ({ p: i + 1, score: 0 })),
    [null], [[]], [{ p: 0, score: 0 }], [{ p: 9, score: 0 }], [{ p: 1.5, score: 0 }],
    [{ p: '1', score: 0 }], [{ p: 1, score: NaN }], [{ p: 1, score: Infinity }],
    [{ p: 1, score: '0' }], [{ p: 1, score: 0 }, { p: 1, score: 5 }],
    [{ p: 1, score: 0, label: 'あ'.repeat(13) }], [{ p: 1, score: 0, label: null }],
    [{ p: 1, score: 0, ranked: 'false' }], [{ p: 1, score: 0, ranked: null }],
    [{ p: 1, score: 0, other: 1 }], [new Date()],
  ].map((results) => ({ results })))('不正な結果を拒む: %j', ({ results }) => {
    expect(validateGameEnd(results).ok).toBe(false);
  });

  it.each([
    null, [], 'options', new Date(), { display: 'records' }, { outcome: 'win' },
    { note: 'あ'.repeat(121) }, { note: 1 }, { note: null }, { display: null },
    { outcome: null }, { arbitrary: true }, { note: '', extra: 'x' },
  ].map((options) => ({ options })))('不正なoptionsを拒む: %j', ({ options }) => {
    expect(validateGameEnd([{ p: 1, score: 0 }], options).ok).toBe(false);
  });

  it('recordでラベルを欠く行を拒み、pointsでは従来の省略を許す', () => {
    expect(validateGameEnd([{ p: 1, score: 0 }], { display: 'record' }).ok).toBe(false);
    expect(validateGameEnd([{ p: 1, score: 0 }], { display: 'points' }).ok).toBe(true);
    expect(validateGameEnd(undefined, { outcome: 'incomplete' })).toEqual({ ok: true, options: { outcome: 'incomplete' } });
  });

  it('optionsは検証した値をコピーし、getterを再評価しない', () => {
    let reads = 0;
    const options = { get display() { return ++reads === 1 ? 'points' : 'invalid'; } };
    expect(validateGameEnd([], options)).toEqual({ ok: true, results: [], options: { display: 'points' } });
    expect(reads).toBe(1);
  });

  it('列挙されない既知のrecord指定も検証し、label省略を拒む', () => {
    const options = Object.defineProperty({}, 'display', { value: 'record' });
    expect(validateGameEnd([{ p: 1, score: 0 }], options).ok).toBe(false);
    expect(validateGameEnd([{ p: 1, score: 0, label: '10.0秒' }], options)).toEqual({
      ok: true, results: [{ p: 1, score: 0, label: '10.0秒' }], options: { display: 'record' },
    });
  });
});
