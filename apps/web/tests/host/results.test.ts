import { beforeAll, describe, expect, it, vi } from 'vitest';
import { registerHostMessages } from '../../src/host/messages';
import { rankResults } from '../../src/host/results';
import { resultsScreen } from '../../src/host/view-panels';
import { useJapanese } from './fakes';

beforeAll(() => {
  useJapanese();
  registerHostMessages();
});

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

  it('順位を外す行は点数を比べず最後に席順で載せ、同率優勝の次は3位にする', () => {
    const rows = rankResults([
      { p: 5, score: 100, ranked: false },
      { p: 3, score: -2 },
      { p: 2, score: -5, ranked: true },
      { p: 4, score: 200, ranked: false },
      { p: 1, score: -2 },
    ], who);
    expect(rows.map((r) => [r.p, r.rank])).toEqual([[1, 1], [3, 1], [2, 3], [4, null], [5, null]]);
  });

  it('勝敗未成立なら、点数やrankedに関係なく全員順位なし', () => {
    const rows = rankResults([{ p: 1, score: 100 }, { p: 2, score: -5 }, { p: 3, score: 200, ranked: false }], who, { outcome: 'incomplete' });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.rank === null)).toBe(true);
  });
});

describe('記録と勝敗なしの結果画面', () => {
  it('記録を主表示にして点数を描画・読み上げへ出さず、文字列をHTMLにしない', () => {
    const options = { display: 'record' as const, note: '<b>目安です</b>' };
    const rows = rankResults([{ p: 1, score: -987, label: '<u>0.3秒</u>' }, { p: 2, score: 999, label: '退出', ranked: false }], who);
    const el = resultsScreen(null, rows, { again: vi.fn(), home: vi.fn(), share: vi.fn() }, options);
    expect(el.querySelector('.result__value')?.textContent).toBe('<u>0.3秒</u>');
    expect(el.querySelector('.results__note')?.textContent).toBe(options.note);
    expect(el.querySelector('b, u')).toBeNull();
    expect(el.querySelector('.result__score')).toBeNull();
    expect(el.outerHTML).not.toMatch(/-987|999|点/);
    expect(el.querySelector('[data-seat="2"] .result__rank')?.textContent).toBe('—');
    expect(el.querySelector('[data-seat="2"]')?.classList.contains('result--top')).toBe(false);
  });

  it('8人の勝敗なし・注記でも密な表示と再戦・ホーム・共有を保つ', () => {
    const options = { display: 'record' as const, outcome: 'incomplete' as const, note: '人数が足りません。通信の遅れを含む目安です' };
    const rows = rankResults(Array.from({ length: 8 }, (_, i) => ({ p: i + 1, score: 0, label: 'ズレ0.0秒' })), who, options);
    const on = { again: vi.fn(), home: vi.fn(), share: vi.fn() };
    const el = resultsScreen(null, rows, on, options);
    expect(el.classList.contains('results--dense')).toBe(true);
    expect(el.querySelector('.results__outcome')?.textContent).toBe('勝敗なし');
    expect(el.querySelectorAll('.result')).toHaveLength(8);
    expect([...el.querySelectorAll('.result__rank')].map((r) => r.textContent)).toEqual(Array(8).fill('—'));
    expect(el.querySelector('.result--top')).toBeNull();
    for (const action of ['again', 'home', 'share'] as const) {
      el.querySelector<HTMLElement>(`[data-nav="results:${action}"]`)?.click();
      expect(on[action]).toHaveBeenCalledOnce();
    }
  });
});
