// 画面の確認用のスクリーンショット（評価者に渡す）。3つの幅で、ホーム（初回の案内・1人・4人・8人）・詳細・外す・
// ゲーム中のメニュー・結果・共有・エラー（回線・混雑・閉じた・取って代わられた）と、公開のアドレスが無いときの注意を撮る。
// 本番と同じく PUBLIC_URL を渡した Worker で撮る（部屋の案内と共有の宛先が、公開のアドレスになる）。
// 撮る前に、終わりのあるアニメーションの完了を待つ。ビューポートの画像を基本にし、縦に長いときだけ全体の画像も足す。
// 重ねる板（外す・詳細・メニュー・共有・覆い）は画面に固定なので、全体の画像は撮らない（幕が途中で切れて見えるだけ）。
// 実行：npx playwright test -c playwright.host.config.ts --project host-shots
import { expect, test, type Page } from '@playwright/test';
import { env, openHost, ScriptPad, settle, type HostPage } from './e2e/fixtures';

const EIGHT = ['たろう', 'はなこ', 'ゆい', 'けんた', 'さくら', 'そうた', 'みお', 'まつぼっくりのすけ'];

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
] as const;

async function imagesReady(page: Page): Promise<void> {
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
}

/** 主役のカードの中身が切れていないか・参加の板の中身が板からはみ出していないか・横にはみ出していないか。 */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const info = document.querySelector('.hero__info');
    if (info && info.scrollHeight > info.clientHeight + 1) out.push(`主役のカードの中身が切れる: ${info.scrollHeight} > ${info.clientHeight}`);
    const join = document.querySelector('.home__join .join');
    if (join) {
      const bottom = join.getBoundingClientRect().bottom;
      for (const el of join.children) {
        const r = el.getBoundingClientRect();
        if (r.bottom > bottom + 1) out.push(`参加の板からはみ出す: ${el.className} ${Math.round(r.bottom)} > ${Math.round(bottom)}`);
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`横にはみ出す: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    // 1366×768 では、補足の文字（記録・つながっていません・共有の注記・混雑の画面の補足・部屋のコード）が、ブラウザで測って17px以上。
    if (window.innerWidth === 1366) {
      for (const sel of ['.result__caption', '.seat__off', '[data-layer="share"] .note', '.status__hint', '.join__label']) {
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 17) out.push(`1366で補足の文字が小さい: ${sel} ${px}px`);
        }
      }
    }
    // スマホの幅のホーム：上の操作群は高さの2割以下、最初の画面に参加の入口（QR）と、いれば参加者の札が入る。
    const home = document.querySelector('.home');
    if (home && window.innerWidth <= 700 && !document.querySelector('.layer')) {
      const h = window.innerHeight;
      const bottom = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0;
      if (bottom('.home__top') > h * 0.2) out.push(`上の操作群が高さの2割を超える: ${Math.round(bottom('.home__top'))} > ${Math.round(h * 0.2)}`);
      if (bottom('.join__qr') > h) out.push(`QRが最初の画面に入らない: ${Math.round(bottom('.join__qr'))} > ${h}`);
      if (document.querySelector('.seat') && bottom('.seat') > h) out.push(`参加者の札が最初の画面に入らない: ${Math.round(bottom('.seat'))} > ${h}`);
      if (document.querySelector('[data-prompt]') && bottom('.home__prompt') > h) out.push(`選び方の案内が最初の画面に入らない: ${Math.round(bottom('.home__prompt'))} > ${h}`);
    }
    return out;
  });
}

async function joinAll(base: string, code: string, names: string[]): Promise<ScriptPad[]> {
  const pads: ScriptPad[] = [];
  for (const n of names) {
    const p = new ScriptPad(base, code, n);
    await p.join();
    pads.push(p);
  }
  return pads;
}

for (const size of SIZES) {
  test(`画面の確認 ${size.width}x${size.height}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const dir = `${env('IRORI_HOST_E2E_SHOTS')}/${size.width}x${size.height}`;
    const shot = async (page: Page, name: string, o: { full?: boolean } = {}) => {
      // ビューポートの画像は、画面の一番上から撮る（最初に目に入るところ）。下の部分は全体の画像で見る。
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      // 切れ・はみ出しがあっても、残りの場面は撮り続ける（最後に、この試験を失敗にする）。
      expect.soft(await layoutProblems(page), `${size.width}x${size.height} ${name}`).toEqual([]);
      await page.screenshot({ path: `${dir}/${name}.png` });
      if (o.full === false) return;
      const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
      if (tall) await page.screenshot({ path: `${dir}/${name}-full.png`, fullPage: true });
    };
    const base = env('IRORI_HOST_E2E_PUBLIC');
    const host: HostPage = await openHost(browser, base, { viewport: size });
    await host.expectState('home');
    await imagesReady(host.page);
    const code = await host.code();
    await shot(host.page, '01-home-first-run');

    // 1人：2人からのゲームが灰色。選択を灰色のカードに合わせる。
    const [a] = await joinAll(base, code, ['たろう']);
    await expect(host.page.locator('.seat')).toHaveCount(1);
    await host.page.locator('.card[data-game="tap-race"]').focus();
    await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'tap-race');
    await shot(host.page, '02-home-one-player');

    // 4人（1人はつながっていない）。
    const more = await joinAll(base, code, ['はなこ', 'ゆい', 'けんた']);
    await expect(host.page.locator('.seat')).toHaveCount(4);
    more[2]?.close();
    await expect(host.page.locator('.seat[data-seat="4"]')).toHaveAttribute('data-online', 'false');
    await host.page.locator('.card[data-game="hello-pad"]').focus();
    await shot(host.page, '03-home-four-players');

    // 外す人の確かめ。
    await host.page.locator('.seat[data-seat="3"]').click();
    await expect(host.page.locator('[data-layer="kick"]')).toBeVisible();
    await shot(host.page, '04-kick', { full: false });
    await host.page.keyboard.press('Escape');
    await expect(host.page.locator('[data-layer="kick"]')).toHaveCount(0);

    // 詳細。
    await host.page.locator('.card[data-game="tap-race"]').click();
    await host.expectState('detail');
    await shot(host.page, '05-detail', { full: false });

    // ゲーム中のメニュー（一時停止）。
    await host.page.keyboard.press('Escape');
    await host.page.locator('.card[data-game="hello-pad"]').click();
    await host.page.locator('[data-nav="detail:start"]').click();
    await host.expectState('playing');
    await host.page.keyboard.press('Escape');
    await host.expectState('paused');
    await shot(host.page, '06-menu', { full: false });
    await host.page.locator('[data-nav="menu:home"]').click();
    await host.expectState('home');

    // 結果：連打レースを3人で完走させる（順位・色と形・名前・点数・ラベル）。4人目の席は猶予で空く。
    await expect(host.page.locator('.seat')).toHaveCount(3, { timeout: 20_000 });
    await host.page.locator('.card[data-game="tap-race"]').click();
    await host.page.locator('[data-nav="detail:start"]').click();
    await host.expectState('playing');
    const runners = [a, more[0], more[1]].filter((p): p is ScriptPad => p !== undefined);
    for (const p of runners) await p.expectSpec((s) => s?.k === 'buzzer', '連打の画面');
    for (const [i, p] of runners.entries()) {
      for (let n = 0; n < 40; n++) p.press('buzzer');
      await host.page.waitForTimeout(150 + i * 200);
    }
    await host.expectState('results');
    await expect(host.page.locator('.result')).toHaveCount(3);
    await shot(host.page, '07-results');

    // 共有（結果から開く）。
    await host.page.locator('[data-nav="results:share"]').click();
    await expect(host.page.locator('[data-layer="share"]')).toBeVisible();
    await shot(host.page, '08-share', { full: false });
    for (const p of runners) p.close();
    await host.context.close();

    // エラー：回線がない（部屋を作りに行けない）。
    const offCtx = await browser.newContext({ viewport: size, locale: 'ja-JP' });
    await offCtx.route('**/api/rooms', (r) => r.abort('internetdisconnected'));
    const off = await openHost(browser, base, { context: offCtx });
    await off.expectState('offline');
    await shot(off.page, '09-error-offline');
    await offCtx.close();

    // エラー：混雑（1日の上限）。1つ目で上限に達したあとの2つ目。
    const caps = env('IRORI_HOST_E2E_CAPS');
    const c1 = await openHost(browser, caps, { viewport: size });
    await expect.poll(() => c1.state(), { timeout: 15_000 }).toMatch(/^(home|busy)$/);
    const busy = await openHost(browser, caps, { viewport: size });
    await busy.expectState('busy');
    await shot(busy.page, '10-error-busy');
    await Promise.all([c1.context.close(), busy.context.close()]);

    // エラー：無操作で閉じた部屋。
    const idle = await openHost(browser, env('IRORI_HOST_E2E_IDLE'), { viewport: size });
    await idle.expectState('home');
    await idle.expectState('closed');
    await shot(idle.page, '11-error-closed');
    await idle.context.close();

    // エラー：別のタブで、同じ部屋が開かれた。
    const r1 = await openHost(browser, base, { viewport: size });
    await r1.expectState('home');
    const stored = await r1.page.evaluate(() => sessionStorage.getItem('irori:host:room'));
    const ctx2 = await browser.newContext({ viewport: size, locale: 'ja-JP' });
    await ctx2.addInitScript((v) => sessionStorage.setItem('irori:host:room', v), stored ?? '');
    const r2 = await openHost(browser, base, { context: ctx2 });
    await r2.expectState('home');
    await r1.expectState('replaced');
    await shot(r1.page, '12-error-replaced', { full: false });
    await Promise.all([r1.context.close(), ctx2.close()]);

    // 8人（満員）。参加者の札が何行になっても、主役のカードと棚が画面に収まるか。
    const crowd = await openHost(browser, base, { viewport: size });
    await crowd.expectState('home');
    await imagesReady(crowd.page);
    const eight = await joinAll(base, await crowd.code(), EIGHT);
    await expect(crowd.page.locator('.seat')).toHaveCount(8);
    await crowd.page.locator('.card[data-game="dot-grab"]').focus();
    await expect(crowd.page.locator('.hero')).toHaveAttribute('data-game', 'dot-grab');
    await shot(crowd.page, '13-home-eight-players');
    for (const p of eight) p.close();
    await crowd.context.close();

    // 公開のアドレスが無い Worker（手元の 127.0.0.1 だけ）で開いたとき：QRの近くの注意。
    const local = await openHost(browser, env('IRORI_HOST_E2E_MAIN'), { viewport: size });
    await local.expectState('home');
    await imagesReady(local.page);
    await expect(local.page.locator('[data-loopback]')).toBeVisible();
    await shot(local.page, '14-home-loopback');
    await local.context.close();
  });
}
