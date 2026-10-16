// 参加：ホストの画面のQRを読み取ると /pad#CODE。3台が「参加する」を1回押すと、ホストの帯に3人が並び、
// 最初に入った人のスマホがリモコン、ほかは待機になる。どの組でも流す（4組の入口の確かめ）。
import { expect, test } from './fixtures';
import { ALL } from './lib/tags';

test('参加：QRは /pad#CODE。3台が1回押すだけで入り、帯に3人・リーダーにリモコン', ALL, async ({ rig }) => {
  const host = await rig.openHost();
  const code = await host.code();
  expect(await host.readQr()).toBe(`${host.base}/pad#${code}`);
  await expect(host.page.locator('.join__code')).toHaveText(code);

  const pads = await rig.join(host, ['たろう', 'はなこ', undefined]);
  expect(await Promise.all(pads.map((p) => p.seat()))).toEqual([1, 2, 3]);
  await expect(host.page.locator('.seat[data-seat]')).toHaveCount(3);
  const seats = await host.seats();
  expect(seats.map((s) => [s.seat, s.online, s.leader])).toEqual([
    [1, true, true],
    [2, true, false],
    [3, true, false],
  ]);
  expect(seats.slice(0, 2).map((s) => s.name)).toEqual(['たろう', 'はなこ']);
  await expect(host.root).toHaveAttribute('data-players', '3');
  await expect(host.root).toHaveAttribute('data-leader', '1');
  await pads[0]!.expectKind('remote');
  await pads[1]!.expectKind('wait');
  await pads[2]!.expectKind('wait');
  // スマホの縁と札は、自分の席の色と形（data-seat）。
  for (const [i, p] of pads.entries()) await expect(p.play).toHaveAttribute('data-seat', String(i + 1));
});
