import type { PlayerInfo } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { applyFrame, EMPTY_ROSTER, fit, nextLeader, withLocked, type Roster } from '../../src/host/roster';

const p = (id: number, online = true, name = `p${id}`): PlayerInfo => ({ id, name, online });

function joined(r: Roster, ...ids: number[]): Roster {
  return ids.reduce((acc, id) => applyFrame(acc, { t: 'joined', p: p(id) }), r);
}

describe('リーダー（最初に入った席。離れたら接続中の最小の席へ）', () => {
  it('最初に入った人がリーダーになり、あとから入った人では変わらない', () => {
    const r = joined(EMPTY_ROSTER, 3, 1, 2);
    expect(r.leader).toBe(3);
    expect(r.players.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('リーダーが切れたら、接続中の最小の席へ移る（戻ってきても戻さない）', () => {
    let r = joined(EMPTY_ROSTER, 1, 2, 3);
    r = applyFrame(r, { t: 'online', p: 1, on: false });
    expect(r.leader).toBe(2);
    r = applyFrame(r, { t: 'online', p: 1, on: true });
    expect(r.leader).toBe(2);
  });

  it('リーダーが抜けたら、接続中の最小の席へ移る。切れている席は飛ばす', () => {
    let r = joined(EMPTY_ROSTER, 1, 2, 3);
    r = applyFrame(r, { t: 'online', p: 2, on: false });
    r = applyFrame(r, { t: 'left', p: 1, why: 'bye' });
    expect(r.leader).toBe(3);
  });

  it('誰もつながっていないときは、席が残っていればそのまま。最後の人が抜けたら null', () => {
    let r = joined(EMPTY_ROSTER, 1);
    r = applyFrame(r, { t: 'online', p: 1, on: false });
    expect(r.leader).toBe(1);
    r = applyFrame(r, { t: 'left', p: 1, why: 'timeout' });
    expect(r.leader).toBeNull();
  });

  it('nextLeader：いまのリーダーがつながっていれば変えない', () => {
    expect(nextLeader([p(1), p(2)], 2)).toBe(2);
    expect(nextLeader([p(1, false), p(4), p(2)], 1)).toBe(2);
    expect(nextLeader([], null)).toBeNull();
  });

  it('welcome（ホストの入り直し）では、覚えていたリーダーを続ける。切れていれば移す', () => {
    const before: Roster = { ...EMPTY_ROSTER, leader: 2 };
    const w = applyFrame(before, { t: 'welcome', role: 'host', code: 'BCDF', players: [p(1), p(2)], max: 8, locked: true });
    expect(w).toMatchObject({ leader: 2, locked: true, max: 8 });
    const w2 = applyFrame(before, { t: 'welcome', role: 'host', code: 'BCDF', players: [p(1), p(2, false)], max: 8, locked: false });
    expect(w2.leader).toBe(1);
  });

  it('ロックの切り替えは、同じ値なら同じものを返す', () => {
    const r = withLocked(EMPTY_ROSTER, true);
    expect(r.locked).toBe(true);
    expect(withLocked(r, true)).toBe(r);
  });
});

describe('人数に合うか（合わないゲームは灰色にして理由を1行）', () => {
  it('足りない：あと何人', () => {
    expect(fit({ min: 2, max: 8 }, 1)).toEqual({ ok: false, why: 'need', n: 1 });
    expect(fit({ min: 3, max: 8 }, 0)).toEqual({ ok: false, why: 'need', n: 3 });
  });

  it('多すぎる：最大何人', () => {
    expect(fit({ min: 1, max: 4 }, 5)).toEqual({ ok: false, why: 'over', max: 4 });
  });

  it('範囲の端は遊べる', () => {
    expect(fit({ min: 2, max: 4 }, 2)).toEqual({ ok: true });
    expect(fit({ min: 2, max: 4 }, 4)).toEqual({ ok: true });
  });
});
