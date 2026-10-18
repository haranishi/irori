// ゲームが送る前の検査。ホスト（host-bridge の validateGameToHost）と同じ上限で、仮想プレイヤーでも同じ検査が走る
// （docs/architecture.md「検証は2回ある」）。画面と終了は protocol の共通検証を使う。
// ほかの項目も tests/checks-agreement.test.ts でホストと突き合わせる。
import { isPlainObject, LIMITS, STORAGE_LIMITS, utf8Length, validateGameEnd, validatePadSpec } from '@irori/protocol';
import type { GameResult, HostEnvironment, PlayerId } from '@irori/protocol';

export { isPlainObject };

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

export function checkResults(v: unknown, options?: unknown): GameResult[] | string {
  if (v === undefined) return 'results は配列です';
  const r = validateGameEnd(v, options);
  return r.ok ? r.results ?? [] : r.reason;
}

export function readEnv(v: unknown): Readonly<HostEnvironment> | null {
  if (!isPlainObject(v) || Object.keys(v).length !== 2 || typeof v.connected !== 'boolean' || typeof v.visible !== 'boolean') return null;
  return Object.freeze({ connected: v.connected, visible: v.visible });
}

export function isStoreKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= STORAGE_LIMITS.KEY_MAX_LENGTH;
}

export function isStoreValue(v: unknown): v is string {
  return typeof v === 'string' && v.length <= STORAGE_LIMITS.VALUE_MAX_BYTES && utf8Length(v) <= STORAGE_LIMITS.VALUE_MAX_BYTES;
}
