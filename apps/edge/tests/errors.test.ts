// 閉じるコードの試験。実サーバーの上で、RoomCore の判断が正しいコードで相手に届くことを確かめる。
import { CLOSE_CODES } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { barrier, createRoom, edge, host, pad, Peer, status, wsUrl } from './client';

const MENU = JSON.stringify({ t: 'in', i: { k: 'menu' } });
const padded = (json: string, bytes: number) => json.slice(0, -1) + ' '.repeat(bytes - json.length) + '}';

describe('閉じるコード', () => {
  it('鍵の誤りは 4007', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const p = await Peer.open(wsUrl(base, room.code));
    p.send({ t: 'hello', v: 1, role: 'host', key: 'x'.repeat(43) });
    expect(await p.take({ t: 'err' })).toEqual({ t: 'err', code: 'auth' });
    expect((await p.waitClose()).code).toBe(CLOSE_CODES.auth);
  });

  it('hello がなければ（上書きで1秒）4011', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    const p = await Peer.open(wsUrl(base, room.code));
    expect(await p.take({ t: 'err' }, 15_000)).toEqual({ t: 'err', code: 'timeout' });
    // 一度も送信していない接続は、サーバーが閉じても onclose が約10秒遅れて届く（ローカルの workerd で実測。
    // 先に何か送った接続はすぐ閉じる）。判断の時刻は上の err で見たので、ここはコードだけを確かめる。
    expect((await p.waitClose(30_000)).code).toBe(CLOSE_CODES.timeout);
    h.send({ t: 'close' });
  });

  it('最初のフレームが hello でなければ 4001、版が違えば 4012', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const a = await Peer.open(wsUrl(base, room.code));
    a.send(MENU);
    expect((await a.waitClose()).code).toBe(CLOSE_CODES['bad-frame']);
    const b = await Peer.open(wsUrl(base, room.code));
    b.send({ t: 'hello', v: 99, role: 'pad' });
    expect(await b.take({ t: 'err' })).toEqual({ t: 'err', code: 'version' });
    expect((await b.waitClose()).code).toBe(CLOSE_CODES.version);
  });

  it('過大フレームは 4002（スマホは512バイト。文字数ではなくバイト数で数える）', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    const a = await pad(base, room.code);
    a.peer.send(padded(MENU, 512));
    await h.take({ t: 'in' });
    a.peer.send(padded(MENU, 513));
    expect(await a.peer.take({ t: 'err' })).toEqual({ t: 'err', code: 'too-large' });
    expect((await a.peer.waitClose()).code).toBe(CLOSE_CODES['too-large']);
    // 「あ」は3バイト。200文字で600バイト。文字数では上限に届かない
    const b = await Peer.open(wsUrl(base, room.code));
    b.send({ t: 'hello', v: 1, role: 'pad', name: 'あ'.repeat(200) });
    expect((await b.waitClose()).code).toBe(CLOSE_CODES['too-large']);
    // ホストは16KiBまで
    h.send(padded(JSON.stringify({ t: 'lock', on: false }), 16_384));
    h.send(padded(JSON.stringify({ t: 'lock', on: false }), 16_385));
    expect((await h.waitClose()).code).toBe(CLOSE_CODES['too-large']);
  });

  it('連打は捨てて、続けば 4003', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    const a = await pad(base, room.code);
    for (let i = 0; i < 400; i++) a.peer.send(MENU);
    expect(await a.peer.take({ t: 'err', code: 'rate' })).toEqual({ t: 'err', code: 'rate' });
    expect((await a.peer.waitClose()).code).toBe(CLOSE_CODES.rate);
    const forwarded = h.frames.filter((f) => f.t === 'in').length;
    expect(forwarded).toBeGreaterThan(0);
    expect(forwarded).toBeLessThan(400);
  });

  it('満員（上書きで3席）は 4005。席を持つ人の入り直しは通る', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    await host(base, room);
    const seated = await pad(base, room.code);
    await pad(base, room.code);
    await pad(base, room.code);
    const fourth = await pad(base, room.code);
    expect(fourth.welcome).toEqual({ t: 'err', code: 'full' });
    expect((await fourth.peer.waitClose()).code).toBe(CLOSE_CODES.full);
    seated.peer.close();
    await seated.peer.waitClose();
    const back = await pad(base, room.code, { resume: seated.welcome.resume as string });
    expect(back.welcome).toMatchObject({ t: 'welcome', you: { id: 1 } });
  });

  it('ロック中は 4006。解けば入れる', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    h.send({ t: 'lock', on: true });
    await barrier(h);
    expect((await status(base, room.code)).body).toMatchObject({ locked: true });
    const a = await pad(base, room.code);
    expect(a.welcome).toEqual({ t: 'err', code: 'locked' });
    expect((await a.peer.waitClose()).code).toBe(CLOSE_CODES.locked);
    h.send({ t: 'lock', on: false });
    await barrier(h);
    expect((await status(base, room.code)).body).toMatchObject({ locked: false });
    expect((await pad(base, room.code)).welcome).toMatchObject({ t: 'welcome' });
  });

  it('存在しない部屋は 4004。GET は exists:false', async () => {
    const base = edge().main;
    expect((await status(base, 'ZZZZ')).body).toEqual({ exists: false, locked: false, players: 0, max: 3 });
    const a = await Peer.open(wsUrl(base, 'ZZZZ'));
    expect(await a.take({ t: 'err' })).toEqual({ t: 'err', code: 'no-room' });
    expect((await a.waitClose()).code).toBe(CLOSE_CODES['no-room']);
    // 形の正しくないコードは、部屋を起こさずに Worker が断る
    const b = await Peer.open(wsUrl(base, 'AEIO'));
    expect((await b.waitClose()).code).toBe(CLOSE_CODES['no-room']);
    expect((await status(base, 'not-a-code')).body).toMatchObject({ exists: false });
  });

  it('ホストの二重接続は、古いほうが 4009', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const first = await host(base, room);
    const second = await host(base, room);
    expect(await first.take({ t: 'err' })).toEqual({ t: 'err', code: 'replaced' });
    expect((await first.waitClose()).code).toBe(CLOSE_CODES.replaced);
    second.send({ t: 'close' });
  });

  it('ping には、部屋を起こさずに pong が返る', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const p = await Peer.open(wsUrl(base, room.code));
    p.send('{"t":"ping"}');
    expect(await p.take({ t: 'pong' })).toEqual({ t: 'pong' });
  });
});
