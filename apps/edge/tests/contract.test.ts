// room-client（RoomSocket）を、実際の Worker に当てる契約の試験。
// room-client の単体の試験は偽物の WebSocket で動くので、ping の文字列・閉じるコード・再開の札の受け渡しが、
// 本物どうしで合っているかはここで確かめる（偽物どうしの試験は、契約の食い違いを隠す）。
// この試験だけが apps/edge から room-client を読む。src ではないので、依存の向き（check-deps）の対象外。
import { RoomSocket, roomSocketUrl, type SocketState, type WebSocketLike } from '@irori/room-client';
import { describe, expect, it } from 'vitest';
import { createRoom, edge, freshIp, openSocket } from './client';

type Frame = { t: string } & Record<string, unknown>;

/** Node の WebSocket に、試験ごとの接続元IPを付ける。作った接続は外から切れるように覚えておく。 */
function socketsFor(ip: string) {
  const made: WebSocket[] = [];
  class Tagged {
    constructor(url: string) {
      const ws = openSocket(url, ip);
      made.push(ws);
      return ws as unknown as Tagged;
    }
  }
  return { Ctor: Tagged as unknown as new (url: string) => WebSocketLike, made };
}

function collect<T>(subscribe: (fn: (v: T) => void) => void) {
  const seen: T[] = [];
  const waiters: Array<() => void> = [];
  subscribe((v) => {
    seen.push(v);
    for (const w of waiters.splice(0)) w();
  });
  const until = (ok: (v: T) => boolean, timeoutMs = 15_000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`来なかった。届いたもの=${JSON.stringify(seen)}`)), timeoutMs);
      const check = () => {
        const hit = seen.find(ok);
        if (hit !== undefined) {
          clearTimeout(timer);
          resolve(hit);
        } else waiters.push(check);
      };
      check();
    });
  return { seen, until };
}

describe('RoomSocket と Worker の契約', () => {
  it('つなぐ・入力・切れてからの入り直し（同じ札で同じ席）・ping/pong・bye', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const url = roomSocketUrl(base, room.code);

    const hostIo = socketsFor(freshIp());
    const host = new RoomSocket({ role: 'host', url, key: () => room.key, WebSocket: hostIo.Ctor });
    const hostFrames = collect<Frame>((fn) => host.on('frame', fn as (f: Frame) => void));
    host.connect();
    await hostFrames.until((f) => f.t === 'welcome');

    let resume: string | undefined;
    const padIo = socketsFor(freshIp());
    // ping を短くして、自動応答の文字列が合っていることを確かめる（合わなければ pong が来ず、入り直しが起きる）
    const pad = new RoomSocket({
      role: 'pad',
      url,
      name: () => 'けいやく',
      resume: () => resume,
      WebSocket: padIo.Ctor,
      pingIntervalMs: 250,
      pongTimeoutMs: 1_500,
    });
    const padFrames = collect<Frame>((fn) => pad.on('frame', fn as (f: Frame) => void));
    const states = collect<SocketState>((fn) => pad.on('state', fn));
    pad.on('frame', (f) => {
      if (f.t === 'welcome') resume = f.resume;
    });
    pad.connect();
    const welcome = await padFrames.until((f) => f.t === 'welcome');
    expect(welcome).toMatchObject({ you: { id: 1, name: 'けいやく', online: true }, host: true });
    expect(pad.state).toBe('open');

    expect(pad.send({ t: 'in', i: { k: 'btn', id: 'go', d: 1 } })).toBe(true);
    expect(await hostFrames.until((f) => f.t === 'in')).toMatchObject({ p: 1, i: { k: 'btn', id: 'go', d: 1 } });

    // pong が返り続ければ、3秒のあいだ一度も入り直さない（pong の期限1.5秒より長く見るので、文字列が合わなければ必ず入り直す）
    await new Promise((r) => setTimeout(r, 3_000));
    expect(states.seen).toEqual(['connecting', 'open']);
    expect(padIo.made).toHaveLength(1);

    // 回線が切れたことにする → 自動で入り直し、同じ札で同じ席に戻る
    padIo.made[0]!.close();
    await states.until((s) => s === 'reconnecting');
    await hostFrames.until((f) => f.t === 'online' && f.on === false);
    await hostFrames.until((f) => f.t === 'online' && f.on === true);
    await hostFrames.until((f) => f.t === 'pad?');
    const again = padFrames.seen.filter((f) => f.t === 'welcome');
    await padFrames.until(() => padFrames.seen.filter((f) => f.t === 'welcome').length === 2);
    expect(padFrames.seen.filter((f) => f.t === 'welcome').at(-1)).toMatchObject({ you: { id: 1 }, resume: welcome.resume });
    expect(again.length).toBeGreaterThanOrEqual(1);
    expect(padIo.made).toHaveLength(2);

    // bye で抜けたら、入り直さない
    pad.send({ t: 'bye' });
    expect(await hostFrames.until((f) => f.t === 'left')).toEqual({ t: 'left', p: 1, why: 'bye' });
    await states.until((s) => s === 'closed');
    host.send({ t: 'close' });
    host.close();
  });

  it('同じ札で2本つなぐと、古い側は 4009 を受けて入り直さず、新しい側が残る。reconnect() で取り返せる', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const url = roomSocketUrl(base, room.code);
    const host = new RoomSocket({ role: 'host', url, key: () => room.key, WebSocket: socketsFor(freshIp()).Ctor });
    const hostFrames = collect<Frame>((fn) => host.on('frame', fn as (f: Frame) => void));
    host.connect();
    await hostFrames.until((f) => f.t === 'welcome');

    let resume: string | undefined;
    const keep = (f: Frame) => {
      if (f.t === 'welcome') resume = f.resume as string;
    };
    const ioA = socketsFor(freshIp());
    const a = new RoomSocket({ role: 'pad', url, resume: () => resume, WebSocket: ioA.Ctor });
    const aStates = collect<SocketState>((fn) => a.on('state', fn));
    const aErrors = collect<{ code: string; fatal: boolean }>((fn) => a.on('error', fn));
    a.on('frame', keep as (f: unknown) => void);
    a.connect();
    await aStates.until((st) => st === 'open');

    const ioB = socketsFor(freshIp());
    const b = new RoomSocket({ role: 'pad', url, resume: () => resume, WebSocket: ioB.Ctor });
    const bFrames = collect<Frame>((fn) => b.on('frame', fn as (f: Frame) => void));
    const bStates = collect<SocketState>((fn) => b.on('state', fn));
    b.connect();
    expect(await bFrames.until((f) => f.t === 'welcome')).toMatchObject({ you: { id: 1 } });
    await aStates.until((st) => st === 'replaced');
    expect(await aErrors.until((e) => e.fatal)).toMatchObject({ code: 'replaced', closeCode: 4009 });

    // 入り直しの待ち（最初は0.5秒）より十分長く待っても、古い側は新しい接続を作らない
    await new Promise((r) => setTimeout(r, 2_000));
    expect(ioA.made).toHaveLength(1);
    expect(a.state).toBe('replaced');
    expect(b.state).toBe('open');
    b.send({ t: 'in', i: { k: 'menu' } });
    expect(await hostFrames.until((f) => f.t === 'in')).toMatchObject({ p: 1, i: { k: 'menu' } });

    // 人が押したときだけ入り直す。今度は新しかった側が 4009 を受け、やはり入り直さない
    a.reconnect();
    await aStates.until(() => aStates.seen.filter((st) => st === 'open').length === 2);
    await bStates.until((st) => st === 'replaced');
    expect(ioA.made).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(ioB.made).toHaveLength(1);
    host.send({ t: 'close' });
    for (const s of [a, b, host]) s.close();
  });

  it('入り直しても無駄な理由（存在しない部屋）では、閉じたままになる', async () => {
    const base = edge().main;
    const io = socketsFor(freshIp());
    const s = new RoomSocket({ role: 'pad', url: roomSocketUrl(base, 'ZZZZ'), WebSocket: io.Ctor });
    const errors = collect<{ code: string; fatal: boolean }>((fn) => s.on('error', fn));
    s.connect();
    expect(await errors.until((e) => e.fatal)).toMatchObject({ code: 'no-room', closeCode: 4004, fatal: true });
    expect(s.state).toBe('closed');
    expect(io.made).toHaveLength(1);
  });
});
