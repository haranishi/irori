// 部屋の中の栓。既にある部屋への接続・入退室・ロックの連打で、名簿と保存の書き込みを膨らませないこと
// （独立のセキュリティレビューの高1。直す前は、100往復で保存200回、ロック80回で保存80回、待ち中200本がすべて残った）。
import { LIMITS } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, T0, World } from './world';

const MENU = { t: 'in', i: { k: 'menu' } };

describe('hello 前の接続', () => {
  it(`同時に ${LIMITS.ROOM_MAX_PENDING} 本まで。超えた新しい接続は、すぐ 4003 で閉じる`, () => {
    const w = new World();
    w.host();
    const conns = Array.from({ length: 200 }, () => w.open());
    const open = conns.filter((c) => w.closeCode(c) === undefined);
    expect(open).toHaveLength(LIMITS.ROOM_MAX_PENDING);
    const late = conns.at(-1)!;
    expect(w.take(late)).toEqual([{ t: 'err', code: 'rate' }]);
    expect(w.closeCode(late)).toBe(CLOSE_CODES.rate);
  });

  it('待ち中の1本が hello を済ませれば、次の1本を受け付ける', () => {
    const w = new World();
    w.host();
    const conns = Array.from({ length: LIMITS.ROOM_MAX_PENDING }, () => w.open());
    expect(w.closeCode(w.open())).toBe(CLOSE_CODES.rate);
    w.send(conns[0]!, { t: 'hello', v: 1, role: 'pad' });
    const next = w.open();
    expect(w.closeCode(next)).toBeUndefined();
  });
});

describe('新しい席', () => {
  it(`1分に ${LIMITS.ROOM_NEW_SEATS_PER_MINUTE} 席まで。超えた入室は 4003 で断り、保存の書き込みも増えない`, () => {
    const w = new World();
    w.host();
    const persists = w.persists;
    let welcomed = 0;
    let refused = 0;
    for (let i = 0; i < 100; i++) {
      w.advance(5);
      const p = w.pad();
      if (p.seat === null) {
        refused++;
        expect(w.take(p.conn)).toEqual([{ t: 'err', code: 'rate' }]);
        expect(w.closeCode(p.conn)).toBe(CLOSE_CODES.rate);
      } else {
        welcomed++;
        w.send(p.conn, { t: 'bye' });
      }
    }
    expect(welcomed).toBe(LIMITS.ROOM_NEW_SEATS_PER_MINUTE);
    expect(refused).toBe(100 - LIMITS.ROOM_NEW_SEATS_PER_MINUTE);
    // 入室と退出で1回ずつ。断った入室は書き込まない
    expect(w.persists - persists).toBe(2 * LIMITS.ROOM_NEW_SEATS_PER_MINUTE);
  });

  it('札での入り直しは数えない。1分たてば、また入れる', () => {
    const w = new World();
    w.host();
    const keep = w.pad();
    for (let i = 1; i < LIMITS.ROOM_NEW_SEATS_PER_MINUTE; i++) w.send(w.pad().conn, { t: 'bye' });
    expect(w.pad().seat).toBeNull();
    w.drop(keep.conn);
    expect(w.pad({ resume: keep.resume ?? '' }).seat).toBe(1);
    w.advance(60_000);
    expect(w.pad().seat).not.toBeNull();
  });
});

describe('ロックの切り替え', () => {
  it(`1分に ${LIMITS.ROOM_LOCKS_PER_MINUTE} 回まで。超えた分は無視して違反に数え、保存しない`, () => {
    const w = new World();
    const h = w.host();
    w.take(h);
    const persists = w.persists;
    for (let i = 0; i < LIMITS.ROOM_LOCKS_PER_MINUTE; i++) {
      w.advance(10);
      w.send(h, { t: 'lock', on: i % 2 === 0 });
    }
    expect(w.core.status(w.now).locked).toBe(false); // 20回の切り替えのあと
    for (let i = 0; i < 10; i++) {
      w.advance(10);
      w.send(h, { t: 'lock', on: true }); // 状態を変える要求だけが「切り替え」
    }
    expect(w.persists - persists).toBe(LIMITS.ROOM_LOCKS_PER_MINUTE);
    expect(w.take(h)).toEqual(Array.from({ length: 10 }, () => ({ t: 'err', code: 'rate' })));
    expect(w.core.status(w.now).locked).toBe(false);
    expect(w.closeCode(h)).toBeUndefined();
    w.advance(60_000);
    w.send(h, { t: 'lock', on: true });
    expect(w.core.status(w.now).locked).toBe(true);
  });

  it('状態の変わらないロックは数えない', () => {
    const w = new World();
    const h = w.host();
    for (let i = 0; i < 50; i++) w.send(h, { t: 'lock', on: false });
    w.send(h, { t: 'lock', on: true });
    expect(w.core.status(w.now).locked).toBe(true);
  });
});

describe('休止からの復元と無操作の時間', () => {
  it('保存が1分に1回でも、接続の付属情報の時刻と照らし合わせ、早く閉じない', () => {
    const w = new World();
    w.host();
    const p = w.pad();
    // 最後の保存は T0。59秒後の入力は、保存の間隔（1分）より短いので書き込まれない
    w.advance(59_000);
    w.send(p.conn, MENU);
    expect(w.persisted?.lastActivity).toBe(T0);
    w.hibernate();
    w.advance(LIMITS.ROOM_IDLE_MS - 59_000 + 30_000); // 保存の値からは20分30秒、最後の操作からは19分31秒
    expect(w.destroyed).toBe(false);
    w.advance(60_000);
    expect(w.destroyed).toBe(true);
  });

  it('付属情報の時刻は5秒刻みにし、操作のたびには書き換えない', () => {
    const w = new World();
    const h = w.host();
    const seen: Array<number | undefined> = [];
    for (let i = 0; i < 20; i++) {
      w.advance(1_000);
      w.send(h, { t: 'pad', to: '*', spec: { k: 'wait' } });
      seen.push(w.attachments.get(h)?.seen);
    }
    expect(new Set(seen).size).toBeLessThanOrEqual(5);
    for (const s of seen) expect((s ?? 1) % 5_000).toBe(0);
  });
});
