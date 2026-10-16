// API の応答の形。/api/* は保存させない（no-store）。

import { CLOSE_CODES, type BusyResponse, type ErrorCode } from '@irori/protocol';
import type { Verdict } from './limiter';
import { SECURITY_HEADERS } from './policy';

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra },
  });
}

/** 上限に当たったとき。IPの上限は 429、1日の総数は 503。 */
export function refused(v: Extract<Verdict, { ok: false }>): Response {
  const retry = { 'Retry-After': String(v.retryAfterSec) };
  if (v.status === 503) return json({ error: 'busy', retryAfterSec: v.retryAfterSec } satisfies BusyResponse, 503, retry);
  return json({ error: 'rate', retryAfterSec: v.retryAfterSec }, 429, retry);
}

/**
 * 受け入れてすぐ、理由を付けて閉じる WebSocket。ブラウザの WebSocket は HTTP の状態コードを読めないので、
 * 閉じるコード（4004 など）で理由を伝える。
 */
export function rejectSocket(code: ErrorCode): Response {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  server.send(JSON.stringify({ t: 'err', code }));
  server.close(CLOSE_CODES[code], code);
  return new Response(null, { status: 101, webSocket: client });
}

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}
