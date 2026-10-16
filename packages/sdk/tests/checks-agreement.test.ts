// SDK の送る前の検査と、ホスト（host-bridge）の受けたときの検査が、同じ入力で同じ判定になることを確かめる。
// SDK はホストの部品を読めない（依存の向き）ので規則の写しを持つ。試験だけが両方を読んで突き合わせる。
import { describe, expect, it } from 'vitest';
import { validateGameToHost } from '../../host-bridge/src/validate';
import { checkPadSpec, checkResults, checkVibrate, isStoreKey, isStoreValue } from '../src/checks';

const values: unknown[] = [
  undefined, null, 0, 1, 7.5, 8, 9, -1, 1000, 1000.4, 1001, Number.NaN, Number.POSITIVE_INFINITY, '', 'a', 'k'.repeat(64), 'k'.repeat(65),
  'x'.repeat(16_384), 'あ'.repeat(5_461), 'あ'.repeat(5_462), true, [], [0], [1, 2, 3], Array(8).fill(10), Array(9).fill(10), ['1'], {},
];
const results: unknown[] = [
  [], [{ p: 1, score: 1 }], [{ p: 1, score: 1, label: '1位' }], [{ p: 1, score: 1, label: 'あ'.repeat(13) }], [{ p: 0, score: 1 }],
  [{ p: 1.5, score: 1 }], [{ p: 1, score: Number.NaN }], [{ p: 1, score: 1 }, { p: 1, score: 2 }], [{ p: 1, score: 1, x: 1 }],
  Array.from({ length: 8 }, (_, i) => ({ p: i + 1, score: i })), Array.from({ length: 9 }, (_, i) => ({ p: (i % 8) + 1, score: i })), 'x', null,
];
const specs: unknown[] = [
  { k: 'wait' }, { k: 'remote' }, { k: 'pad', buttons: [{ id: 'a', label: 'A' }] }, { k: 'pad', buttons: [{ id: 'A', label: 'A' }] },
  { k: 'buzzer', label: 'x', color: 'pink' }, { k: 'choices', options: [{ id: 'a', label: 'A' }] }, { k: 'touch', mode: 'swipe', x: 1 },
];

describe('SDK と host-bridge の検査の一致', () => {
  it.each(values.map((v) => [v]))('振動 %s', (ms) => {
    const host = validateGameToHost({ m: 'vibrate', to: '*', ms: typeof ms === 'number' ? [ms] : ms }).ok;
    expect(typeof checkVibrate(ms) !== 'string').toBe(host);
  });

  it.each(results.map((r) => [r]))('結果 %j', (r) => {
    expect(typeof checkResults(r) !== 'string').toBe(validateGameToHost({ m: 'end', results: r }).ok);
  });

  it.each(values.map((v) => [v]))('保存の鍵と値 %s', (v) => {
    expect(isStoreKey(v)).toBe(validateGameToHost({ m: 'store.get', id: 1, key: v }).ok);
    expect(isStoreValue(v)).toBe(validateGameToHost({ m: 'store.set', id: 1, key: 'k', value: v }).ok);
  });

  it.each(specs.map((s) => [s]))('画面の指定 %j', (spec) => {
    expect(checkPadSpec(spec) === null).toBe(validateGameToHost({ m: 'setPad', to: '*', spec }).ok);
  });
});
