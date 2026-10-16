import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, World, sha, T0 } from './world';

describe('作成', () => {
  it('鍵はホストにだけ返し、保存にはハッシュだけを残す', () => {
    const w = new World();
    expect(w.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(w.persisted?.keyHash).toBe(sha(w.key));
    expect(JSON.stringify(w.persisted)).not.toContain(w.key);
    // 作成後60秒でホストが来なければ閉じるので、そこに目覚ましを掛ける
    expect(w.alarm).toBe(T0 + 60_000);
  });

  it('保存する状態は決めた項目だけ', () => {
    const w = new World();
    w.host();
    w.pad({ name: 'たろう' });
    expect(Object.keys(w.persisted ?? {}).sort()).toEqual(
      ['code', 'createdAt', 'hostOffAt', 'hostSeen', 'keyHash', 'lastActivity', 'locked', 'seats', 'v'].sort(),
    );
    expect(Object.keys(w.persisted?.seats[0] ?? {}).sort()).toEqual(['id', 'name', 'offAt', 'online', 'resumeHash'].sort());
  });
});

describe('入室', () => {
  it('ホストが入ると welcome、スマホが入るとホストに joined', () => {
    const w = new World();
    const h = w.host();
    expect(w.take(h)).toEqual([{ t: 'welcome', role: 'host', code: 'BCDF', players: [], max: 8, locked: false }]);
    const p = w.pad({ name: 'たろう' });
    expect(w.take(p.conn)).toEqual([{ t: 'welcome', role: 'pad', you: { id: 1, name: 'たろう', online: true }, resume: p.resume, host: true }]);
    expect(p.resume).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(w.take(h)).toEqual([{ t: 'joined', p: { id: 1, name: 'たろう', online: true } }]);
    expect(JSON.stringify(w.persisted)).not.toContain(p.resume);
  });

  it('ホストより先に入ったスマホは「ホストを待つ」状態で、ホストが来たら知らされる', () => {
    const w = new World();
    const p = w.pad();
    expect(w.take(p.conn)).toMatchObject([{ t: 'welcome', host: false }]);
    const h = w.host();
    expect(w.take(h)).toEqual([
      { t: 'welcome', role: 'host', code: 'BCDF', players: [{ id: 1, name: 'プレイヤー1', online: true }], max: 8, locked: false },
      { t: 'pad?', p: 1 },
    ]);
    expect(w.take(p.conn)).toEqual([{ t: 'host', on: true }]);
  });

  it('席は空いている最小の番号', () => {
    const w = new World();
    w.host();
    const a = w.pad();
    const b = w.pad();
    const c = w.pad();
    expect([a.seat, b.seat, c.seat]).toEqual([1, 2, 3]);
    w.send(b.conn, { t: 'bye' });
    expect(w.pad().seat).toBe(2);
    expect(w.pad().seat).toBe(4);
  });

  it('名前は掃除し、空なら「プレイヤーN」、重複には番号を付ける', () => {
    const w = new World();
    const h = w.host();
    w.pad({ name: '  \u{202e}たろう\u{200b} ' });
    w.pad({ name: 'たろう' });
    w.pad({ name: 'たろう' });
    w.pad({ name: '\u{200d}\u{3164}' });
    w.pad({ name: 'プレイヤー5' });
    w.pad({ name: 'あいうえおかきくけこさし' });
    w.pad({ name: 'あいうえおかきくけこさし' });
    const names = w.take(h).flatMap((f) => (f.t === 'joined' ? [f.p.name] : []));
    expect(names).toEqual(['たろう', 'たろう2', 'たろう3', 'プレイヤー4', 'プレイヤー5', 'あいうえおかきくけこさし', 'あいうえおかきくけこさ2']);
  });

  it('満員なら新しい人は 4005。席を持つ人の入り直しは通る', () => {
    const w = new World({ MAX_PLAYERS: 3 });
    w.host();
    const a = w.pad();
    w.pad();
    w.pad();
    const d = w.pad();
    expect(d.seat).toBeNull();
    expect(w.take(d.conn)).toEqual([{ t: 'err', code: 'full' }]);
    expect(w.closeCode(d.conn)).toBe(CLOSE_CODES.full);
    w.drop(a.conn);
    const back = w.pad({ resume: a.resume ?? '' });
    expect(back.seat).toBe(1);
  });

  it('ロック中は新しい人は 4006。席を持つ人の入り直しは通る。解けば入れる', () => {
    const w = new World();
    const h = w.host();
    const a = w.pad();
    w.send(h, { t: 'lock', on: true });
    expect(w.persisted?.locked).toBe(true);
    const b = w.pad();
    expect(w.take(b.conn)).toEqual([{ t: 'err', code: 'locked' }]);
    expect(w.closeCode(b.conn)).toBe(CLOSE_CODES.locked);
    w.drop(a.conn);
    expect(w.pad({ resume: a.resume ?? '' }).seat).toBe(1);
    w.send(h, { t: 'lock', on: false });
    expect(w.pad().seat).toBe(2);
  });

  it('上書きでも席の上限は8を超えない', () => {
    const w = new World({ MAX_PLAYERS: 20 });
    expect(w.core.status(w.now).max).toBe(8);
  });
});

describe('握手', () => {
  it('鍵が違えば 4007', () => {
    const w = new World();
    const c = w.host('wrong');
    expect(w.take(c)).toEqual([{ t: 'err', code: 'auth' }]);
    expect(w.closeCode(c)).toBe(CLOSE_CODES.auth);
  });

  it('hello の前の、ほかのフレームは 4001', () => {
    const w = new World();
    const c = w.open();
    w.send(c, { t: 'in', i: { k: 'menu' } });
    expect(w.take(c)).toEqual([{ t: 'err', code: 'bad-frame' }]);
    expect(w.closeCode(c)).toBe(CLOSE_CODES['bad-frame']);
  });

  it('壊れた hello・バイナリも 4001、版の違いは 4012', () => {
    const w = new World();
    const a = w.open();
    w.raw(a, '{"t":"hello"');
    expect(w.closeCode(a)).toBe(4001);
    const b = w.open();
    w.binary(b, 10);
    expect(w.closeCode(b)).toBe(4001);
    const c = w.open();
    w.send(c, { t: 'hello', v: 2, role: 'pad' });
    expect(w.take(c)).toEqual([{ t: 'err', code: 'version' }]);
    expect(w.closeCode(c)).toBe(CLOSE_CODES.version);
  });

  it('hello が5秒来なければ 4011（目覚ましで）', () => {
    const w = new World();
    w.host();
    const c = w.open();
    expect(w.alarm).toBe(T0 + 5_000);
    w.advance(4_999);
    expect(w.closeCode(c)).toBeUndefined();
    w.advance(1);
    expect(w.take(c)).toEqual([{ t: 'err', code: 'timeout' }]);
    expect(w.closeCode(c)).toBe(CLOSE_CODES.timeout);
  });

  it('役割は途中で変えられない（2度目の hello は違反）', () => {
    const w = new World();
    const h = w.host();
    w.take(h);
    w.send(h, { t: 'hello', v: 1, role: 'pad' });
    expect(w.take(h)).toEqual([{ t: 'err', code: 'bad-frame' }]);
    expect(w.closeCode(h)).toBeUndefined();
  });

  it('ホストの二重接続は新しいほうが勝ち、古いほうは 4009。スマホは「ホスト不在」にならない', () => {
    const w = new World();
    const a = w.host();
    const p = w.pad();
    w.take(p.conn);
    const b = w.host();
    expect(w.take(a)).toContainEqual({ t: 'err', code: 'replaced' });
    expect(w.closeCode(a)).toBe(CLOSE_CODES.replaced);
    expect(w.take(b)).toEqual([
      { t: 'welcome', role: 'host', code: 'BCDF', players: [{ id: 1, name: 'プレイヤー1', online: true }], max: 8, locked: false },
      { t: 'pad?', p: 1 },
    ]);
    expect(w.take(p.conn)).toEqual([]);
    w.send(p.conn, { t: 'in', i: { k: 'menu' } });
    expect(w.take(b)).toEqual([{ t: 'in', p: 1, i: { k: 'menu' }, T: w.now }]);
  });
});
