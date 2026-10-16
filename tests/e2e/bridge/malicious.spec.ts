// 悪意のあるゲーム：枠の外へ出る試みがすべて失敗・無効になり、なおホストは操作を続けられる。
// 危険な試み（親のDOM・画面遷移・ポップアップ・ダイアログ・なりすましポート）は、ゲームの自己申告だけでなく
// 親側からも独立に確かめる。巨大・不正なメッセージの連投では、枠が止まる（error reason 'rate'）。
import type { Dialog, Page } from '@playwright/test';
import { expect, openHost, test } from './harness';

const names = (page: Page, id: string) => page.evaluate((i) => window.H.names(i), id);

test('同梱方式の悪意あるゲームは、脱出をすべて止められ、ホストは動き続ける', async ({ page, context, consoleServer }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d: Dialog) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await openHost(page, consoleServer);
  const started = await page.evaluate(() => window.H.start({ id: 'evil', entry: { bundled: 'games/escape/' }, readyTimeoutMs: 8000 }));
  expect(started.ok).toBe(true);
  expect(started.source?.sandbox).toBe('allow-scripts');

  // 握手と players は通る（枠は隔離しつつ、ホストから見れば普通のゲーム）。
  await page.waitForFunction(() => window.H.names('evil').includes('ready'));

  // ゲームの自己申告：止まっていれば例外になる試みは、すべて例外になっている（脱出していない）。
  await expect.poll(() => page.evaluate(() => window.H.evilReports().length)).toBeGreaterThan(0);
  const report = (await page.evaluate(() => window.H.evilReports()))[0]?.report ?? {};
  for (const name of ['parentDocument', 'topLocation', 'windowOpen', 'localStorage', 'cookie', 'camera']) {
    expect(report[name]?.escaped, `${name}: ${report[name]?.note}`).toBe(false);
  }
  // 無言で無効になる試み（alert・formSubmit）は、親側から起きていないことを確かめる。
  expect(Object.keys(report)).toEqual(expect.arrayContaining(['alert', 'formSubmit']));
  expect(dialogs).toEqual([]); // alert は出ていない
  expect(context.pages()).toHaveLength(1); // window.open で新しいページは出ていない
  expect(page.url()).toBe(`${consoleServer.url}/host.html`); // top は書き換えられていない（formSubmit _top・top.location とも）
  expect(await page.evaluate(() => document.querySelector('h1')?.textContent)).toBe('bridge e2e host'); // 親のDOMは無事
  expect(await page.evaluate(() => window.H.dropped('evil'))).toBe(0);

  // ホストは操作を続けられる：別の正常なゲームが起動して ready まで行く。
  await page.evaluate(() => window.H.start({ id: 'after-evil', entry: { bundled: 'games/hello/' }, readyTimeoutMs: 8000 }));
  await page.waitForFunction(() => window.H.names('after-evil').includes('ready'));
  // 悪意あるゲームへ players を送っても、ホストは止まらない。
  await page.evaluate(() => window.H.post('evil', { m: 'players', players: [{ id: 1, name: 'あ', online: true }], leader: 1 }));
  await expect.poll(() => page.evaluate(() => window.H.gameMsgs().some((m) => m.kind === 'players'))).toBe(true);
});

test('巨大・不正なメッセージの連投では、枠を止める（error reason rate）', async ({ page, consoleServer }) => {
  await openHost(page, consoleServer);
  await page.evaluate(() => window.H.start({ id: 'flood', entry: { bundled: 'games/flood/' }, readyTimeoutMs: 8000 }));

  await expect.poll(() => names(page, 'flood')).toContain('error');
  const err = (await page.evaluate(() => window.H.events('flood'))).find((e) => e.name === 'error');
  expect(err?.detail).toMatchObject({ reason: 'rate' });
  expect(await page.evaluate(() => window.H.state('flood'))).toBe('stopped');

  // 連投の最中でも、別の正常なゲームは起動して遊べる。
  await page.evaluate(() => window.H.start({ id: 'after-flood', entry: { bundled: 'games/hello/' }, readyTimeoutMs: 8000 }));
  await page.waitForFunction(() => window.H.names('after-flood').includes('ready'));
});
