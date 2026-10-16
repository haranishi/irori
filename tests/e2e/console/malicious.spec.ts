// 悪意のあるゲーム（A2 の tests/e2e/bridge/pages/games/escape を、そのまま使う）を、本物のコンソールの枠で動かす。
//   同梱 … ビルドの写しに足した games/c1-escape/ と登録情報（前処理の extra の Worker・本番と同じ CSP）
//   外部 … 別のオリジン（localhost）から ?dev= で（開発用の DEV_FRAMES=1 の Worker）
// ゲームの自己申告（__evil_report__）と、コンソールの側からの確かめ（ダイアログ・新しいページ・画面遷移・
// ほかのオリジンへの通信・コンソールの DOM と保存）の両方で見る。最後に、コンソールが操作できる状態に戻れること
// （メニュー → ホーム → 別のゲームを最後まで遊べる）を確かめる。
// 枠の中のゲームが出す「sandbox に止められた」という知らせは、守りが効いた記録なので、ゲームのURLから出たものだけ許す。
import { env } from './lib/env.mjs';
import { expect, test, type Host, type Pad } from './fixtures';
import { HOST } from './lib/tags';

type Report = Record<string, { escaped: boolean | string; note: string }>;

/** 枠の中の試みが止められたときの知らせ（WebKit はこれを「ページの例外」として出す）。 */
const SANDBOX_NOTE = /sandbox|allow-modals|allow-top-navigation|allow-popups|allow-forms|getUserMedia|Permission policy|SecurityError/i;

async function listenForReport(host: Host): Promise<void> {
  await host.page.evaluate(() => {
    window.addEventListener('message', (e) => {
      const r = (e.data as { __evil_report__?: unknown } | null)?.__evil_report__;
      if (r) (globalThis as { __c1Evil?: unknown }).__c1Evil = r;
    });
  });
}

const report = (host: Host) => host.page.evaluate(() => (globalThis as { __c1Evil?: unknown }).__c1Evil as Report | undefined);

/** コンソールが操作できる状態に戻れる：Esc でメニュー → ホーム → hello-pad を最後まで。 */
async function consoleStillWorks(host: Host, pads: Pad[]): Promise<void> {
  await host.key('Escape');
  await host.expectState('paused');
  await host.page.locator('[data-nav="menu:home"]').click();
  await host.expectState('home');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  await host.choose('hello-pad', pads[0]);
  await pads[1]!.tap('hop');
  await pads[0]!.tap('end');
  expect((await host.results()).map((r) => r.seat).sort()).toEqual([1, 2]);
}

test('悪意のあるゲーム（同梱）：枠の外へ出る試みはすべて止まり、コンソールは操作を続けられる', HOST, async ({ rig }) => {
  const host = await rig.openHost({ base: env('extra') });
  const gameUrl = `${host.base}/games/c1-escape/`;
  for (const w of rig.watches) {
    w.frameConsoleOk = (m) => m.location().url.startsWith(gameUrl);
    w.pageErrorOk = (e) => SANDBOX_NOTE.test(e.message) || e.message.includes('/games/c1-escape/');
  }
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await listenForReport(host);
  await host.choose('c1-escape', pads[0]);
  await expect(host.page.locator('.stage iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect.poll(() => report(host), { timeout: 20_000 }).toBeTruthy();
  const r = (await report(host))!;
  for (const name of ['parentDocument', 'topLocation', 'windowOpen', 'localStorage', 'cookie', 'camera']) {
    expect(r[name]?.escaped, `${name}: ${r[name]?.note}`).toBe(false);
  }
  expect(Object.keys(r)).toEqual(expect.arrayContaining(['alert', 'formSubmit']));
  // コンソールの側から：画面は遷移していない・DOM は無事・保存とクッキーに何も書かれていない。
  expect(host.page.url()).toBe(`${host.base}/`);
  await expect(host.root).toHaveAttribute('data-state', 'playing');
  expect(await host.page.evaluate(() => [localStorage.getItem('x'), document.cookie])).toEqual([null, '']);
  expect(host.context.pages()).toHaveLength(1);
  await consoleStillWorks(host, pads);
});

test('悪意のあるゲーム（外部・?dev=）：自分のオリジンの外へは出られず、コンソールは操作を続けられる', HOST, async ({ rig }) => {
  const ext = env('external');
  const extOrigin = new URL(ext).origin;
  const host = await rig.openHost({ base: env('dev'), path: `/?dev=${encodeURIComponent(ext)}`, allowHosts: [new URL(ext).host] });
  for (const w of rig.watches) {
    w.frameConsoleOk = (m) => m.location().url.startsWith(extOrigin);
    w.pageErrorOk = (e) => SANDBOX_NOTE.test(e.message) || e.message.includes(new URL(ext).host);
  }
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await listenForReport(host);
  await expect(host.page.locator('.card').first()).toHaveAttribute('data-game', 'dev');
  await host.page.locator('.card[data-game="dev"]').click();
  await host.expectState('detail');
  await host.page.locator('[data-nav="detail:start"]').click();
  // 外部のゲームは、開く前に接続先のホスト名を確かめる。
  await expect(host.page.locator('[data-layer="confirm"]')).toContainText(new URL(ext).host);
  await host.page.locator('[data-nav="confirm:ok"]').click();
  await host.expectState('playing', 20_000);
  await expect(host.page.locator('.stage iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect.poll(() => report(host), { timeout: 20_000 }).toBeTruthy();
  const r = (await report(host))!;
  // 外部のゲームは自分のオリジンを持つので、自分の保存とクッキーは使える（設計どおり）。コンソールの側には届かない。
  for (const name of ['parentDocument', 'topLocation', 'windowOpen', 'camera']) {
    expect(r[name]?.escaped, `${name}: ${r[name]?.note}`).toBe(false);
  }
  expect(host.page.url()).toBe(`${host.base}/?dev=${encodeURIComponent(ext)}`);
  expect(await host.page.evaluate(() => [localStorage.getItem('x'), document.cookie])).toEqual([null, '']);
  expect(host.context.pages()).toHaveLength(1);
  await consoleStillWorks(host, pads);
});
