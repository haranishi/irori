// 再接続つきの WebSocket クライアント。ブラウザと Node（グローバルの WebSocket）の両方で動く。
// iOS の Safari は画面ロックやタブの切替で黙って切るので、切断と入り直しは例外ではなく通常の経路として扱う。
// 時計・タイマー・乱数・WebSocket は差し替えられる（試験で実時間を待たないため）。

import {
  CLOSE_CODES,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  PROTOCOL_VERSION,
  parseToHostFrame,
  parseToPadFrame,
  type ErrorCode,
  type HostFrame,
  type PadFrame,
  type ParseResult,
  type ToHostFrame,
  type ToPadFrame,
} from '@irori/protocol';

/**
 * replaced：同じ札や鍵を持つ別の接続に、席や役割を取られた（4009）。自動では入り直さない。
 * 画面が「こちらで続ける」を出し、押されたら reconnect() を呼ぶ。
 */
export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'replaced' | 'closed';
export type Role = 'host' | 'pad';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** ブラウザの WebSocket と同じ形のうち、使うところだけ。 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface RoomSocketError {
  /** サーバーが閉じたときの理由。network は理由の分からない切断、protocol は読めないフレーム。 */
  code: ErrorCode | 'network' | 'protocol';
  closeCode?: number;
  reason?: string;
  /** true なら、もう自動では入り直さない（replaced のときは reconnect() で入り直せる）。 */
  fatal: boolean;
}

interface RoleTypes {
  host: { incoming: ToHostFrame; outgoing: Exclude<HostFrame, { t: 'hello' }>; hello: { key: () => string } };
  pad: {
    incoming: ToPadFrame;
    outgoing: Exclude<PadFrame, { t: 'hello' }>;
    hello: { name?: () => string | undefined; resume?: () => string | undefined };
  };
}

export type RoomSocketOptions<R extends Role> = {
  role: R;
  /** 接続先。入り直すたびに呼ぶので、関数でもよい。 */
  url: string | (() => string);
  WebSocket?: WebSocketConstructor;
  clock?: Clock;
  /** ゆらぎに使う 0〜1 の乱数。 */
  random?: () => number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
} & RoleTypes[R]['hello'];

interface Events<R extends Role> {
  frame: (frame: RoleTypes[R]['incoming']) => void;
  state: (state: SocketState) => void;
  error: (error: RoomSocketError) => void;
}

const CODE_BY_CLOSE = new Map<number, ErrorCode>(Object.entries(CLOSE_CODES).map(([k, v]) => [v, k as ErrorCode]));
/** 入り直しても無駄なもの。部屋がない・外された・閉じた・鍵が違う・版が違う・満員・ロック。 */
const NO_RETRY = new Set<number>([
  CLOSE_CODES['no-room'],
  CLOSE_CODES.kicked,
  CLOSE_CODES.closed,
  CLOSE_CODES.auth,
  CLOSE_CODES.version,
  CLOSE_CODES.full,
  CLOSE_CODES.locked,
]);

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 部屋の WebSocket の URL。http(s) のオリジンから ws(s) を作る。 */
export function roomSocketUrl(origin: string, code: string): string {
  const u = new URL(`/api/rooms/${encodeURIComponent(code)}/ws`, origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

export class RoomSocket<R extends Role> {
  private readonly opts: RoomSocketOptions<R>;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly pingMs: number;
  private readonly pongMs: number;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly listeners: { [K in keyof Events<R>]: Set<Events<R>[K]> } = { frame: new Set(), state: new Set(), error: new Set() };
  private ws: WebSocketLike | null = null;
  private current: SocketState = 'closed';
  private attempt = 0;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private probeTimer: unknown = null;
  private retryTimer: unknown = null;
  private welcomed = false;
  /** bye を送った・close() を呼んだ。サーバーが閉じても入り直さない。 */
  private leaving = false;

  constructor(opts: RoomSocketOptions<R>) {
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    this.random = opts.random ?? Math.random;
    this.pingMs = opts.pingIntervalMs ?? 15_000;
    this.pongMs = opts.pongTimeoutMs ?? 30_000;
    this.minMs = opts.backoffMinMs ?? 500;
    this.maxMs = opts.backoffMaxMs ?? 8_000;
  }

  get state(): SocketState {
    return this.current;
  }

  on<K extends keyof Events<R>>(event: K, fn: Events<R>[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  /** つなぐ。すでにつないでいる・つなぎ直している最中なら何もしない。 */
  connect(): void {
    if (this.current !== 'closed') return;
    this.leaving = false;
    this.attempt = 0;
    this.setState('connecting');
    this.open();
  }

  /**
   * 人の操作で入り直す（replaced の後に「こちらで続ける」が押されたときなど）。待ち時間を最初に戻して、すぐにつなぐ。
   * 入れれば、席や役割を持っていた別の接続のほうが 4009 で閉じられる。つないでいる最中なら何もしない。
   */
  reconnect(): void {
    if (this.current === 'open' || this.current === 'connecting') return;
    this.leaving = false;
    this.attempt = 0;
    // 入り直しの最中（つなぎかけの接続がある）なら、待ち時間を戻すだけでよい。
    if (this.current === 'reconnecting' && this.ws) return;
    this.clearTimers();
    this.setState('connecting');
    this.open();
  }

  /** つながっていて welcome を受けたあとだけ送る。それ以外は捨てて false（古い入力を後から届けないため）。 */
  send(frame: RoleTypes[R]['outgoing']): boolean {
    if (this.current !== 'open' || !this.ws) return false;
    if (frame.t === 'bye') this.leaving = true;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  /**
   * いまの接続が生きているかを、すぐに確かめる。画面に戻ったとき（visibilitychange・pageshow・online）に呼ぶ。
   * iPhone は画面ロックのあと接続が黙って死んでいて、pong の期限（30秒）を待つと、その間タップが届かない。
   * open のときだけ ping を1回送り、timeoutMs 以内に pong が来なければ、待たずに捨てて入り直す。
   * open 以外のとき・確かめている最中は何もしない。
   */
  probe(timeoutMs = 3_000): void {
    if (this.current !== 'open' || !this.ws || this.probeTimer !== null) return;
    this.ws.send(HEARTBEAT_PING);
    this.probeTimer = this.clock.setTimeout(() => {
      this.probeTimer = null;
      this.dropAndRetry('probe');
    }, timeoutMs);
  }

  /** やめる。入り直さない。 */
  close(): void {
    this.leaving = true;
    this.clearTimers();
    const ws = this.ws;
    this.detach();
    if (ws) {
      try {
        ws.close(1000, 'bye');
      } catch {
        // すでに閉じている
      }
    }
    this.setState('closed');
  }

  // ---- 中身 ----

  private emit<K extends keyof Events<R>>(event: K, ...args: Parameters<Events<R>[K]>): void {
    for (const fn of [...this.listeners[event]]) (fn as (...a: Parameters<Events<R>[K]>) => void)(...args);
  }

  private setState(s: SocketState): void {
    if (this.current === s) return;
    this.current = s;
    this.emit('state', s);
  }

  private open(): void {
    const Ctor = this.opts.WebSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (!Ctor) throw new Error('RoomSocket: WebSocket がありません');
    const url = typeof this.opts.url === 'function' ? this.opts.url() : this.opts.url;
    this.welcomed = false;
    let ws: WebSocketLike;
    try {
      ws = new Ctor(url);
    } catch {
      this.scheduleRetry({ code: 'network', fatal: false });
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify(this.hello()));
      this.schedulePing();
      this.armPongDeadline();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.onMessage(ev.data);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.onClose(ev.code, ev.reason);
    };
    ws.onerror = () => {
      // 続けて onclose が来る。理由はそちらで扱う。
    };
  }

  private hello(): HostFrame | PadFrame {
    if (this.opts.role === 'host') {
      const o = this.opts as RoomSocketOptions<'host'>;
      return { t: 'hello', v: PROTOCOL_VERSION, role: 'host', key: o.key() };
    }
    const o = this.opts as RoomSocketOptions<'pad'>;
    const f: PadFrame = { t: 'hello', v: PROTOCOL_VERSION, role: 'pad' };
    const name = o.name?.();
    const resume = o.resume?.();
    if (name !== undefined) f.name = name;
    if (resume !== undefined) f.resume = resume;
    return f;
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') {
      this.emit('error', { code: 'protocol', reason: 'binary', fatal: false });
      return;
    }
    if (data === HEARTBEAT_PONG) {
      // どの ping への返事でも、生きている証拠になる。確かめている最中なら、そこで終わり。
      if (this.probeTimer !== null) {
        this.clock.clearTimeout(this.probeTimer);
        this.probeTimer = null;
      }
      this.armPongDeadline();
      return;
    }
    // 名簿の名前は、長さだけでは捨てない（中継と版が違っても、welcome を捨てて部屋に戻れなくならないように）。
    const opts = { lenientNames: true };
    const r = (this.opts.role === 'host' ? parseToHostFrame(data, opts) : parseToPadFrame(data, opts)) as ParseResult<RoleTypes[R]['incoming']>;
    if (!r.ok) {
      this.emit('error', { code: 'protocol', reason: r.reason, fatal: false });
      return;
    }
    if (r.frame.t === 'welcome') {
      this.welcomed = true;
      this.attempt = 0;
      this.setState('open');
    }
    this.emit('frame', r.frame);
  }

  private onClose(code: number, reason: string): void {
    this.clearTimers();
    this.detach();
    const known = CODE_BY_CLOSE.get(code);
    if (this.leaving) {
      this.setState('closed');
      return;
    }
    if (code === CLOSE_CODES.replaced) {
      // 4009 を受けるのは、別の生きた接続に取って代わられた側。ここで入り直すと、二重のタブが互いを追い出し続ける。
      this.emit('error', { code: 'replaced', closeCode: code, reason, fatal: true });
      this.setState('replaced');
      return;
    }
    if (NO_RETRY.has(code)) {
      this.emit('error', { code: known ?? 'network', closeCode: code, reason, fatal: true });
      this.setState('closed');
      return;
    }
    this.scheduleRetry({ code: known ?? 'network', closeCode: code, reason, fatal: false });
  }

  private scheduleRetry(error: RoomSocketError): void {
    this.emit('error', error);
    this.setState('reconnecting');
    const base = Math.min(this.maxMs, this.minMs * 2 ** this.attempt);
    // ゆらぎを付けて、サーバーの再起動のあとに全員が同じ瞬間に戻ってこないようにする。
    const delay = Math.min(this.maxMs, Math.max(this.minMs, base * (0.8 + 0.4 * this.random())));
    this.attempt++;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (this.current === 'reconnecting') this.open();
    }, delay);
  }

  private schedulePing(): void {
    this.pingTimer = this.clock.setTimeout(() => {
      this.pingTimer = null;
      if (!this.ws) return;
      this.ws.send(HEARTBEAT_PING);
      this.schedulePing();
    }, this.pingMs);
  }

  /** 最後の pong（またはつながった時）から pongMs のあいだ pong が来なければ、切って入り直す。 */
  private armPongDeadline(): void {
    if (this.pongTimer !== null) this.clock.clearTimeout(this.pongTimer);
    this.pongTimer = this.clock.setTimeout(() => {
      this.pongTimer = null;
      this.dropAndRetry('timeout');
    }, this.pongMs);
  }

  /** 返事のない接続は、閉じる知らせも届かないことが多い。待たずに捨てて、いつもの待ち時間で入り直す。 */
  private dropAndRetry(reason: 'timeout' | 'probe'): void {
    const ws = this.ws;
    if (!ws) return;
    this.clearTimers();
    this.detach();
    try {
      ws.close(1000, reason);
    } catch {
      // すでに閉じている
    }
    this.scheduleRetry({ code: 'timeout', reason, fatal: false });
  }

  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  private clearTimers(): void {
    for (const t of [this.pingTimer, this.pongTimer, this.probeTimer, this.retryTimer]) if (t !== null) this.clock.clearTimeout(t);
    this.pingTimer = null;
    this.pongTimer = null;
    this.probeTimer = null;
    this.retryTimer = null;
  }

  /** 試験と表示用：welcome を受けたか。 */
  get established(): boolean {
    return this.welcomed;
  }
}
