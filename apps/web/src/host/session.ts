// 部屋とのつながり。POST /api/rooms で部屋を作り、コードと鍵を sessionStorage に置く（URLには載せない）。
// 再読み込みでは同じ鍵で同じ部屋に戻る。部屋が消えていたら（no-room・auth）新しく作る。
// replaced（4009）では自動で入り直さない。人が「ここで続ける」を押したときだけ reconnect() を呼ぶ。
// 画面に戻ったとき（visibilitychange・pageshow）と online で probe() を呼び、死んだ接続を30秒待たずに捨てる。
import { isValidCode, type CreateRoomResponse, type HostFrame, type ToHostFrame } from '@irori/protocol';
import { roomSocketUrl, type RoomSocket, type RoomSocketError } from '@irori/room-client';

export type HostSocket = Pick<RoomSocket<'host'>, 'state' | 'on' | 'connect' | 'reconnect' | 'probe' | 'send' | 'close'>;
export type Welcome = Extract<ToHostFrame, { t: 'welcome' }>;
export type HostOut = Exclude<HostFrame, { t: 'hello' }>;

export interface StoredRoom {
  code: string;
  key: string;
  leader: number | null;
}

export interface LinkEvents {
  welcome(f: Welcome): void;
  frame(f: Exclude<ToHostFrame, { t: 'welcome' }>): void;
  /** つながっていたのが切れて、入り直している。 */
  lost(): void;
  replaced(): void;
  closed(): void;
  busy(b: { reason: 'daily' | 'rate'; retryAfterSec: number }): void;
  /** 部屋を作りに行けなかった（回線がない・サーバーに届かない）。 */
  offline(): void;
  version(): void;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LinkOptions {
  origin: string;
  fetch: typeof fetch;
  storage: Store | null;
  makeSocket: (url: string, key: () => string) => HostSocket;
  doc: Pick<Document, 'visibilityState' | 'addEventListener'>;
  win: Pick<Window, 'addEventListener'>;
  events: LinkEvents;
}

export const ROOM_KEY = 'irori:host:room';

export function readRoom(storage: Store | null): StoredRoom | null {
  try {
    const v = JSON.parse(storage?.getItem(ROOM_KEY) ?? 'null') as Partial<StoredRoom> | null;
    if (!v || !isValidCode(v.code) || typeof v.key !== 'string' || v.key.length === 0 || v.key.length > 256) return null;
    return { code: v.code, key: v.key, leader: typeof v.leader === 'number' ? v.leader : null };
  } catch {
    return null;
  }
}

function writeRoom(storage: Store | null, room: StoredRoom): void {
  try {
    storage?.setItem(ROOM_KEY, JSON.stringify(room));
  } catch {
    // 保存できない環境では、再読み込みで新しい部屋になる。
  }
}

function clearRoom(storage: Store | null): void {
  try {
    storage?.removeItem(ROOM_KEY);
  } catch {
    // 同上
  }
}

const clampSec = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 86_400) : 60;
};

export class RoomLink {
  private socket: HostSocket | null = null;
  private room: StoredRoom | null = null;
  private unsub: Array<() => void> = [];
  /** 保存していた部屋に入り直している最中（no-room なら新しく作ってよい）。 */
  private resuming = false;
  /** 部屋を作りに行けなかった。online で作り直す。 */
  private wantsCreate = false;

  constructor(private readonly o: LinkOptions) {
    o.doc.addEventListener('visibilitychange', this.onVisible);
    o.win.addEventListener('pageshow', this.onShow);
    o.win.addEventListener('online', this.onOnline);
  }

  get code(): string | null {
    return this.room?.code ?? null;
  }

  get socketState(): HostSocket['state'] {
    return this.socket?.state ?? 'closed';
  }

  async open(): Promise<void> {
    const stored = readRoom(this.o.storage);
    if (stored) this.attach(stored, true);
    else await this.create();
  }

  /** 新しい部屋を作る（閉じた部屋の後・混雑の後の「もう一度」も、ここ）。 */
  async create(): Promise<void> {
    this.detach();
    clearRoom(this.o.storage);
    this.wantsCreate = false;
    let res: Response;
    try {
      res = await this.o.fetch('/api/rooms', { method: 'POST', headers: { Accept: 'application/json' } });
    } catch {
      this.wantsCreate = true;
      this.o.events.offline();
      return;
    }
    if (res.status === 503 || res.status === 429) {
      const body = (await res.json().catch(() => null)) as { retryAfterSec?: unknown } | null;
      this.o.events.busy({ reason: res.status === 503 ? 'daily' : 'rate', retryAfterSec: clampSec(body?.retryAfterSec ?? res.headers.get('Retry-After')) });
      return;
    }
    const body = res.ok ? ((await res.json().catch(() => null)) as Partial<CreateRoomResponse> | null) : null;
    if (!body || !isValidCode(body.code) || typeof body.key !== 'string' || body.key.length === 0) {
      this.wantsCreate = true;
      this.o.events.offline();
      return;
    }
    const room = { code: body.code, key: body.key, leader: null };
    writeRoom(this.o.storage, room);
    this.attach(room, false);
  }

  /** 「ここで続ける」「いますぐ、つなぎ直す」。部屋がまだ無ければ作る。 */
  reconnect(): void {
    if (this.socket) this.socket.reconnect();
    else void this.open();
  }

  send(frame: HostOut): boolean {
    return this.socket?.send(frame) ?? false;
  }

  /** リーダーを覚えておく（再読み込みのあとも、同じ人がリモコンを持つように）。 */
  rememberLeader(leader: number | null): void {
    if (!this.room || this.room.leader === leader) return;
    this.room = { ...this.room, leader };
    writeRoom(this.o.storage, this.room);
  }

  get storedLeader(): number | null {
    return this.room?.leader ?? null;
  }

  private attach(room: StoredRoom, resuming: boolean): void {
    this.detach();
    this.room = room;
    this.resuming = resuming;
    const s = this.o.makeSocket(roomSocketUrl(this.o.origin, room.code), () => room.key);
    this.socket = s;
    this.unsub = [
      s.on('frame', (f) => this.onFrame(f)),
      s.on('state', (st) => {
        if (st === 'reconnecting') this.o.events.lost();
      }),
      s.on('error', (e) => this.onError(e)),
    ];
    s.connect();
  }

  private detach(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const s = this.socket;
    this.socket = null;
    s?.close();
  }

  private onFrame(f: ToHostFrame): void {
    // 購読関数が例外を投げると、ほかの購読者に届かない。ここで受け止めて報告だけする。
    try {
      if (f.t === 'welcome') {
        this.resuming = false;
        this.o.events.welcome(f);
      } else this.o.events.frame(f);
    } catch (err) {
      report(err);
    }
  }

  private onError(e: RoomSocketError): void {
    if (!e.fatal) return;
    try {
      switch (e.code) {
        case 'replaced':
          this.o.events.replaced();
          return;
        case 'no-room':
        case 'auth':
          // 保存していた部屋が、もう無い（期限切れ・閉じた）。新しく作る。作ったばかりの部屋なら、閉じたと出す。
          if (this.resuming) {
            void this.create();
            return;
          }
          break;
        case 'version':
          this.detach();
          this.o.events.version();
          return;
        default:
          break;
      }
      this.detach();
      clearRoom(this.o.storage);
      this.room = null;
      this.o.events.closed();
    } catch (err) {
      report(err);
    }
  }

  private readonly onVisible = (): void => {
    if (this.o.doc.visibilityState === 'visible') this.socket?.probe();
  };

  private readonly onShow = (): void => {
    this.socket?.probe();
  };

  private readonly onOnline = (): void => {
    if (!this.socket) {
      if (this.wantsCreate) void this.create();
      return;
    }
    if (this.socket.state === 'reconnecting') this.socket.reconnect();
    else this.socket.probe();
  };
}

function report(err: unknown): void {
  if (typeof reportError === 'function') reportError(err);
  else console.error(err);
}
