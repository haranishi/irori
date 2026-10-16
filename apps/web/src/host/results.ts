// ゲームの end の results を、順位の表にする（画面に依存しない純粋な関数）。
// 点数の高い順。同じ点数は同じ順位にし、次の順位はその人数だけ飛ばす（1, 1, 3）。
import type { GameResult, PlayerId } from '@irori/protocol';

export interface ResultRow {
  p: PlayerId;
  rank: number;
  score: number;
  label?: string;
  name: string;
  /** いまの部屋にいない（ゲームの途中で抜けた）。 */
  gone: boolean;
}

export function rankResults(results: readonly GameResult[], nameOf: (p: PlayerId) => { name: string; gone: boolean }): ResultRow[] {
  const sorted = [...results].sort((a, b) => b.score - a.score || a.p - b.p);
  const rows: ResultRow[] = [];
  let rank = 0;
  let prev: number | undefined;
  sorted.forEach((r, i) => {
    if (prev === undefined || r.score !== prev) {
      rank = i + 1;
      prev = r.score;
    }
    const who = nameOf(r.p);
    const row: ResultRow = { p: r.p, rank, score: r.score, name: who.name, gone: who.gone };
    if (r.label !== undefined) row.label = r.label;
    rows.push(row);
  });
  return rows;
}
