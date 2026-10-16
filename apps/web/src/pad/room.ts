// 部屋のコード・存在の確認・端末に残すもの（再開の札と前回の名前）。画面に依存しない。
import {
  LIMITS,
  countGraphemes,
  isValidCode,
  normalizeCode,
  sanitizeName,
  truncateGraphemes,
  utf8Length,
  type RoomStatus,
} from '@irori/protocol';

export const CODE_CHARS: string = LIMITS.CODE_ALPHABET;

/**
 * 打たれた・貼られた文字から、コードに使える文字だけを残す（全角は半角に、小文字は大文字に）。
 * 部屋のURLを丸ごと貼られたときは、# の後ろだけを見る。
 */
export function codeChars(raw: string): string {
  const at = raw.lastIndexOf('#');
  const s = normalizeCode(at >= 0 ? raw.slice(at + 1) : raw);
  let out = '';
  for (const c of s) if (CODE_CHARS.includes(c)) out += c;
  return out;
}

/** QRのURLの # 以降。正しい4文字なら code、そうでなければ null（raw は入力欄の下書きに使う）。 */
export function codeFromHash(hash: string): { code: string | null; raw: string } {
  let raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 壊れた % はそのまま使う
  }
  const n = normalizeCode(raw);
  return { code: isValidCode(n) ? n : null, raw };
}

export type Lookup =
  | { kind: 'open'; players: number; max: number }
  | { kind: 'missing' }
  | { kind: 'full'; max: number }
  | { kind: 'locked' }
  | { kind: 'rate'; retryAfterSec: number }
  | { kind: 'busy'; retryAfterSec: number }
  | { kind: 'network' };

function retryAfter(res: Response): number {
  const n = Number(res.headers.get('Retry-After'));
  return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.ceil(n)) : 10;
}

/** GET /api/rooms/:code。応答も信用せず、形を確かめてから使う。 */
export async function lookupRoom(code: string, fetchImpl: typeof fetch): Promise<Lookup> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    return { kind: 'network' };
  }
  if (res.status === 429) return { kind: 'rate', retryAfterSec: retryAfter(res) };
  if (res.status === 503) return { kind: 'busy', retryAfterSec: retryAfter(res) };
  if (!res.ok) return { kind: 'network' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'network' };
  }
  const s = (typeof body === 'object' && body !== null ? body : {}) as Partial<Record<keyof RoomStatus, unknown>>;
  if (typeof s.exists !== 'boolean' || typeof s.locked !== 'boolean' || typeof s.players !== 'number' || typeof s.max !== 'number') {
    return { kind: 'network' };
  }
  if (!s.exists) return { kind: 'missing' };
  if (s.locked) return { kind: 'locked' };
  if (s.players >= s.max) return { kind: 'full', max: s.max };
  return { kind: 'open', players: s.players, max: s.max };
}

// ---- 端末に残すもの ----

/** sessionStorage・localStorage のうち、使う形だけ。プライベートブラウズなどで例外を投げても止まらない。 */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const NAME_KEY = 'irori:name';
export const resumeKey = (code: string): string => `irori:resume:${code}`;

/** 使えるかを1回だけ確かめて返す。使えなければ null（その場合は、残さずに動く）。 */
export function openStorage(get: () => KeyValue): KeyValue | null {
  try {
    const s = get();
    s.getItem(NAME_KEY);
    return s;
  } catch {
    return null;
  }
}

export function readItem(s: KeyValue | null, key: string): string | null {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(s: KeyValue | null, key: string, value: string): void {
  try {
    s?.setItem(key, value);
  } catch {
    // 容量がいっぱい・保存が禁止されている。残せなくても遊べる。
  }
}

export function removeItem(s: KeyValue | null, key: string): void {
  try {
    s?.removeItem(key);
  } catch {
    // 同上
  }
}

// ---- 名前 ----

/** hello は512バイトまで（超えると 4002 で閉じられ、同じ hello で入り直し続ける）。名前は余裕を見て200バイトに収める。 */
const NAME_MAX_BYTES = 200;

/** 送る名前。中継と同じ掃除をしたうえで、バイト数でも切る。空なら空（中継が「プレイヤーN」を付ける）。 */
export function fitName(raw: string): string {
  let s = sanitizeName(raw, '');
  while (s !== '' && utf8Length(s) > NAME_MAX_BYTES) s = truncateGraphemes(s, countGraphemes(s) - 1).trimEnd();
  return s;
}

/** 入力欄の名前を、12書記素までに切る。 */
export function clipName(raw: string): string {
  return truncateGraphemes(raw, LIMITS.NAME_MAX_GRAPHEMES);
}
