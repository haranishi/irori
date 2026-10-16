// 登録情報の entry を、枠のURLと属性に変える（ADR 0001）。
// 同梱のゲームは allow-same-origin なし（オリジンが空になり、コンソールに触れない）。
// 外部のゲームは、コンソールと別のオリジンのときだけ allow-same-origin をつける。同じオリジンに付けると隔離が消える。
import { isPlainObject } from './text';

export type ManifestEntry = { bundled: string } | { url: string };

export interface ResolveOptions {
  /** 開発のときだけ、http の localhost と 127.0.0.1 を許す。 */
  allowLocalhost?: boolean;
}

export interface FrameSource {
  kind: 'bundled' | 'external';
  src: string;
  sandbox: string;
  /** 音の再生だけを渡す。カメラ・マイク・位置情報などは渡さない。 */
  allow: string;
  referrerPolicy: 'no-referrer';
  loading: 'eager';
  /** 握手で受け付ける送り主のオリジン。同梱は空のオリジン（'null'）。 */
  origin: string;
  /** 外部のゲームのホスト名（開く前の確認に出す）。同梱は null。 */
  host: string | null;
}

export type EntryRejection = 'bad-entry' | 'bad-console-origin' | 'bad-url' | 'insecure' | 'credentials' | 'same-origin';
export type ResolveResult = { ok: true; frame: FrameSource } | { ok: false; reason: EntryRejection };

export const SANDBOX_BUNDLED = 'allow-scripts';
export const SANDBOX_EXTERNAL = 'allow-scripts allow-same-origin';
export const FRAME_ALLOW = 'autoplay';

const no = (reason: EntryRejection): ResolveResult => ({ ok: false, reason });

export function resolveEntry(entry: unknown, consoleOrigin: string, opts: ResolveOptions = {}): ResolveResult {
  let base: URL;
  try {
    base = new URL(consoleOrigin);
  } catch {
    return no('bad-console-origin');
  }
  if (base.origin === 'null') return no('bad-console-origin');
  if (!isPlainObject(entry) || Object.keys(entry).length !== 1) return no('bad-entry');

  if (typeof entry.bundled === 'string') {
    const m = /^games\/([a-z0-9-]+)\/$/.exec(entry.bundled);
    if (!m) return no('bad-entry');
    return {
      ok: true,
      frame: {
        kind: 'bundled',
        src: new URL(`/games/${m[1]}/index.html`, base.origin).href,
        sandbox: SANDBOX_BUNDLED,
        allow: FRAME_ALLOW,
        referrerPolicy: 'no-referrer',
        loading: 'eager',
        origin: 'null',
        host: null,
      },
    };
  }

  if (typeof entry.url !== 'string') return no('bad-entry');
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return no('bad-url');
  }
  if (url.username !== '' || url.password !== '') return no('credentials');
  const local = opts.allowLocalhost === true && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !local) return no('insecure');
  if (url.origin === base.origin) return no('same-origin');
  return {
    ok: true,
    frame: {
      kind: 'external',
      src: url.href,
      sandbox: SANDBOX_EXTERNAL,
      allow: FRAME_ALLOW,
      referrerPolicy: 'no-referrer',
      loading: 'eager',
      origin: url.origin,
      host: url.host,
    },
  };
}

/** ループバック・プライベートIP・リンクローカル・.local（mDNS）。公開サーバーの名前ではないもの。 */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h.includes(':')) return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  return false;
}

/**
 * `?dev=<URL>`。コンソールがローカルかLANの上で動いているときだけ有効で、公開サーバーでは null。
 * 返したURLは、resolveEntry({ url }, origin, { allowLocalhost: true }) に渡して使う。
 */
export function parseDevParam(loc: { search: string; hostname: string }): string | null {
  if (!isLocalHostname(loc.hostname)) return null;
  const raw = new URLSearchParams(loc.search).get('dev');
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}
