// ゲームから来るメッセージの検証（docs/security.md）。ゲームは信用しない。形・数・大きさが合わないものは捨てる。
// 通ったものは、検証したキーだけで組み直して返す。画面の指定は、中継と同じ検査（protocol の validatePadSpec）を使う。
// 規則がずれると、ホストが通した画面を中継が捨てて、スマホに何も出なくなるため。
import { LIMITS, STORAGE_LIMITS, utf8Length, validateGameEnd, validatePadSpec } from '@irori/protocol';
import type { GamePadSpec, GameToHost, PlayerId } from '@irori/protocol';
import { isPlainObject, unknownKey } from './text';

export type ValidateResult = { ok: true; msg: GameToHost } | { ok: false; reason: string };

const KEYS: Record<GameToHost['m'], readonly string[]> = {
  ready: ['m'],
  setPad: ['m', 'to', 'spec'],
  vibrate: ['m', 'to', 'ms'],
  end: ['m', 'results', 'options'],
  'store.get': ['m', 'id', 'key'],
  'store.set': ['m', 'id', 'key', 'value'],
};

const reject = (reason: string): ValidateResult => ({ ok: false, reason });
const accept = (msg: GameToHost): ValidateResult => ({ ok: true, msg });

function seat(v: unknown): v is PlayerId {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= LIMITS.MAX_PLAYERS;
}

function target(v: unknown): PlayerId | '*' | null {
  return v === '*' || seat(v) ? (v as PlayerId | '*') : null;
}

function storeKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= STORAGE_LIMITS.KEY_MAX_LENGTH;
}

function requestId(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

export function validateGameToHost(raw: unknown): ValidateResult {
  if (!isPlainObject(raw)) return reject('オブジェクトではありません');
  const m = raw.m;
  if (typeof m !== 'string' || !Object.hasOwn(KEYS, m)) return reject('知らない種類です');
  const extra = unknownKey(raw, KEYS[m as GameToHost['m']]);
  if (extra) return reject(`知らないキー ${extra.slice(0, 24)} があります`);

  switch (m as GameToHost['m']) {
    case 'ready':
      return accept({ m: 'ready' });
    case 'setPad': {
      const to = target(raw.to);
      if (to === null) return reject('to は席番号か * です');
      // remote はコンソール専用なので、ゲームからは拒む（第2引数 false）。
      const spec = validatePadSpec(raw.spec, false);
      if (!spec.ok) return reject(spec.reason);
      return accept({ m: 'setPad', to, spec: spec.frame as GamePadSpec });
    }
    case 'vibrate': {
      const to = target(raw.to);
      if (to === null) return reject('to は席番号か * です');
      const ms = raw.ms;
      if (!Array.isArray(ms) || ms.length === 0 || ms.length > LIMITS.FX_PATTERN_MAX) return reject(`ms は1〜${LIMITS.FX_PATTERN_MAX}個です`);
      const out: number[] = [];
      for (const n of ms as unknown[]) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > LIMITS.FX_MS_MAX) return reject(`ms は0〜${LIMITS.FX_MS_MAX}です`);
        out.push(Math.round(n));
      }
      return accept({ m: 'vibrate', to, ms: out });
    }
    case 'end': {
      const r = validateGameEnd(raw.results, raw.options);
      if (!r.ok) return reject(r.reason);
      const { ok: _, ...data } = r;
      return accept({ m: 'end', ...data });
    }
    case 'store.get':
      if (!requestId(raw.id) || !storeKey(raw.key)) return reject('store.get の id か key が形に合いません');
      return accept({ m: 'store.get', id: raw.id, key: raw.key });
    case 'store.set': {
      if (!requestId(raw.id) || !storeKey(raw.key)) return reject('store.set の id か key が形に合いません');
      const v = raw.value;
      // 1単位が少なくとも1バイトなので、長さで先に落とせる。
      if (typeof v !== 'string' || v.length > STORAGE_LIMITS.VALUE_MAX_BYTES || utf8Length(v) > STORAGE_LIMITS.VALUE_MAX_BYTES) {
        return reject(`store.set の value は${STORAGE_LIMITS.VALUE_MAX_BYTES}バイトまでの文字列です`);
      }
      return accept({ m: 'store.set', id: raw.id, key: raw.key, value: v });
    }
  }
}
