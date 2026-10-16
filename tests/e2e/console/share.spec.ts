// 共有：ゲームの結果の画面から開く共有の板（端末の共有シート・X・LINE・リンクのコピー）。共有するのはサイトのURLで、
// 部屋のURL（/pad#CODE）ではない（知らない人が部屋に入ってこないため）。ホームの共有は B1 の試験にあるので、ここは結果から。
// OGP と canonical は、ホストの画面（/）とスマホの画面（/pad）の両方で、配信したオリジンの絶対URLになっている。
import { expect, test } from './fixtures';
import { HOST } from './lib/tags';

/** ページの head の canonical と OGP の URL。 */
async function meta(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    canonical: document.querySelector('link[rel~="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
    twitterImage: document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
  }));
}

test('共有：結果の画面から開く共有の4つは、サイトのURLを渡す（部屋のコードを含まない）', HOST, async ({ rig }) => {
  const shared: unknown[] = [];
  const host = await rig.openHost({
    init: async (ctx) => {
      await ctx.exposeFunction('__c1Shared', (d: unknown) => void shared.push(d));
      await ctx.addInitScript(() => {
        // 端末の共有シート（navigator.share）を持つ端末のふり。呼ばれた中身を試験へ渡す。
        Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: unknown) => (globalThis as unknown as { __c1Shared: (x: unknown) => void }).__c1Shared(d) });
      });
    },
  });
  const code = await host.code();
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('hello-pad', pads[0]);
  await pads[0]!.tap('end');
  await host.expectState('results');
  await host.page.locator('[data-nav="results:share"]').click();
  const layer = host.page.locator('[data-layer="share"]');
  await expect(layer).toBeVisible();
  const site = `${host.base}/`;
  await expect(layer.locator('.share__url')).toHaveText(site);
  // 4つ：端末の共有シート・X・LINE・リンクのコピー。
  for (const nav of ['share:native', 'share:x', 'share:line', 'share:copy']) await expect(layer.locator(`[data-nav="${nav}"]`)).toBeVisible();
  const x = new URL((await layer.locator('[data-nav="share:x"]').getAttribute('href')) ?? '');
  expect(`${x.origin}${x.pathname}`).toBe('https://x.com/intent/post');
  expect(x.searchParams.get('url')).toBe(site);
  const line = new URL((await layer.locator('[data-nav="share:line"]').getAttribute('href')) ?? '');
  expect(`${line.origin}${line.pathname}`).toBe('https://social-plugins.line.me/lineit/share');
  expect(line.searchParams.get('url')).toBe(site);
  for (const href of [x.href, line.href]) {
    expect(href).not.toContain(code);
    expect(href).not.toContain('/pad');
  }
  await layer.locator('[data-nav="share:native"]').click();
  await expect.poll(() => shared).toEqual([expect.objectContaining({ url: site })]);
  if (rig.engine === 'chromium') {
    await layer.locator('[data-nav="share:copy"]').click();
    await expect.poll(() => host.page.evaluate(() => navigator.clipboard.readText())).toBe(site);
  }
  // 外へのリンクは新しいタブで開き、参照元を渡さない（押しても、この試験ではページを開かない）。
  for (const nav of ['share:x', 'share:line']) {
    await expect(layer.locator(`[data-nav="${nav}"]`)).toHaveAttribute('target', '_blank');
    await expect(layer.locator(`[data-nav="${nav}"]`)).toHaveAttribute('rel', /noopener/);
  }
  await layer.locator('[data-nav="share:close"]').click();
  await expect(layer).toHaveCount(0);
  await host.expectState('results');
});

test('OGP と canonical：ホストの画面とスマホの画面の両方で、配信したオリジンの絶対URL', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pad = await rig.openPad(host.base);
  await pad.join(await host.code());
  const origin = host.base;
  expect(await meta(host.page)).toEqual({
    canonical: `${origin}/`,
    ogUrl: `${origin}/`,
    ogImage: `${origin}/og.png`,
    twitterImage: `${origin}/og.png`,
    ogTitle: expect.stringContaining('irori'),
  });
  expect(await meta(pad.page)).toEqual({
    canonical: `${origin}/pad`,
    ogUrl: `${origin}/pad`,
    ogImage: `${origin}/og.png`,
    twitterImage: `${origin}/og.png`,
    ogTitle: expect.stringContaining('irori'),
  });
  // 画像は実際に配られている（1200×630 の PNG）。
  const res = await host.context.request.get(`${origin}/og.png`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  const png = await res.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  expect(res.headers()['set-cookie']).toBeUndefined();
});
