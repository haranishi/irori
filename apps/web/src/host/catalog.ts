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
