// 上限の栓。IPごとの作成（毎分）、存在確認（毎分。存在しない部屋への WebSocket も同じ枠）、1日の総数。
// 数え方は1分ごとの区切りなので、区切りの直前なら次の分まで待ってから始める（区切りをまたぐと数が戻るため）。
import { describe, expect, it } from 'vitest';
import { awayFromMinuteEdge, createRoom, edge, freshIp, Peer, status, upgradeStatus, wsUrl } from './client';
import { CAPS_VARS, MAIN_VARS } from './global-setup';

const CREATE_PER_MINUTE = Number(MAIN_VARS.CREATE_PER_IP_PER_MINUTE);
const LOOKUP_PER_MINUTE = Number(MAIN_VARS.LOOKUP_PER_IP_PER_MINUTE);

describe('作成の上限（IPごと）', () => {
  it('同じIPから毎分の上限を超えると 429。別のIPは作れる', async () => {
    const base = edge().main;
    await awayFromMinuteEdge();
    const ip = freshIp();
    for (let i = 0; i < CREATE_PER_MINUTE; i++) await createRoom(base, ip);
    const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
    expect(r.status).toBe(429);
    const body = (await r.json()) as { error: string; retryAfterSec: number };
    expect(body.error).toBe('rate');
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(60);
    expect(r.headers.get('Retry-After')).toBe(String(body.retryAfterSec));
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    await expect(createRoom(base, freshIp())).resolves.toMatchObject({ ttl: 30 });
  });

  it('IPv6 は上位64ビットで1人と数える', async () => {
    const base = edge().main;
    await awayFromMinuteEdge();
    const prefix = `2001:db8:${((Math.random() * 0xffff) | 0).toString(16)}:1`;
    for (let i = 0; i < CREATE_PER_MINUTE; i++) await createRoom(base, `${prefix}::${i + 1}`);
    const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': `${prefix}:ffff::9` } });
    expect(r.status).toBe(429);
  });
});

describe('存在確認の上限（コードの総当たりを止める）', () => {
  it('GET /api/rooms/:code は、同じIPから毎分の上限を超えると 429', async () => {
    const base = edge().main;
    await awayFromMinuteEdge();
    const ip = freshIp();
    for (let i = 0; i < LOOKUP_PER_MINUTE; i++) expect((await status(base, 'ZZZZ', ip)).status).toBe(200);
    const r = await status(base, 'ZZZZ', ip);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate' });
    expect((await status(base, 'ZZZZ', freshIp())).status).toBe(200);
  });

  it('存在しない部屋への WebSocket も同じ枠で数える。存在する部屋への接続は数えない', async () => {
    const base = edge().main;
    await awayFromMinuteEdge();
    const room = await createRoom(base);
    const ip = freshIp();
    // 存在する部屋へは、枠より多くつないでも通る
    for (let i = 0; i < LOOKUP_PER_MINUTE + 2; i++) expect(await upgradeStatus(base, room.code, ip)).toBe(101);
    // 存在しない部屋（形の正しいコードと、正しくないコード）への接続と、GET を合わせて数える
    const half = Math.floor(LOOKUP_PER_MINUTE / 2);
    for (let i = 0; i < half; i++) expect(await upgradeStatus(base, 'ZZZZ', ip)).toBe(101);
    for (let i = half; i < LOOKUP_PER_MINUTE - 1; i++) expect(await upgradeStatus(base, 'AEIO', ip)).toBe(101);
    expect((await status(base, 'ZZZZ', ip)).status).toBe(200);
    expect(await upgradeStatus(base, 'ZZZZ', ip)).toBe(429);
    expect(await upgradeStatus(base, 'AEIO', ip)).toBe(429);
    expect((await status(base, room.code, ip)).status).toBe(429);
    // 枠に当たっても、存在する部屋には入れる
    expect(await upgradeStatus(base, room.code, ip)).toBe(101);
    const p = await Peer.open(wsUrl(base, room.code), ip);
    p.send({ t: 'hello', v: 1, role: 'pad' });
    expect(await p.take({ t: 'welcome' })).toMatchObject({ you: { id: 1 } });
  });
});

describe('1日の総数（運営者の値。ALLOW_TEST_OVERRIDES なしでも効く）', () => {
  it('MAX_ROOMS_PER_DAY を超えると 503 {"error":"busy","retryAfterSec":…}', async () => {
    const base = edge().caps;
    for (let i = 0; i < Number(CAPS_VARS.MAX_ROOMS_PER_DAY); i++) await createRoom(base);
    const r = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'CF-Connecting-IP': freshIp() } });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string; retryAfterSec: number };
    expect(body.error).toBe('busy');
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(86_400);
    expect(r.headers.get('Retry-After')).toBe(String(body.retryAfterSec));
  });
});
