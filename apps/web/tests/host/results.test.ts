import { describe, expect, it } from 'vitest';
import { rankResults } from '../../src/host/results';

const names = new Map([
  [1, 'たろう'],
  [2, 'はなこ'],
  [3, 'じろう'],
]);
const who = (p: number) => ({ name: names.get(p) ?? `プレイヤー${p}`, gone: !names.has(p) });

describe('結果の順位', () => {
  it('点数の高い順。同点は同じ順位で、次は人数ぶん飛ばす', () => {
    const rows = rankResults(
      [
        { p: 1, score: 600 },
        { p: 2, score: 800, label: '3.2秒' },
        { p: 3, score: 600 },
        { p: 4, score: 100 },
      ],
      who,
    );
    expect(rows.map((r) => [r.p, r.rank])).toEqual([
      [2, 1],
      [1, 2],
      [3, 2],
      [4, 4],
    ]);
    expect(rows[0]).toMatchObject({ name: 'はなこ', label: '3.2秒', gone: false });
    expect(rows[3]).toMatchObject({ name: 'プレイヤー4', gone: true });
    expect('label' in (rows[1] ?? {})).toBe(false);
  });

  it('負の点数も並べられる。結果が空なら空', () => {
    expect(rankResults([{ p: 1, score: -200 }, { p: 2, score: 0 }], who).map((r) => r.p)).toEqual([2, 1]);
    expect(rankResults([], who)).toEqual([]);
  });
});
