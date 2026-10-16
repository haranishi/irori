// スマホの画面の単体試験（happy-dom）の道具：時計・偽の WebSocket・保存・存在確認の応答を差し替えて、
// 実時間を待たずに PadApp を動かす。サーバーの側の操作は FakeWS のメソッドで行う。
import { CLOSE_CODES, type PadSpec, type ToPadFrame } from '@irori/protocol';
import type { Clock, WebSocketLike } from '@irori/room-client';
import { PadApp, type PadDeps } from '../../src/pad/app';
import { registerPadMessages } from '../../src/pad/messages';
import type { KeyValue } from '../../src/pad/room';

export class FakeClock implements Clock {
  t = 1_000;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  /** 時計を進め、途中のタイマーを時刻の順に動かす。 */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= target && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = target;
  }
}

export class FakeWS implements WebSocketLike {
  static all: FakeWS[] = [];
  readonly sent: string[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }
  // ---- サーバーの側 ----
  accept(): void {
    this.onopen?.({});
  }
  message(frame: ToPadFrame | string): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  drop(code: number, reason = ''): void {
    this.onerror?.({});
    this.onclose?.({ code, reason });
  }
  get frames(): Record<string, unknown>[] {
    return this.sent.filter((s) => s.startsWith('{"t"')).map((s) => JSON.parse(s) as Record<string, unknown>);
  }
  get hello(): Record<string, unknown> | undefined {
    return this.frames.find((f) => f.t === 'hello');
  }
  /** つないで welcome を返す（席 id）。 */
  welcome(id: number, name: string, resume = 'TOKEN-1', host = true): void {
    this.accept();
    this.message({ t: 'welcome', role: 'pad', you: { id, name, online: true }, resume, host });
  }
  pad(spec: PadSpec): void {
    this.message({ t: 'pad', spec });
  }
}

export const lastWS = (): FakeWS => {
  const ws = FakeWS.all.at(-1);
  if (!ws) throw new Error('WebSocket がまだ作られていない');
  return ws;
};

export function memoryStorage(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

export interface Lookup {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Harness {
  app: PadApp;
  root: HTMLElement;
  clock: FakeClock;
  session: ReturnType<typeof memoryStorage>;
  local: ReturnType<typeof memoryStorage>;
  lookups: string[];
  vibrations: number[][];
  wakeRequests: () => number;
  /** 存在確認の応答（既定は「部屋があり、空きがある」）。 */
  respond: (r: Lookup | 'network') => void;
  q: <T extends Element = HTMLElement>(sel: string) => T | null;
  screen: () => string | undefined;
  state: () => string | undefined;
  click: (sel: string) => void;
}

export const OPEN_ROOM: Lookup = { status: 200, body: { exists: true, locked: false, players: 1, max: 8 } };

/** 存在確認の fetch と応答の読み取り（Promise の連鎖）を流し切る。実時間は待たない（0ms のタスクを数回回すだけ）。 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

let current: PadApp | null = null;

export function startApp(opts: { hash?: string; session?: ReturnType<typeof memoryStorage>; local?: ReturnType<typeof memoryStorage>; noStorage?: boolean } = {}): Harness {
  registerPadMessages();
  // 前の試験の画面は止める（window のイベントを聞いたまま残ると、次の試験の URL に反応してしまう）。
  current?.stop();
  current = null;
  FakeWS.all = [];
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  // happy-dom の言語は英語なので、試験は ?lang=ja で日本語の文言にそろえる。
  history.replaceState(null, '', `/pad?lang=ja${opts.hash ? `#${opts.hash}` : ''}`);
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const clock = new FakeClock();
  const session = opts.session ?? memoryStorage();
  const local = opts.local ?? memoryStorage();
  const lookups: string[] = [];
  const vibrations: number[][] = [];
  let reply: Lookup | 'network' = OPEN_ROOM;
  let wake = 0;
  const deps: PadDeps = {
    win: window,
    doc: document,
    fetch: (async (url: string) => {
      lookups.push(String(url));
      if (reply === 'network') throw new TypeError('network');
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json', ...reply.headers } });
    }) as unknown as typeof fetch,
    clock,
    session: opts.noStorage ? null : session,
    local: opts.noStorage ? null : local,
    WebSocket: FakeWS,
    vibrate: (p) => {
      vibrations.push(p);
      return true;
    },
    wakeLock: {
      request: async () => {
        wake++;
        const s = new EventTarget() as EventTarget & { released: boolean; release(): Promise<void> };
        s.released = false;
        s.release = async () => {
          s.released = true;
        };
        return s;
      },
    },
    socket: { backoffMinMs: 500, backoffMaxMs: 8_000 },
  };
  const app = new PadApp(root, deps);
  current = app;
  app.start();
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  return {
    app,
    root,
    clock,
    session,
    local,
    lookups,
    vibrations,
    wakeRequests: () => wake,
    respond: (r) => {
      reply = r;
    },
    q,
    screen: () => q('[data-screen]')?.getAttribute('data-screen') ?? undefined,
    state: () => q('[data-state]')?.getAttribute('data-state') ?? undefined,
    click: (sel) => {
      const el = q<HTMLElement>(sel);
      if (!el) throw new Error(`見つからない: ${sel}`);
      // 指のタップと同じく detail=1 の click を出す（キーボードの決定は detail=0）。
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    },
  };
}

/** QR のURLで開いて「参加する」を押し、welcome まで進める。 */
export async function joined(h: Harness, id = 1, name = 'プレイヤー1', resume = 'TOKEN-1'): Promise<FakeWS> {
  await settle();
  h.click('[data-act="join"]');
  const ws = lastWS();
  ws.welcome(id, name, resume);
  return ws;
}

export function pointer(el: Element, type: string, init: PointerEventInit = {}): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'touch', ...init }));
}

/** 画面ロックから戻ったことにする。 */
export function comeBack(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
}

export { CLOSE_CODES };
