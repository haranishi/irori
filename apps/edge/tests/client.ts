// 試験用の小さな受け手。届いたフレームを貯め、条件に合うものを「届いたとき」に返す（時間を決め打ちで待たない）。
// 接続元のIPは CF-Connecting-IP で試験ごとに変える。回数の栓が、ほかの試験と混ざらないようにするため。

import { randomInt } from 'node:crypto';
import { request } from 'node:http';
import { inject } from 'vitest';

export type Json = Record<string, unknown>;

export const edge = () => inject('edge');

export function freshIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** Node の WebSocket（undici）は、2つめの引数で見出しを付けられる。DOM の型には無いので、ここで形を決める。 */
const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

export function openSocket(url: string, ip: string): WebSocket {
  return new NodeWebSocket(url, { headers: { 'CF-Connecting-IP': ip } });
}

export function wsUrl(base: string, code: string): string {
  return `${base.replace(/^http/, 'ws')}/api/rooms/${code}/ws`;
}

export class Peer {
  readonly frames: Json[] = [];
  readonly raw: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.onmessage = (e) => {
      const text = String(e.data);
      this.raw.push(text);
      try {
        this.frames.push(JSON.parse(text) as Json);
      } catch {
        this.frames.push({ unparsed: text });
      }
      this.wake();
    };
    ws.onclose = (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake();
    };
  }

  static open(url: string, ip = freshIp()): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const ws = openSocket(url, ip);
      const peer = new Peer(ws);
      ws.onopen = () => resolve(peer);
      ws.onerror = () => reject(new Error(`WebSocket に接続できません: ${url}`));
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  private until<T>(check: () => T | undefined, what: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} を待ったが来ない。届いたもの=${JSON.stringify(this.frames)} 閉じた=${JSON.stringify(this.closed)}`)), timeoutMs);
      const attempt = () => {
        const v = check();
        if (v !== undefined) {
          clearTimeout(timer);
          resolve(v);
        } else this.waiters.push(attempt);
      };
      attempt();
    });
  }

  send(frame: Json | string): void {
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  /** 条件に合う最初のフレームを取り出す（取り出したものは frames から消える）。 */
  take(match: Json | ((f: Json) => boolean), timeoutMs = 10_000): Promise<Json> {
    const ok = typeof match === 'function' ? match : (f: Json) => Object.entries(match).every(([k, v]) => JSON.stringify(f[k]) === JSON.stringify(v));
    return this.until(
      () => {
        const i = this.frames.findIndex(ok);
        return i < 0 ? undefined : this.frames.splice(i, 1)[0];
      },
      `フレーム ${typeof match === 'function' ? '(条件)' : JSON.stringify(match)}`,
      timeoutMs,
    );
  }

  waitClose(timeoutMs = 10_000): Promise<{ code: number; reason: string }> {
    return this.until(() => this.closed ?? undefined, '切断', timeoutMs);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // すでに閉じている
    }
  }
}

export interface Created {
  code: string;
  key: string;
  ttl: number;
}

export async function createRoom(base: string, ip = freshIp()): Promise<Created> {
  const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
  if (r.status !== 201) throw new Error(`部屋を作れない: ${r.status} ${await r.text()}`);
  return (await r.json()) as Created;
}

export async function status(base: string, code: string, ip = freshIp()): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${base}/api/rooms/${code}`, { headers: { 'CF-Connecting-IP': ip } });
  return { status: r.status, body: (await r.json()) as Json };
}

export async function host(base: string, room: Created): Promise<Peer> {
  const p = await Peer.open(wsUrl(base, room.code));
  p.send({ t: 'hello', v: 1, role: 'host', key: room.key });
  await p.take({ t: 'welcome' });
  return p;
}

/**
 * 区切り。部屋はフレームを届いた順に処理するので、わざと不正なフレームを送り、その誤りが返ってきたら、
 * それより前に送ったフレームは処理済みとわかる（HTTP の照会は別の道で届くので、順序がそろわない）。
 */
export async function barrier(peer: Peer): Promise<void> {
  peer.send({ t: 'barrier' });
  await peer.take({ t: 'err', code: 'bad-frame' });
}

export async function pad(base: string, code: string, hello: Json = {}, ip = freshIp()): Promise<{ peer: Peer; welcome: Json }> {
  const peer = await Peer.open(wsUrl(base, code), ip);
  peer.send({ t: 'hello', v: 1, role: 'pad', ...hello });
  const welcome = await peer.take((f) => f.t === 'welcome' || f.t === 'err');
  return { peer, welcome };
}

/** WebSocket の握手だけを送り、HTTP の状態コードを返す（101 なら受け入れ、429・403 なら栓）。 */
export function upgradeStatus(base: string, code: string, ip: string, extra: Record<string, string> = {}): Promise<number> {
  const url = new URL(`/api/rooms/${code}/ws`, base);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from('irori-test-key-0').toString('base64'),
        'CF-Connecting-IP': ip,
        ...extra,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/** 1分ごとの区切りの直前なら、次の分まで待つ（区切りをまたぐと数が戻り、上限の試験が揺れるため）。 */
export async function awayFromMinuteEdge(): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 15_000) await new Promise((r) => setTimeout(r, left + 200));
}
