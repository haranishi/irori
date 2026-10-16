// ソフトキーボード：実機では画面の半分以上を覆う。キーボードが出た後の見える高さ（縦 390×420・横 844×190）で、
// 入力欄にいるあいだ、入力欄と主ボタン（「部屋をさがす」「参加する」）が見える範囲に残ること。
// Playwright は画面の大きさを変えるだけで、キーボードそのものは出せない（Chromium の resizes-content と同じ状態を作る）。
import type { Locator, Page } from '@playwright/test';
import { act, expect, openPad, test } from './e2e/fixtures';

async function inView(page: Page, locator: Locator): Promise<boolean> {
  const b = await locator.boundingBox();
  const v = page.viewportSize();
  if (!b || !v) return false;
  return b.y >= 0 && b.y + b.height <= v.height + 0.5 && b.x >= 0 && b.x + b.width <= v.width + 0.5;
}

const SIZES = [
  { name: '縦', width: 390, height: 420 },
  { name: '横', width: 844, height: 190 },
] as const;

test('Android の Chrome でも、キーボードが出たら画面の高さを縮めるよう頼んでいる（interactive-widget=resizes-content）', async ({ page, line }) => {
  await openPad(page, line);
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content?.split(',').map((s) => s.trim())).toContain('interactive-widget=resizes-content');
});

for (const vp of SIZES) {
  test(`キーボードが出た高さ（${vp.name} ${vp.width}×${vp.height}）でも、コードの枠と「部屋をさがす」が見える`, async ({ page, line }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openPad(page, line);
    // 入力の画面は、出したときに最初の枠へ入る（キーボードが出る）。
    await expect(page.locator('.pp-code__box').nth(0)).toBeFocused();
    await expect.poll(() => inView(page, page.locator('.pp-code__box').nth(0))).toBe(true);
    await expect.poll(() => inView(page, act(page, 'find'))).toBe(true);
  });

  test(`キーボードが出た高さ（${vp.name} ${vp.width}×${vp.height}）でも、名前の欄と「参加する」が見える`, async ({ page, line, makeHost }) => {
    const host = await makeHost();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openPad(page, line, host.code);
    await page.locator('#pp-name').focus();
    await expect.poll(() => inView(page, page.locator('#pp-name'))).toBe(true);
    await expect.poll(() => inView(page, act(page, 'join'))).toBe(true);
    // 名前を打っても、そのまま参加できる。
    await page.locator('#pp-name').pressSequentially('たろう');
    expect(await inView(page, act(page, 'join'))).toBe(true);
  });
}

test('小さい画面でキーボードが出た高さ（縦 340×380）では、名前の欄に入ると「参加する」まで見える範囲へ寄せる', async ({ page, line, makeHost }) => {
  // 開いたときは「参加する」が見える範囲の外にある高さ。欄に入ったときに画面を送らないと、「参加する」がキーボードの裏に残る。
  // （幅より低いと横向きの配置になるので、縦のまま低い 340×380 で試す。）
  const host = await makeHost();
  await page.setViewportSize({ width: 340, height: 380 });
  await openPad(page, line, host.code);
  await page.locator('#pp-name').focus();
  await expect.poll(() => inView(page, page.locator('#pp-name'))).toBe(true);
  await expect.poll(() => inView(page, act(page, 'join'))).toBe(true);
});
