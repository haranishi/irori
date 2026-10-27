import { CLOSE_CODES, HEARTBEAT_PING, HEARTBEAT_PONG } from '@irori/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { RoomSocket, roomSocketUrl, type Clock, type RoomSocketError, type SocketState, type WebSocketLike } from '../src/index';

class FakeClock implements Clock {
  t = 0;
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
  get pending(): number {
    return this.timers.size;
  }
}

class FakeWS implements WebSocketLike {
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
  // ---- サーバーの側の操作 ----
  accept(): void {
    this.onopen?.({});
  }
  message(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  drop(code: number, reason = ''): void {
    this.onerror?.({});
    this.onclose?.({ code, reason });
  }
  get hellos(): unknown[] {
    return this.sent.filter((s) => s.includes('"hello"')).map((s) => JSON.parse(s));
  }
}

const HOST_WELCOME = { t: 'welcome', role: 'host', code: 'BCDF', players: [], max: 8, locked: false };
const PAD_WELCOME = (resume: string) => ({ t: 'welcome', role: 'pad', you: { id: 2, name: 'はなこ', online: true }, resume, host: true });
const last = () => FakeWS.all.at(-1)!;

let clock: FakeClock;
beforeEach(() => {
  FakeWS.all = [];
  clock = new FakeClock();
});

function pad(extra: { resume?: () => string | undefined; random?: () => number } = {}) {
  const states: SocketState[] = [];
  const errors: RoomSocketError[] = [];
  const frames: unknown[] = [];
  const s = new RoomSocket({
    role: 'pad',
    url: 'ws://example.test/api/rooms/BCDF/ws',
    name: () => 'はなこ',
    WebSocket: FakeWS,
    clock,
    random: extra.random ?? (() => 0.5),
    ...(extra.resume ? { resume: extra.resume } : {}),
  });
  s.on('state', (st) => states.push(st));
  s.on('error', (e) => errors.push(e));
  s.on('frame', (f) => frames.push(f));
  return { s, states, errors, frames };
}

describe('つなぐ', () => {
  it('つながったら hello を送り、welcome で open になる。フレームは検証してから渡す', () => {
    const { s, states, frames } = pad({ resume: () => 'tok' });
    s.connect();
    expect(states).toEqual(['connecting']);
    last().accept();
    expect(last().hellos).toEqual([{ t: 'hello', v: 1, role: 'pad', name: 'はなこ', resume: 'tok' }]);
    expect(s.state).toBe('connecting');
    last().message(PAD_WELCOME('tok'));
    expect(s.state).toBe('open');
    last().message({ t: 'pad', spec: { k: 'buzzer', label: '押す' } });
    expect(frames).toEqual([PAD_WELCOME('tok'), { t: 'pad', spec: { k: 'buzzer', label: '押す' } }]);
  });

  it('ホストは鍵を関数から取って hello に入れる', () => {
    const s = new RoomSocket({ role: 'host', url: 'ws://x/api/rooms/BCDF/ws', key: () => 'secret', WebSocket: FakeWS, clock });
    s.connect();
    last().accept();
    expect(last().hellos).toEqual([{ t: 'hello', v: 1, role: 'host', key: 'secret' }]);
    last().message(HOST_WELCOME);
    expect(s.state).toBe('open');
    expect(s.send({ t: 'kick', p: 3 })).toBe(true);
    expect(last().sent.at(-1)).toBe('{"t":"kick","p":3}');
  });

  it('名前と札がなければ、hello に入れない', () => {
    const s = new RoomSocket({ role: 'pad', url: 'ws://x', WebSocket: FakeWS, clock });
    s.connect();
    last().accept();
    expect(last().hellos).toEqual([{ t: 'hello', v: 1, role: 'pad' }]);
  });

  it('welcome の前は送らない（false）', () => {
    const { s } = pad();
    expect(s.send({ t: 'in', i: { k: 'menu' } })).toBe(false);
    s.connect();
    last().accept();
    expect(s.send({ t: 'in', i: { k: 'menu' } })).toBe(false);
    last().message(PAD_WELCOME('x'));
    expect(s.send({ t: 'in', i: { k: 'menu' } })).toBe(true);
  });

  it('名簿（welcome・joined）は、名前の長さだけでは捨てない（中継と書記素の数え方が違っても、部屋に戻れるように）', () => {
    const frames: unknown[] = [];
    const errors: RoomSocketError[] = [];
    const s = new RoomSocket({ role: 'host', url: 'ws://x', key: () => 'k', WebSocket: FakeWS, clock });
    s.on('frame', (f) => frames.push(f));
    s.on('error', (e) => errors.push(e));
    s.connect();
    last().accept();
    const long = 'ဩ'.repeat(40);
    const welcome = { ...HOST_WELCOME, players: [{ id: 1, name: long, online: true }] };
    last().message(welcome);
    last().message({ t: 'joined', p: { id: 2, name: long, online: true } });
    expect(s.state).toBe('open');
    expect(frames).toEqual([welcome, { t: 'joined', p: { id: 2, name: long, online: true } }]);
    expect(errors).toEqual([]);
    last().message({ t: 'joined', p: { id: 2, name: 7, online: true } }); // 形の誤りは捨てる
    expect(errors.map((e) => e.code)).toEqual(['protocol']);
  });

  it('読めないフレームとバイナリは渡さず、error で知らせる。接続は続ける', () => {
    const { s, errors, frames } = pad();
    s.connect();
    last().accept();
    last().message(PAD_WELCOME('x'));
    last().message({ t: 'in', p: 1, i: { k: 'menu' } }); // スマホ宛てに来るはずのない形
    last().onmessage?.({ data: new ArrayBuffer(2) });
    expect(frames).toHaveLength(1);
    expect(errors.map((e) => e.code)).toEqual(['protocol', 'protocol']);
    expect(s.state).toBe('open');
  });
});

describe('入り直す', () => {
  it('切れたら待ってから入り直し、そのときの札で hello を送り直す', () => {
    let resume = 'first';
    const { s, states, errors } = pad({ resume: () => resume });
    s.connect();
    last().accept();
    last().message(PAD_WELCOME('first'));
    resume = 'second';
    last().drop(1006);
    expect(s.state).toBe('reconnecting');
    expect(errors).toEqual([{ code: 'network', closeCode: 1006, reason: '', fatal: false }]);
    expect(FakeWS.all).toHaveLength(1);
    clock.advance(499);
    expect(FakeWS.all).toHaveLength(1);
    clock.advance(1);
    expect(FakeWS.all).toHaveLength(2);
    last().accept();
    expect(last().hellos).toEqual([{ t: 'hello', v: 1, role: 'pad', name: 'はなこ', resume: 'second' }]);
    last().message(PAD_WELCOME('second'));
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('待ち時間は 0.5秒から倍々で、最大8秒。welcome を受けたら最初に戻る', () => {
    const { s } = pad();
    s.connect();
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = clock.t;
      const count = FakeWS.all.length;
      last().drop(1006);
      while (FakeWS.all.length === count) clock.advance(1);
      waits.push(clock.t - before);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    last().accept();
    last().message(PAD_WELCOME('x'));
    const before = clock.t;
    last().drop(1006);
    while (FakeWS.all.length === 8) clock.advance(1);
    expect(clock.t - before).toBe(500);
  });

  it('ゆらぎは 0.8〜1.2倍で、0.5〜8秒の外には出ない', () => {
    const delays = (r: number) => {
      FakeWS.all = [];
      clock = new FakeClock();
      const { s } = pad({ random: () => r });
      s.connect();
      const out: number[] = [];
      for (let i = 0; i < 6; i++) {
        const before = clock.t;
        const count = FakeWS.all.length;
        last().drop(1006);
        while (FakeWS.all.length === count) clock.advance(1);
        out.push(clock.t - before);
      }
      return out;
    };
    expect(delays(0)).toEqual([500, 800, 1600, 3200, 6400, 6400]);
    expect(delays(0.999999)).toEqual([600, 1200, 2400, 4800, 8000, 8000]);
  });

  it.each([
    ['no-room', CLOSE_CODES['no-room']],
    ['kicked', CLOSE_CODES.kicked],
    ['closed', CLOSE_CODES.closed],
    ['auth', CLOSE_CODES.auth],
    ['version', CLOSE_CODES.version],
    ['full', CLOSE_CODES.full],
    ['locked', CLOSE_CODES.locked],
  ] as const)('%s（%i）では入り直さない', (code, closeCode) => {
    const { s, errors } = pad();
    s.connect();
    last().accept();
    last().drop(closeCode);
    expect(s.state).toBe('closed');
    expect(errors).toEqual([{ code, closeCode, reason: '', fatal: true }]);
    clock.advance(60_000);
    expect(FakeWS.all).toHaveLength(1);
  });

  it.each([
    ['bad-frame', CLOSE_CODES['bad-frame']],
    ['too-large', CLOSE_CODES['too-large']],
    ['rate', CLOSE_CODES.rate],
    ['timeout', CLOSE_CODES.timeout],
  ] as const)('%s（%i）では入り直す', (code, closeCode) => {
    const { s, errors } = pad();
    s.connect();
    last().accept();
    last().drop(closeCode);
    expect(errors).toEqual([{ code, closeCode, reason: '', fatal: false }]);
    expect(s.state).toBe('reconnecting');
    clock.advance(500);
    expect(FakeWS.all).toHaveLength(2);
  });

  it('URL が関数なら、入り直すたびに呼ぶ', () => {
    let n = 0;
    const s = new RoomSocket({ role: 'pad', url: () => `ws://x/${++n}`, WebSocket: FakeWS, clock, random: () => 0.5 });
    s.connect();
    last().drop(1006);
    clock.advance(500);
    expect(FakeWS.all.map((w) => w.url)).toEqual(['ws://x/1', 'ws://x/2']);
  });

  it('入り直した後は、古い接続から来たものを無視する', () => {
    const { s, frames } = pad();
    s.connect();
    const old = last();
    old.accept();
    old.drop(1006);
    clock.advance(500);
    old.message(PAD_WELCOME('old'));
    expect(frames).toEqual([]);
    expect(s.state).toBe('reconnecting');
  });
});

describe('取って代わられた（4009）', () => {
  it('自動では入り直さない。待ち時間を十分に進めても、新しい接続を作らない', () => {
    const { s, states, errors } = pad();
    s.connect();
    last().accept();
    last().message(PAD_WELCOME('x'));
    last().drop(CLOSE_CODES.replaced, 'replaced');
    expect(s.state).toBe('replaced');
    expect(errors).toEqual([{ code: 'replaced', closeCode: CLOSE_CODES.replaced, reason: 'replaced', fatal: true }]);
    clock.advance(10 * 60_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(clock.pending).toBe(0);
    expect(states).toEqual(['connecting', 'open', 'replaced']);
  });

  it('reconnect() で、すぐに入り直す。札は関数から取り直し、待ち時間は最初に戻る', () => {
    let resume = 'tok';
    const { s, states } = pad({ resume: () => resume });
    s.connect();
    last().drop(1006); // 待ち時間を一度伸ばしておく
    clock.advance(500);
    last().accept();
    last().message(PAD_WELCOME('tok'));
    last().drop(CLOSE_CODES.replaced);
    resume = 'tok2';
    s.reconnect();
    expect(FakeWS.all).toHaveLength(3);
    expect(s.state).toBe('connecting');
    last().accept();
    expect(last().hellos).toEqual([{ t: 'hello', v: 1, role: 'pad', name: 'はなこ', resume: 'tok2' }]);
    last().message(PAD_WELCOME('tok2'));
    expect(s.state).toBe('open');
    expect(states).toEqual(['connecting', 'reconnecting', 'open', 'replaced', 'connecting', 'open']);
    const before = clock.t;
    last().drop(1006);
    while (FakeWS.all.length === 3) clock.advance(1);
    expect(clock.t - before).toBe(500);
  });

  it('reconnect() は、つないでいる最中は何もしない。入り直しの待ちの間なら、待たずにつなぐ', () => {
    const { s } = pad();
    s.connect();
    s.reconnect();
    expect(FakeWS.all).toHaveLength(1);
    last().accept();
    last().message(PAD_WELCOME('x'));
    s.reconnect();
    expect(FakeWS.all).toHaveLength(1);
    last().drop(1006);
    expect(s.state).toBe('reconnecting');
    s.reconnect();
    expect(FakeWS.all).toHaveLength(2);
    expect(clock.pending).toBe(0);
  });

  it('入り直さない理由で閉じた後も、reconnect() なら人の操作として入り直せる', () => {
    const { s } = pad();
    s.connect();
    last().drop(CLOSE_CODES['no-room']);
    expect(s.state).toBe('closed');
    s.reconnect();
    expect(FakeWS.all).toHaveLength(2);
  });
});

describe('生存確認', () => {
  it('15秒ごとに ping を送る', () => {
    const { s } = pad();
    s.connect();
    last().accept();
    last().message(PAD_WELCOME('x'));
    clock.advance(14_999);
    expect(last().sent.filter((x) => x === HEARTBEAT_PING)).toHaveLength(0);
    clock.advance(1);
    expect(last().sent.filter((x) => x === HEARTBEAT_PING)).toHaveLength(1);
    last().message(HEARTBEAT_PONG);
    clock.advance(15_000);
    expect(last().sent.filter((x) => x === HEARTBEAT_PING)).toHaveLength(2);
  });

  it('pong はフレームとして渡さない', () => {
    const { s, frames, errors } = pad();
    s.connect();
    last().accept();
    last().message(HEARTBEAT_PONG);
    expect(frames).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('30秒 pong が来なければ、切って入り直す', () => {
    const { s, errors } = pad();
    s.connect();
    const first = last();
    first.accept();
    first.message(PAD_WELCOME('x'));
    clock.advance(15_000);
    first.message(HEARTBEAT_PONG); // 15秒の時点で pong
    clock.advance(29_999);
    expect(first.closedWith).toBeNull();
    clock.advance(1); // 最後の pong から30秒
    expect(first.closedWith).toEqual({ code: 1000, reason: 'timeout' });
    expect(errors).toEqual([{ code: 'timeout', reason: 'timeout', fatal: false }]);
    expect(s.state).toBe('reconnecting');
    clock.advance(500);
    expect(FakeWS.all).toHaveLength(2);
  });
});

describe('probe（画面に戻った直後の確かめ）', () => {
  function opened() {
    const p = pad();
    p.s.connect();
    last().accept();
    last().message(PAD_WELCOME('x'));
    return p;
  }
  const pings = (ws: FakeWS) => ws.sent.filter((x) => x === HEARTBEAT_PING).length;

  it('(a) pong が来れば入り直さず、いつもの期限の管理に戻る', () => {
    const { s } = opened();
    const ws = last();
    s.probe(3_000);
    expect(pings(ws)).toBe(1);
    clock.advance(100);
    ws.message(HEARTBEAT_PONG);
    clock.advance(10_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(s.state).toBe('open');
    s.probe(3_000); // 終わったあとは、もう一度確かめられる
    expect(pings(ws)).toBe(2);
  });

  it('(b) timeoutMs 以内に pong が来なければ、待たずに捨てて入り直す', () => {
    const { s, errors } = opened();
    const ws = last();
    s.probe(3_000);
    clock.advance(2_999);
    expect(ws.closedWith).toBeNull();
    clock.advance(1);
    expect(ws.closedWith).toEqual({ code: 1000, reason: 'probe' });
    expect(s.state).toBe('reconnecting');
    expect(errors).toEqual([{ code: 'timeout', reason: 'probe', fatal: false }]);
    clock.advance(500);
    expect(FakeWS.all).toHaveLength(2);
  });

  it('(c) open でないときは何もしない', () => {
    const { s } = pad();
    s.probe();
    expect(FakeWS.all).toHaveLength(0);
    s.connect();
    last().accept(); // つながったが、まだ welcome を受けていない
    const before = clock.pending;
    s.probe();
    expect(pings(last())).toBe(0);
    expect(clock.pending).toBe(before);
    last().drop(CLOSE_CODES.replaced);
    s.probe();
    expect(clock.pending).toBe(0);
    expect(s.state).toBe('replaced');
  });

  it('(d) 二重に呼んでも ping は1回で、待ちも1つ', () => {
    const { s } = opened();
    const ws = last();
    const before = clock.pending;
    s.probe(3_000);
    s.probe(3_000);
    s.probe(1_000);
    expect(pings(ws)).toBe(1);
    expect(clock.pending).toBe(before + 1);
    clock.advance(1_000);
    expect(ws.closedWith).toBeNull(); // 後から呼んだ短い待ちは使わない
  });
});

describe('やめる', () => {
  it('close() の後は、サーバーが閉じても入り直さない', () => {
    const { s, states } = pad();
    s.connect();
    const ws = last();
    ws.accept();
    ws.message(PAD_WELCOME('x'));
    s.close();
    expect(ws.closedWith).toEqual({ code: 1000, reason: 'bye' });
    ws.drop(1000);
    clock.advance(60_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(states.at(-1)).toBe('closed');
    expect(clock.pending).toBe(0);
  });

  it('bye を送った後に閉じられたら、入り直さない', () => {
    const { s } = pad();
    s.connect();
    last().accept();
    last().message(PAD_WELCOME('x'));
    s.send({ t: 'bye' });
    last().drop(1000);
    clock.advance(60_000);
    expect(s.state).toBe('closed');
    expect(FakeWS.all).toHaveLength(1);
  });

  it('入り直しを待っている間の close() は、待ちを取り消す', () => {
    const { s } = pad();
    s.connect();
    last().drop(1006);
    s.close();
    clock.advance(60_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(clock.pending).toBe(0);
  });

  it('close() の後に connect() すれば、もう一度つなぐ', () => {
    const { s } = pad();
    s.connect();
    s.close();
    s.connect();
    expect(FakeWS.all).toHaveLength(2);
    expect(s.state).toBe('connecting');
  });
});

describe('URL', () => {
  it.each([
    ['http://192.168.1.5:8787', 'ws://192.168.1.5:8787/api/rooms/BCDF/ws'],
    ['https://irori.example', 'wss://irori.example/api/rooms/BCDF/ws'],
    ['https://irori.example/some/path', 'wss://irori.example/api/rooms/BCDF/ws'],
  ])('%s → %s', (origin, url) => {
    expect(roomSocketUrl(origin, 'BCDF')).toBe(url);
  });
});

it('tilesの画面と入力を運び、不正な再送を捨てても接続を保つ', () => {
  const { s, frames } = pad();
  s.connect(); last().accept(); last().message(PAD_WELCOME('tok'));
  const spec = { k: 'tiles', tiles: [{ id: 'a', label: '札' }], ok: '出す' };
  last().message({ t: 'pad', spec });
  expect(frames.at(-1)).toEqual({ t: 'pad', spec });
  last().message({ t: 'pad', spec: { ...spec, max: 9 } });
  expect(frames.at(-1)).toEqual({ t: 'pad', spec });
  expect(s.send({ t: 'in', i: { k: 'tiles', ids: ['a'] } })).toBe(true);
  expect(JSON.parse(last().sent.at(-1)!)).toEqual({ t: 'in', i: { k: 'tiles', ids: ['a'] } });
  s.close();
});
