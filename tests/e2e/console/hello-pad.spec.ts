// hello-pad（ハローパッド）の終わり方3つ：リーダーの「おわる」で end／30秒の時間切れ／全員退出。ぴょんの回数が結果に出る。
// 「おわる」はリーダー（最初に入った席）のスマホにだけ出る。リーダーが抜けると、次のリーダーの席へ移る。
import { GAME_MS } from '../../../games/hello-pad/logic.js';
import { expect, test } from './fixtures';
import { HOST } from './lib/tags';

test('hello-pad リーダーの「おわる」：ぴょんの回数が結果になり、「ホームへ」で戻る', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  for (const p of pads) await p.expectKind('pad');
  // 「おわる」はリーダーにだけ。ほかの席は「ぴょん」だけ。
  await expect(pads[0]!.button('end')).toBeVisible();
  for (const p of pads.slice(1)) await expect(p.button('end')).toHaveCount(0);
  await pads[1]!.tapMany('hop', 3, 120);
  await pads[2]!.tap('hop');
  await expect.poll(() => host.inputs(2).filter((r) => r.f.i?.id === 'hop' && r.f.i.d === 1).length).toBe(3);
  await expect.poll(() => host.inputs(3).filter((r) => r.f.i?.id === 'hop' && r.f.i.d === 1).length).toBe(1);
  // スティックも、倒すと axis が届く（離すと 0,0）。
  await pads[0]!.stick(0.8, 0, 400);
  await expect.poll(() => host.inputs(1).filter((r) => r.f.i?.k === 'axis').map((r) => [r.f.i?.x, r.f.i?.y]).at(-1)).toEqual([0, 0]);
  expect(host.inputs(1).some((r) => r.f.i?.k === 'axis' && (r.f.i.x ?? 0) > 0.5)).toBe(true);
  await pads[0]!.tap('end');
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank, r.score, r.label])).toEqual([
    [2, 1, 3, 'ぴょん3回'],
    [3, 2, 1, 'ぴょん1回'],
    [1, 3, 0, 'ぴょん0回'],
  ]);
  await pads[0]!.tap('right');
  await pads[0]!.tap('ok');
  await host.expectState('home');
});

test('hello-pad 時間切れ：ホストの時計を30秒進めると終わり、ぴょんの回数で結果が出る', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  await pads[1]!.tapMany('hop', 2, 120);
  await expect.poll(() => host.inputs(2).filter((r) => r.f.i?.id === 'hop' && r.f.i.d === 1).length).toBe(2);
  await host.advance(GAME_MS);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank, r.score, r.label])).toEqual([
    [2, 1, 2, 'ぴょん2回'],
    [1, 2, 0, 'ぴょん0回'],
  ]);
});

test('hello-pad 全員退出：リーダーが抜けるたびに「おわる」が次の席へ移り、最後の1人が抜けると終わる。結果には3人とも、抜けたときの回数で残る', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  await pads[1]!.tap('hop');
  await pads[0]!.leave();
  await expect(pads[1]!.button('end')).toBeVisible();
  await expect(pads[2]!.button('end')).toHaveCount(0);
  await pads[1]!.leave();
  await expect(pads[2]!.button('end')).toBeVisible();
  await pads[2]!.leave();
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank, r.score, r.label, r.gone])).toEqual([
    [2, 1, 1, 'ぴょん1回', true],
    [1, 2, 0, 'ぴょん0回', true],
    [3, 2, 0, 'ぴょん0回', true],
  ]);
  await host.key('Escape');
  await host.expectState('home');
});
