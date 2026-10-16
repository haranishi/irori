import { LIMITS } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, World } from './world';

const MENU = { t: 'in', i: { k: 'menu' } };

function setup() {
  const w = new World();
  const h = w.host();
  const a = w.pad({ name: 'あ' });
  const b = w.pad({ name: 'い' });
  w.take(h);
  w.take(a.conn);
  w.take(b.conn);
  return { w, h, a, b };
}

describe('休止からの復帰', () => {
  it('保存した状態と付属情報から名簿を組み直し、そのまま中継を続ける', () => {
    const { w, h, a, b } = setup();
    w.advance(5_000);
    w.hibernate();
    w.send(b.conn, MENU);
    expect(w.take(h)).toEqual([{ t: 'in', p: 2, i: { k: 'menu' }, T: w.now }]);
    w.send(h, { t: 'pad', to: '*', spec: { k: 'wait' } });
    expect(w.take(a.conn)).toEqual([{ t: 'pad', spec: { k: 'wait' } }]);
    // 名前の重複の判定も、保存した名簿で続く
    const c = w.pad({ name: 'あ' });
    expect(w.take(c.conn)).toMatchObject([{ t: 'welcome', you: { id: 3, name: 'あ2' } }]);
  });

  it('休止をはさんでも、再開の札で同じ席に戻れる', () => {
    const { w, h, a } = setup();
    w.drop(a.conn);
    w.take(h);
    w.advance(20_000);
    w.hibernate();
    const back = w.pad({ resume: a.resume ?? '' });
    expect(back.seat).toBe(1);
    expect(w.take(h)).toEqual([{ t: 'online', p: 1, on: true }, { t: 'pad?', p: 1 }]);
  });

  it('休止をはさんでも、猶予は切れた時刻から数える', () => {
    const { w, h, a } = setup();
    w.drop(a.conn);
    w.take(h);
    w.advance(40_000);
    w.hibernate();
    w.advance(LIMITS.PAD_GRACE_MS - 40_000);
    expect(w.take(h)).toEqual([{ t: 'left', p: 1, why: 'timeout' }]);
  });

  it('休止をはさんでも、ホストの不在は切れた時刻から数える', () => {
    const { w, h, a } = setup();
    w.drop(h);
    w.advance(50_000);
    w.hibernate();
    w.advance(LIMITS.HOST_GRACE_MS - 50_000 - 1);
    expect(w.destroyed).toBe(false);
    w.advance(1);
    expect(w.destroyed).toBe(true);
    expect(w.closeCode(a.conn)).toBe(CLOSE_CODES.closed);
  });

  it('知らせのないまま消えた接続は、復帰した時点で切れたものとして扱う', () => {
    const { w, h, a, b } = setup();
    w.advance(1_000);
    w.hibernate([a.conn]);
    w.send(b.conn, MENU);
    expect(w.take(h)).toEqual([
      { t: 'online', p: 1, on: false },
      { t: 'in', p: 2, i: { k: 'menu' }, T: w.now },
    ]);
    expect(w.persisted?.seats[0]).toMatchObject({ id: 1, online: false, offAt: w.now });
    expect(w.alarm).toBe(w.now + LIMITS.PAD_GRACE_MS);
  });

  it('ホストの接続が消えていれば、スマホに host:false を知らせて不在の猶予を始める', () => {
    const { w, h, a, b } = setup();
    w.hibernate([h]);
    w.send(a.conn, MENU);
    expect(w.take(a.conn)).toEqual([{ t: 'host', on: false }]);
    expect(w.take(b.conn)).toEqual([{ t: 'host', on: false }]);
    expect(w.persisted?.hostOffAt).toBe(w.now);
  });

  it('同じ席を名乗る接続が2つ残っていたら、新しいほうを残す', () => {
    const { w, h, a } = setup();
    const newer = w.open();
    w.attachments.set(newer, { role: 'pad', seat: 1, openedAt: w.now + 1 });
    w.hibernate();
    w.send(newer, MENU);
    expect(w.closeCode(a.conn)).toBe(CLOSE_CODES.replaced);
    expect(w.take(h)).toEqual([{ t: 'in', p: 1, i: { k: 'menu' }, T: w.now }]);
  });

  it('役割の決まっていない接続は、復帰後も hello の期限で閉じる', () => {
    const { w } = setup();
    const c = w.open();
    w.advance(1_000);
    w.hibernate();
    w.advance(LIMITS.HELLO_TIMEOUT_MS);
    expect(w.closeCode(c)).toBe(CLOSE_CODES.timeout);
  });
});
