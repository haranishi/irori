// 棚の一覧。/registry/index.json（tools/build-registry.mjs が作る）を読み、1件ずつ実行時の検査を通す。
// 通らないものは棚に出さない。?dev= のゲームは、登録情報がないので、ここで最小の項目を作って先頭に置く。
import { validateManifestEntry, type ManifestEntry, type PadKind } from '@irori/host-bridge';
import type { Locale } from '../shared/i18n';
import { t } from '../shared/i18n';

export interface GameEntry {
  id: string;
  title: string;
  summary: string;
  players: { min: number; max: number };
  pads: PadKind[];
  authors: string[];
  license: string;
  assets: string;
  entry: ManifestEntry;
  /** 公開パス（/registry/thumbs/…）。無ければ null（画面で代わりの絵を描く）。 */
  thumb: string | null;
  /** 外部のゲームのホスト名。同梱は null。 */
  host: string | null;
  dev: boolean;
  minutes?: { min: number; max: number } | undefined;
  kind?: string | undefined;
  preview?: string | undefined;
}

export const REGISTRY_URL = '/registry/index.json';
const THUMB_DIR = '/registry/thumbs/';

function pick(v: Partial<Record<'ja' | 'en', string>>, locale: Locale): string {
  return v[locale] ?? v.ja ?? v.en ?? '';
}

function hostOf(entry: ManifestEntry): string | null {
  if (!('url' in entry)) return null;
  try {
    return new URL(entry.url).host;
  } catch {
    return null;
  }
}

/** サムネイルの公開パス。一覧が足したパス（同じファイル名を指す /registry/thumbs/ のもの）があれば、それを使う。 */
function thumbOf(raw: Record<string, unknown>, file: string): string {
  for (const v of Object.values(raw)) {
    if (typeof v === 'string' && v.startsWith(THUMB_DIR) && v.endsWith(`/${file}`) && !v.includes('..')) return v;
  }
  return THUMB_DIR + file;
}

/** 追加の表示情報は通信の型に混ぜず、旧登録もそのまま読めるようにする。 */
function kindOf(raw: Record<string, unknown>, locale: Locale): string | undefined {
  const value = raw.kind;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const values = Object.entries(value);
  if (!values.length || !values.every(([key, text]) => ['ja', 'en'].includes(key) && typeof text === 'string' && [...text].length > 0 && [...text].length <= 12)) return undefined;
  return pick(value as Partial<Record<Locale, string>>, locale);
}

function previewOf(raw: Record<string, unknown>): string | undefined {
  return typeof raw.preview === 'string' && /^[a-z0-9-]+\.mp4$/.test(raw.preview)
    ? `/registry/previews/${raw.preview}` : undefined;
}

function minutesOf(raw: Record<string, unknown>): GameEntry['minutes'] {
  const value = raw.minutes as { min?: unknown; max?: unknown } | undefined;
  if (!value || typeof value !== 'object' || Object.keys(value).some((key) => key !== 'min' && key !== 'max')) return undefined;
  const { min, max } = value;
  return typeof min === 'number' && typeof max === 'number' && Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max <= 120 && min <= max ? { min, max } : undefined;
}

export function parseCatalog(json: unknown, locale: Locale): GameEntry[] {
  const list: unknown[] = Array.isArray(json)
    ? json
    : typeof json === 'object' && json !== null && Array.isArray((json as { games?: unknown }).games)
      ? ((json as { games: unknown[] }).games)
      : [];
  const seen = new Set<string>();
  const out: GameEntry[] = [];
  for (const item of list) {
    const r = validateManifestEntry(item);
    if (!r.ok || seen.has(r.manifest.id)) continue;
    const m = r.manifest;
    seen.add(m.id);
    out.push({
      id: m.id,
      title: pick(m.title, locale),
      summary: pick(m.summary, locale),
      players: { min: m.players.min, max: m.players.max },
      pads: [...m.pads],
      authors: m.authors.map((a) => a.name),
      license: m.license.code,
      assets: m.license.assets,
      entry: m.entry,
      thumb: thumbOf(item as Record<string, unknown>, m.thumbnail),
      host: hostOf(m.entry),
      dev: false,
      minutes: minutesOf(item as Record<string, unknown>),
      kind: kindOf(item as Record<string, unknown>, locale),
      preview: previewOf(item as Record<string, unknown>),
    });
  }
  return out;
}

/** ?dev=<URL> のゲーム。人数は分からないので1〜8人、入力の種類も分からないので空にする。 */
export function devEntry(url: string): GameEntry {
  return {
    id: 'dev',
    title: t('host.game.dev'),
    summary: t('host.game.devSummary'),
    players: { min: 1, max: 8 },
    pads: [],
    authors: [t('host.game.devAuthor')],
    license: '—',
    assets: '—',
    entry: { url },
    thumb: null,
    host: hostOf({ url }),
    dev: true,
  };
}

export async function loadCatalog(fetchFn: typeof fetch, locale: Locale): Promise<GameEntry[]> {
  const res = await fetchFn(REGISTRY_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`registry: ${res.status}`);
  return parseCatalog(await res.json(), locale);
}
