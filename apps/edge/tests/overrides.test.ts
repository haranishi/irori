// 上書きの関門。ALLOW_TEST_OVERRIDES が "1" のときだけ、時間と上限の上書きが効く。
// plain は ALLOW_TEST_OVERRIDES を "true"（"1" ではない）にして、小さな値をすべて渡してある（global-setup.ts）。
import { describe, expect, it } from 'vitest';
import { createRoom, edge, freshIp, host, pad, Peer, status, wsUrl } from './client';

describe('ALLOW_TEST_OVERRIDES が "1" でなければ、上書きは効かない', () => {
  it('作成の猶予・席の数・作成と存在確認の回数は既定のまま。不正な MAX_ROOMS_PER_DAY も既定に戻る', async () => {
    const base = edge().plain;
    const ip = freshIp();
    const a = await createRoom(base, ip);
    expect(a.ttl).toBe(60); // CREATE_TTL_S=5 は効かない
    // CREATE_PER_IP_PER_MINUTE=1 は効かない。MAX_ROOMS_PER_DAY=0 は不正な値なので、既定の2000に戻る（0にはならない）
    const b = await createRoom(base, ip);
    expect(b.code).not.toBe(a.code);
    for (let i = 0; i < 3; i++) expect((await status(base, a.code, ip)).body).toMatchObject({ exists: true, max: 8 }); // LOOKUP=1・MAX_PLAYERS=2 は効かない
  });

  it('席は3人目も入れる（MAX_PLAYERS=2 は効かない）', async () => {
    const base = edge().plain;
    const room = await createRoom(base);
    await host(base, room);
    for (let i = 1; i <= 3; i++) expect((await pad(base, room.code)).welcome).toMatchObject({ t: 'welcome', you: { id: i } });
  });

  it('hello の待ち・猶予は既定のまま（100ミリ秒の上書きは効かない）', async () => {
    const base = edge().plain;
    const room = await createRoom(base);
    const h = await host(base, room);
    const a = await pad(base, room.code);
    const silent = await Peer.open(wsUrl(base, room.code));
    a.peer.close();
    await h.take({ t: 'online', p: 1, on: false });
    // 1.5秒たっても、hello のない接続は閉じられず、切れた席も残っている（既定は5秒と60秒）
    await new Promise((r) => setTimeout(r, 1_500));
    expect(silent.closed).toBeNull();
    expect(h.frames.find((f) => f.t === 'left')).toBeUndefined();
    const back = await pad(base, room.code, { resume: a.welcome.resume as string });
    expect(back.welcome).toMatchObject({ t: 'welcome', you: { id: 1 } });
    h.send({ t: 'close' });
  });
});

describe('ALLOW_TEST_OVERRIDES が "1" なら、上書きが効く', () => {
  it('作成の猶予と席の数', async () => {
    const base = edge().main;
    const room = await createRoom(base);
    expect(room.ttl).toBe(30);
    expect((await status(base, room.code)).body).toMatchObject({ max: 3 });
  });
});
