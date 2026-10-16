// ゲームを開く前の決まり（画面に依存しない純粋な関数）。
// 外部のゲームは、開く前に「{ホスト名} のサーバーに接続します」と確かめる。同じホスト名は、そのタブでは1回だけ。
import { resolveEntry, type FrameSource } from '@irori/host-bridge';
import type { GameEntry } from './catalog';

export type SourceResult = { ok: true; source: FrameSource } | { ok: false; reason: string };

/** 登録情報の entry を枠の指定にする。同梱は末尾のスラッシュの道で開く（index.html は 307 で転送されるため）。 */
export function frameSource(game: GameEntry, consoleOrigin: string): SourceResult {
  const r = resolveEntry(game.entry, consoleOrigin, { allowLocalhost: game.dev });
  if (!r.ok) return { ok: false, reason: r.reason };
  const f = r.frame;
  return { ok: true, source: f.kind === 'bundled' ? { ...f, src: f.src.replace(/\/index\.html$/, '/') } : f };
}

/** 確かめが要るなら、そのホスト名。要らなければ null。 */
export function hostToConfirm(source: FrameSource, trusted: ReadonlySet<string>): string | null {
  if (source.kind !== 'external' || source.host === null) return null;
  return trusted.has(source.host) ? null : source.host;
}

const TRUSTED_KEY = 'irori:host:trusted';

/** このタブで確かめたホスト名（sessionStorage）。読めない環境では、毎回確かめる。 */
export function loadTrusted(storage: Pick<Storage, 'getItem'> | null): Set<string> {
  try {
    const v: unknown = JSON.parse(storage?.getItem(TRUSTED_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []);
  } catch {
    return new Set();
  }
}

export function saveTrusted(storage: Pick<Storage, 'setItem'> | null, hosts: ReadonlySet<string>): void {
  try {
    storage?.setItem(TRUSTED_KEY, JSON.stringify([...hosts].slice(0, 50)));
  } catch {
    // 保存できなくても、このページの中では覚えている。
  }
}
