// ホスト1・スマホ3の通し。作成 → 参加 → 入力 → 画面の指定 → 再接続 → 退出 → 閉じる。
import { describe, expect, it } from 'vitest';
import { createRoom, edge, host, pad, Peer, status, wsUrl } from './client';

const CODE_RE = /^[23456789BCDFGHJKLMNPQRSTVWXYZ]{4}$/;

describe('ホスト1・スマホ3の通し', () => {
  it('作成 → 参加 → 入力 → 画面の指定 → 再接続 → 退出', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    expect(room.code).toMatch(CODE_RE);
    expect(room.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(room.ttl).toBe(30); // CREATE_TTL_S の上書きが効いている
    expect((await status(base, room.code)).body).toEqual({ exists: true, locked: false, players: 0, max: 3 });

    const h = await host(base, room);
    const names = ['あお', 'あか', 'みどり'];
    const pads: Array<{ peer: Peer; welcome: Record<string, unknown> }> = [];
    for (const [i, name] of names.entries()) {
      const p = await pad(base, room.code, { name });
      expect(p.welcome).toMatchObject({ t: 'welcome', role: 'pad', you: { id: i + 1, name, online: true }, host: true });
      expect(await h.take({ t: 'joined' })).toEqual({ t: 'joined', p: { id: i + 1, name, online: true } });
      pads.push(p);
    }
    expect((await status(base, room.code)).body).toEqual({ exists: true, locked: false, players: 3, max: 3 });

    // 入力：席番号と受信時刻はサーバーが付ける。数値は丸める
    pads[1]!.peer.send({ t: 'in', i: { k: 'axis', id: 'stick', x: 2, y: -0.333 } });
    const input = await h.take({ t: 'in' });
    expect(input).toMatchObject({ t: 'in', p: 2, i: { k: 'axis', id: 'stick', x: 1, y: -0.33 } });
    expect(Math.abs((input.T as number) - Date.now())).toBeLessThan(60_000);

    // 画面の指定と振動
    h.send({ t: 'pad', to: '*', spec: { k: 'buzzer', label: '押す' } });
    for (const p of pads) expect(await p.peer.take({ t: 'pad' })).toEqual({ t: 'pad', spec: { k: 'buzzer', label: '押す' } });
    const choices = { k: 'choices', options: [{ id: 'y', label: 'はい' }, { id: 'n', label: 'いいえ' }] };
    h.send({ t: 'pad', to: 3, spec: choices });
    h.send({ t: 'fx', to: 1, ms: [100, 50, 5000] });
    expect(await pads[2]!.peer.take({ t: 'pad' })).toEqual({ t: 'pad', spec: choices });
    expect(await pads[0]!.peer.take({ t: 'fx' })).toEqual({ t: 'fx', ms: [100, 50, 1000] });
    expect(pads[0]!.peer.frames.filter((f) => f.t === 'pad')).toEqual([]);

    // 再接続：切れた席は猶予の間残り、同じ札で同じ席に戻る。ホストには online と pad?
    const resume = pads[1]!.welcome.resume as string;
    pads[1]!.peer.close();
    expect(await h.take({ t: 'online' })).toEqual({ t: 'online', p: 2, on: false });
    const back = await pad(base, room.code, { name: 'あか', resume });
    expect(back.welcome).toEqual({ t: 'welcome', role: 'pad', you: { id: 2, name: 'あか', online: true }, resume, host: true });
    expect(await h.take({ t: 'online' })).toEqual({ t: 'online', p: 2, on: true });
    expect(await h.take({ t: 'pad?' })).toEqual({ t: 'pad?', p: 2 });
    back.peer.send({ t: 'in', i: { k: 'btn', id: 'ok', d: 1 } });
    expect(await h.take({ t: 'in' })).toMatchObject({ p: 2, i: { k: 'btn', id: 'ok', d: 1 } });

    // 退出：bye は 1000 で閉じ、席をすぐ空ける
    pads[2]!.peer.send({ t: 'bye' });
    expect((await pads[2]!.peer.waitClose()).code).toBe(1000);
    expect(await h.take({ t: 'left' })).toEqual({ t: 'left', p: 3, why: 'bye' });
    expect((await status(base, room.code)).body).toMatchObject({ players: 2 });

    // 閉じる：スマホに closed、全員 4010。部屋は消える
    h.send({ t: 'close' });
    expect(await pads[0]!.peer.take({ t: 'closed' })).toEqual({ t: 'closed' });
    expect((await pads[0]!.peer.waitClose()).code).toBe(4010);
    expect((await back.peer.waitClose()).code).toBe(4010);
    expect((await h.waitClose()).code).toBe(4010);
    expect((await status(base, room.code)).body).toMatchObject({ exists: false });
  });

  it('ホストが入り直すと、つながっている全席の pad? が届き、スマホには host の切り替えが届く', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h1 = await host(base, room);
    const a = await pad(base, room.code);
    const b = await pad(base, room.code);
    await h1.take({ t: 'joined', p: { id: 2, name: 'プレイヤー2', online: true } });
    h1.close();
    expect(await a.peer.take({ t: 'host' })).toEqual({ t: 'host', on: false });
    expect(await b.peer.take({ t: 'host' })).toEqual({ t: 'host', on: false });
    const h2 = await Peer.open(wsUrl(base, room.code));
    h2.send({ t: 'hello', v: 1, role: 'host', key: room.key });
    expect(await h2.take({ t: 'welcome' })).toMatchObject({ players: [{ id: 1, online: true }, { id: 2, online: true }] });
    expect(await h2.take({ t: 'pad?', p: 1 })).toEqual({ t: 'pad?', p: 1 });
    expect(await h2.take({ t: 'pad?', p: 2 })).toEqual({ t: 'pad?', p: 2 });
    expect(await a.peer.take({ t: 'host' })).toEqual({ t: 'host', on: true });
    h2.send({ t: 'close' });
    await h2.waitClose();
  });

  it('猶予（上書きで1.5秒）が過ぎると席が空き、ホストに left(timeout)', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    const a = await pad(base, room.code);
    await h.take({ t: 'joined' });
    a.peer.close();
    await h.take({ t: 'online', p: 1, on: false });
    expect(await h.take({ t: 'left' }, 15_000)).toEqual({ t: 'left', p: 1, why: 'timeout' });
    const late = await pad(base, room.code, { resume: a.welcome.resume as string });
    expect(late.welcome.resume).not.toBe(a.welcome.resume);
    h.send({ t: 'close' });
  });

  it('ホストが戻らなければ（上書きで2秒）、スマホに closed が届き 4010 で閉じる', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    const a = await pad(base, room.code);
    h.close();
    await a.peer.take({ t: 'host', on: false });
    expect(await a.peer.take({ t: 'closed' }, 15_000)).toEqual({ t: 'closed' });
    expect((await a.peer.waitClose()).code).toBe(4010);
    expect((await status(base, room.code)).body).toMatchObject({ exists: false });
  });
});
