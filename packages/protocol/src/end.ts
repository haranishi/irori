// SDK送信前とiframeの受信時に同じ規則を使う。既知キーだけでコピーし、省略された値は補わない。
import type { GameEndOptions, GameResult } from './bridge';
import type { PlayerId } from './types';
import { LIMITS } from './limits';
import { fitsGraphemes } from './names';

export type EndValidation =
  | { ok: true; results?: GameResult[]; options?: GameEndOptions }
  | { ok: false; reason: string };

function plain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
export { plain as isPlainObject };

const reject = (reason: string): EndValidation => ({ ok: false, reason });

export function validateGameEnd(results?: unknown, options?: unknown): EndValidation {
  const out: Extract<EndValidation, { ok: true }> = { ok: true };
  if (results !== undefined) {
    if (!Array.isArray(results) || results.length > LIMITS.MAX_PLAYERS) return reject('results-array');
    const rows: GameResult[] = [];
    const seen = new Set<number>();
    for (const row of results as unknown[]) {
      if (!plain(row) || Object.keys(row).some((k) => !['p', 'score', 'label', 'ranked'].includes(k))) return reject('result-shape');
      const { p, score, label, ranked } = row;
      if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > LIMITS.MAX_PLAYERS || seen.has(p as number)
        || !Number.isFinite(score)
        || (label !== undefined && (typeof label !== 'string' || !fitsGraphemes(label, LIMITS.LABEL_MAX_GRAPHEMES)))
        || (ranked !== undefined && typeof ranked !== 'boolean')) return reject('result-value');
      seen.add(p as number);
      const clean: GameResult = { p: p as PlayerId, score: score as number };
      if (label !== undefined) clean.label = label as string;
      if (ranked !== undefined) clean.ranked = ranked as boolean;
      rows.push(clean);
    }
    out.results = rows;
  }
  if (options !== undefined) {
    if (!plain(options) || Object.keys(options).some((k) => !['display', 'outcome', 'note'].includes(k))) return reject('options-shape');
    const { display, outcome, note } = options;
    if ((display !== undefined && display !== 'points' && display !== 'record')
      || (outcome !== undefined && outcome !== 'complete' && outcome !== 'incomplete')
      || (note !== undefined && (typeof note !== 'string' || !fitsGraphemes(note, LIMITS.BODY_MAX_GRAPHEMES)))) return reject('options-value');
    // 検証したスナップショットだけをコピーし、getterを再評価しない。
    const clean: GameEndOptions = {};
    if (display !== undefined) clean.display = display;
    if (outcome !== undefined) clean.outcome = outcome;
    if (note !== undefined) clean.note = note;
    if (clean.display === 'record' && out.results?.some((row) => row.label === undefined)) return reject('record-label');
    out.options = clean;
  }
  return out;
}
