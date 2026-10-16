// 単体で開いた SDK が、仮想プレイヤーとして動く（?mock=3、キーボード、end）。枠ではなく、ゲームを直接開く。
import { expect, test } from './harness';

// 仮想プレイヤーの文言は navigator.language で決まる。日本語の文言を見るため、この試験だけ ja-JP にする。
test.use({ locale: 'ja-JP' });

test('?mock=3 で3人の仮想プレイヤー。キーボードで操作でき、席1のボタンで結果が出る', async ({ page, consoleServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${consoleServer.url}/games/mock/index.html?mock=3`);

  await page.waitForFunction(() => window.__mode === 'mock');
  expect(await page.evaluate(() => window.__players)).toBe(3);
  await expect(page.locator('.irori-mock__banner')).toContainText('開発モード');
  await expect(page.locator('.irori-mock__seat')).toHaveCount(3);

  // キーボード：1人目は WASD。右を押すと axis が入る。
  await page.locator('canvas').click();
  await page.keyboard.press('KeyD');
  await expect
    .poll(() => page.evaluate(() => (window.__inputs ?? []).some(([p, i]) => p === 1 && i.k === 'axis' && i.x === 1)))
    .toBe(true);

  // 画面脇のパッド：2人目の席のパッドを押すと、2人目の入力になる。
  const seat2 = page.locator('.irori-mock__seat[data-p="2"]');
  await expect(seat2.locator('svg[data-shape="square"]')).toHaveCount(1);

  // 席1のボタン（Space = jump）で end → 結果の画面と「もう一度」。
  await page.keyboard.press('Space');
  await expect(page.locator('.irori-mock__results')).toBeVisible();
  await expect(page.locator('.irori-mock__again')).toHaveText('もう一度');
  const ranks = await page.locator('.irori-mock__results li').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.p));
  expect(ranks).toEqual(['1', '2']);

  expect(errors).toEqual([]);
});
