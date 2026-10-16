// 独立のセキュリティレビュー（R-security）の指摘への対応を、実物の Worker で確かめる。
// 高1：既にある部屋への接続・入退室・ロックが、どの栓にも数えられなかった。中1：名前の書記素の数え方が環境で違った。
import { LIMITS, parseToHostFrame, parseToPadFrame, utf8Length } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { awayFromMinuteEdge, barrier, createRoom, edge, freshIp, host, pad, Peer, status, upgradeStatus, wsUrl, type Json } from './client';
import { MAIN_VARS } from './global-setup';

const WS_PER_MINUTE = LIMITS.WS_CONNECT_PER_IP.perMinute;
const until = async (ok: () => boolean, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error('待ったが条件が揃わない');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('既にある部屋への接続・入退室・ロック', () => {
  it(`hello のない接続200本は、部屋ごとに ${LIMITS.ROOM_MAX_PENDING} 本で止まる`, async () => {
    // hello の待ちが既定（5秒）の plain で見る。待ちを1秒に縮めた main では、試験の途中で待ち中の数が減ってしまう
    const base = edge().plain;
    const room = await createRoom(base);
    const h = await host(base, room);
    const ips = [freshIp(), freshIp(), freshIp(), freshIp()]; // IPごとの栓（毎分60）に当たらないよう、4つに分ける
    const peers = await Promise.all(Array.from({ length: 200 }, (_, i) => Peer.open(wsUrl(base, room.code), ips[i % 4])));
    const refused = () => peers.filter((p) => p.frames.some((f) => f.t === 'err' && f.code === 'rate')).length;
    await until(() => refused() === 200 - LIMITS.ROOM_MAX_PENDING);
    expect(refused()).toBe(200 - LIMITS.ROOM_MAX_PENDING);
    for (const p of peers) p.close();
    h.send({ t: 'close' });
  });

  it(`同じIPからの WebSocket は毎分 ${WS_PER_MINUTE} 本まで。${WS_PER_MINUTE + 1} 本目は、部屋に渡す前に 429`, async () => {
    const base = edge().main;
    await awayFromMinuteEdge();
    const room = await createRoom(base);
    const ip = freshIp();
    for (let i = 0; i < WS_PER_MINUTE; i++) expect(await upgradeStatus(base, room.code, ip)).toBe(101);
    expect(await upgradeStatus(base, room.code, ip)).toBe(429);
    expect(await upgradeStatus(base, 'ZZZZ', ip)).toBe(429); // 存在しない部屋も、部屋を起こす前にここで止まる
    expect(await upgradeStatus(base, room.code, freshIp())).toBe(101);
  });

  it(`hello→bye の100往復は、新しい席 ${LIMITS.ROOM_NEW_SEATS_PER_MINUTE} で止まる`, async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    const ips = [freshIp(), freshIp()];
    let welcomed = 0;
    let refused = 0;
    for (let i = 0; i < 100; i++) {
      const { peer, welcome } = await pad(base, room.code, {}, ips[i % 2]);
      if (welcome.t === 'welcome') {
        welcomed++;
        peer.send({ t: 'bye' });
      } else {
        expect(welcome).toEqual({ t: 'err', code: 'rate' });
        refused++;
      }
    }
    expect(welcomed).toBe(LIMITS.ROOM_NEW_SEATS_PER_MINUTE);
    expect(refused).toBe(100 - LIMITS.ROOM_NEW_SEATS_PER_MINUTE);
    h.send({ t: 'close' });
  });

  it(`ロックの切り替えは、1分に ${LIMITS.ROOM_LOCKS_PER_MINUTE} 回まで。超えた分は効かずに違反として知らせる`, async () => {
    const base = edge().main;
    const room = await createRoom(base);
    const h = await host(base, room);
    for (let i = 0; i < LIMITS.ROOM_LOCKS_PER_MINUTE; i++) h.send({ t: 'lock', on: i % 2 === 0 });
    for (let i = 0; i < 5; i++) h.send({ t: 'lock', on: true });
    await barrier(h);
    expect(h.frames.filter((f) => f.t === 'err' && f.code === 'rate')).toHaveLength(5);
    expect((await status(base, room.code)).body).toMatchObject({ locked: false });
    h.send({ t: 'close' });
  });
});

describe('別のサイトからの要求', () => {
  it('部屋の作成：Origin がホストと違えば 403、Sec-Fetch-Site が cross-site なら 403。同じオリジンと、Origin のない要求は通る', async () => {
    const base = edge().main;
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': freshIp(), ...headers } });
    expect((await post({ Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ Origin: 'null' })).status).toBe(403);
    expect((await post({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await post({ Origin: base, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(201);
    expect((await post({})).status).toBe(201);
  });

  it('WebSocket：Origin がホストと違えば 403。同じオリジンは通る', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    expect(await upgradeStatus(base, room.code, freshIp(), { Origin: 'https://evil.example' })).toBe(403);
    expect(await upgradeStatus(base, room.code, freshIp(), { Origin: base })).toBe(101);
  });
});

describe('IPv6 は /64 に加えて /48 でも数える', () => {
  it('同じ /48 の別々の /64 から作っても、/64 の上限の4倍で止まる', async () => {
    const base = edge().main;
    await awayFromMinuteEdge();
    const perMinute = Number(MAIN_VARS.CREATE_PER_IP_PER_MINUTE);
    const block = `2001:db8:${((Math.random() * 0xffff) | 0).toString(16)}`;
    const wide = perMinute * LIMITS.IPV6_48_FACTOR;
    for (let i = 0; i < wide; i++) await createRoom(base, `${block}:${(i + 1).toString(16)}::1`); // /64 ごとに1部屋
    const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': `${block}:ffff::1` } });
    expect(r.status).toBe(429);
    await expect(createRoom(base, `2001:db8:${((Math.random() * 0xffff) | 0).toString(16)}:1::1`)).resolves.toMatchObject({ ttl: 30 });
  });
});

describe('名前：受け手は書記素でなく、符号位置とバイトで数える', () => {
  const CONJUNCTS = ['\u{1000}\u{1039}\u{1000}', '\u{1780}\u{17d2}\u{1780}', '\u{a98f}\u{a9c0}\u{a98f}', '\u{1b13}\u{1b44}\u{1b13}'];

  it('結合子音を13個並べた名前でも、Node のホストが joined と welcome を受け取れる', async () => {
    const base = edge().plain; // 4人が入るので、席が8つの側で見る（main は3つに上書きしてある）
    const room = await createRoom(base);
    const h = await host(base, room);
    for (const c of CONJUNCTS) {
      const { welcome } = await pad(base, room.code, { name: c.repeat(13) });
      const name = (welcome.you as Json).name as string;
      expect([...name].length).toBeLessThanOrEqual(LIMITS.NAME_MAX_CODEPOINTS);
      const joined = await h.take({ t: 'joined' });
      // Node の受け手は、書記素で数えると12を超える名前を、拒まずに受ける（拒むと参加者が見えなくなっていた）
      expect(parseToHostFrame(JSON.stringify(joined)).ok).toBe(true);
      expect(parseToPadFrame(JSON.stringify(welcome)).ok).toBe(true);
    }
    // 入り直したホストも、名簿の welcome を受け取れる（前は welcome を捨てて先へ進めなかった）
    const again = await Peer.open(wsUrl(base, room.code));
    again.send({ t: 'hello', v: 1, role: 'host', key: room.key });
    const w = await again.take({ t: 'welcome' });
    expect(parseToHostFrame(JSON.stringify(w)).ok).toBe(true);
    again.send({ t: 'close' });
  });

  it('結合記号を積んだ名前（約430バイト）は、中継が96バイトまでに切る', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    await host(base, room);
    const stacked = ('a' + '\u{301}'.repeat(17)).repeat(12);
    expect(utf8Length(JSON.stringify({ t: 'hello', v: 1, role: 'pad', name: stacked }))).toBeLessThan(512);
    const { welcome } = await pad(base, room.code, { name: stacked });
    const name = (welcome.you as Json).name as string;
    expect(utf8Length(name)).toBeLessThanOrEqual(LIMITS.NAME_MAX_BYTES);
    expect([...name].length).toBeLessThanOrEqual(LIMITS.NAME_MAX_CODEPOINTS);
  });
});
