// ゲームの隔離枠（ADR 0001）。握手だけ window.postMessage で受け、そのあとは渡した MessagePort の上で話す。
// 握手は、送り主が自分の枠（event.source）で、オリジンも期待どおりのときだけ受ける。ほかの窓や枠からの握手は無視する。
import { BRIDGE_VERSION } from '@irori/protocol';
import type { BridgePort, GameEndOptions, GamePadSpec, GameResult, HostEnvironment, HostToGame, PlayerId, PlayerInfo } from '@irori/protocol';
import type { FrameSource } from './entry';
import type { GameStorage } from './storage';
import { validateGameToHost } from './validate';
import { isPlainObject, unknownKey } from './text';

export const HANDSHAKE_TIMEOUT_MS = 3_000;
/** 外部のゲームは遠いサーバーから読むので、握手まで長めに待つ。登録の検査（10秒）より短くしない。 */
export const EXTERNAL_HANDSHAKE_TIMEOUT_MS = 10_000;
export const READY_TIMEOUT_MS = 10_000;

/** 枠を開いてから握手が届くまでの、既定の待ち時間。 */
export function handshakeTimeoutFor(kind: FrameSource['kind']): number {
  return kind === 'external' ? EXTERNAL_HANDSHAKE_TIMEOUT_MS : HANDSHAKE_TIMEOUT_MS;
}
export const MAX_MESSAGES_PER_SEC = 100;

export interface GameFrameInit {
  players: PlayerInfo[];
  leader: PlayerId | null;
  locale: string;
  paused?: boolean;
  environment?: HostEnvironment;
}

export interface GameFrameOptions {
  container: HTMLElement;
  /** resolveEntry が返した frame。 */
  source: FrameSource;
  init: GameFrameInit;
  /** 渡せば、store.get / store.set にここで答える。無ければ「使えない」と答える。 */
  storage?: GameStorage;
  /** 枠の title（読み上げ用）。 */
  title?: string;
  handshakeTimeoutMs?: number;
  readyTimeoutMs?: number;
  maxMessagesPerSec?: number;
}

export type FrameState = 'idle' | 'loading' | 'connected' | 'ready' | 'ended' | 'stopped';

export interface StoreRequest {
  m: 'store.get' | 'store.set';
  id: number;
  key: string;
  value?: string;
}

export interface GameFrameEvents {
  ready: () => void;
  setPad: (e: { to: PlayerId | '*'; spec: GamePadSpec }) => void;
  vibrate: (e: { to: PlayerId | '*'; ms: number[] }) => void;
  end: (e: { results: GameResult[]; options?: GameEndOptions }) => void;
  store: (e: StoreRequest) => void;
  /** 握手のあと、決めた時間内に ready が来なかった。枠は止めない（中断を勧めるかはコンソールが決める）。 */
  timeout: () => void;
  /** 枠を止めた。handshake＝握手が来なかった、rate＝メッセージが多すぎた。 */
  error: (e: { reason: 'handshake' | 'rate' }) => void;
}

/** ホストからゲームへ送れるもの。init は握手のときに枠が自分で送る。 */
export type HostMessage = Exclude<HostToGame, { m: 'init' }>;

type Listener = (...args: never[]) => void;

function environment(v: unknown): HostEnvironment | null {
  if (!isPlainObject(v) || unknownKey(v, ['connected', 'visible']) || typeof v.connected !== 'boolean' || typeof v.visible !== 'boolean') return null;
  return { connected: v.connected, visible: v.visible };
}

export class GameFrame {
  private iframe: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private current: FrameState = 'idle';
  private droppedCount = 0;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  /** 直近に受けたメッセージの時刻（流量の検査）。 */
  private readonly stamps: number[] = [];
  private readonly listeners = new Map<keyof GameFrameEvents, Set<Listener>>();
  private readonly init: Extract<HostToGame, { m: 'init' }>;

  constructor(private readonly opts: GameFrameOptions) {
    this.init = { m: 'init', sdk: BRIDGE_VERSION, players: [...opts.init.players], leader: opts.init.leader, locale: opts.init.locale, paused: opts.init.paused === true,
      capabilities: ['result-options-v1', 'host-environment-v1', 'pad-tiles-v1'] };
    const env = environment(opts.init.environment);
    if (env) this.init.environment = env;
  }

  get state(): FrameState {
    return this.current;
  }

  get element(): HTMLIFrameElement | null {
    return this.iframe;
  }

  /** 検証を通らずに捨てたメッセージの数。 */
  get dropped(): number {
    return this.droppedCount;
  }

  on<K extends keyof GameFrameEvents>(name: K, fn: GameFrameEvents[K]): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as Listener);
    return () => set.delete(fn as Listener);
  }

  start(): void {
    if (this.current !== 'idle') return;
    const s = this.opts.source;
    this.current = 'loading';
    window.addEventListener('message', this.onWindowMessage);
    const f = document.createElement('iframe');
    // sandbox は読み込みの前に付ける。あとから付けても、最初の文書には効かない。
    f.setAttribute('sandbox', s.sandbox);
    f.setAttribute('allow', s.allow);
    f.setAttribute('referrerpolicy', s.referrerPolicy);
    f.setAttribute('loading', s.loading);
    if (this.opts.title) f.title = this.opts.title;
    f.src = s.src;
    this.iframe = f;
    this.handshakeTimer = setTimeout(() => this.stop('handshake'), this.opts.handshakeTimeoutMs ?? handshakeTimeoutFor(s.kind));
    this.opts.container.append(f);
  }

  post(msg: HostMessage): void {
    if (this.current === 'stopped') return;
    if (msg.m === 'environment') {
      const env = environment(msg.environment);
      if (!env || unknownKey(msg, ['m', 'environment'])) return;
      msg = { m: 'environment', environment: env };
    }
    if (!this.port) {
      // 握手の前は、最初に渡す init の中身を更新する。入力などは受け手がいないので捨てる。
      if (msg.m === 'players') {
        this.init.players = [...msg.players];
        this.init.leader = msg.leader;
      } else if (msg.m === 'pause' || msg.m === 'resume') {
        this.init.paused = msg.m === 'pause';
      } else if (msg.m === 'environment') {
        this.init.environment = msg.environment;
      }
      return;
    }
    this.port.postMessage(msg);
  }

  destroy(): void {
    if (this.current !== 'stopped') this.teardown();
  }

  private readonly onWindowMessage = (ev: MessageEvent): void => {
    const win = this.iframe?.contentWindow;
    if (!win || ev.source !== win) return;
    if (this.flooded()) return;
    if (ev.origin !== this.opts.source.origin || this.port || this.current !== 'loading') return;
    const d = ev.data as { irori?: unknown; v?: unknown } | null;
    if (typeof d !== 'object' || d === null || d.irori !== 'hello' || d.v !== BRIDGE_VERSION) return;
    this.connect(win);
  };

  private connect(win: Window): void {
    clearTimeout(this.handshakeTimer);
    const ch = new MessageChannel();
    this.port = ch.port1;
    this.port.onmessage = (e) => this.onPortMessage(e.data);
    const hello: BridgePort = { irori: 'port', v: BRIDGE_VERSION };
    // 同梱のゲームはオリジンが空なので '*' でしか届かない。外部のゲームには、そのオリジンだけを宛先にする。
    win.postMessage(hello, this.opts.source.kind === 'bundled' ? '*' : this.opts.source.origin, [ch.port2]);
    this.current = 'connected';
    this.port.postMessage(this.init);
    this.readyTimer = setTimeout(() => {
      if (this.current === 'connected') this.emit('timeout');
    }, this.opts.readyTimeoutMs ?? READY_TIMEOUT_MS);
  }

  private onPortMessage(data: unknown): void {
    if (this.current === 'stopped' || this.flooded()) return;
    const r = validateGameToHost(data);
    if (!r.ok) {
      this.droppedCount++;
      return;
    }
    const m = r.msg;
    const ended = this.current === 'ended';
    switch (m.m) {
      case 'ready':
        if (this.current !== 'connected') return;
        this.current = 'ready';
        clearTimeout(this.readyTimer);
        this.emit('ready');
        return;
      case 'setPad':
        if (!ended) this.emit('setPad', { to: m.to, spec: m.spec });
        return;
      case 'vibrate':
        if (!ended) this.emit('vibrate', { to: m.to, ms: m.ms });
        return;
      case 'end':
        // 終わったあとの画面の指定は、コンソールのリモコンを上書きしないよう受けない。
        if (ended) return;
        this.current = 'ended';
        clearTimeout(this.readyTimer);
        this.emit('end', m.options === undefined ? { results: m.results ?? [] } : { results: m.results ?? [], options: m.options });
        return;
      case 'store.get':
      case 'store.set':
        this.answerStore(m.m === 'store.set' ? { m: m.m, id: m.id, key: m.key, value: m.value } : { m: m.m, id: m.id, key: m.key });
        return;
    }
  }

  private answerStore(req: StoreRequest): void {
    const s = this.opts.storage;
    let res: HostToGame;
    if (!s) {
      res = { m: 'store.res', id: req.id, value: null, error: 'unavailable' };
    } else {
      const r = req.m === 'store.get' ? s.get(req.key) : s.set(req.key, req.value ?? '');
      res = r.ok ? { m: 'store.res', id: req.id, value: r.value } : { m: 'store.res', id: req.id, value: null, error: r.error };
    }
    this.port?.postMessage(res);
    this.emit('store', req);
  }

  /** 1秒あたりの上限を超えたら、枠を止めて true。 */
  private flooded(): boolean {
    const now = performance.now();
    this.stamps.push(now);
    if (this.stamps.length > (this.opts.maxMessagesPerSec ?? MAX_MESSAGES_PER_SEC)) {
      const oldest = this.stamps.shift() as number;
      if (now - oldest < 1000) {
        this.stop('rate');
        return true;
      }
    }
    return false;
  }

  private stop(reason: 'handshake' | 'rate'): void {
    if (this.current === 'stopped') return;
    this.teardown();
    this.emit('error', { reason });
  }

  private teardown(): void {
    this.current = 'stopped';
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.readyTimer);
    window.removeEventListener('message', this.onWindowMessage);
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = null;
    }
    this.iframe?.remove();
    this.iframe = null;
  }

  private emit<K extends keyof GameFrameEvents>(name: K, ...args: Parameters<GameFrameEvents[K]>): void {
    for (const fn of [...(this.listeners.get(name) ?? [])]) {
      try {
        (fn as (...a: Parameters<GameFrameEvents[K]>) => void)(...args);
      } catch (err) {
        // 受け手の失敗で、枠の処理を止めない。エラーは報告だけする。
        if (typeof reportError === 'function') reportError(err);
        else console.error(err);
      }
    }
  }
}
