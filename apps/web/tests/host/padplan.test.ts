import type { GamePadSpec, PlayerInfo } from '@irori/protocol';
import { validatePadSpec } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { expandTarget, planPads, type PadPlanInput, type PadTexts } from '../../src/host/padplan';

const text: PadTexts = {
  remoteHint: 'ゲームを選んで、［決定］を押してください',
  choosing: (name) => `${name}が選んでいます`,
  choosingBody: '大きな画面を見てください',
  lateTitle: '次のゲームから参加できます',
  lateBody: 'いまのゲームが終わるまで、少しお待ちください',
  starting: 'もうすぐ始まります',
  waiting: '待っています',
  menu: 'メニューを操作中です',
};

const p = (id: number, name = `p${id}`, online = true): PlayerInfo => ({ id, name, online });
const base = (over: Partial<PadPlanInput>): PadPlanInput => ({ owner: 'console', players: [p(1, 'たろう'), p(2), p(3)], leader: 1, participants: null, gameSpecs: new Map(), text, ...over });

describe('席ごとのスマホの画面', () => {
  it('一時停止のメニューのあいだは、リーダーのリモコンの案内も、ほかの席も「メニューを操作中です」', () => {
    const plan = planPads(base({ paused: true }));
    expect(plan.get(1)).toEqual({ k: 'remote', hint: 'メニューを操作中です' });
    expect(plan.get(2)).toEqual({ k: 'wait', title: 'メニューを操作中です', body: '大きな画面を見てください' });
    expect(planPads(base({})).get(2)).toMatchObject({ title: 'たろうが選んでいます' });
  });

  it('ホームなど：リーダーにリモコン、ほかに「{名前}が選んでいます」', () => {
    const plan = planPads(base({}));
    expect(plan.get(1)).toEqual({ k: 'remote', hint: text.remoteHint });
    expect(plan.get(2)).toEqual({ k: 'wait', title: 'たろうが選んでいます', body: text.choosingBody });
    expect(plan.get(3)).toEqual({ k: 'wait', title: 'たろうが選んでいます', body: text.choosingBody });
  });

  it('ゲーム中：参加者にはゲームの指定（まだ無ければ「もうすぐ始まります」）、途中から来た人には「次のゲームから参加できます」', () => {
    const spec: GamePadSpec = { k: 'buzzer', label: '連打!' };
    const plan = planPads(base({ owner: 'game', participants: new Set([1, 2]), gameSpecs: new Map([[1, spec]]) }));
    expect(plan.get(1)).toEqual(spec);
    expect(plan.get(2)).toEqual({ k: 'wait', title: text.starting });
    expect(plan.get(3)).toEqual({ k: 'wait', title: text.lateTitle, body: text.lateBody });
  });

  it('送らない状態（部屋がない・つながっていない）では空', () => {
    expect(planPads(base({ owner: 'none' })).size).toBe(0);
  });

  it('作った画面は、中継と同じ検査を必ず通る（12文字の名前でも上限内）', () => {
    const plan = planPads(base({ players: [p(1, 'あいうえおかきくけこさし'), p(2)], leader: 1 }));
    for (const spec of plan.values()) expect(validatePadSpec(spec, true).ok).toBe(true);
    expect(plan.get(2)).toMatchObject({ title: 'あいうえおかきくけこさしが選んでいます' });
  });

  it('リーダーがいない（全員が抜けた直後など）ときは、ただの待機', () => {
    expect(planPads(base({ leader: null })).get(2)).toEqual({ k: 'wait', title: text.waiting });
  });

  it("ゲームの宛先 '*' は参加者だけに広げ、参加者でない席は落とす", () => {
    const parts = new Set([3, 1]);
    expect(expandTarget('*', parts)).toEqual([1, 3]);
    expect(expandTarget(3, parts)).toEqual([3]);
    expect(expandTarget(2, parts)).toEqual([]);
  });
});
