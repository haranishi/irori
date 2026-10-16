import { LIMITS } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, T0, World } from './world';

const MENU = { t: 'in', i: { k: 'menu' } };

function setup(players = 2) {
  const w = new World();
  const h = w.host();
  const pads = Array.from({ length: players }, () => w.pad());
  w.take(h);
  for (const p of pads) w.take(p.conn);
  return { w, h, pads };
}

describe('スマホの再接続', () => {
  it('切れるとホストに online:false、同じ札で入り直すと同じ席に戻り、ホストに online と pad?', () => {
    const { w, h, pads } = setup();
    const a = pads[0]!;
    w.drop(a.conn);
    expect(w.take(h)).toEqual([{ t: 'online', p: 1, on: false }]);
    expect(w.persisted?.seats[0]).toMatchObject({ id: 1, online: false, offAt: w.now });
    w.advance(30_000);
    const back = w.pad({ resume: a.resume ?? '' });
    expect(w.take(back.conn)).toEqual([{ t: 'welcome', role: 'pad', you: { id: 1, name: 'プレイヤー1', online: true }, resume: a.resume, host: true }]);
    expect(w.take(h)).toEqual([
      { t: 'online', p: 1, on: true },
      { t: 'pad?', p: 1 },
    ]);
    expect(w.persisted?.seats[0]).toMatchObject({ id: 1, online: true, offAt: null });
  });

  it('同じ札が二重につながったら、新しいほうを残して古いほうを 4009 で閉じる', () => {
    const { w, h, pads } = setup();
    const a = pads[0]!;
    const twin = w.pad({ resume: a.resume ?? '' });
    expect(twin.seat).toBe(1);
    expect(w.take(a.conn)).toEqual([{ t: 'err', code: 'replaced' }]);
    expect(w.closeCode(a.conn)).toBe(CLOSE_CODES.replaced);
    // 席は切れていないので online は送らない。画面の送り直しだけ頼む
    expect(w.take(h)).toEqual([{ t: 'pad?', p: 1 }]);
    w.send(twin.conn, MENU);
    expect(w.take(h)).toEqual([{ t: 'in', p: 1, i: { k: 'menu' }, T: w.now }]);
    expect(w.core.status(w.now).players).toBe(2);
  });

  it('猶予の60秒が過ぎると席を空け、ホストに left(timeout)。古い札は使えない', () => {
    const { w, h, pads } = setup();
    const a = pads[0]!;
    w.drop(a.conn);
    w.take(h);
    // 目覚ましは期限より遅れない（早く鳴るのはよい。鳴ったときに数え直す）
    expect(w.alarm).toBeLessThanOrEqual(w.now + LIMITS.PAD_GRACE_MS);
    w.advance(LIMITS.PAD_GRACE_MS - 1);
    expect(w.take(h)).toEqual([]);
    w.advance(1);
    expect(w.take(h)).toEqual([{ t: 'left', p: 1, why: 'timeout' }]);
    expect(w.persisted?.seats.map((s) => s.id)).toEqual([2]);
    const late = w.pad({ resume: a.resume ?? '' });
    expect(late.seat).toBe(1);
    expect(late.resume).not.toBe(a.resume);
    expect(w.take(h)).toEqual([{ t: 'joined', p: { id: 1, name: 'プレイヤー1', online: true } }]);
  });

  it('目覚ましが遅れても、期限を過ぎた札では入れない', () => {
    const { w, h, pads } = setup();
    const a = pads[0]!;
    w.drop(a.conn);
    w.take(h);
    w.now += LIMITS.PAD_GRACE_MS + 10; // 目覚ましを鳴らさずに時計だけ進める
    const late = w.pad({ resume: a.resume ?? '' });
    expect(late.resume).not.toBe(a.resume);
    expect(w.take(h)).toEqual([
      { t: 'left', p: 1, why: 'timeout' },
      { t: 'joined', p: { id: 1, name: 'プレイヤー1', online: true } },
    ]);
  });
});

describe('ホストの不在', () => {
  it('ホストが切れるとスマホに host:false。入り直すと全席に pad? が届き、スマホに host:true', () => {
    const { w, h, pads } = setup(3);
    w.drop(pads[2]!.conn);
    w.drop(h);
    for (const p of pads.slice(0, 2)) expect(w.take(p.conn)).toEqual([{ t: 'host', on: false }]);
    expect(w.persisted?.hostOffAt).toBe(w.now);
    w.advance(10_000);
    const h2 = w.host();
    const frames = w.take(h2);
    expect(frames[0]).toMatchObject({ t: 'welcome', players: [{ id: 1, online: true }, { id: 2, online: true }, { id: 3, online: false }] });
    // 切れている席（3）には頼まない。その席は戻ってきたときに pad? が届く
    expect(frames.slice(1)).toEqual([{ t: 'pad?', p: 1 }, { t: 'pad?', p: 2 }]);
    for (const p of pads.slice(0, 2)) expect(w.take(p.conn)).toEqual([{ t: 'host', on: true }]);
  });

  it('ホストが90秒戻らなければ、スマホに closed を送って 4010 で閉じ、部屋を消す', () => {
    const { w, h, pads } = setup();
    w.drop(h);
    for (const p of pads) w.take(p.conn);
    w.advance(LIMITS.HOST_GRACE_MS - 1);
    expect(w.destroyed).toBe(false);
    w.advance(1);
    for (const p of pads) {
      expect(w.take(p.conn)).toEqual([{ t: 'closed' }]);
      expect(w.closeCode(p.conn)).toBe(CLOSE_CODES.closed);
    }
    expect(w.destroyed).toBe(true);
    expect(w.persisted).toBeNull();
  });

  it('作成から60秒、ホストが一度も来なければ閉じる（先に入ったスマホも閉じる）', () => {
    const w = new World();
    const p = w.pad();
    w.take(p.conn);
    w.advance(LIMITS.CREATE_TTL_S * 1000 - 1);
    expect(w.destroyed).toBe(false);
    w.advance(1);
    expect(w.take(p.conn)).toEqual([{ t: 'closed' }]);
    expect(w.destroyed).toBe(true);
  });

  it('一度来たホストには、作成後60秒の期限ではなく、不在の90秒が効く', () => {
    const w = new World();
    const h = w.host();
    w.advance(30_000);
    w.drop(h);
    w.advance(LIMITS.CREATE_TTL_S * 1000);
    expect(w.destroyed).toBe(false);
    w.advance(LIMITS.HOST_GRACE_MS);
    expect(w.destroyed).toBe(true);
  });
});

describe('部屋の寿命', () => {
  it('無操作20分で閉じる', () => {
    const { w, h } = setup();
    w.advance(LIMITS.ROOM_IDLE_MS - 1);
    expect(w.destroyed).toBe(false);
    w.advance(1);
    expect(w.destroyed).toBe(true);
    expect(w.closeCode(h)).toBe(CLOSE_CODES.closed);
  });

  it('操作があれば、20分を過ぎても閉じない。作成から12時間で閉じる', () => {
    const { w, pads } = setup(1);
    const p = pads[0]!.conn;
    let minutes = 0;
    while (!w.destroyed && minutes < 13 * 60) {
      w.advance(60_000);
      if (!w.destroyed) w.send(p, MENU);
      minutes++;
    }
    expect(w.destroyed).toBe(true);
    expect(w.now - T0).toBeGreaterThanOrEqual(LIMITS.ROOM_MAX_MS);
    expect(w.now - T0).toBeLessThan(LIMITS.ROOM_MAX_MS + 60_000);
  });

  it('期限を過ぎた部屋は、目覚ましの前でも status で「ない」と答える', () => {
    const { w } = setup();
    w.now += LIMITS.ROOM_IDLE_MS;
    expect(w.core.status(w.now)).toEqual({ exists: false, locked: false, players: 0, max: 8 });
  });
});

describe('書き込みを増やさない', () => {
  it('入力は保存しない。目覚ましも掛け直さない', () => {
    const { w, h, pads } = setup();
    const persists = w.persists;
    const alarms = w.alarms;
    for (let i = 0; i < 200; i++) {
      w.advance(100);
      w.send(pads[i % 2]!.conn, { t: 'in', i: { k: 'axis', id: 'stick', x: Math.sin(i), y: 0 } });
    }
    expect(w.take(h)).toHaveLength(200);
    expect(w.persists - persists).toBe(0);
    expect(w.alarms - alarms).toBeLessThanOrEqual(1); // 作成時の60秒の目覚ましが鳴った後の、掛け直し1回
  });

  it('最終操作の時刻は、1分に1回まで保存する', () => {
    const { w, pads } = setup(1);
    const persists = w.persists;
    for (let i = 0; i < 600; i++) {
      w.advance(1_000);
      w.send(pads[0]!.conn, MENU);
    }
    expect(w.persists - persists).toBeGreaterThanOrEqual(9);
    expect(w.persists - persists).toBeLessThanOrEqual(10);
  });
});
