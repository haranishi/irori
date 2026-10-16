// 単体試験の小さな作り物：部屋の WebSocket（RoomSocket と同じ形）と、POST /api/rooms。
// 実物との結合（本物の Worker）は *.e2e.ts で確かめる。ここでは、画面の側の決まり（入り直さない・probe を呼ぶ）を見る。
import type { PlayerInfo, ToHostFrame } from '@irori/protocol';
import type { RoomSocketError, SocketState } from '@irori/room-client';
import type { HostSocket } from '../../src/host/session';

type Ev = 'frame' | 'state' | 'error';

export class FakeSocket {
  state: SocketState = 'closed';
  connects = 0;
  reconnects = 0;
  probes = 0;
  closes = 0;
  readonly sent: unknown[] = [];
  private readonly ls: Record<Ev, Set<(v: never) => void>> = { frame: new Set(), state: new Set(), error: new Set() };

  constructor(
    readonly url: string,
    readonly key: () => string,
  ) {}

  on(ev: Ev, fn: (v: never) => void): () => void {
    this.ls[ev].add(fn);
    return () => this.ls[ev].delete(fn);
  }

  connect(): void {
    this.connects++;
    this.setState('connecting');
  }

  /** 本物（RoomSocket）と同じく、つないでいる最中とつながっているときは何もしない。数えるのは効いた呼び出しだけ。 */
  reconnect(): void {
    if (this.state === 'open' || this.state === 'connecting') return;
    this.reconnects++;
    this.setState('connecting');
  }

  probe(): void {
    this.probes++;
  }

  send(frame: unknown): boolean {
    if (this.state !== 'open') return false;
    this.sent.push(frame);
    return true;
  }

  close(): void {
    this.closes++;
    this.setState('closed');
  }

  // ---- 試験から動かす ----

  welcome(code: string, players: PlayerInfo[] = [], locked = false): void {
    this.setState('open');
    this.frame({ t: 'welcome', role: 'host', code, players, max: 8, locked });
  }

  frame(f: ToHostFrame): void {
    for (const fn of [...this.ls.frame]) (fn as (f: ToHostFrame) => void)(f);
  }

  fail(code: RoomSocketError['code'], fatal = true): void {
    for (const fn of [...this.ls.error]) (fn as (e: RoomSocketError) => void)({ code, fatal });
    if (code === 'replaced') this.setState('replaced');
    else if (fatal) this.setState('closed');
    else this.setState('reconnecting');
  }

  setState(s: SocketState): void {
    if (this.state === s) return;
    this.state = s;
    for (const fn of [...this.ls.state]) (fn as (s: SocketState) => void)(s);
  }
}

export class SocketFactory {
  readonly made: FakeSocket[] = [];
  readonly make = (url: string, key: () => string): HostSocket => {
    const s = new FakeSocket(url, key);
    this.made.push(s);
    return s as unknown as HostSocket;
  };

  get last(): FakeSocket {
    const s = this.made.at(-1);
    if (!s) throw new Error('まだ接続を作っていない');
    return s;
  }
}

/** POST /api/rooms の作り物。応答を順に返し、呼ばれた回数を数える。 */
export function roomsApi(...responses: Array<() => Response>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    const r = responses[Math.min(i++, responses.length - 1)];
    if (!r) throw new TypeError('network');
    return r();
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export const created = (code: string, key = `key-${code}`) => () => new Response(JSON.stringify({ code, key, ttl: 60 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
export const busy = (status: 503 | 429, retryAfterSec: number) => () => new Response(JSON.stringify({ error: status === 503 ? 'busy' : 'rate', retryAfterSec }), { status });
export const offline = () => {
  throw new TypeError('Failed to fetch');
};

export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** visibilityState を動かせる document の代わり。 */
export class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  show(): void {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }

  hide(): void {
    this.visibilityState = 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/** 画面の文言を日本語にそろえる（happy-dom の navigator.language は英語）。 */
export function useJapanese(): void {
  Object.defineProperty(window.navigator, 'language', { configurable: true, get: () => 'ja-JP' });
}
