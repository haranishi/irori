// ゲームごとの小さな保存。ホストの localStorage を、ゲームの id で名前を分けて使う。
// 1つ16KB・合計64KB（STORAGE_LIMITS）。合計は、そのゲームのキーと値のバイト数の和で数える。
import { STORAGE_LIMITS, utf8Length } from '@irori/protocol';

export interface StorageBackend {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StorageError = 'key' | 'too-large' | 'quota' | 'unavailable';
export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageError };

export interface GameStorage {
  readonly gameId: string;
  get(key: string): StorageResult<string | null>;
  set(key: string, value: string): StorageResult<null>;
  /** いま使っているバイト数。 */
  usage(): number;
}

const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const fail = (error: StorageError) => ({ ok: false, error }) as const;

export function createGameStorage(gameId: string, backend: StorageBackend): GameStorage {
  if (!GAME_ID_RE.test(gameId)) throw new RangeError(`ゲームの id が形に合いません: ${gameId.slice(0, 40)}`);
  const prefix = `irori:game:${gameId}:`;
  const keyOk = (k: unknown): k is string => typeof k === 'string' && k.length >= 1 && k.length <= STORAGE_LIMITS.KEY_MAX_LENGTH;

  const usage = () => {
    let total = 0;
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k?.startsWith(prefix)) total += utf8Length(k.slice(prefix.length)) + utf8Length(backend.getItem(k) ?? '');
    }
    return total;
  };

  return {
    gameId,
    get(key) {
      if (!keyOk(key)) return fail('key');
      try {
        return { ok: true, value: backend.getItem(prefix + key) };
      } catch {
        return fail('unavailable');
      }
    },
    set(key, value) {
      if (!keyOk(key)) return fail('key');
      if (typeof value !== 'string' || value.length > STORAGE_LIMITS.VALUE_MAX_BYTES || utf8Length(value) > STORAGE_LIMITS.VALUE_MAX_BYTES) {
        return fail('too-large');
      }
      try {
        const old = backend.getItem(prefix + key);
        const size = utf8Length(key) + utf8Length(value);
        const before = old === null ? 0 : utf8Length(key) + utf8Length(old);
        if (usage() - before + size > STORAGE_LIMITS.TOTAL_MAX_BYTES) return fail('quota');
        backend.setItem(prefix + key, value);
        return { ok: true, value: null };
      } catch {
        // 端末の保存の上限・プライベートブラウズ・保存の無効化。
        return fail('unavailable');
      }
    },
    usage() {
      try {
        return usage();
      } catch {
        return 0;
      }
    },
  };
}
