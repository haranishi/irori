import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRoom, ROOM_KEY, RoomLink, type LinkEvents } from '../../src/host/session';
import { busy, created, FakeDoc, memoryStorage, offline, roomsApi, SocketFactory } from './fakes';

const ORIGIN = 'https://irori.example';
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(fetchFn: typeof fetch, storage = memoryStorage()) {
  const sockets = new SocketFactory();
  const doc = new FakeDoc();
  const win = new EventTarget();
  const events = {
    welcome: vi.fn(),
    frame: vi.fn(),
    lost: vi.fn(),
    replaced: vi.fn(),
    closed: vi.fn(),
    busy: vi.fn(),
    offline: vi.fn(),
    version: vi.fn(),
  } satisfies LinkEvents;
  const link = new RoomLink({
    origin: ORIGIN,
    fetch: fetchFn,
    storage,
    makeSocket: sockets.make,
    doc: doc as unknown as Document,
    win: win as unknown as Window,
    events,
  });
  return { link, sockets, doc, win, events, storage };
}

afterEach(() => vi.restoreAllMocks());

describe('部屋を作り、鍵を sessionStorage に置く', () => {
  it('保存がなければ POST /api/rooms で作り、コードと鍵を保存して、そのコードの WebSocket につなぐ', async () => {
    const api = roomsApi(created('BCDF', 'secret-key'));
    const { link, sockets, storage } = setup(api.fetch);
    await link.open();
    expect(api.calls).toEqual(['POST /api/rooms']);
    expect(readRoom(storage)).toEqual({ code: 'BCDF', key: 'secret-key', leader: null });
    expect(sockets.last.url).toBe('wss://irori.example/api/rooms/BCDF/ws');
    expect(sockets.last.key()).toBe('secret-key');
    expect(sockets.last.connects).toBe(1);
    expect(link.code).toBe('BCDF');
  });

  it('再読み込み：保存した鍵で同じ部屋に戻る（作り直さない）', async () => {
    const storage = memoryStorage();
    storage.setItem(ROOM_KEY, JSON.stringify({ code: 'XN7Q', key: 'k1', leader: 2 }));
    const api = roomsApi(created('ZZZZ'));
    const { link, sockets, events } = setup(api.fetch, storage);
    await link.open();
    expect(api.calls).toEqual([]);
    expect(sockets.last.key()).toBe('k1');
    expect(link.storedLeader).toBe(2);
    sockets.last.welcome('XN7Q');
    expect(events.welcome).toHaveBeenCalledTimes(1);
  });

  it('保存した部屋が消えていたら（no-room・auth）、新しく作る', async () => {
    for (const code of ['no-room', 'auth'] as const) {
      const storage = memoryStorage();
      storage.setItem(ROOM_KEY, JSON.stringify({ code: 'XN7Q', key: 'old', leader: null }));
      const api = roomsApi(created('BCDF', 'new'));
      const { link, sockets, events } = setup(api.fetch, storage);
      await link.open();
      sockets.last.fail(code);
      await flush();
      expect(api.calls).toEqual(['POST /api/rooms']);
      expect(sockets.made).toHaveLength(2);
      expect(sockets.last.key()).toBe('new');
      expect(readRoom(storage)?.code).toBe('BCDF');
      expect(events.closed).not.toHaveBeenCalled();
    }
  });

  it('作ったばかりの部屋が no-room なら、作り直し続けず「閉じた」にする', async () => {
    const api = roomsApi(created('BCDF'), created('CDFG'));
    const { link, sockets, events, storage } = setup(api.fetch);
    await link.open();
    sockets.last.welcome('BCDF');
    sockets.last.fail('no-room');
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(events.closed).toHaveBeenCalledTimes(1);
    expect(readRoom(storage)).toBeNull();
  });

  it('部屋が閉じた（closed）：保存を消して closed', async () => {
    const api = roomsApi(created('BCDF'));
    const { link, sockets, events, storage } = setup(api.fetch);
    await link.open();
    sockets.last.welcome('BCDF');
    sockets.last.fail('closed');
    expect(events.closed).toHaveBeenCalledTimes(1);
    expect(readRoom(storage)).toBeNull();
    expect(link.code).toBeNull();
  });

  it('503（1日の上限）と 429（作りすぎ）は busy。理由と待つ秒数を渡す', async () => {
    const a = setup(roomsApi(busy(503, 3600)).fetch);
    await a.link.open();
    expect(a.events.busy).toHaveBeenCalledWith({ reason: 'daily', retryAfterSec: 3600 });
    const b = setup(roomsApi(busy(429, 30)).fetch);
    await b.link.open();
    expect(b.events.busy).toHaveBeenCalledWith({ reason: 'rate', retryAfterSec: 30 });
    expect(b.sockets.made).toHaveLength(0);
  });

  it('作りに行けない（回線がない）ときは offline。online になったら作り直す', async () => {
    const api = roomsApi(offline, created('BCDF'));
    const { link, sockets, events, win } = setup(api.fetch);
    await link.open();
    expect(events.offline).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(api.calls).toHaveLength(2);
    expect(sockets.made).toHaveLength(1);
  });

  it('壊れた作成の応答（コードの形が違う）は、つながずに offline', async () => {
    const api = roomsApi(() => new Response(JSON.stringify({ code: 'aeiou', key: 'k' }), { status: 201 }));
    const { link, sockets, events } = setup(api.fetch);
    await link.open();
    expect(events.offline).toHaveBeenCalledTimes(1);
    expect(sockets.made).toHaveLength(0);
  });
});

describe('切断と入り直し', () => {
  it('replaced（4009）では自動で入り直さない。人が押したときだけ reconnect()', async () => {
    const { link, sockets, events } = setup(roomsApi(created('BCDF')).fetch);
    await link.open();
    const s = sockets.last;
    s.welcome('BCDF');
    s.fail('replaced');
    expect(events.replaced).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.reconnects).toBe(0);
    expect(s.connects).toBe(1);
    expect(sockets.made).toHaveLength(1);
    link.reconnect();
    expect(s.reconnects).toBe(1);
  });

  it('つながっていた接続が切れて入り直しているあいだは lost', async () => {
    const { link, sockets, events } = setup(roomsApi(created('BCDF')).fetch);
    await link.open();
    sockets.last.welcome('BCDF');
    sockets.last.fail('network', false);
    expect(events.lost).toHaveBeenCalledTimes(1);
  });

  it('画面に戻ったとき（visibilitychange で visible）に probe() を呼ぶ。隠れたときは呼ばない', async () => {
    const { link, sockets, doc } = setup(roomsApi(created('BCDF')).fetch);
    await link.open();
    sockets.last.welcome('BCDF');
    doc.hide();
    expect(sockets.last.probes).toBe(0);
    doc.show();
    expect(sockets.last.probes).toBe(1);
  });

  it('pageshow でも probe()。online は、入り直しの最中なら待たずに reconnect()', async () => {
    const { link, sockets, win } = setup(roomsApi(created('BCDF')).fetch);
    await link.open();
    const s = sockets.last;
    s.welcome('BCDF');
    win.dispatchEvent(new Event('pageshow'));
    expect(s.probes).toBe(1);
    win.dispatchEvent(new Event('online'));
    expect(s.probes).toBe(2);
    s.setState('reconnecting');
    win.dispatchEvent(new Event('online'));
    expect(s.reconnects).toBe(1);
  });

  it('受け手が例外を投げても、受け取りは止まらない（報告だけする）', async () => {
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const { link, sockets, events } = setup(roomsApi(created('BCDF')).fetch);
    events.frame.mockImplementation(() => {
      throw new Error('boom');
    });
    await link.open();
    sockets.last.welcome('BCDF');
    sockets.last.frame({ t: 'online', p: 1, on: true });
    sockets.last.frame({ t: 'online', p: 1, on: false });
    expect(events.frame).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('リーダーを保存し、再読み込みで読める', async () => {
    const { link, storage } = setup(roomsApi(created('BCDF', 'k')).fetch);
    await link.open();
    link.rememberLeader(3);
    expect(readRoom(storage)).toEqual({ code: 'BCDF', key: 'k', leader: 3 });
  });
});
