// tap-race（連打レース）の終わり方3つを、本物のコンソール・本物のスマホ3台・実 Worker で最後まで通す。
//   全員完走 … リモコンで選んで開始 → 3台が40回 → 結果 →「もう一度」→ 再び完走 →「ホームへ」
//   時間切れ … ホストの時計を進めて締切を越える。完走していない人は、たたいた回数の順（1回もたたかなかった人は0点）
//   全員退出 … 3台がメニューの「退出」（bye）。結果には3人とも「棄権」0点（退出の印つき）で残り、ホストのキーでホームへ戻れる
// 期待値の文字（「よーい」など）は、ゲームの規則（games/tap-race/logic.js）から読む。
import { OUT_LABEL, PADS, POINTS, TAPS_TO_FINISH } from '../../../games/tap-race/logic.js';
import { expect, test, type Host } from './fixtures';
import { HOST } from './lib/tags';

/** ホストが受け取った、その席の連打ボタン（buzzer）を押した瞬間（d:1）の数。リモコンの押下は数えない。 */
const downs = (host: Host, p: number) => host.inputs(p).filter((r) => r.f.i?.k === 'btn' && r.f.i.id === 'buzzer' && r.f.i.d === 1).length;

test('tap-race 全員完走：リモコンで選んで開始 → 3台が40回 → 結果 →「もう一度」→ 再び完走 →「ホームへ」', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('tap-race', pads[0]);
  for (const round of [1, 2]) {
    await host.expectState('playing');
    for (const p of pads) await p.expectWait((PADS.ready as { title: string }).title);
    await host.expectPhase('race', 15_000);
    for (const p of pads) await p.expectKind('buzzer');
    const before = [1, 2, 3].map((s) => downs(host, s));
    // 1台ずつ完走させる（順位を決めるため）。完走した台には「完走！ N位」。
    for (const [i, p] of pads.entries()) {
      await p.tapMany('buzzer', TAPS_TO_FINISH);
      if (i < 2) await p.expectWait(`完走！ ${i + 1}位`);
    }
    const rows = await host.results();
    expect(rows.map((r) => [r.seat, r.rank, r.score])).toEqual([
      [1, 1, POINTS[0]],
      [2, 2, POINTS[1]],
      [3, 3, POINTS[2]],
    ]);
    // 完走の秒は0.01秒まで（同時に近いゴールでも、表示が分かれる）。
    for (const r of rows) expect(r.label).toMatch(/^\d+\.\d{2}秒$/);
    // 押した数は、送った数とちょうど同じ（取りこぼし・二重がない）。
    expect([1, 2, 3].map((s, i) => downs(host, s) - before[i]!)).toEqual([TAPS_TO_FINISH, TAPS_TO_FINISH, TAPS_TO_FINISH]);
    await pads[0]!.expectKind('remote');
    await pads[1]!.expectKind('wait');
    await expect(host.root.locator('[data-focused]').first()).toHaveAttribute('data-nav', 'results:again');
    if (round === 1) await pads[0]!.tap('ok');
  }
  await pads[0]!.tap('right');
  await expect(host.root.locator('[data-focused]').first()).toHaveAttribute('data-nav', 'results:home');
  await pads[0]!.tap('ok');
  await host.expectState('home');
  await pads[0]!.expectKind('remote');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
});

test('tap-race 時間切れ：ホストの時計を締切まで進めると、たたいた回数の順で結果が出る（0回は0点）', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 15_000);
  await pads[0]!.tapMany('buzzer', 7);
  await pads[1]!.tapMany('buzzer', 12);
  await expect.poll(() => [downs(host, 1), downs(host, 2), downs(host, 3)]).toEqual([7, 12, 0]);
  await host.advance(31_000);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank, r.score, r.label])).toEqual([
    [2, 1, POINTS[0], '12回'],
    [1, 2, POINTS[1], '7回'],
    [3, 3, 0, '0回'],
  ]);
  await pads[0]!.expectKind('remote');
  await pads[0]!.tap('right');
  await pads[0]!.tap('ok');
  await host.expectState('home');
});

test('tap-race 全員退出：3台がメニューの「退出」で bye。結果に全員「棄権」0点で残り、ホストのキーでホームへ', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 15_000);
  await pads[2]!.tapMany('buzzer', 5);
  for (const p of pads) await p.leave();
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.score, r.label, r.gone])).toEqual([1, 2, 3].map((seat) => [seat, 0, OUT_LABEL, true]));
  await expect(host.root).toHaveAttribute('data-players', '0');
  // 全員が出たあとは、ホストのキーボードで戻る（リモコンを持つ人がいない）。
  await host.key('Escape');
  await host.expectState('home');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  expect(host.received.filter((r) => r.f.t === 'left').map((r) => r.f.why)).toEqual(['bye', 'bye', 'bye']);
});
