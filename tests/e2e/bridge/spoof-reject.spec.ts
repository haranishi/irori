// なりすましの無視、コンソールと同じオリジンの拒否、ready を返さないゲームの timeout。
import { expect, openHost, test } from './harness';

test('別の枠からホストへ握手を送っても、無視される（自分の枠だけと握手する）', async ({ page, consoleServer }) => {
  await openHost(page, consoleServer);
  // 握手を送らない沈黙のゲーム（同梱＝オリジンが空）を、短い制限で起動する。
  // なりすましの枠も、同じく allow-same-origin なしの sandbox にするので、オリジンは同じ 'null'。
  // つまり、握手を受けるかどうかの判別は event.source だけが頼りになる＝その検査を外すと、この試験が落ちる。
  await page.evaluate(() => window.H.start({ id: 'silent', entry: { bundled: 'games/silent/' }, handshakeTimeoutMs: 1500, readyTimeoutMs: 1500 }));
  await page.evaluate(() => window.H.addRogue('/rogue.html'));

  // なりすましの握手は無視されるので、沈黙のゲームは握手が来ないまま error（握手なし）になる。
  // 検査を外すと、なりすましにつながって ready 待ちの timeout になり、この assert が落ちる。
  await expect.poll(() => page.evaluate(() => window.H.names('silent')), { timeout: 8000 }).toContain('error');
  const err = (await page.evaluate(() => window.H.events('silent'))).find((e) => e.name === 'error');
  expect(err?.detail).toMatchObject({ reason: 'handshake' });
  expect(await page.evaluate(() => window.H.names('silent'))).not.toContain('ready');
  expect(await page.evaluate(() => window.H.names('silent'))).not.toContain('timeout');

  // なりすましがいても、本物のゲームは正しく握手して ready まで行く。
  await page.evaluate(() => window.H.start({ id: 'real', entry: { bundled: 'games/hello/' }, readyTimeoutMs: 8000 }));
  await page.waitForFunction(() => window.H.names('real').includes('ready'));
});

test('外部方式でコンソールと同じオリジンのURLは拒否される', async ({ page, consoleServer }) => {
  await openHost(page, consoleServer);
  // 試験のコンソールは http の 127.0.0.1 なので allowLocalhost を付ける（公開時は https。順序の都合で、同一オリジンの判定を見る）。
  const r = await page.evaluate((origin) => window.H.resolveEntry({ url: `${origin}/games/hello/` }, origin, { allowLocalhost: true }), consoleServer.url);
  expect(r).toEqual({ ok: false, reason: 'same-origin' });
  const started = await page.evaluate((origin) => window.H.start({ id: 'same', entry: { url: `${origin}/games/hello/` }, allowLocalhost: true }), consoleServer.url);
  expect(started).toEqual({ ok: false, reason: 'same-origin' });
});

test('ready を返さないゲームは、決めた時間で timeout（試験では短くできる）', async ({ page, consoleServer }) => {
  await openHost(page, consoleServer);
  await page.evaluate(() => window.H.start({ id: 'noready', entry: { bundled: 'games/noready/' }, readyTimeoutMs: 1200 }));
  // 握手は済み（connected）だが、ready が来ないので timeout になる。
  await expect.poll(() => page.evaluate(() => window.H.names('noready')), { timeout: 8000 }).toContain('timeout');
  expect(await page.evaluate(() => window.H.names('noready'))).not.toContain('ready');
});
