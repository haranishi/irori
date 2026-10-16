import type { PlayerInfo } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { reconcile, resultName, seatLeft, startLineup } from '../../src/host/lineup';
import { expandTarget, planPads, type PadTexts } from '../../src/host/padplan';

const p = (id: number, name: string, online = true): PlayerInfo => ({ id, name, online });
const TEXT: PadTexts = {
  remoteHint: 'ゲームを選んで、［決定］を押してください',
  choosing: (name) => `${name}が選んでいます`,
  choosingBody: '大きな画面を見てください',
  lateTitle: '次のゲームから参加できます',
  lateBody: 'いまのゲームが終わるまで、少しお待ちください',
  starting: 'もうすぐ始まります',
  waiting: '待っています',
  menu: 'メニューを操作中です',
};

describe('ゲームの参加者（席の番号と、その席に入った回）', () => {
  it('外した席（left）に別の人が入っても、そのゲームの参加者ではない：待機の画面で、ゲームの宛先にも入らない', () => {
    let l = startLineup([p(1, 'たろう'), p(2, 'はなこ'), p(3, 'じろう')]);
    l = seatLeft(l, 2, 'はなこ');
    // 中継は空いた最小の番号を渡すので、次に入った人も席2になる。
    const now = [p(1, 'たろう'), p(3, 'じろう'), p(2, 'さぶろう')];
    expect([...l.seats]).toEqual([1, 3]);
    const plan = planPads({ owner: 'game', players: now, leader: 1, participants: l.seats, gameSpecs: new Map([[2, { k: 'pad' }]]), text: TEXT });
    expect(plan.get(2)).toMatchObject({ k: 'wait', title: '次のゲームから参加できます' });
    expect(plan.get(1)).toMatchObject({ k: 'wait', title: 'もうすぐ始まります' });
    expect(expandTarget('*', l.seats)).toEqual([1, 3]);
    expect(expandTarget(2, l.seats)).toEqual([]);
  });

  it('退出（bye）のあとに別の人が入っても同じ。抜けた人は、結果に元の名前で「退出」として載る', () => {
    let l = startLineup([p(1, 'たろう'), p(2, 'はなこ')]);
    l = seatLeft(l, 2, 'はなこ');
    const now = [p(1, 'たろう'), p(2, 'さぶろう')];
    expect(resultName(l, now, 2, 'プレイヤー2')).toEqual({ name: 'はなこ', gone: true });
    expect(resultName(l, now, 1, 'プレイヤー1')).toEqual({ name: 'たろう', gone: false });
    // 2回目の left（もう参加者でない席）は、控えの名前を変えない。
    expect(resultName(seatLeft(l, 2, 'さぶろう'), now, 2, 'プレイヤー2')).toEqual({ name: 'はなこ', gone: true });
  });

  it('ホストがつなぎ直したとき：名簿にいない席と、名前の違う席は抜けたものとして扱う。切れていただけの参加者は残す', () => {
    const l = startLineup([p(1, 'たろう'), p(2, 'はなこ'), p(3, 'じろう')]);
    const r = reconcile(l, [p(1, 'たろう', false), p(2, 'さぶろう')]);
    expect([...r.seats]).toEqual([1]);
    expect([...r.gone].sort()).toEqual([2, 3]);
    expect(resultName(r, [], 3, 'プレイヤー3')).toEqual({ name: 'じろう', gone: true });
  });
});
