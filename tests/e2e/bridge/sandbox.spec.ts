// 枠の sandbox 属性が、DOM 上で正しいこと。これが崩れると隔離が消える（ADR 0001）。
// 変異（sandbox の撤去・同梱への allow-same-origin の付与）を速く確実に捕まえる門番。
import { expect, openHost, test } from './harness';

test('同梱は allow-scripts だけ、外部は allow-scripts allow-same-origin が、枠に実際に付く', async ({ page, consoleServer, externalServer }) => {
  await openHost(page, consoleServer);

  const bundled = await page.evaluate(() => window.H.start({ id: 'sb-bundled', entry: { bundled: 'games/hello/' }, readyTimeoutMs: 8000 }));
  expect(bundled.ok).toBe(true);
  expect(await page.evaluate(() => window.H.sandboxAttr('sb-bundled'))).toBe('allow-scripts');

  const external = await page.evaluate((url) => window.H.start({ id: 'sb-external', entry: { url: `${url}/games/hello/` }, allowLocalhost: true, readyTimeoutMs: 8000 }), externalServer.url);
  expect(external.ok).toBe(true);
  expect(await page.evaluate(() => window.H.sandboxAttr('sb-external'))).toBe('allow-scripts allow-same-origin');

  // 同梱の枠に allow-same-origin が付いていないこと（隔離の肝）。
  expect((await page.evaluate(() => window.H.sandboxAttr('sb-bundled')))?.split(' ')).not.toContain('allow-same-origin');
});
