// 試験用のホスト役：packages/room-client を、Node から実 Worker につなぐ。ホストの画面（B1）とは独立に、スマホの画面を確かめる。
// ホストの約束どおり、席ごとに最後に送った画面を覚え、`pad?`（入り直した席の送り直しの依頼）に応えて送り直す。
// 待つときは、フレームが届くたびに条件を見直す（時間を決め打ちで待たない・出力の文字列を見ない）。
import type { InputEvent, PadSpec, PlayerInfo, RoomStatus, ToHostFrame } from '@irori/protocol';
import { RoomSocket, roomSocketUrl } from '@irori/room-client';

const byte = (lo = 0) => lo + Math.floor(Math.random() * (256 - lo));

/** 部屋の作成は、同じIPから1時間60回まで（上書きできない栓）。試験ごとに名乗るIPを変える。 */
export function freshIp(): string {
  return `10.${byte()}.${byte()}.${byte(1)}`;
}

export type InFrame = Extract<ToHostFrame, { t: 'in' }>;

class Waiters {
  private list: Array<() => void> = [];
  wake(): void {
    const w = this.list;
    this.list = [];
    for (const fn of w) fn();
  }
  until<T>(check: () => T | undefined, what: string, timeoutMs: number, detail: () => string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} を待ったが来ない（${timeoutMs}ms）。${detail()}`)), timeoutMs);
      const attempt = () => {
        let v: T | undefined;
        try {
          v = check();
        } catch (e) {
          clearTimeout(timer);
          reject(e as Error);
          return;
        }
        if (v !== undefined) {
          clearTimeout(timer);
          resolve(v);
        } else this.list.push(attempt);
      };
      attempt();
    });
  }
}

export class TestHost {
  readonly frames: ToHostFrame[] = [];
  /** 席ごとに最後に送った画面（ホストの画面と同じ約束）。 */
  readonly specs = new Map<number, PadSpec>();
  /** false にすると、pad? に応えない（送り直しの遅れや欠落を作るため）。 */
  resend = true;
  private socket: RoomSocket<'host'> | null = null;
  private readonly waiters = new Waiters();
  private readonly pads: RoomSocket<'pad'>[] = [];

  private constructor(
    readonly base: string,
    readonly code: string,
    readonly key: string,
  ) {}

  static async create(base: string): Promise<TestHost> {
    const res = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': freshIp() } });
    if (res.status !== 201) throw new Error(`部屋を作れない: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { code: string; key: string };
    const host = new TestHost(base, body.code, body.key);
    await host.connect();
    return host;
  }

  /** つなぐ（入り直しも同じ鍵で）。welcome を受けるまで待つ。 */
  async connect(): Promise<void> {
    const before = this.count('welcome');
    const s = new RoomSocket<'host'>({ role: 'host', url: roomSocketUrl(this.base, this.code), key: () => this.key });
    s.on('frame', (f) => {
      this.frames.push(f);
      if (f.t === 'pad?' && this.resend) {
        const spec = this.specs.get(f.p);
        if (spec) this.socket?.send({ t: 'pad', to: f.p, spec });
      }
      this.waiters.wake();
    });
    s.on('state', () => this.waiters.wake());
    this.socket = s;
    s.connect();
    await this.until(() => (this.count('welcome') > before ? true : undefined), 'ホストの welcome');
  }

  /** ホストの画面が落ちた（閉じる知らせを送って切る）。スマホには host:false が届く。 */
  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  private send(frame: Parameters<RoomSocket<'host'>['send']>[0]): void {
    if (!this.socket?.send(frame)) throw new Error(`ホストが送れない: ${JSON.stringify(frame)}`);
  }

  setPad(to: number, spec: PadSpec): void {
    this.specs.set(to, spec);
    this.send({ t: 'pad', to, spec });
  }

  fx(to: number, ms: number[]): void {
    this.send({ t: 'fx', to, ms });
  }

  kick(p: number): void {
    this.send({ t: 'kick', p });
  }

  lock(on: boolean): void {
    this.send({ t: 'lock', on });
  }

  closeRoom(): void {
    this.send({ t: 'close' });
  }

  // ---- 見たもの ----

  /** 部屋の状態の照会（GET /api/rooms/:code）。ロックの反映などは、これで確かめてから進む。 */
  async status(): Promise<RoomStatus> {
    const r = await fetch(`${this.base}/api/rooms/${this.code}`, { headers: { 'CF-Connecting-IP': freshIp() } });
    return (await r.json()) as RoomStatus;
  }

  count(t: ToHostFrame['t']): number {
    return this.frames.filter((f) => f.t === t).length;
  }

  joined(): PlayerInfo[] {
    return this.frames.flatMap((f) => (f.t === 'joined' ? [f.p] : []));
  }

  inputs(p?: number): InFrame[] {
    return this.frames.filter((f): f is InFrame => f.t === 'in' && (p === undefined || f.p === p));
  }

  /** 席 p の入力（i だけ）。 */
  events(p: number): InputEvent[] {
    return this.inputs(p).map((f) => f.i);
  }

  until<T>(check: () => T | undefined, what: string, timeoutMs = 10_000): Promise<T> {
    return this.waiters.until(check, what, timeoutMs, () => `届いたもの=${JSON.stringify(this.frames.slice(-12))}`);
  }

  /** n 人目の参加を待って、その席を返す。 */
  joinedNth(n: number, timeoutMs?: number): Promise<PlayerInfo> {
    return this.until(() => this.joined()[n - 1], `${n}人目の参加`, timeoutMs);
  }

  /** 席 p の入力が n 件になるまで待つ。 */
  eventsAtLeast(p: number, n: number, timeoutMs?: number): Promise<InputEvent[]> {
    return this.until(() => (this.events(p).length >= n ? this.events(p) : undefined), `席${p}の入力${n}件`, timeoutMs);
  }

  /** 試験用：Node のスマホ役をつなぎ、本人とホストの両側に参加が届くまで待つ（満員を作るため）。 */
  async addNodePad(name: string): Promise<{ id: number; leave: () => void }> {
    const before = this.frames.length;
    let you: PlayerInfo | null = null;
    const s = new RoomSocket<'pad'>({ role: 'pad', url: roomSocketUrl(this.base, this.code), name: () => name });
    s.on('frame', (f) => {
      if (f.t === 'welcome') you = f.you;
      this.waiters.wake();
    });
    this.pads.push(s);
    s.connect();
    const me = await this.until(() => you ?? undefined, `Node のスマホ役「${name}」の welcome`);
    // 別接続のjoinedはwelcomeより遅れることがある。古い同席の参加記録は、今回の到達に数えない。
    await this.until(
      () => this.frames.slice(before).some((f) => f.t === 'joined' && f.p.id === me.id) ? true : undefined,
      `Node のスマホ役「${name}」の joined`,
    );
    return {
      id: me.id,
      leave: () => {
        s.send({ t: 'bye' });
        s.close();
      },
    };
  }

  close(): void {
    for (const p of this.pads) p.close();
    this.socket?.close();
    this.socket = null;
  }
}
