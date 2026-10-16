// ホストの画面と部屋のつながり：取って代わられた（replaced）・画面に戻ったときの probe()・再読み込み・
// 部屋を作れない（実際の 503）・無操作で閉じた部屋・回線がない・外部のゲームの確かめ（?dev=）。実 Worker・実ブラウザ。
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { env, openHost, ScriptPad } from './e2e/fixtures';

const main = () => env('IRORI_HOST_E2E_MAIN');
const desktop = { viewport: { width: 1280, height: 720 }, locale: 'ja-JP' } as const;

/** pong を握りつぶす（画面ロックのあとの、黙って死んだ接続の代わり）。ページを読む前に入れる。 */
async function installPongTrap(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const g = globalThis as { __dropPong?: boolean };
    const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    if (!desc?.set || !desc.get) return;
    const { get, set } = desc;
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(fn: ((ev: MessageEvent) => void) | null) {
        set.call(this, fn && ((ev: MessageEvent) => (g.__dropPong && ev.data === '{"t":"pong"}' ? undefined : fn.call(this, ev))));
      },
    });
  });
}

/** 画面ロックや別のタブから戻ってきたときの知らせ。 */
async function showAgain(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('同じ鍵で2つ目のホスト：古い側に案内と「ここで続ける」。自動では入り直さず、押すと取り返す', async ({ browser }) => {
  const a = await openHost(browser, main());
  await a.expectState('home');
  const code = await a.code();
  const pad = new ScriptPad(main(), code, 'たろう');
  await pad.join();
  await expect(a.page.locator('.seat')).toHaveCount(1);
  const stored = await a.page.evaluate(() => sessionStorage.getItem('irori:host:room'));
  expect(stored).toContain(code);

  const ctx = await browser.newContext(desktop);
  await ctx.addInitScript((v) => sessionStorage.setItem('irori:host:room', v), stored ?? '');
  const b = await openHost(browser, main(), { context: ctx });
  await b.expectState('home');
  expect(await b.code()).toBe(code);
  await expect(b.page.locator('.seat')).toHaveCount(1);
  await a.expectState('replaced');
  await expect(a.page.locator('[data-layer="cover"]')).toContainText('別のタブで開かれました');
  // 待っても、古い側は入り直さない（二重のタブが互いを追い出し続けない）。
  await a.page.waitForTimeout(3_000);
  await a.expectState('replaced');
  await b.expectState('home');
  // 押したときだけ入り直す。今度は新しい側が replaced になる。
  await a.page.locator('[data-nav="cover:replaced"]').click();
  await a.expectState('home');
  await b.expectState('replaced');
  pad.close();
  await a.assertClean();
  await b.assertClean();
  await Promise.all([a.context.close(), ctx.close()]);
});

test('画面に戻ったら probe()：死んだ接続を30秒待たずに捨てて、入り直す', async ({ browser }) => {
  const ctx = await browser.newContext(desktop);
  await installPongTrap(ctx);
  const sockets: string[] = [];
  ctx.on('page', (p) => p.on('websocket', (ws) => sockets.push(ws.url())));
  const host = await openHost(browser, main(), { context: ctx });
  await host.expectState('home');
  const code = await host.code();
  const mine = () => sockets.filter((u) => u.includes(`/${code}/`)).length;
  await expect.poll(mine).toBe(1);
  await host.page.evaluate(() => {
    (globalThis as { __dropPong?: boolean }).__dropPong = true;
  });
  const t0 = Date.now();
  await showAgain(host.page);
  // probe の待ちは3秒。pong の期限（30秒）を待たずに、新しい接続が張られる。
  await expect.poll(mine, { timeout: 9_000 }).toBe(2);
  expect(Date.now() - t0).toBeLessThan(9_000);
  await host.page.evaluate(() => {
    (globalThis as { __dropPong?: boolean }).__dropPong = false;
  });
  await host.expectState('home');
  expect(await host.code()).toBe(code);
  await host.assertClean();
  await ctx.close();
});

test('ホストの再読み込み：同じ部屋に戻り、席も残る', async ({ browser }) => {
  const host = await openHost(browser, main());
  const code = await host.code();
  const pad = new ScriptPad(main(), code, 'たろう');
  await pad.join();
  await expect(host.page.locator('.seat')).toHaveCount(1);
  await pad.expectSpec((s) => s?.k === 'remote', 'リーダーにリモコン');
  const before = pad.frames.filter((f) => f.t === 'pad').length;
  await host.page.reload();
  await host.expectState('home');
  expect(await host.code()).toBe(code);
  await expect(host.page.locator('.seat[data-seat="1"] .seat__name')).toHaveText('たろう');
  // 入り直したホストは pad? を受けて、リーダーにリモコンを送り直す。
  await expect.poll(() => pad.frames.filter((f) => f.t === 'pad').length).toBeGreaterThan(before);
  await pad.expectSpec((s) => s?.k === 'remote', 'ホストが戻ったら、リーダーにまたリモコン');
  pad.close();
  await host.assertClean();
  await host.context.close();
});

test('部屋を作れない（1日の上限で 503）：理由と、自動でもう一度試すまでの目安', async ({ browser }) => {
  const caps = env('IRORI_HOST_E2E_CAPS');
  const first = await openHost(browser, caps);
  await first.expectState('home');
  const second = await openHost(browser, caps);
  await second.expectState('busy');
  const card = second.page.locator('.status');
  await expect(card).toContainText('いまは新しい部屋を作れません');
  // 押さなくても、理由と、いつ自動でもう一度試すかが1文で出る。ボタンは「いますぐ試す」だけ。
  await expect(second.page.locator('.status__wait')).toHaveText(/^今日作れる部屋の数が上限に達したので、約\d+(秒|分|時間)後に、自動でもう一度試します$/);
  const creates: string[] = [];
  second.page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/rooms') creates.push(r.method());
  });
  await second.page.locator('[data-nav="busy:now"]').click();
  await expect.poll(() => creates.length).toBe(1);
  await second.expectState('busy');
  // 自分で動かすやり方は、ファイル名でなく、新しいタブで開くリンク。
  const howto = second.page.locator('a[data-nav="busy:howto"]');
  await expect(howto).toHaveText('やり方を見る');
  await expect(howto).toHaveAttribute('target', '_blank');
  await expect(howto).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(card).not.toContainText('docs/');
  // 作成の要求が 503 になったことは、ブラウザがコンソールに記録する（ページの不具合ではない）。それだけを外す。
  const rest = second.watch.problems.filter((p) => !/status of 503/.test(p));
  second.watch.problems.splice(0, second.watch.problems.length, ...rest);
  await first.assertClean();
  await second.assertClean();
  await Promise.all([first.context.close(), second.context.close()]);
});

test('無操作で閉じた部屋：「部屋を閉じました」→「新しい部屋を作る」で別の部屋', async ({ browser }) => {
  const idle = env('IRORI_HOST_E2E_IDLE');
  const host = await openHost(browser, idle);
  await host.expectState('home');
  const code = await host.code();
  await host.expectState('closed');
  await expect(host.page.locator('.status')).toContainText('部屋を閉じました');
  await host.page.locator('[data-nav="closed:new"]').click();
  await host.expectState('home');
  await expect(host.page.locator('#app')).not.toHaveAttribute('data-code', code);
  await host.assertClean();
  await host.context.close();
});

test('回線がない：部屋を作りに行けないと「接続が切れました」。つなぎ直すとホーム', async ({ browser }) => {
  const ctx = await browser.newContext(desktop);
  let block = true;
  await ctx.route('**/api/rooms', (route) => (block ? route.abort('internetdisconnected') : route.continue()));
  const host = await openHost(browser, main(), { context: ctx });
  host.watch.allowSocketErrors();
  await host.expectState('offline');
  await expect(host.page.locator('[data-layer="cover"]')).toContainText('接続が切れました');
  block = false;
  await host.page.locator('[data-nav="cover:offline"]').click();
  await host.expectState('home');
  await host.assertClean();
  await ctx.close();
});

test('外部のゲーム（?dev=）：開く前に「{ホスト名} のサーバーに接続します」。同じホストは、そのタブでは1回だけ', async ({ browser }) => {
  const devUrl = env('IRORI_HOST_E2E_DEV');
  const devHost = new URL(devUrl).host;
  const host = await openHost(browser, main(), { path: `/?dev=${encodeURIComponent(devUrl)}`, allowHosts: [devHost] });
  await host.expectState('home');
  const code = await host.code();
  await expect(host.page.locator('.card').first()).toHaveAttribute('data-game', 'dev');
  await expect(host.page.locator('.hero [data-external]')).toHaveText(`${devHost} のサーバーで動くゲームです`);
  const pad = new ScriptPad(main(), code, 'たろう');
  await pad.join();
  const k = host.page.keyboard;
  const focused = host.page.locator('#app [data-focused]').first();
  await k.press('Enter');
  await host.expectState('detail');
  await k.press('Enter');
  const confirm = host.page.locator('[data-layer="confirm"]');
  await expect(confirm).toContainText(`${devHost} のサーバーに接続します`);
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  // 既定の選択は「やめる」。やめると詳細に戻り、枠は作らない。
  await expect(focused).toHaveAttribute('data-nav', 'confirm:cancel');
  await k.press('Enter');
  await expect(confirm).toHaveCount(0);
  await host.expectState('detail');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  await k.press('Enter');
  await expect(confirm).toBeVisible();
  await k.press('ArrowLeft');
  await expect(focused).toHaveAttribute('data-nav', 'confirm:ok');
  await k.press('Enter');
  await host.expectState('playing');
  await expect(host.page.locator('.stage iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await pad.expectSpec((s) => s?.k === 'pad', 'ゲームの画面');
  pad.press('end');
  await host.expectState('results');
  await expect(host.page.locator('.result__value')).toHaveText('dev');
  await expect(host.page.locator('.result__caption')).toHaveText('記録');
  // もう一度：同じホスト名は、このタブでは確かめずに始まる。
  await k.press('Enter');
  await host.expectState('playing');
  await expect(confirm).toHaveCount(0);
  pad.close();
  await host.assertClean();
  await host.context.close();
});

/** ?dev= で外部の試験用ゲームを開き、確かめの「接続して はじめる」まで進める。 */
async function launchDev(browser: Parameters<typeof openHost>[0], path: string) {
  const devUrl = new URL(path, env('IRORI_HOST_E2E_DEV')).href;
  const devHost = new URL(devUrl).host;
  const host = await openHost(browser, main(), { path: `/?dev=${encodeURIComponent(devUrl)}`, allowHosts: [devHost] });
  await host.expectState('home');
  const pad = new ScriptPad(main(), await host.code(), 'たろう');
  await pad.join();
  const k = host.page.keyboard;
  await k.press('Enter');
  await k.press('Enter');
  await expect(host.page.locator('[data-layer="confirm"]')).toBeVisible();
  await k.press('ArrowLeft');
  await k.press('Enter');
  await host.expectState('launching');
  return { host, pad };
}

test('ready が来ない：「応答がありません」→「待つ」。待っても始まらないときは、戻るでホームへ', async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, pad } = await launchDev(browser, '/noready/');
  const root = host.page.locator('#app');
  await expect(root).toHaveAttribute('data-issue', 'slow', { timeout: 20_000 });
  await expect(host.page.locator('.launch')).toContainText('応答がありません');
  // リーダーのスマホにはリモコンが戻る（ホームへ戻る操作が要るため）。
  await pad.expectSpec((s) => s?.k === 'remote', '応答がないときはリモコン');
  await expect(host.page.locator('#app [data-focused]')).toHaveAttribute('data-nav', 'launch:wait');
  await host.page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-issue', 'none');
  // 待っても始まらなければ、同じ時間のあとに、また選べる（詰まらない）。
  await expect(root).toHaveAttribute('data-issue', 'slow', { timeout: 20_000 });
  await host.page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-issue', 'none');
  // 読み込みの最中でも、戻る（Esc）でやめてホームへ。
  await host.page.keyboard.press('Escape');
  await host.expectState('home');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  pad.close();
  await host.assertClean();
  await host.context.close();
});

test('握手が来ない：「ゲームを始められませんでした」→ ホームへ', async ({ browser }) => {
  test.setTimeout(60_000);
  const { host, pad } = await launchDev(browser, '/nohello/');
  const root = host.page.locator('#app');
  await expect(root).toHaveAttribute('data-issue', 'failed', { timeout: 20_000 });
  await expect(host.page.locator('.launch')).toContainText('ゲームを始められませんでした');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  await pad.expectSpec((s) => s?.k === 'remote', '始められないときはリモコン');
  await expect(host.page.locator('#app [data-focused]')).toHaveAttribute('data-nav', 'launch:home');
  pad.press('ok');
  await host.expectState('home');
  pad.close();
  await host.assertClean();
  await host.context.close();
});
