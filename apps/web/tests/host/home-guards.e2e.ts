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
    await pad.expectSpec(s => s?.k === 'remote' && s.hint === '「もう一度」か「ホームへ」を選んで、［決定］を押してください', '結果の案内');
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

test('棚の境目と補助文字：箱・帯・QR・ページ送りの間に8px以上を残す', async ({ browser }) => {
  const host = await openHost(browser, env('IRORI_HOST_E2E_PUBLIC'));
  const page = host.page;
  try {
    await host.expectState('home');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1920, 1700, 1699, 1280, 1200, 1199, 1024, 900, 899, 600, 599, 390]) {
      const height = width >= 1700 ? 1080 : width === 1024 ? 576 : width < 600 ? 844 : 720;
      await page.setViewportSize({ width, height });
      await page.reload();
      await page.locator('.card').first().waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const box = (el: Element) => el.getBoundingClientRect();
        const gap = (a: DOMRect, b: DOMRect) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
        const cards = [...document.querySelectorAll('.card')].map(box);
        const dock = box(document.querySelector('.home__dock')!);
        const guide = document.querySelector('.home__guide')!;
        const regions = [dock, ...(getComputedStyle(guide).display !== 'none' ? [box(guide)] : [])];
        for (const r of [...cards, ...regions]) {
          if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) out.push(`画面外 ${JSON.stringify(r.toJSON())} ${innerWidth}x${innerHeight}`);
        }
        for (let i = 0; i < cards.length; i++) {
          for (const b of [...cards.slice(i + 1), ...regions]) if (gap(cards[i]!, b) < 8) out.push(`箱の隙間 ${JSON.stringify(cards[i]!.toJSON())} ${JSON.stringify(b.toJSON())}`);
        }
        for (const arrow of document.querySelectorAll('.shelf__pages .btn')) {
          for (const card of cards) if (gap(card, box(arrow)) < 8) out.push('矢印の隙間');
        }
        if (gap(dock, box(guide)) < 8) out.push('案内とQRの隙間');
        if (innerWidth >= 1280) {
          for (const el of document.querySelectorAll('.guide__step, .guide__num')) if (parseFloat(getComputedStyle(el).fontSize) + .001 < 18 * innerWidth / 1280) out.push(`手順の文字 ${getComputedStyle(el).fontSize} 幅${innerWidth}`);
          if (parseFloat(getComputedStyle(document.querySelector('.home__controls')!).fontSize) + .001 < 16 * innerWidth / 1280) out.push(`操作の文字 ${getComputedStyle(document.querySelector('.home__controls')!).fontSize} 幅${innerWidth}`);
        }
        return out;
      });
      expect(problems, `${width}×${height}`).toEqual([]);
      await page.locator('.card').first().focus();
      const typography = await page.locator('.hero__summary, .hero__minutes, .hero__chips .players-chip').evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
      for (const px of typography) expect(px + .001).toBeGreaterThanOrEqual(width >= 1280 ? 16 * width / 1280 : 16);
      const separation = await page.evaluate(() => {
        const hero = document.querySelector('.home__hero')!.getBoundingClientRect();
        const dock = document.querySelector('.home__dock')!.getBoundingClientRect();
        const cards = [...document.querySelectorAll('.card')].map(el => el.getBoundingClientRect());
        const gap = (a: DOMRect, b: DOMRect) => Math.max(b.left-a.right, a.left-b.right, b.top-a.bottom, a.top-b.bottom);
        const controls = document.querySelector('.home__controls')!;
        if (getComputedStyle(controls).display !== 'none' && gap(hero, controls.getBoundingClientRect()) < 0) return -1000;
        return Math.min(gap(hero, dock), ...cards.map(r => gap(hero, r)));
      });
      expect(separation, `選択の帯 ${width}`).toBeGreaterThanOrEqual(8);
    }
  } finally { await host.context.close(); }
});

test('参加できないQRの理由と、選択と操作フォーカスの強弱', async ({ browser }) => {
  const host = await openHost(browser, base());
  const page = host.page;
  try {
    await expect(page.locator('.dock__reason')).toHaveText('このアドレスでは、スマホは参加できません');
    await expect(page.locator('.guide__step').first()).toHaveText('1左下のQRを開く');
    await page.locator('.card').first().focus();
    const selected = page.locator('.card[data-selected]');
    const glow = await selected.evaluate(el => getComputedStyle(el).boxShadow);
    expect(glow).not.toBe('none');
    for (const selector of ['.dock__qr', '[data-nav="tool:sound"]']) {
      await page.locator(selector).focus();
      await expect.poll(() => selected.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
      expect(await page.locator(selector).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    }
    const play = page.locator('[data-nav="shelf:play"]');
    await expect(play).toBeDisabled();
    expect(await play.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  } finally { await host.context.close(); }
});


test('人数超過の印・あそぶの塗り・時間とリモコンのQR案内', async ({ browser }) => {
  const host = await openHost(browser, base());
  const page = host.page;
  const pads: ScriptPad[] = [];
  try {
    for (let i = 1; i <= 3; i++) {
      const pad = new ScriptPad(base(), await host.code(), `p${i}`);
      pads.push(pad);
      await pad.join();
    }
    await expect(page.locator('.seat')).toHaveCount(3);
    const duel = page.locator('.card[data-game="blade-duel"]');
    await expect(duel).toHaveAttribute('data-playable', 'false');
    await expect(duel.locator('.card__unavailable')).toHaveText('2');
    await duel.focus();
    await expect(page.locator('[data-nav="shelf:play"]')).toBeDisabled();
    await expect(page.locator('.hero .fit')).toHaveText('最大2人です');
    const hello = page.locator('.card[data-game="hello-pad"]');
    await hello.focus();
    await expect(page.locator('.hero__minutes')).toHaveText('約1分');
    const play = page.locator('[data-nav="shelf:play"]');
    await expect(play).toBeEnabled();
    expect(await play.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await pads[0]!.expectSpec(s => s?.k === 'remote' && s.hint === 'ゲームを選んで、［決定］を押してください', 'ホームの案内');
    await page.locator('.dock__qr').click();
    await pads[0]!.expectSpec(s => s?.k === 'remote' && s.hint === 'QRを閉じるには［戻る］を押してください', 'QRの案内');
    pads[0]!.press('back');
    await expect(page.locator('.qr-dialog')).toHaveCount(0);
    await pads[0]!.expectSpec(s => s?.k === 'remote' && s.hint === 'ゲームを選んで、［決定］を押してください', '戻った案内');
  } finally { pads.forEach(pad => pad.close()); await host.context.close(); }
});
