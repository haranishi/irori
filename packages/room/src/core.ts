// 部屋の状態機械（docs/protocol.md）。入出力・時計・乱数・ハッシュを持たず、イベントを受けて「やること」を返す。
// 時刻はイベントの now だけを使う。期限の処理は、目覚ましを待たずにどのイベントの最初にも行う
// （目覚ましが遅れても、期限を過ぎた札で入り直せないようにするため）。

import {
  CLOSE_CODES,
  LIMITS,
  REASON_VERSION,
  numberedName,
  parseHelloFrame,
  parseHostFrame,
  parsePadFrame,
  sanitizeName,
  type ErrorCode,
  type HostHello,
  type PadHello,
  type PlayerId,
  type PlayerInfo,
  type RoomStatus,
  type ToHostFrame,
  type ToPadFrame,
} from '@irori/protocol';
import {
  ROOM_LIMITS,
  type ConnAttachment,
  type ConnId,
  type Effect,
  type Role,
  type RoomDeps,
  type RoomEvent,
  type RoomLimits,
  type RoomState,
  type SeatState,
  type SocketSnapshot,
} from './types';

interface Conn {
  id: ConnId;
  role: Role;
  seat: PlayerId | null;
  openedAt: number;
  /** トークンバケット。 */
  tokens: number;
  refillAt: number;
  /** 違反の時刻（窓の中のものだけ残す）。 */
  violations: number[];
  /** この接続の最後の操作の時刻。付属情報に5秒刻みで載せ、復元のときに最終操作と照らし合わせる。 */
  seen: number;
}

/** 付属情報の seen の刻み。細かくすると、操作のたびに付属情報を書き直すことになる。 */
const SEEN_STEP_MS = 5_000;
const MINUTE_MS = 60_000;

interface Seat extends SeatState {
  conn: ConnId | null;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
    if (b !== undefined) out += B64URL[(n >> 6) & 63]!;
    if (c !== undefined) out += B64URL[n & 63]!;
  }
  return out;
}

function limitsOf(over: Partial<RoomLimits> | undefined): RoomLimits {
  const L: RoomLimits = {
    ...ROOM_LIMITS,
    ...over,
    FRAME_MAX_BYTES: { ...ROOM_LIMITS.FRAME_MAX_BYTES, ...over?.FRAME_MAX_BYTES },
    RATE: { ...ROOM_LIMITS.RATE, ...over?.RATE },
  };
  // 席番号は通信の型で1〜8に決まっている。上書きでもそれを超えさせない。
  L.MAX_PLAYERS = Math.max(1, Math.min(LIMITS.MAX_PLAYERS, Math.floor(L.MAX_PLAYERS)));
  return L;
}

function info(s: Seat): PlayerInfo {
  return { id: s.id, name: s.name, online: s.conn !== null };
}

export class RoomCore {
  private readonly L: RoomLimits;
  private readonly code: string;
  private readonly keyHash: string;
  private readonly createdAt: number;
  private lastActivity: number;
  private persistedActivity: number;
  private locked: boolean;
  private hostSeen: boolean;
  private hostOffAt: number | null;
  private hostConn: ConnId | null = null;
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly conns = new Map<ConnId, Conn>();
  private out: Effect[] = [];
  private dirty = false;
  /** いま掛かっている目覚まし。undefined は「分からない」（復帰直後・鳴った直後）なので必ず掛け直す。 */
  private alarmAt: number | undefined = undefined;
  private destroyed = false;
  /** 復帰のときに見つかった、名簿に収まらない接続。最初のイベントで閉じる。 */
  private orphans: Array<{ conn: ConnId; code: ErrorCode }> = [];
  private needsReconcile = false;
  /** 新しい席とロックの切り替えの時刻（1分の窓）。入退室の往復やロックの連打で、保存の書き込みを膨らませないため。 */
  private newSeatTimes: number[] = [];
  private lockTimes: number[] = [];

  private constructor(
    state: RoomState,
    private readonly deps: RoomDeps,
  ) {
    this.L = limitsOf(deps.limits);
    this.code = state.code;
    this.keyHash = state.keyHash;
    this.createdAt = state.createdAt;
    this.lastActivity = state.lastActivity;
    this.persistedActivity = state.lastActivity;
    this.locked = state.locked;
    this.hostSeen = state.hostSeen;
    this.hostOffAt = state.hostOffAt;
    for (const s of state.seats) this.seats.set(s.id, { ...s, conn: null });
  }

  /** 部屋を作る。key はホストにだけ返し、ここにはハッシュだけを残す。 */
  static create(code: string, now: number, deps: RoomDeps): { core: RoomCore; key: string; effects: Effect[] } {
    const key = base64url(deps.rand(limitsOf(deps.limits).HOST_KEY_BYTES));
    const core = new RoomCore(
      { v: 1, code, keyHash: deps.hash(key), createdAt: now, lastActivity: now, locked: false, hostSeen: false, hostOffAt: null, seats: [] },
      deps,
    );
    core.dirty = true;
    core.flush(now);
    return { core, key, effects: core.take() };
  }

  /** 休止からの復帰。保存した状態と、生きている接続の付属情報から名簿を組み直す。 */
  static restore(state: RoomState, sockets: readonly SocketSnapshot[], deps: RoomDeps): RoomCore {
    const core = new RoomCore(state, deps);
    // 同じ席や役割に複数の接続があれば、新しいほうを残す（つながった順に並べて、後から来たもので上書きする）。
    const sorted = [...sockets].sort((a, b) => (a.att?.openedAt ?? 0) - (b.att?.openedAt ?? 0));
    for (const { conn, att } of sorted) {
      if (!att) {
        core.orphans.push({ conn, code: 'closed' });
        continue;
      }
      const rate = att.role === 'host' ? core.L.RATE.host : core.L.RATE.pad;
      const c: Conn = {
        id: conn,
        role: att.role,
        seat: att.seat,
        openedAt: att.openedAt,
        tokens: rate.burst,
        refillAt: Number.NEGATIVE_INFINITY,
        violations: [],
        seen: att.seen ?? att.openedAt,
      };
      if (c.seen > core.lastActivity) core.lastActivity = c.seen;
      if (att.role === 'host') {
        if (core.hostConn !== null) {
          core.orphans.push({ conn: core.hostConn, code: 'replaced' });
          core.conns.delete(core.hostConn);
        }
        core.hostConn = conn;
      } else if (att.role === 'pad') {
        const s = att.seat === null ? undefined : core.seats.get(att.seat);
        if (!s) {
          core.orphans.push({ conn, code: 'timeout' });
          continue;
        }
        if (s.conn !== null) {
          core.orphans.push({ conn: s.conn, code: 'replaced' });
          core.conns.delete(s.conn);
        }
        s.conn = conn;
      }
      core.conns.set(conn, c);
    }
    core.needsReconcile = true;
    return core;
  }

  handle(ev: RoomEvent): Effect[] {
    if (this.destroyed) return [];
    const now = ev.now;
    if (this.needsReconcile) this.reconcile(now);
    if (ev.type === 'tick') this.alarmAt = undefined; // 鳴った目覚ましは、もう掛かっていない
    this.expire(now);
    if (this.destroyed) {
      if (ev.type === 'open') this.out.push({ type: 'close', conn: ev.conn, code: CLOSE_CODES.closed, reason: 'closed' });
      return this.take();
    }
    switch (ev.type) {
      case 'open':
        this.onOpen(ev.conn, now);
        break;
      case 'frame': {
        const c = this.conns.get(ev.conn);
        // 知らない接続は、こちらが閉じた後に届いた残りのフレーム。
        if (c) this.onFrame(c, ev.raw, ev.bytes, ev.binary === true, now);
        break;
      }
      case 'close': {
        const c = this.conns.get(ev.conn);
        if (c) {
          this.conns.delete(c.id);
          this.detach(c, now);
        }
        break;
      }
      case 'tick':
        break;
    }
    this.flush(now);
    return this.take();
  }

  /** 接続の付属情報。Durable Object がこれを serializeAttachment に書く。 */
  attachment(conn: ConnId): ConnAttachment | null {
    const c = this.conns.get(conn);
    return c ? { role: c.role, seat: c.seat, openedAt: c.openedAt, seen: Math.floor(c.seen / SEEN_STEP_MS) * SEEN_STEP_MS } : null;
  }

  /** GET /api/rooms/:code の中身。期限を過ぎた部屋は、目覚ましの前でも「ない」と答える。 */
  status(now: number): RoomStatus {
    const alive = !this.destroyed && this.closingReason(now) === null;
    return { exists: alive, locked: alive && this.locked, players: alive ? this.seats.size : 0, max: this.L.MAX_PLAYERS };
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  snapshot(): RoomState {
    return {
      v: 1,
      code: this.code,
      keyHash: this.keyHash,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      locked: this.locked,
      hostSeen: this.hostSeen,
      hostOffAt: this.hostOffAt,
      seats: [...this.seats.values()]
        .sort((a, b) => a.id - b.id)
        .map(({ id, name, resumeHash, online, offAt }) => ({ id, name, resumeHash, online, offAt })),
    };
  }

  // ---- 時間 ----

  private closingReason(now: number): string | null {
    const L = this.L;
    if (now >= this.createdAt + L.ROOM_MAX_MS) return 'max-age';
    if (now >= this.lastActivity + L.ROOM_IDLE_MS) return 'idle';
    if (!this.hostSeen && now >= this.createdAt + L.CREATE_TTL_S * 1000) return 'no-host';
    if (this.hostConn === null && this.hostOffAt !== null && now >= this.hostOffAt + L.HOST_GRACE_MS) return 'host-gone';
    return null;
  }

  private expire(now: number): void {
    if (this.closingReason(now) !== null) {
      this.closeRoom();
      return;
    }
    for (const c of [...this.conns.values()]) {
      if (c.role === 'pending' && now >= c.openedAt + this.L.HELLO_TIMEOUT_MS) this.fail(c, 'timeout', now);
    }
    for (const s of [...this.seats.values()]) {
      if (s.conn === null && s.offAt !== null && now >= s.offAt + this.L.PAD_GRACE_MS) this.removeSeat(s, 'timeout');
    }
  }

  private nextDeadline(): number {
    const L = this.L;
    let t = Math.min(this.createdAt + L.ROOM_MAX_MS, this.lastActivity + L.ROOM_IDLE_MS);
    if (!this.hostSeen) t = Math.min(t, this.createdAt + L.CREATE_TTL_S * 1000);
    else if (this.hostConn === null && this.hostOffAt !== null) t = Math.min(t, this.hostOffAt + L.HOST_GRACE_MS);
    for (const c of this.conns.values()) if (c.role === 'pending') t = Math.min(t, c.openedAt + L.HELLO_TIMEOUT_MS);
    for (const s of this.seats.values()) if (s.conn === null && s.offAt !== null) t = Math.min(t, s.offAt + L.PAD_GRACE_MS);
    return t;
  }

  private flush(now: number): void {
    if (this.destroyed) return;
    if (this.dirty) {
      this.out.push({ type: 'persist', state: this.snapshot() });
      this.persistedActivity = this.lastActivity;
      this.dirty = false;
    }
    // 期限が後ろへずれただけなら掛け直さない（早く鳴っても、鳴ったときに数え直せばよい）。書き込みを減らすため。
    const next = this.nextDeadline();
    if (this.alarmAt === undefined || next < this.alarmAt || this.alarmAt <= now) {
      this.out.push({ type: 'alarm', at: next });
      this.alarmAt = next;
    }
  }

  private touch(c: Conn, now: number): void {
    c.seen = now;
    if (now > this.lastActivity) this.lastActivity = now;
    if (this.lastActivity - this.persistedActivity >= this.L.ACTIVITY_PERSIST_MS) this.dirty = true;
  }

  private reconcile(now: number): void {
    this.needsReconcile = false;
    for (const o of this.orphans) {
      this.send(o.conn, { t: 'err', code: o.code });
      this.out.push({ type: 'close', conn: o.conn, code: CLOSE_CODES[o.code], reason: o.code });
    }
    this.orphans = [];
    // 休止の間に、閉じる知らせが届かないまま消えた接続がある（再起動など）。切れたものとして扱い、猶予を始める。
    for (const s of this.seats.values()) {
      if (s.conn === null && (s.online || s.offAt === null)) {
        s.online = false;
        s.offAt = s.offAt ?? now;
        this.dirty = true;
        this.toHost({ t: 'online', p: s.id, on: false });
      } else if (s.conn !== null && (!s.online || s.offAt !== null)) {
        s.online = true;
        s.offAt = null;
        this.dirty = true;
      }
    }
    if (this.hostConn === null && this.hostSeen && this.hostOffAt === null) {
      this.hostOffAt = now;
      this.dirty = true;
      this.toPads({ t: 'host', on: false });
    } else if (this.hostConn !== null && (!this.hostSeen || this.hostOffAt !== null)) {
      this.hostSeen = true;
      this.hostOffAt = null;
      this.dirty = true;
    }
  }

  // ---- 接続 ----

  private onOpen(id: ConnId, now: number): void {
    let pending = 0;
    for (const c of this.conns.values()) if (c.role === 'pending') pending++;
    if (pending >= this.L.MAX_PENDING) {
      // hello を送らない接続を大量に開かれても、名簿と目覚ましを膨らませないよう、新しいほうをすぐ閉じる。
      this.send(id, { t: 'err', code: 'rate' });
      this.out.push({ type: 'close', conn: id, code: CLOSE_CODES.rate, reason: 'rate' });
      return;
    }
    const rate = this.L.RATE.pad;
    this.conns.set(id, { id, role: 'pending', seat: null, openedAt: now, tokens: rate.burst, refillAt: now, violations: [], seen: now });
  }

  /** 1分の窓で max 回まで。通れば時刻を記録して true。 */
  private withinMinute(times: number[], max: number, now: number): boolean {
    while (times.length > 0 && times[0]! <= now - MINUTE_MS) times.shift();
    if (times.length >= max) return false;
    times.push(now);
    return true;
  }

  private onFrame(c: Conn, raw: string, bytes: number, binary: boolean, now: number): void {
    // 役割が決まる前は、小さいほう（スマホ）の上限で見る。hello は小さい。
    const max = c.role === 'host' ? this.L.FRAME_MAX_BYTES.host : this.L.FRAME_MAX_BYTES.pad;
    if (bytes > max) return this.fail(c, 'too-large', now);
    if (!this.takeToken(c, now)) return this.violate(c, 'rate', now);
    if (c.role === 'pending') {
      // 役割は最初のフレームで決める。hello でないものが先に来た接続は、そこで閉じる。
      if (binary) return this.fail(c, 'bad-frame', now);
      return this.onHello(c, raw, now);
    }
    if (binary) return this.violate(c, 'bad-frame', now);
    if (c.role === 'host') this.onHostFrame(c, raw, now);
    else this.onPadFrame(c, raw, now);
  }

  private takeToken(c: Conn, now: number): boolean {
    const rate = c.role === 'host' ? this.L.RATE.host : this.L.RATE.pad;
    const elapsed = Math.max(0, now - c.refillAt);
    c.tokens = Math.min(rate.burst, c.tokens + (elapsed * rate.perSec) / 1000);
    c.refillAt = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private violate(c: Conn, code: 'bad-frame' | 'rate', now: number): void {
    const since = now - this.L.VIOLATION_WINDOW_MS;
    c.violations = c.violations.filter((t) => t > since);
    c.violations.push(now);
    if (c.violations.length >= this.L.VIOLATIONS_BEFORE_CLOSE) return this.fail(c, 'rate', now);
    this.send(c.id, { t: 'err', code });
  }

  /** 誤りを知らせて閉じる。席やホストの扱いは、相手が切れたときと同じ。 */
  private fail(c: Conn, code: ErrorCode, now: number): void {
    this.send(c.id, { t: 'err', code });
    this.out.push({ type: 'close', conn: c.id, code: CLOSE_CODES[code], reason: code });
    this.conns.delete(c.id);
    this.detach(c, now);
  }

  /** 新しい接続に場所を譲る古い接続を閉じる。席はそのまま新しいほうへ渡す。 */
  private replace(old: Conn): void {
    this.send(old.id, { t: 'err', code: 'replaced' });
    this.out.push({ type: 'close', conn: old.id, code: CLOSE_CODES.replaced, reason: 'replaced' });
    this.conns.delete(old.id);
  }

  private detach(c: Conn, now: number): void {
    if (c.role === 'host' && this.hostConn === c.id) {
      this.hostConn = null;
      this.hostOffAt = now;
      this.dirty = true;
      this.toPads({ t: 'host', on: false });
    } else if (c.role === 'pad' && c.seat !== null) {
      const s = this.seats.get(c.seat);
      if (s && s.conn === c.id) {
        s.conn = null;
        s.online = false;
        s.offAt = now;
        this.dirty = true;
        this.toHost({ t: 'online', p: s.id, on: false });
      }
    }
  }

  // ---- 握手 ----

  private onHello(c: Conn, raw: string, now: number): void {
    const r = parseHelloFrame(raw);
    if (!r.ok) return this.fail(c, r.reason === REASON_VERSION ? 'version' : 'bad-frame', now);
    if (r.frame.role === 'host') this.helloHost(c, r.frame, now);
    else this.helloPad(c, r.frame, now);
  }

  private helloHost(c: Conn, f: HostHello, now: number): void {
    if (!this.deps.timingSafeEqual(this.deps.hash(f.key), this.keyHash)) return this.fail(c, 'auth', now);
    const previous = this.hostConn === null ? undefined : this.conns.get(this.hostConn);
    // ホストの二重接続は新しいほうが勝つ。古いほうは、切れかけで残っているだけのことが多い。
    if (previous) this.replace(previous);
    c.role = 'host';
    this.hostConn = c.id;
    if (!this.hostSeen || this.hostOffAt !== null) {
      this.hostSeen = true;
      this.hostOffAt = null;
      this.dirty = true;
    }
    this.touch(c, now);
    this.send(c.id, { t: 'welcome', role: 'host', code: this.code, players: this.players(), max: this.L.MAX_PLAYERS, locked: this.locked });
    for (const s of this.seats.values()) {
      if (s.conn === null) continue;
      // 入り直したホストは、スマホにいま出すべき画面を知らない。席ごとに送り直しを頼む。
      this.send(c.id, { t: 'pad?', p: s.id });
      if (!previous) this.send(s.conn, { t: 'host', on: true });
    }
  }

  private helloPad(c: Conn, f: PadHello, now: number): void {
    const resumed = f.resume === undefined ? undefined : this.seatByToken(f.resume);
    if (resumed && f.resume !== undefined) return this.resumeSeat(c, resumed, f.resume, now);
    // 席を持つ人の入り直しは、満員やロックでも通る（上で済ませた）。新しい人だけをここで止める。
    const refusal: ErrorCode | null = this.locked ? 'locked' : this.seats.size >= this.L.MAX_PLAYERS ? 'full' : null;
    if (refusal) return this.fail(c, refusal, now);
    // 入って出るのを繰り返すと、そのたびに保存の書き込みが出る。新しい席の数を1分あたりで縛る。
    if (!this.withinMinute(this.newSeatTimes, this.L.NEW_SEATS_PER_MINUTE, now)) return this.fail(c, 'rate', now);
    let id = 1;
    while (this.seats.has(id)) id++;
    const token = base64url(this.deps.rand(this.L.RESUME_TOKEN_BYTES));
    const s: Seat = {
      id,
      name: this.uniqueName(sanitizeName(f.name, `プレイヤー${id}`)),
      resumeHash: this.deps.hash(token),
      online: true,
      offAt: null,
      conn: c.id,
    };
    this.seats.set(id, s);
    c.role = 'pad';
    c.seat = id;
    this.dirty = true;
    this.touch(c, now);
    this.send(c.id, { t: 'welcome', role: 'pad', you: info(s), resume: token, host: this.hostConn !== null });
    this.toHost({ t: 'joined', p: info(s) });
  }

  private resumeSeat(c: Conn, s: Seat, token: string, now: number): void {
    const old = s.conn === null ? undefined : this.conns.get(s.conn);
    // 同じ札が二重につながったら、新しいほうを残す。
    if (old) this.replace(old);
    const wasOffline = !old;
    s.conn = c.id;
    if (!s.online || s.offAt !== null) {
      s.online = true;
      s.offAt = null;
      this.dirty = true;
    }
    c.role = 'pad';
    c.seat = s.id;
    this.touch(c, now);
    // 札は持ってきたものをそのまま返す。毎回替えると、welcome を受け取る前に切れた端末が席を失う。
    this.send(c.id, { t: 'welcome', role: 'pad', you: info(s), resume: token, host: this.hostConn !== null });
    if (wasOffline) this.toHost({ t: 'online', p: s.id, on: true });
    this.toHost({ t: 'pad?', p: s.id });
  }

  private seatByToken(token: string): Seat | undefined {
    const h = this.deps.hash(token);
    for (const s of this.seats.values()) if (this.deps.timingSafeEqual(h, s.resumeHash)) return s;
    return undefined;
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.seats.values()].map((s) => s.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      const candidate = numberedName(name, n);
      if (!taken.has(candidate)) return candidate;
    }
  }

  private players(): PlayerInfo[] {
    return [...this.seats.values()].sort((a, b) => a.id - b.id).map(info);
  }

  // ---- フレーム ----

  private onHostFrame(c: Conn, raw: string, now: number): void {
    const r = parseHostFrame(raw);
    // 役割は途中で変えられない。2度目の hello も違反。
    if (!r.ok || r.frame.t === 'hello') return this.violate(c, 'bad-frame', now);
    const f = r.frame;
    this.touch(c, now);
    switch (f.t) {
      case 'pad':
        // いない席・切れている席宛ては、黙って捨てる。退出と行き違うのは普通のこと。
        for (const conn of this.targets(f.to)) this.send(conn, { t: 'pad', spec: f.spec });
        break;
      case 'fx':
        for (const conn of this.targets(f.to)) this.send(conn, { t: 'fx', ms: f.ms });
        break;
      case 'kick': {
        const s = this.seats.get(f.p);
        if (s) this.evict(s, 'kick');
        break;
      }
      case 'lock':
        if (this.locked !== f.on) {
          // 切り替えのたびに保存の書き込みが出る。超えた分は無視して、違反に数える。
          if (!this.withinMinute(this.lockTimes, this.L.LOCKS_PER_MINUTE, now)) return this.violate(c, 'rate', now);
          this.locked = f.on;
          this.dirty = true;
        }
        break;
      case 'close':
        this.closeRoom();
        break;
    }
  }

  private onPadFrame(c: Conn, raw: string, now: number): void {
    const r = parsePadFrame(raw);
    if (!r.ok || r.frame.t === 'hello') return this.violate(c, 'bad-frame', now);
    const f = r.frame;
    const seatId = c.seat ?? 0;
    this.touch(c, now);
    if (f.t === 'in') {
      // 席番号は接続から付ける。フレームの値は使わない（なりすましの防止）。
      this.toHost({ t: 'in', p: seatId, i: f.i, T: now });
      return;
    }
    const s = this.seats.get(seatId);
    if (s) this.evict(s, 'bye');
  }

  private targets(to: PlayerId | '*'): ConnId[] {
    const out: ConnId[] = [];
    for (const s of this.seats.values()) if (s.conn !== null && (to === '*' || s.id === to)) out.push(s.conn);
    return out;
  }

  /** 外す・自分から出る。席は猶予を待たずにすぐ空ける。 */
  private evict(s: Seat, why: 'kick' | 'bye'): void {
    const c = s.conn === null ? undefined : this.conns.get(s.conn);
    if (c) {
      if (why === 'kick') this.send(c.id, { t: 'kicked' });
      this.out.push({ type: 'close', conn: c.id, code: why === 'kick' ? CLOSE_CODES.kicked : 1000, reason: why });
      this.conns.delete(c.id);
    }
    s.conn = null;
    this.removeSeat(s, why);
  }

  private removeSeat(s: Seat, why: 'bye' | 'timeout' | 'kick'): void {
    this.seats.delete(s.id);
    this.dirty = true;
    this.toHost({ t: 'left', p: s.id, why });
  }

  private closeRoom(): void {
    for (const c of this.conns.values()) {
      if (c.role === 'pad') this.send(c.id, { t: 'closed' });
      else if (c.role === 'host') this.send(c.id, { t: 'err', code: 'closed' });
      this.out.push({ type: 'close', conn: c.id, code: CLOSE_CODES.closed, reason: 'closed' });
    }
    this.conns.clear();
    this.seats.clear();
    this.hostConn = null;
    this.destroyed = true;
    this.out.push({ type: 'destroy' });
  }

  // ---- 送る ----

  private send(conn: ConnId, frame: ToHostFrame | ToPadFrame): void {
    this.out.push({ type: 'send', conn, frame });
  }

  private toHost(frame: ToHostFrame): void {
    if (this.hostConn !== null) this.send(this.hostConn, frame);
  }

  private toPads(frame: ToPadFrame): void {
    for (const s of this.seats.values()) if (s.conn !== null) this.send(s.conn, frame);
  }

  private take(): Effect[] {
    const out = this.out;
    this.out = [];
    return out;
  }
}
