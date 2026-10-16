// ゲームが送る前の検査。ホスト（host-bridge の validateGameToHost）と同じ上限で、仮想プレイヤーでも同じ検査が走る
// （docs/architecture.md「検証は2回ある」）。画面の指定は、中継・ホストと同じ protocol の validatePadSpec を使う。
// ほかの項目はホストの規則の写しなので、片方を直したら、もう片方も直す（tests/checks-agreement.test.ts が突き合わせる）。
import { fitsGraphemes, LIMITS, STORAGE_LIMITS, utf8Length, validatePadSpec } from '@irori/protocol';
import type { GameResult, PlayerId } from '@irori/protocol';

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** 通れば null、通らなければ理由。remote はコンソール専用なので拒む。 */
export function checkPadSpec(spec: unknown): string | null {
  const r = validatePadSpec(spec, false);
  return r.ok ? null : r.reason;
}

export function isSeat(v: unknown): v is PlayerId {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= LIMITS.MAX_PLAYERS;
}

/** 振動の並び。通れば整数に丸めた並び、通らなければ理由。 */
export function checkVibrate(ms: unknown): number[] | string {
  const list = typeof ms === 'number' ? [ms] : Array.isArray(ms) ? (ms as unknown[]) : null;
  if (!list || list.length === 0 || list.length > LIMITS.FX_PATTERN_MAX) return `振動は1〜${LIMITS.FX_PATTERN_MAX}個の数です`;
  const out: number[] = [];
  for (const n of list) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > LIMITS.FX_MS_MAX) return `振動の長さは0〜${LIMITS.FX_MS_MAX}ミリ秒です`;
    out.push(Math.round(n));
  }
  return out;
}

export function checkResults(v: unknown): GameResult[] | string {
  if (!Array.isArray(v)) return 'results は配列です';
  if (v.length > LIMITS.MAX_PLAYERS) return `results は${LIMITS.MAX_PLAYERS}件までです`;
  const out: GameResult[] = [];
  const seen = new Set<number>();
  for (const r of v as unknown[]) {
    if (!isPlainObject(r) || Object.keys(r).some((k) => k !== 'p' && k !== 'score' && k !== 'label')) return 'results の要素は { p, score, label? } です';
    if (!isSeat(r.p)) return 'results の p は席番号（整数）です';
    if (seen.has(r.p)) return 'results の p が重複しています';
    seen.add(r.p);
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) return 'results の score は有限の数です';
    if (r.label !== undefined && (typeof r.label !== 'string' || !fitsGraphemes(r.label, LIMITS.LABEL_MAX_GRAPHEMES))) {
      return `results の label は${LIMITS.LABEL_MAX_GRAPHEMES}文字までです`;
    }
    out.push(r.label === undefined ? { p: r.p, score: r.score } : { p: r.p, score: r.score, label: r.label });
  }
  return out;
}

export function isStoreKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= STORAGE_LIMITS.KEY_MAX_LENGTH;
}

export function isStoreValue(v: unknown): v is string {
  return typeof v === 'string' && v.length <= STORAGE_LIMITS.VALUE_MAX_BYTES && utf8Length(v) <= STORAGE_LIMITS.VALUE_MAX_BYTES;
}
