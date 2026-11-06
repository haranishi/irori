// 変異でも個別に流せる、配置と読みやすさの実ブラウザの門番。
import { expect, test } from '@playwright/test';
import { env, openHost, ScriptPad } from './e2e/fixtures';

const base = () => env('IRORI_HOST_E2E_MAIN');

test('狭い大画面でも上の道具は2割以下、左下QRは最初の画面で押せる', async ({ browser }) => {
  const host = await openHost(browser, base(), { viewport: { width: 1024, height: 576 } });
  try {
    await host.expectState('home');
    const top = (await host.page.locator('.home__top').boundingBox())!;
    const qr = (await host.page.locator('.dock__qr').boundingBox())!;
    expect(top.y + top.height).toBeLessThanOrEqual(576 * .2);
    expect(qr.x).toBeGreaterThanOrEqual(0);
    expect(qr.x + qr.width).toBeLessThan(512);
    expect(qr.y + qr.height).toBeLessThanOrEqual(576);
    await host.page.locator('.dock__qr').click();
    await expect(host.page.locator('.qr-dialog')).toBeVisible();
    await host.page.keyboard.press('Escape');
    await expect(host.page.locator('.qr-dialog')).toHaveCount(0);
    await host.assertClean();
  } finally { await host.context.close(); }
});

test('1366幅の結果で記録の補足は17px以上あり、値と一緒に読める', async ({ browser }) => {
  const url = env('IRORI_HOST_E2E_DEV');
  const host = await openHost(browser, base(), { viewport: { width: 1366, height: 768 }, path: `/?dev=${encodeURIComponent(url)}`, allowHosts: [new URL(url).host] });
  const pad = new ScriptPad(base(), await host.code(), 'たろう');
  try {
    await pad.join();
    await host.page.locator('.card[data-game="dev"]').click();
    await host.page.locator('[data-nav="confirm:ok"]').click();
    await host.expectState('playing');
    await pad.expectSpec(s => s?.k === 'pad', 'ゲームの操作盤');
    pad.press('end');
    await host.expectState('results');
    const caption = host.page.locator('.result__caption');
    await expect(caption).toHaveText('記録');
    expect(await caption.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
    await expect(host.page.locator('.result__value')).toHaveText('dev');
    await host.assertClean();
  } finally { pad.close(); await host.context.close(); }
});

for (const [width, height] of [[1280, 720], [1024, 576], [1920, 1080]]) {
  test(`公開URLの拡大QRと戻るが収まり、閉じる操作でフォーカスが戻る ${width}×${height}`, async ({ browser }) => {
    const host = await openHost(browser, env('IRORI_HOST_E2E_PUBLIC'), { viewport: { width: width!, height: height! } });
    const page = host.page;
    try {
      await host.expectState('home');
      const opener = page.locator('.dock__qr');
      await opener.click();
      expect((await page.locator('.qr-dialog .join__qr').boundingBox())!.width).toBeGreaterThanOrEqual(500);
      for (const selector of ['.join__qr', '.join__codebox', '[data-nav="qr:back"]']) {
        const r = (await page.locator(`.qr-dialog ${selector}`).boundingBox())!;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(width!);
        expect(r.y + r.height).toBeLessThanOrEqual(height!);
      }
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await page.keyboard.press('q');
      await page.locator('[data-nav="qr:back"]').click();
      await expect(opener).toBeFocused();
      await opener.click();
      await page.locator('.layer--qr').click({ position: { x: 1, y: 1 } });
      await expect(page.locator('.qr-dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      await host.assertClean();
    } finally { await host.context.close(); }
  });
}
