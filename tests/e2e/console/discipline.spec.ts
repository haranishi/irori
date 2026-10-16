// 見張り（lib/watch.ts）が、本当に見張っていることの確かめ。0件の見張りは「問題がない」の証拠にならない。
// 本物のホストの画面を開いた文脈に、わざと問題を1つずつ起こし、見張りがそれぞれを記録することを見る。
// Set-Cookie だけは、本物の応答で確かめる（経路で作った応答では、ブラウザが Set-Cookie を見せないため）。
// そのために、Set-Cookie を返す小さなサーバーを手元に立て、そのオリジンを見張る。
// （この試験の文脈は rig の外で作るので、起こした問題で試験は落ちない。外への通信は経路で止めるので、外へは出ない。）
import { createServer } from 'node:http';
import { pickPorts } from '../../../tools/lib/edge-server.mjs';
import { env } from './lib/env.mjs';
import { expect, freshIpForRooms, test } from './fixtures';
import { HOST } from './lib/tags';
import { Watch } from './lib/watch';

test('見張りは、ほかのオリジン・CSP違反・コンソールのエラー・ページの例外・ダイアログ・新しいページを、それぞれ記録する', HOST, async ({ browser }) => {
  const base = env('main');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const watch = new Watch({ label: '試し', origin: base });
  await watch.attach(ctx);
  await freshIpForRooms(ctx);
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'home', { timeout: 20_000 });
  expect(await watch.report(), '何もしていない画面では、問題は0件').toEqual([]);
  expect(watch.counts.sockets, '部屋の WebSocket を記録した').toBeGreaterThanOrEqual(1);
  await page.evaluate(() => {
    // ほかのオリジン：CSP の frame-src https: は通るので、経路の見張りが止める。
    const f = document.createElement('iframe');
    f.src = 'https://irori-c1.invalid/';
    document.body.append(f);
    // CSP 違反：img-src は自分のオリジンだけ。
    const img = new Image();
    img.src = 'https://irori-c1.invalid/x.png';
    document.body.append(img);
    console.error('c1: わざと出したエラー');
    setTimeout(() => {
      throw new Error('c1: わざと投げた例外');
    }, 0);
    alert('c1');
    window.open('/c1-popup');
  });
  await expect
    .poll(async () => {
      const p = (await watch.report()).join('\n');
      return {
        外への通信: /ほかのオリジンへの通信（止めた）: https:\/\/irori-c1\.invalid\//.test(p),
        CSP違反: /CSP違反: img-src/.test(p),
        エラー: /c1: わざと出したエラー/.test(p),
        例外: /pageerror: c1: わざと投げた例外/.test(p),
        ダイアログ: /ダイアログが出た/.test(p),
        新しいページ: /新しいページが開いた/.test(p),
      };
    })
    .toEqual({ 外への通信: true, CSP違反: true, エラー: true, 例外: true, ダイアログ: true, 新しいページ: true });
  expect(watch.counts.requests).toBeGreaterThan(5);
  await ctx.close();
});

test('見張りは、本物の応答の Set-Cookie と、ほかのホストへの WebSocket を記録する', HOST, async ({ browser }) => {
  const [port] = await pickPorts(1, { from: 5260, to: 5289 });
  const server = createServer((req, res) => {
    if (req.url === '/cookie') {
      res.writeHead(200, { 'Set-Cookie': 'c1=1', 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>c1</title><p>c1</p>');
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${port}`;
  const ctx = await browser.newContext();
  const watch = new Watch({ label: '試し', origin });
  await watch.attach(ctx);
  const page = await ctx.newPage();
  await page.goto(`${origin}/`);
  await page.evaluate(async () => {
    await fetch('/cookie');
    // ほかのホスト（localhost は 127.0.0.1 と別のホスト）への WebSocket。つながらなくても、作った時点で記録する。
    const ws = new WebSocket(`ws://localhost:${location.port}/`);
    ws.onerror = () => undefined;
  });
  watch.socketErrorsOk = true;
  await expect
    .poll(async () => {
      const p = (await watch.report()).join('\n');
      return { cookie: /Set-Cookie が返った: .*\/cookie → c1=1/.test(p), socket: /ほかのホストへの WebSocket: ws:\/\/localhost:/.test(p) };
    })
    .toEqual({ cookie: true, socket: true });
  await ctx.close();
  await new Promise((r) => server.close(r));
});
