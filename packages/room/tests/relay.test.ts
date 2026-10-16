import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, World } from './world';

function setup(players = 3) {
  const w = new World();
  const h = w.host();
  const pads = Array.from({ length: players }, () => w.pad());
  w.take(h);
  for (const p of pads) w.take(p.conn);
  return { w, h, pads };
}

describe('入力の転送', () => {
  it('席番号と受信時刻を付けてホストへ運ぶ。数値は丸める', () => {
    const { w, h, pads } = setup();
    w.advance(1234);
    w.send(pads[1]!.conn, { t: 'in', i: { k: 'axis', id: 'stick', x: 3, y: 0.126 } });
    expect(w.take(h)).toEqual([{ t: 'in', p: 2, i: { k: 'axis', id: 'stick', x: 1, y: 0.13 }, T: w.now }]);
  });

  it('席番号を名乗るフレームは捨て、違反として知らせる（なりすまし）', () => {
    const { w, h, pads } = setup();
    w.send(pads[1]!.conn, { t: 'in', p: 1, i: { k: 'btn', id: 'a', d: 1 } });
    expect(w.take(h)).toEqual([]);
    expect(w.take(pads[1]!.conn)).toEqual([{ t: 'err', code: 'bad-frame' }]);
  });

  it('スマホがホスト専用のフレームを送っても、効かずに違反になる', () => {
    const { w, h, pads } = setup();
    const evil = pads[2]!.conn;
    for (const f of [{ t: 'kick', p: 1 }, { t: 'lock', on: true }, { t: 'close' }, { t: 'pad', to: '*', spec: { k: 'wait' } }, { t: 'fx', to: 1, ms: [100] }]) {
      w.send(evil, f);
    }
    expect(w.take(evil)).toEqual(Array.from({ length: 5 }, () => ({ t: 'err', code: 'bad-frame' })));
    expect(w.take(h)).toEqual([]);
    expect(w.take(pads[0]!.conn)).toEqual([]);
    expect(w.closeCode(pads[0]!.conn)).toBeUndefined();
    expect(w.destroyed).toBe(false);
    expect(w.core.status(w.now).locked).toBe(false);
  });

  it('ホストがいないあいだの入力は捨てる', () => {
    const { w, h, pads } = setup(1);
    w.drop(h);
    expect(() => w.send(pads[0]!.conn, { t: 'in', i: { k: 'menu' } })).not.toThrow();
    expect(w.take(pads[0]!.conn)).toEqual([{ t: 'host', on: false }]);
  });
});

describe('画面と振動', () => {
  it('全員宛てはつながっている席だけに、1人宛てはその席だけに', () => {
    const { w, h, pads } = setup();
    w.drop(pads[2]!.conn);
    w.send(h, { t: 'pad', to: '*', spec: { k: 'buzzer', label: '押す' } });
    expect(w.take(pads[0]!.conn)).toEqual([{ t: 'pad', spec: { k: 'buzzer', label: '押す' } }]);
    expect(w.take(pads[1]!.conn)).toEqual([{ t: 'pad', spec: { k: 'buzzer', label: '押す' } }]);
    w.send(h, { t: 'pad', to: 2, spec: { k: 'wait' } });
    expect(w.take(pads[0]!.conn)).toEqual([]);
    expect(w.take(pads[1]!.conn)).toEqual([{ t: 'pad', spec: { k: 'wait' } }]);
  });

  it('いない席・切れている席宛ては、黙って捨てる（違反にしない）', () => {
    const { w, h, pads } = setup();
    w.drop(pads[2]!.conn);
    w.take(h);
    w.send(h, { t: 'pad', to: 7, spec: { k: 'wait' } });
    w.send(h, { t: 'pad', to: 3, spec: { k: 'wait' } });
    w.send(h, { t: 'fx', to: 7, ms: [10] });
    expect(w.take(h)).toEqual([]);
    for (const p of pads) expect(w.take(p.conn)).toEqual([]);
  });

  it('振動は8個まで。値は 0〜1000 に丸める', () => {
    const { w, h, pads } = setup(1);
    w.send(h, { t: 'fx', to: '*', ms: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(w.take(h)).toEqual([{ t: 'err', code: 'bad-frame' }]);
    expect(w.take(pads[0]!.conn)).toEqual([]);
    w.send(h, { t: 'fx', to: 1, ms: [5000, -3, 12.4] });
    expect(w.take(pads[0]!.conn)).toEqual([{ t: 'fx', ms: [1000, 0, 12] }]);
  });

  it('remote（コンソール専用の画面）はホストから送れる', () => {
    const { w, h, pads } = setup(1);
    w.send(h, { t: 'pad', to: 1, spec: { k: 'remote', hint: '選ぶ' } });
    expect(w.take(pads[0]!.conn)).toEqual([{ t: 'pad', spec: { k: 'remote', hint: '選ぶ' } }]);
  });
});

describe('退出', () => {
  it('kick は本人に kicked を送って 4008 で閉じ、席をすぐ空ける。札も無効になる', () => {
    const { w, h, pads } = setup();
    const b = pads[1]!;
    w.send(h, { t: 'kick', p: 2 });
    expect(w.take(b.conn)).toEqual([{ t: 'kicked' }]);
    expect(w.closeCode(b.conn)).toBe(CLOSE_CODES.kicked);
    expect(w.take(h)).toEqual([{ t: 'left', p: 2, why: 'kick' }]);
    expect(w.persisted?.seats.map((s) => s.id)).toEqual([1, 3]);
    const again = w.pad({ resume: b.resume ?? '' });
    expect(again.seat).toBe(2);
    expect(again.resume).not.toBe(b.resume);
    expect(w.take(h)).toEqual([{ t: 'joined', p: { id: 2, name: 'プレイヤー2', online: true } }]);
  });

  it('切れている席も kick で外せる', () => {
    const { w, h, pads } = setup();
    w.drop(pads[0]!.conn);
    w.take(h);
    w.send(h, { t: 'kick', p: 1 });
    expect(w.take(h)).toEqual([{ t: 'left', p: 1, why: 'kick' }]);
  });

  it('bye は 1000 で閉じ、席をすぐ空ける', () => {
    const { w, h, pads } = setup();
    w.send(pads[0]!.conn, { t: 'bye' });
    expect(w.closeCode(pads[0]!.conn)).toBe(1000);
    expect(w.take(h)).toEqual([{ t: 'left', p: 1, why: 'bye' }]);
    expect(w.core.status(w.now).players).toBe(2);
  });

  it('ホストの close で、スマホに closed を送って全員 4010、部屋を消す', () => {
    const { w, h, pads } = setup();
    w.send(h, { t: 'close' });
    for (const p of pads) {
      expect(w.take(p.conn)).toEqual([{ t: 'closed' }]);
      expect(w.closeCode(p.conn)).toBe(CLOSE_CODES.closed);
    }
    expect(w.take(h)).toEqual([{ t: 'err', code: 'closed' }]);
    expect(w.closeCode(h)).toBe(CLOSE_CODES.closed);
    expect(w.destroyed).toBe(true);
    expect(w.core.status(w.now).exists).toBe(false);
  });
});
