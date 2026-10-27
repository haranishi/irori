// 登録情報（registry/schema/game.schema.json）の、実行時の検査。主要な条件だけを見る。
// 完全な検査はビルドの道具（Ajv）が行う。棚の index.json は、表示用のキー（サムネイルの公開パスなど）を足すので、
// ここでは知らないキーを拒まない。
import { LIMITS } from '@irori/protocol';
import type { GamePadSpec } from '@irori/protocol';
import type { ManifestEntry } from './entry';
import { isPlainObject } from './text';

export type PadKind = GamePadSpec['k'];
type Localized = Partial<Record<'ja' | 'en', string>>;

export interface GameManifest {
  schema: 1;
  id: string;
  title: Localized;
  summary: Localized;
  authors: { name: string; url?: string }[];
  license: { code: string; assets: string };
  players: { min: number; max: number };
  pads: PadKind[];
  entry: ManifestEntry;
  thumbnail: string;
  sdk: 1;
  rating: 'all';
  added: string;
  links?: { source?: string; homepage?: string };
}

export type ManifestResult = { ok: true; manifest: GameManifest } | { ok: false; reason: string };

const PADS: readonly string[] = ['wait', 'pad', 'buzzer', 'choices', 'tiles', 'touch', 'tilt'];
const HTTPS = /^https:\/\/[^\s]+$/;

const str = (v: unknown, min: number, max: number) => typeof v === 'string' && v.length >= min && v.length <= max;

function localized(v: unknown, max: number): boolean {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  return keys.length >= 1 && keys.every((k) => (k === 'ja' || k === 'en') && str(v[k], 1, max));
}

function entryOk(v: unknown): boolean {
  if (!isPlainObject(v) || Object.keys(v).length !== 1) return false;
  if ('bundled' in v) return typeof v.bundled === 'string' && /^games\/[a-z0-9-]+\/$/.test(v.bundled);
  return str(v.url, 9, 300) && /^https:\/\/[^\s@]+$/.test(v.url as string);
}

function linksOk(v: unknown): boolean {
  if (v === undefined) return true;
  if (!isPlainObject(v)) return false;
  return Object.entries(v).every(([k, u]) => (k === 'source' || k === 'homepage') && str(u, 9, 200) && HTTPS.test(u as string));
}

function players(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= LIMITS.MAX_PLAYERS;
  return ok(v.min) && ok(v.max) && (v.min as number) <= (v.max as number);
}

export function validateManifestEntry(json: unknown): ManifestResult {
  const no = (reason: string): ManifestResult => ({ ok: false, reason });
  if (!isPlainObject(json)) return no('オブジェクトではありません');
  const j = json;
  if (j.schema !== 1) return no('schema は 1 です');
  if (typeof j.id !== 'string' || !/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(j.id)) return no('id が形に合いません');
  if (!localized(j.title, 24)) return no('title が形に合いません');
  if (!localized(j.summary, 80)) return no('summary が形に合いません');
  if (
    !Array.isArray(j.authors) ||
    j.authors.length < 1 ||
    j.authors.length > 5 ||
    !j.authors.every((a: unknown) => isPlainObject(a) && str(a.name, 1, 40) && (a.url === undefined || (str(a.url, 9, 200) && HTTPS.test(a.url as string))))
  ) {
    return no('authors が形に合いません');
  }
  if (!isPlainObject(j.license) || !str(j.license.code, 2, 60) || !str(j.license.assets, 2, 60)) return no('license が形に合いません');
  if (!players(j.players)) return no('players が形に合いません');
  if (!Array.isArray(j.pads) || j.pads.length < 1 || new Set(j.pads).size !== j.pads.length || !j.pads.every((p: unknown) => PADS.includes(p as string))) {
    return no('pads が形に合いません');
  }
  if (!entryOk(j.entry)) return no('entry が形に合いません');
  if (typeof j.thumbnail !== 'string' || !/^[a-z0-9-]+\.(webp|png|jpg)$/.test(j.thumbnail)) return no('thumbnail が形に合いません');
  if (j.sdk !== 1) return no('sdk は 1 です');
  if (j.rating !== 'all') return no('rating は all です');
  if (typeof j.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(j.added)) return no('added は YYYY-MM-DD です');
  if (!linksOk(j.links)) return no('links が形に合いません');
  return { ok: true, manifest: j as unknown as GameManifest };
}
