// ゲームから見た irori。送り先（本物のコンソールか、仮想プレイヤー）は Transport で差し替える。
import { LIMITS } from '@irori/protocol';
import type { GamePadSpec, GameResult, GameToHost, PlayerId, PlayerInfo } from '@irori/protocol';
import { look } from '@irori/pad-ui';
import type { Look } from '@irori/pad-ui';
import { checkPadSpec, checkResults, checkVibrate, isPlainObject, isSeat, isStoreKey, isStoreValue } from './checks';
import { IroriError } from './errors';
import type { IroriErrorCode } from './errors';
import type { GameInput, Irori, IroriEvents, IroriStorage, Target } from './types';

export interface Transport {
  send(msg: GameToHost): void;
}

export interface CoreInit {
  players: readonly PlayerInfo[];
  leader: PlayerId | null;
  paused: boolean;
  locale: string;
}

/** 保存の応答を待つ時間。ホストが答えないときに、約束を宙に浮かせない。 */
export const STORAGE_TIMEOUT_MS = 5_000;

type Listener = (...args: never[]) => void;
type Waiter = { resolve: (v: string | null) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

function report(err: unknown): void {
  if (typeof reportError === 'function') reportError(err);
  else console.error(err);
}

function freezePlayers(list: unknown): readonly PlayerInfo[] {
  const out: PlayerInfo[] = [];
  for (const p of Array.isArray(list) ? (list as unknown[]) : []) {
    if (isPlainObject(p) && isSeat(p.id) && typeof p.name === 'string') out.push(Object.freeze({ id: p.id, name: p.name, online: p.online !== false }));
  }
  return Object.freeze(out.slice(0, LIMITS.MAX_PLAYERS));
}

export class IroriCore implements Irori {
  readonly storage: IroriStorage;
  private list: readonly PlayerInfo[];
  private leaderId: PlayerId | null;
  private isPaused: boolean;
  private readied = false;
  private ended = false;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiter>();
  private readonly listeners = new Map<keyof IroriEvents, Set<Listener>>();

  constructor(
    readonly mode: 'host' | 'mock',
    init: CoreInit,
    private readonly t: Transport,
    readonly locale: string = init.locale,
  ) {
    this.list = freezePlayers(init.players);
    this.leaderId = init.leader;
    this.isPaused = init.paused;
    this.storage = {
      get: (key) => this.request('get', key),
      set: (key, value) => this.request('set', key, value).then(() => undefined),
    };
  }

  get players(): readonly PlayerInfo[] {
    return this.list;
  }

  get leader(): PlayerId | null {
    return this.leaderId;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  on<K extends keyof IroriEvents>(name: K, fn: IroriEvents[K]): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as Listener);
    return () => {
      set.delete(fn as Listener);
    };
  }

  setPad(spec: GamePadSpec, to: Target = 'all'): void {
    const dest = this.target(to);
    const bad = checkPadSpec(spec);
    if (bad) throw new IroriError('bad-pad', bad);
    this.t.send({ m: 'setPad', to: dest, spec });
  }

  vibrate(ms: number | readonly number[], to: Target = 'all'): void {
    const dest = this.target(to);
    const list = checkVibrate(ms);
    if (typeof list === 'string') throw new IroriError('bad-vibrate', list);
    this.t.send({ m: 'vibrate', to: dest, ms: list });
  }

  look(id: PlayerId): Look {
    return look(id, this.locale.toLowerCase().startsWith('ja') ? 'ja' : 'en');
  }

  ready(): void {
    if (this.readied) return;
    this.readied = true;
    this.t.send({ m: 'ready' });
  }

  end(results?: readonly GameResult[]): void {
    if (this.ended) return;
    let list: GameResult[] | undefined;
    if (results !== undefined) {
      const r = checkResults(results);
      if (typeof r === 'string') throw new IroriError('bad-results', r);
      list = r;
    }
    this.ended = true;
    this.t.send(list ? { m: 'end', results: list } : { m: 'end' });
  }

  /** ホスト（または仮想プレイヤー）からのメッセージ。 */
  receive(msg: unknown): void {
    if (!isPlainObject(msg)) return;
    switch (msg.m) {
      case 'players':
        this.list = freezePlayers(msg.players);
        this.leaderId = isSeat(msg.leader) ? msg.leader : null;
        this.emit('players', this.list, this.leaderId);
        return;
      case 'input': {
        const i = msg.i as GameInput | { k: 'menu' } | undefined;
        if (!isSeat(msg.p) || !isPlainObject(i) || i.k === 'menu') return;
        this.emit('input', msg.p, i as GameInput, typeof msg.T === 'number' ? msg.T : Date.now());
        return;
      }
      case 'pause':
      case 'resume': {
        const paused = msg.m === 'pause';
        if (paused === this.isPaused) return;
        this.isPaused = paused;
        this.emit(msg.m);
        return;
      }
      case 'store.res': {
        const w = typeof msg.id === 'number' ? this.waiting.get(msg.id) : undefined;
        if (!w) return;
        this.waiting.delete(msg.id as number);
        clearTimeout(w.timer);
        if (typeof msg.error === 'string') w.reject(new IroriError(storageCode(msg.error), msg.error));
        else w.resolve(typeof msg.value === 'string' ? msg.value : null);
        return;
      }
    }
  }

  private target(to: Target): PlayerId | '*' {
    if (to === 'all') return '*';
    if (isSeat(to)) return to;
    throw new IroriError('bad-target', `宛先は席番号（1〜${LIMITS.MAX_PLAYERS}）か 'all' です`);
  }

  private request(op: 'get' | 'set', key: string, value?: string): Promise<string | null> {
    if (!isStoreKey(key)) return Promise.reject(new IroriError('storage-key', '鍵は1〜64文字の文字列です'));
    if (op === 'set' && !isStoreValue(value)) return Promise.reject(new IroriError('storage-too-large', '値は16KBまでの文字列です'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new IroriError('storage-timeout'));
      }, STORAGE_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      this.t.send(op === 'get' ? { m: 'store.get', id, key } : { m: 'store.set', id, key, value: value as string });
    });
  }

  private emit<K extends keyof IroriEvents>(name: K, ...args: Parameters<IroriEvents[K]>): void {
    for (const fn of [...(this.listeners.get(name) ?? [])]) {
      try {
        (fn as (...a: Parameters<IroriEvents[K]>) => void)(...args);
      } catch (err) {
        // 1つのゲームの受け手の失敗で、ほかの受け手と通信を止めない。
        report(err);
      }
    }
  }
}

function storageCode(error: string): IroriErrorCode {
  if (error === 'quota') return 'storage-quota';
  if (error === 'too-large') return 'storage-too-large';
  if (error === 'key') return 'storage-key';
  return 'storage-unavailable';
}
