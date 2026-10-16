// Worker の入口：/api のルーティングと、HTML（/ と /pad）の配信。
// 静的ファイルの多く（ハッシュ付きのアセット・同梱ゲーム・SDK）は Worker を通さずに配る（wrangler.jsonc の
// run_worker_first）。Worker を通らない静的配信は無料枠の数に入らないため。それらのヘッダーは apps/web/public/_headers。

import { generateCode, isValidCode, normalizeCode, type CreateRoomResponse, type RoomStatus } from '@irori/protocol';
import { readSettings } from './config';
import type { Env } from './env';
import { isWebSocketUpgrade, json, refused, rejectSocket } from './http';
import { SECURITY_HEADERS, absolutize, crossOrigin, htmlCsp, permissionsPolicy, publicOrigin } from './policy';

export { Limiter } from './limiter';
export { Room } from './room';

/** コードが使用中の部屋とぶつかったら、作り直す回数。約70万通りなので、8回続けてぶつかるのは異常のとき。 */
const CODE_ATTEMPTS = 8;
const ROOM_PATH = /^\/api\/rooms\/([^/]+)(\/ws)?$/;

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const limiterOf = (env: Env) => env.LIMITER.get(env.LIMITER.idFromName('global'));
/** 栓に渡すのは生の値。/64・/48 の鍵は Limiter の中で作る。 */
const ipOf = (request: Request) => request.headers.get('CF-Connecting-IP') ?? '';

function methodNotAllowed(allow: string): Response {
  return json({ error: 'method' }, 405, { Allow: allow });
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

async function createRoom(request: Request, url: URL, env: Env): Promise<Response> {
  // 別のサイトのページから、訪問者のIPを借りて部屋を作らせない（1日の総数を減らされないように）。
  if (crossOrigin(request.headers.get('Origin'), url.host) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({ error: 'origin' }, 403);
  }
  const settings = readSettings(env);
  const verdict = await limiterOf(env).take('create', ipOf(request));
  if (!verdict.ok) return refused(verdict);
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = generateCode(rand);
    const key = await env.ROOM.get(env.ROOM.idFromName(code)).create(code);
    if (key !== null) return json({ code, key, ttl: settings.createTtlS } satisfies CreateRoomResponse, 201);
  }
  return json({ error: 'busy', retryAfterSec: 5 }, 503, { 'Retry-After': '5' });
}

async function roomStatus(request: Request, env: Env, code: string): Promise<Response> {
  const verdict = await limiterOf(env).take('lookup', ipOf(request));
  if (!verdict.ok) return refused(verdict);
  if (!isValidCode(code)) {
    return json({ exists: false, locked: false, players: 0, max: readSettings(env).maxPlayers } satisfies RoomStatus);
  }
  return json(await env.ROOM.get(env.ROOM.idFromName(code)).status());
}

async function connect(request: Request, url: URL, env: Env, code: string): Promise<Response> {
  if (!isWebSocketUpgrade(request)) return json({ error: 'upgrade' }, 426, { Upgrade: 'websocket' });
  if (crossOrigin(request.headers.get('Origin'), url.host)) return json({ error: 'origin' }, 403);
  // 接続は、部屋があってもなくても、部屋を起こす前に数える。既にある部屋への接続の連打も、ここで止まる。
  const limiter = limiterOf(env);
  const accepted = await limiter.take('ws', ipOf(request));
  if (!accepted.ok) return refused(accepted);
  if (!isValidCode(code)) {
    // 形の正しくないコードは、部屋を起こさずにここで断る。総当たりの1回として数える。
    const verdict = await limiter.take('lookup', ipOf(request));
    if (!verdict.ok) return refused(verdict);
    return rejectSocket('no-room');
  }
  return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
}

async function api(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname;
  if (path === '/api/health') return request.method === 'GET' ? json({ ok: true }) : methodNotAllowed('GET');
  if (path === '/api/rooms') return request.method === 'POST' ? createRoom(request, url, env) : methodNotAllowed('POST');
  const m = ROOM_PATH.exec(path);
  if (!m) return json({ error: 'not-found' }, 404);
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const code = normalizeCode(decode(m[1] ?? ''));
  return m[2] ? connect(request, url, env, code) : roomStatus(request, env, code);
}

function rewriter(origin: string): HTMLRewriter {
  const fix = (attr: string) => ({
    element(el: Element) {
      const abs = absolutize(el.getAttribute(attr), origin);
      if (abs !== null) el.setAttribute(attr, abs);
    },
  });
  return new HTMLRewriter()
    .on('link[rel~="canonical"]', fix('href'))
    .on('meta[property="og:url"]', fix('content'))
    .on('meta[property="og:image"]', fix('content'))
    .on('meta[name="twitter:image"]', fix('content'));
}

/** Worker を通る静的ファイル（/ と /pad、そして静的ファイルにない道）の応答を整える。 */
function finish(res: Response, url: URL, env: Env): Response {
  const headers = new Headers(res.headers);
  headers.delete('Set-Cookie');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.set('Permissions-Policy', permissionsPolicy(url.pathname));
  const init = { status: res.status, statusText: res.statusText, headers };
  if (!(headers.get('Content-Type') ?? '').startsWith('text/html')) return new Response(res.body, init);
  headers.set('Content-Security-Policy', htmlCsp(url.host, env.DEV_FRAMES === '1'));
  headers.set('Cache-Control', 'no-cache');
  // 書き換えた結果はオリジンで変わるので、元のファイルの ETag は使わない。
  headers.delete('ETag');
  return rewriter(publicOrigin(env.PUBLIC_URL, url.origin)).transform(new Response(res.body, init));
}

async function page(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return finish(new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }), url, env);
  }
  // "/" は index.html、"/pad" は pad.html（静的配信の html_handling が対応づける）。
  return finish(await env.ASSETS.fetch(request), url, env);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, url, env);
      } catch {
        return json({ error: 'internal' }, 500);
      }
    }
    return page(request, url, env);
  },
} satisfies ExportedHandler<Env>;
