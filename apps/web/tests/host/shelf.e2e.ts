// 棚の配置と実物の動画を、実Workerと接続ブラウザで確かめる。
import { expect, test, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import jsQR from 'jsqr';
import { openHost, PagePad, settle } from './e2e/fixtures';

declare const process: { env: Record<string, string | undefined> };
const base = () => process.env.IRORI_HOST_E2E_MAIN ?? 'http://127.0.0.1:8880';

// この回の12本を固定し、並行して追加される次のゲームで配置の試験を変えない。
async function pack3Catalog(context: BrowserContext): Promise<{ previews: number }> {
  const catalog = { previews: 0 };
  const ids = ['hello-pad', 'tap-race', 'dot-grab', 'quiz-4', 'ten-seconds', 'blade-duel', 'lantern-market', 'strike-alley', 'daifugo', 'old-maid', 'moon-village', 'bell-in-sleeve'];
  await context.route('**/registry/index.json', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.games = json.games.filter((game: { id: string }) => ids.includes(game.id));
    expect(json.games.map((game: { id: string }) => game.id).sort()).toEqual([...ids].sort());
    expect(json.games.filter((game: { id: string }) => game.id !== 'bell-in-sleeve').every((game: { preview?: string }) => game.preview)).toBe(true);
    catalog.previews = json.games.filter((game: { preview?: string }) => game.preview).length;
    await route.fulfill({ response, json });
  });
  return catalog;
}

for (const [width, height] of [[1280, 720], [1920, 1080], [1024, 576]]) {
  test(`棚・帯・QR・参加 ${width}×${height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: width!, height: height! } });
    await pack3Catalog(context);
    const host = await openHost(browser, base(), { context });
    let pad: PagePad | undefined;
    try {
      const page = host.page;
      await expect(page.locator('.card')).toHaveCount(12);
      await expect(page.locator('.shelf__empty')).toHaveCount((width! >= 1700 ? 6 : width! >= 1200 ? 5 : 4) * 3 - 12);
      expect(await page.locator('.card__thumb').allTextContents()).toEqual(Array(12).fill(''));
      expect(await page.locator('.shelf').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(width! >= 1700 ? 6 : width! >= 1200 ? 5 : 4);
      await expect(page.locator('.home__hero')).toBeHidden();
      await settle(page);
      for (const selector of ['.card', '.home__dock', '.home__guide']) {
        for (const el of await page.locator(selector).all()) {
          const r = (await el.boundingBox())!;
          expect(r.y, selector).toBeGreaterThanOrEqual(0);
          expect(r.y + r.height, selector).toBeLessThanOrEqual(height!);
        }
      }
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.home__hero')).toBeVisible();
      await page.locator('.card').nth(2).hover();
      await expect(page.locator('.card[data-selected]')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('.card').first()).toBeFocused();
      await page.locator('.dock__qr').click();
      const qr = page.locator('.qr-dialog .join__qr');
      const box = (await qr.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(500);
      for (const selector of ['.join__qr', '.join__codebox', '.join__warn', '[data-nav="qr:back"]']) {
        for (const element of await page.locator(`.qr-dialog ${selector}`).all()) {
          const r = (await element.boundingBox())!;
          expect(r.x, selector).toBeGreaterThanOrEqual(0);
          expect(r.y, selector).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width, selector).toBeLessThanOrEqual(width!);
          expect(r.y + r.height, selector).toBeLessThanOrEqual(height!);
        }
      }
      const pixels = await qr.locator('svg.qr').evaluate(async (svg) => {
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 600;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 600, 600);
        return [...ctx.getImageData(0, 0, 600, 600).data];
      });
      expect(jsQR(new Uint8ClampedArray(pixels), 600, 600)?.data).toBe(await qr.getAttribute('data-url'));
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      const code = await host.code();
      pad = await PagePad.join(browser, base(), code, 'あかり');
      await expect(page.locator('.seat')).toHaveCount(1);
      await expect(page.locator('[data-guide]')).toHaveCount(0);
      await page.locator('.card').first().focus();
      await pad.press('right');
      await expect(page.locator('.card').nth(1)).toBeFocused();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const problems = await page.evaluate(() => {
        const errors: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('.card, .home__dock, .home__hero, .seat')) {
          const r = el.getBoundingClientRect();
          if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight) errors.push(el.className);
        }
        const card = document.querySelector('.card')!.getBoundingClientRect();
        if (Math.abs(card.width / card.height - 3 / 2) > .02) errors.push('箱の縦横比');
        return errors;
      });
      expect(problems).toEqual([]);
      await host.assertClean();
    } finally {
      await pad?.close();
      await host.context.close();
    }
  });
}

test('タップで選び、同じ箱の2回目で遊ぶ。ページを送っても列×3枠を保つ', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  let pad: PagePad | undefined;
  try {
    await context.route('**/registry/index.json', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const first = json.games.find((g: { id: string }) => g.id === 'hello-pad');
      json.games = Array.from({ length: 16 }, (_, n) => ({ ...first, id: `trial-${n}` }));
      await route.fulfill({ response, json });
    });
    const host = await openHost(browser, base(), { context });
    const page = host.page;
    pad = await PagePad.join(browser, base(), await host.code(), 'あかり');
    await page.locator('[data-nav="shelf:next"]').tap();
    await expect(page.locator('.card')).toHaveCount(1);
    await expect(page.locator('.shelf__empty')).toHaveCount(14);
    await page.locator('[data-nav="shelf:prev"]').tap();
    const card = page.locator('.card').nth(1);
    await card.tap();
    await host.expectState('home');
    await expect(page.locator('.hero')).toHaveAttribute('data-game', 'trial-1');
    await card.tap();
    await expect(page.locator('#app')).toHaveAttribute('data-state', /playing|launching/);
  } finally { await pad?.close(); await context.close(); }
});

test('動画は表示中だけ再生し、動きを減らす設定と省データではポスターに戻す', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const catalog = await pack3Catalog(context);
  try {
    await context.addInitScript(() => {
      const connection = new EventTarget() as EventTarget & { saveData: boolean };
      connection.saveData = false;
      Object.defineProperty(navigator, 'connection', { value: connection });
    });
    const host = await openHost(browser, base(), { context });
    const page = host.page;
    const video = page.locator('video').first();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0)).toBe(true);
    await expect(page.locator('video')).toHaveCount(catalog.previews);
    for (const clip of await page.locator('video').all()) {
      await expect.poll(() => clip.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2)).toBe(true);
    }
    const frames = await page.locator('video').evaluateAll(async (elements) => {
      const sample = () => elements.map((el) => {
        const canvas = document.createElement('canvas');
        canvas.width = 160; canvas.height = 90;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(el as HTMLVideoElement, 0, 0, 160, 90);
        return canvas.toDataURL();
      });
      const before = sample();
      await new Promise(resolve => setTimeout(resolve, 500));
      const after = sample();
      return before.map((frame, i) => ({ id: elements[i]!.parentElement!.dataset.game, changed: frame !== after[i] }));
    });
    expect(frames.filter(frame => !frame.changed)).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && v.hidden)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await page.evaluate(() => {
      const connection = (navigator as Navigator & { connection: EventTarget & { saveData: boolean } }).connection;
      connection.saveData = true; connection.dispatchEvent(new Event('change'));
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && v.hidden)).toBe(true);
    await page.evaluate(() => {
      const connection = (navigator as Navigator & { connection: EventTarget & { saveData: boolean } }).connection;
      connection.saveData = false; connection.dispatchEvent(new Event('change'));
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && v.hidden)).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await video.evaluate((el) => { (el.closest('.card') as HTMLElement).style.transform = 'translateX(-3000px)'; });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && v.hidden)).toBe(true);
  } finally { await context.close(); }
});

test('列数の境目で枠数とページを組み直し、動画は最大12本に収める', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1700, height: 1080 } });
  try {
    await context.route('**/registry/index.json', async route => {
      const response = await route.fetch();
      const json = await response.json();
      const preview = json.games.find((game: { preview?: string }) => game.preview);
      expect(preview).toBeTruthy();
      json.games = Array.from({ length: 19 }, (_, n) => ({ ...preview, id: `trial-${n}` }));
      await route.fulfill({ response, json });
    });
    const host = await openHost(browser, base(), { context });
    for (const [width, columns] of [[1700, 6], [1699, 5], [1200, 5], [1199, 4], [900, 4], [899, 3], [600, 3], [599, 2]]) {
      await host.page.setViewportSize({ width: width!, height: 1080 });
      await expect(host.page.locator('.card')).toHaveCount(columns! * 3);
      await expect(host.page.locator('video')).toHaveCount(Math.min(columns! * 3, 12));
      expect(await host.page.locator('.shelf').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
    }
    await host.page.setViewportSize({ width: 899, height: 1080 });
    await host.page.locator('[data-nav="shelf:next"]').click();
    await expect(host.page.locator('.card[data-index="9"]')).toBeFocused();
    await host.page.setViewportSize({ width: 1700, height: 1080 });
    await expect(host.page.locator('.card[data-index="9"]')).toHaveAttribute('data-selected', '');
    await expect(host.page.locator('.card')).toHaveCount(18);
    await expect(host.page.locator('.card[data-index="9"]')).toBeFocused();
    await host.page.locator('[data-nav="tool:share"]').focus();
    await host.page.setViewportSize({ width: 599, height: 1080 });
    await expect(host.page.locator('.card[data-index="9"]')).toHaveAttribute('data-selected', '');
    await expect(host.page.locator('[data-nav="tool:share"]')).toBeFocused();
  } finally { await context.close(); }
});
