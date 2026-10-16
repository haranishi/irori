// 部屋の Durable Object。中身は RoomCore（packages/room）で、ここは入出力だけを受け持つ。
// 休止（Hibernation）を前提にする：接続は ctx.acceptWebSocket で受け、名簿は付属情報から組み直す。
// setTimeout・setInterval は使わない（動いていると休止できず、時間課金が続く）。時刻の処理は alarm() だけ。

import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CLOSE_CODES, HEARTBEAT_PING, HEARTBEAT_PONG, utf8Length, type RoomStatus } from '@irori/protocol';
import { RoomCore, type ConnAttachment, type ConnId, type Effect, type RoomDeps, type RoomEvent, type RoomState, type SocketSnapshot } from '@irori/room';
import { readSettings } from './config';
import type { Env } from './env';
import { isWebSocketUpgrade, refused, rejectSocket } from './http';

const STATE_KEY = 'room';
const encoder = new TextEncoder();

/** 付属情報（16KiB まで）。接続の名前と、RoomCore が決めた役割・席・つないだ時刻だけを持つ。 */
interface StoredAttachment extends ConnAttachment {
  c: ConnId;
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // すでに閉じている
  }
}

const makeDeps = (env: Env): RoomDeps => ({
  rand: (n) => crypto.getRandomValues(new Uint8Array(n)),
  hash: (s) => createHash('sha256').update(s).digest('base64url'),
  timingSafeEqual: (a, b) => {
    const x = encoder.encode(a);
    const y = encoder.encode(b);
    return x.byteLength === y.byteLength && timingSafeEqual(x, y);
  },
  limits: readSettings(env).room,
});

export class Room extends DurableObject<Env> {
  private core: RoomCore | null = null;
  private readonly sockets = new Map<ConnId, WebSocket>();
  private readonly connOf = new WeakMap<WebSocket, ConnId>();
  /** 最後に書いた付属情報。変わったときだけ書き直す。 */
  private readonly written = new Map<ConnId, string>();
  private readonly deps: RoomDeps;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.deps = makeDeps(env);
    // ping は Durable Object を起こさずに、実行環境が答える。
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
    void ctx.blockConcurrencyWhile(() => this.restore());
  }

  /** 休止から起きたとき（またははじめて作られたとき）。保存した状態と、生きている接続の付属情報から組み直す。 */
  private async restore(): Promise<void> {
    const state = await this.ctx.storage.get<RoomState>(STATE_KEY);
    const snapshots: SocketSnapshot[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as StoredAttachment | null;
      // 閉じかけの接続は名簿に入れない（こちらが閉じた後、相手の返事を待っているもの）
      if (ws.readyState > 1 || !a || typeof a.c !== 'string') continue;
      this.track(a.c, ws);
      const att: ConnAttachment = { role: a.role, seat: a.seat, openedAt: a.openedAt };
      if (typeof a.seen === 'number') att.seen = a.seen;
      this.written.set(a.c, JSON.stringify(att));
      snapshots.push({ conn: a.c, att });
    }
    if (state) {
      this.core = RoomCore.restore(state, snapshots, this.deps);
      return;
    }
    for (const ws of this.sockets.values()) safeClose(ws, CLOSE_CODES.closed, 'closed');
    this.sockets.clear();
  }

  /** 部屋を作る（Worker から呼ぶ）。すでに使われているコードなら null。 */
  async create(code: string): Promise<string | null> {
    if (this.core) return null;
    const { core, key, effects } = RoomCore.create(code, Date.now(), this.deps);
    this.core = core;
    await this.apply(effects);
    return key;
  }

  status(): RoomStatus {
    if (this.core) return this.core.status(Date.now());
    return { exists: false, locked: false, players: 0, max: readSettings(this.env).maxPlayers };
  }

  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return new Response('expected websocket', { status: 426 });
    if (!this.core) {
      // 存在しない部屋への接続は、コードの総当たりの手がかりになるので、存在確認と同じ枠で数える。
      const limiter = this.env.LIMITER.get(this.env.LIMITER.idFromName('global'));
      const verdict = await limiter.take('lookup', request.headers.get('CF-Connecting-IP') ?? '');
      if (!verdict.ok) return refused(verdict);
      return rejectSocket('no-room');
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const conn = crypto.randomUUID();
    this.track(conn, server);
    await this.run({ type: 'open', conn, now: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.connId(ws);
    if (!this.core || conn === undefined) return safeClose(ws, CLOSE_CODES.closed, 'closed');
    const now = Date.now();
    if (typeof message === 'string') await this.run({ type: 'frame', conn, raw: message, bytes: utf8Length(message), now });
    else await this.run({ type: 'frame', conn, raw: '', bytes: message.byteLength, binary: true, now });
  }

  override async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.gone(ws);
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.gone(ws);
  }

  override async alarm(): Promise<void> {
    if (!this.core) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.run({ type: 'tick', now: Date.now() });
  }

  // ---- 中身 ----

  private track(conn: ConnId, ws: WebSocket): void {
    this.sockets.set(conn, ws);
    this.connOf.set(ws, conn);
  }

  private connId(ws: WebSocket): ConnId | undefined {
    const known = this.connOf.get(ws);
    if (known !== undefined) return known;
    const a = ws.deserializeAttachment() as StoredAttachment | null;
    return a && typeof a.c === 'string' ? a.c : undefined;
  }

  private async gone(ws: WebSocket): Promise<void> {
    const conn = this.connId(ws);
    // 相手から閉じたときは、こちらも閉じて握手を終える（すでに閉じていれば何もしない）。
    safeClose(ws, 1000, 'bye');
    if (conn === undefined) return;
    this.sockets.delete(conn);
    this.written.delete(conn);
    if (this.core) await this.run({ type: 'close', conn, now: Date.now() });
  }

  private async run(ev: RoomEvent): Promise<void> {
    const core = this.core;
    if (!core) return;
    const effects = core.handle(ev);
    if (ev.type === 'open' || ev.type === 'frame') this.writeAttachment(ev.conn);
    await this.apply(effects);
  }

  private writeAttachment(conn: ConnId): void {
    const ws = this.sockets.get(conn);
    const att = this.core?.attachment(conn);
    if (!ws || !att) return;
    const text = JSON.stringify(att);
    if (this.written.get(conn) === text) return;
    ws.serializeAttachment({ c: conn, ...att } satisfies StoredAttachment);
    this.written.set(conn, text);
  }

  private async apply(effects: Effect[]): Promise<void> {
    for (const e of effects) {
      switch (e.type) {
        case 'send': {
          const ws = this.sockets.get(e.conn);
          if (!ws) break;
          try {
            ws.send(JSON.stringify(e.frame));
          } catch {
            // 相手が先に切れた。閉じる知らせは別に届く。
          }
          break;
        }
        case 'close': {
          const ws = this.sockets.get(e.conn);
          if (ws) safeClose(ws, e.code, e.reason);
          this.sockets.delete(e.conn);
          this.written.delete(e.conn);
          break;
        }
        case 'persist':
          await this.ctx.storage.put(STATE_KEY, e.state);
          break;
        case 'alarm':
          if (e.at === null) await this.ctx.storage.deleteAlarm();
          else await this.ctx.storage.setAlarm(e.at);
          break;
        case 'destroy':
          this.core = null;
          await this.ctx.storage.deleteAlarm();
          await this.ctx.storage.deleteAll();
          break;
      }
    }
  }
}
