// ホストの画面の通し：実 Worker・実ブラウザ。スマホ役は実際の /pad#CODE のページ（3台、別の BrowserContext）。
// ホーム・参加者の帯・人数に合わないゲームの灰色・リーダーのリモコン・ゲームの起動と終了・結果と「もう一度」・メニュー・共有。
import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { env, openHost, PagePad, PUBLIC_URL, ScriptPad, type HostPage } from './e2e/fixtures';

const base = () => env('IRORI_HOST_E2E_MAIN');

/** 画面のQRを、ページの中でキャンバスに描いて画素を取り出し、jsQR で読む（スマホのカメラの代わり）。 */
async function readQr(host: HostPage): Promise<string | null> {
  const px = await host.page.evaluate(async () => {
    const svg = document.querySelector('.join__qr svg');
    if (!svg) return null;
    const size = 600;
    const img = new Image(size, size);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, size, size);
    return { w: size, h: size, data: Array.from(g.getImageData(0, 0, size, size).data) };
  });
  if (!px) return null;
  return jsQR(Uint8ClampedArray.from(px.data), px.w, px.h)?.data ?? null;
}

const focused = (host: HostPage) => host.page.locator('#app [data-focused]').first();

test('ホーム・参加者の帯・灰色・リーダーのリモコン（実際の /pad#CODE を3台）', async ({ browser }) => {
  const host = await openHost(browser, base());
  await host.expectState('home');
  const code = await host.code();
  // QRのURLは /pad#CODE。画面のQRを読み取って確かめる。
  expect(await readQr(host)).toBe(`${base()}/pad#${code}`);
  await expect(host.page.locator('.join__code')).toHaveText(code);
  // 開いたアドレスが 127.0.0.1 で、ほかに公開のアドレスも無い。ほかのスマホから開けないことを知らせ、
  // 「カメラでQRを読む」と、スマホから開けない手入力のアドレスは出さない。開き直す先を1行で示す。
  await expect(host.page.locator('.join__title')).toHaveText('この画面からは参加できません');
  await expect(host.page.locator('.join [data-loopback]')).toContainText('ほかのスマホから開けません');
  await expect(host.page.locator('.join__scan')).toHaveCount(0);
  await expect(host.page.locator('.join [data-fix]')).toContainText('npm run dev');
  await expect(host.page.locator('.guide__step').first()).toContainText('この画面からは、スマホは参加できません');
  // 最初の1人が入るまで、3手順の案内。
  await expect(host.page.locator('.guide__step')).toHaveCount(3);
  // 誰もいないので、どのゲームも灰色。
  await expect(host.page.locator('.card[data-game="hello-pad"]')).toHaveAttribute('data-playable', 'false');

  const p1 = await PagePad.join(browser, base(), code, 'たろう');
  await expect(host.page.locator('.seat[data-seat="1"]')).toBeVisible();
  await expect(host.page.locator('[data-guide]')).toHaveCount(0);
  await expect(host.page.locator('.seat[data-seat="1"] .seat__name')).toHaveText('たろう');
  await expect(host.page.locator('.seat[data-seat="1"]')).toHaveAttribute('data-leader', '');
  // 1人では、2人からのゲームは灰色で、理由が1行。
  const race = host.page.locator('.card[data-game="tap-race"]');
  await expect(race).toHaveAttribute('data-playable', 'false');
  await expect(race.locator('.card__sub')).toHaveText('あと1人で遊べます');
  await expect(host.page.locator('.card[data-game="hello-pad"]')).toHaveAttribute('data-playable', 'true');

  const p2 = await PagePad.join(browser, base(), code, 'はなこ');
  const p3 = await PagePad.join(browser, base(), code);
  await expect(host.page.locator('.seat')).toHaveCount(3);
  await expect(host.page.locator('.people__count')).toHaveText('3/8人');
  await expect(host.page.locator('.seat[data-seat="3"] .seat__name')).toHaveText('プレイヤー3');
  await expect(race).toHaveAttribute('data-playable', 'true');

  // リーダーにだけリモコン。ほかの席は「{名前}が選んでいます」。
  await p1.expectKind('remote');
  await p2.expectKind('wait');
  await p3.expectKind('wait');
  await expect(p2.page.locator('.irori-pad')).toContainText('たろうが選んでいます');

  // リーダーのリモコンで、棚の選択が動き、主役のカードが替わる。
  await expect(focused(host)).toHaveAttribute('data-nav', 'game:ten-seconds');
  await p1.press('right');
  await expect(focused(host)).toHaveAttribute('data-nav', 'game:dot-grab');
  await p1.press('right');
  await expect(focused(host)).toHaveAttribute('data-nav', 'game:hello-pad');
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  await p1.press('right');
  await expect(focused(host)).toHaveAttribute('data-nav', 'game:quiz-4');
  await p1.press('left');
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  // 決定で詳細、戻るでホーム。
  await p1.press('ok');
  await host.expectState('detail');
  await p1.press('back');
  await host.expectState('home');

  // リーダーが抜けたら、接続中の最小の席へリモコンが移る。
  await p1.close();
  await expect(host.page.locator('.seat[data-seat="1"]')).toHaveAttribute('data-online', 'false');
  await expect(host.page.locator('.seat[data-seat="1"]')).toContainText('つながっていません');
  await expect(host.page.locator('.seat[data-seat="2"]')).toHaveAttribute('data-leader', '');
  await p2.expectKind('remote');
  await expect(p3.page.locator('.irori-pad')).toContainText('はなこが選んでいます');

  for (const p of [p2, p3]) expect(p.watch.problems, 'pad page problems').toEqual([]);
  await host.assertClean();
  await Promise.all([p2.close(), p3.close(), host.context.close()]);
});

test('ゲームの起動・メニュー・終了・結果・「もう一度」・ホームへ（リーダーのリモコンだけで）', async ({ browser }) => {
  const host = await openHost(browser, base());
  const code = await host.code();
  const p1 = await PagePad.join(browser, base(), code, 'たろう');
  const p2 = await PagePad.join(browser, base(), code, 'はなこ');
  const p3 = await PagePad.join(browser, base(), code, 'じろう');
  await p1.expectKind('remote');

  // hello-pad（棚の3番め）を選んで、決定 → 詳細 → 決定（はじめる）。
  await p1.press('right');
  await p1.press('right');
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  await p1.press('ok');
  await host.expectState('detail');
  await expect(focused(host)).toHaveAttribute('data-nav', 'detail:start');
  await p1.press('ok');
  await host.expectState('playing');
  await expect(host.page.locator('.stage iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  // ゲームの指定に従う：3台ともスティックとボタンの画面。「おわる」は、ゲームがリーダーにだけ出す。
  for (const p of [p1, p2, p3]) await p.expectKind('pad');
  await expect(p1.page.locator('.irori-pad__btn[data-id="end"]')).toBeVisible();

  // スマホの menu 入力で一時停止。メニューでは、リーダーにリモコン、ほかは待機。
  await p2.page.locator('[data-act="seat"]').press('Enter');
  const pause = p2.page.locator('[data-act="pause"]');
  await expect(pause).toBeVisible();
  await expect
    .poll(async () => {
      if ((await host.state()) !== 'paused') await pause.click({ timeout: 2_000 }).catch(() => undefined);
      return host.state();
    }, { timeout: 15_000 })
    .toBe('paused');
  await expect(host.page.locator('[data-layer="menu"]')).toBeVisible();
  await p1.expectKind('remote');
  await p3.expectKind('wait');
  await expect(focused(host)).toHaveAttribute('data-nav', 'menu:continue');
  // 「続ける」でゲームに戻ると、ゲームの画面が戻る。
  await p1.press('ok');
  await host.expectState('playing');
  for (const p of [p1, p3]) await p.expectKind('pad');

  // 「おわる」で end → 結果。「もう一度」が最初の選択。
  await p1.press('end');
  await host.expectState('results');
  await expect(host.page.locator('.results')).toBeVisible();
  await expect(focused(host)).toHaveAttribute('data-nav', 'results:again');
  await p1.expectKind('remote');
  await p2.expectKind('wait');
  // もう一度 → また遊べる → もう一度終える。
  await p1.press('ok');
  await host.expectState('playing');
  await p3.expectKind('pad');
  await p1.expectKind('pad');
  await p1.press('end');
  await host.expectState('results');
  // 「ホームへ」へ動いて決定。
  await p1.press('right');
  await expect(focused(host)).toHaveAttribute('data-nav', 'results:home');
  await p1.press('ok');
  await host.expectState('home');
  await p1.expectKind('remote');

  for (const p of [p1, p2, p3]) expect(p.watch.problems, 'pad page problems').toEqual([]);
  await host.assertClean();
  await Promise.all([p1.close(), p2.close(), p3.close(), host.context.close()]);
});

test('キーボードでも同じ操作：矢印・Enter・Esc（ゲーム中はメニュー）・M（音）', async ({ browser }) => {
  const host = await openHost(browser, base());
  const code = await host.code();
  const pad = new ScriptPad(base(), code, 'たろう');
  await pad.join();
  await pad.expectSpec((s) => s?.k === 'remote', 'リーダーにリモコン');
  const k = host.page.keyboard;
  const focused = host.page.locator('#app [data-focused]').first();
  await k.press('ArrowRight');
  await k.press('ArrowRight');
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  // 上の並び（音・締め切り・共有）へ上がり、下へ戻ると、棚の選択中のカードに戻る（参加者の札へ飛ばない）。
  await k.press('ArrowUp');
  await expect(focused).toHaveAttribute('data-nav', /^tool:/);
  await k.press('ArrowDown');
  await expect(focused).toHaveAttribute('data-nav', 'game:hello-pad');
  // 参加者の札を選ぶと、見出しの行に外し方の案内が出る。
  await k.press('ArrowDown');
  await expect(focused).toHaveAttribute('data-nav', /^seat:/);
  await expect(host.page.locator('.people__hint')).toBeVisible();
  await k.press('ArrowUp');
  await expect(focused).toHaveAttribute('data-nav', /^game:/);
  await expect(host.page.locator('.people__hint')).toBeHidden();
  // 札から上がった先は、真上のカード（左端のゲームのこともある）。棚の中で、ハローパッドへ戻る。
  for (let i = 0; i < 5 && (await focused.getAttribute('data-nav')) !== 'game:hello-pad'; i++) await k.press('ArrowRight');
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  await k.press('Enter');
  await host.expectState('detail');
  // メニューの開き方は、詳細の「操作」で伝える（ゲームの画面には重ねない）。
  await expect(host.page.locator('[data-layer="detail"] [data-hint="menu"]')).toHaveText('メニュー：［Esc］か、スマホの右上の「…」から');
  await k.press('Escape');
  await host.expectState('home');
  await k.press('Enter');
  await k.press('Enter');
  await host.expectState('playing');
  await pad.expectSpec((s) => s?.k === 'pad', 'ゲームの画面');
  // ゲームの最中は、ホストは案内をゲームの画面に重ねない（短い知らせのほかは、何も出さない）。
  const overlays = host.page.locator('.hints .hint:not(.toast)');
  expect(await overlays.count(), 'ゲームの最中に案内が出た').toBe(0);
  await k.press('Escape');
  await host.expectState('paused');
  // 一時停止中のスマホは「メニューを操作中です」（リーダーはリモコンのまま、メニューを動かせる）。
  await pad.expectSpec((s) => s?.k === 'remote' && s.hint === 'メニューを操作中です', 'メニューではリモコン');
  // メニューの並びは「続ける・ホームへ・…」で、上下で一周する。
  await expect(focused).toHaveAttribute('data-nav', 'menu:continue');
  await k.press('ArrowDown');
  await expect(focused).toHaveAttribute('data-nav', 'menu:home');
  await k.press('ArrowUp');
  await k.press('ArrowUp');
  await expect(focused).toHaveAttribute('data-nav', 'menu:kick');
  await k.press('ArrowDown');
  await expect(focused).toHaveAttribute('data-nav', 'menu:continue');
  await expect(host.page.locator('#app')).toHaveAttribute('data-sound', 'true');
  await k.press('m');
  await expect(host.page.locator('#app')).toHaveAttribute('data-sound', 'false');
  await k.press('Escape');
  await host.expectState('playing');
  pad.press('end');
  await host.expectState('results');
  // 2つ目のゲームでも、案内は重ねない。
  await k.press('Enter');
  await host.expectState('playing');
  await pad.expectSpec((s) => s?.k === 'pad', '2つ目のゲームの画面');
  expect(await overlays.count(), '2つ目のゲームで案内が出た').toBe(0);
  pad.press('end');
  await host.expectState('results');
  pad.close();
  await host.assertClean();
  await host.context.close();
});

test('途中から来た人は、ゲーム中は「次のゲームから参加できます」。ホームに戻れば遊べる', async ({ browser }) => {
  const host = await openHost(browser, base());
  const code = await host.code();
  const a = new ScriptPad(base(), code, 'たろう');
  await a.join();
  await host.page.keyboard.press('ArrowRight');
  await host.page.keyboard.press('ArrowRight');
  await host.page.keyboard.press('Enter');
  await host.page.keyboard.press('Enter');
  await host.expectState('playing');
  await a.expectSpec((s) => s?.k === 'pad', 'ゲームの画面');
  const late = new ScriptPad(base(), code, 'おくれ');
  await late.join();
  await late.expectSpec((s) => s?.k === 'wait' && s.title === '次のゲームから参加できます', '途中から来た人は待機');
  // 遅れて来た人のボタンは、ゲームに届かない（終わらない）。
  late.press('end');
  await host.page.waitForTimeout(400);
  await host.expectState('playing');
  a.press('end');
  await host.expectState('results');
  await late.expectSpec((s) => s?.k === 'wait' && s.title === 'たろうが選んでいます', '結果ではふつうの待機');
  await host.page.keyboard.press('Escape');
  await host.expectState('home');
  await expect(host.page.locator('.seat')).toHaveCount(2);
  a.close();
  late.close();
  await host.assertClean();
  await host.context.close();
});

test('共有：端末の共有シート・X・LINE・リンクのコピー。共有するのはサイトのURL', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP', permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => {
    const calls: unknown[] = [];
    (globalThis as { __shared?: unknown[] }).__shared = calls;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: unknown) => void calls.push(d) });
  });
  const host = await openHost(browser, base(), { context });
  const code = await host.code();
  await host.page.locator('[data-action="share"]').click();
  const layer = host.page.locator('[data-layer="share"]');
  await expect(layer).toBeVisible();
  const site = `${base()}/`;
  await expect(layer.locator('.share__url')).toHaveText(site);
  const x = new URL((await layer.locator('a[data-share="x"]').getAttribute('href')) ?? '');
  expect(`${x.origin}${x.pathname}`).toBe('https://x.com/intent/post');
  expect(x.searchParams.get('url')).toBe(site);
  const line = new URL((await layer.locator('a[data-share="line"]').getAttribute('href')) ?? '');
  expect(`${line.origin}${line.pathname}`).toBe('https://social-plugins.line.me/lineit/share');
  expect(line.searchParams.get('url')).toBe(site);
  for (const href of [x.href, line.href]) expect(href).not.toContain(code);
  await expect(layer.locator('a[data-share="x"]')).toHaveAttribute('target', '_blank');
  // リンクのコピー。
  await layer.locator('[data-nav="share:copy"]').click();
  await expect(host.page.locator('.toast')).toHaveText('コピーしました');
  expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe(site);
  // 端末の共有シート（navigator.share を持たせたときだけ出る）。
  await layer.locator('[data-nav="share:native"]').click();
  expect(await host.page.evaluate(() => (globalThis as { __shared?: unknown[] }).__shared)).toEqual([expect.objectContaining({ url: site })]);
  await expect(layer).toContainText('Instagram と YouTube');
  // ボタンは44px以上。
  for (const sel of ['[data-nav="share:native"]', 'a[data-share="x"]', 'a[data-share="line"]', '[data-nav="share:copy"]']) {
    const b = await layer.locator(sel).boundingBox();
    expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await layer.locator('[data-nav="share:close"]').click();
  await expect(layer).toHaveCount(0);
  await host.assertClean();
  await context.close();
});

test('参加の締め切りと、参加者を外す（kick）', async ({ browser }) => {
  const host = await openHost(browser, base());
  const code = await host.code();
  const a = new ScriptPad(base(), code, 'たろう');
  const b = new ScriptPad(base(), code, 'はなこ');
  await a.join();
  await b.join();
  const lock = host.page.locator('[data-action="lock"]');
  await expect(lock.locator('.btn__label')).toHaveText('参加を締め切る');
  await lock.click();
  await expect(host.page.locator('.join')).toHaveAttribute('data-locked', 'true');
  await expect(lock.locator('.btn__label')).toHaveText('受け付けを再開');
  // QRに重ねた「参加を締め切っています」は、低い画面でも QR の枠の中に収まる（左右で切れない）。
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 600 }, { width: 1366, height: 560 }]) {
    await host.page.setViewportSize(size);
    const inside = await host.page.evaluate(() => {
      const qr = document.querySelector('.home__join .join__qr')!.getBoundingClientRect();
      const text = document.querySelector('.home__join .join__lock > span')!.getBoundingClientRect();
      return text.left >= qr.left && text.right <= qr.right;
    });
    expect(inside, `${size.width}x${size.height}`).toBe(true);
  }
  await host.page.setViewportSize({ width: 1280, height: 720 });
  const c = new ScriptPad(base(), code, 'しらない');
  c.join().catch(() => undefined);
  await expect.poll(() => c.state, { timeout: 10_000 }).toBe('closed');
  await host.page.locator('.seat[data-seat="2"]').click();
  // 取り消せない操作なので、塗りの主ボタンは「やめる」。「外す」は輪郭だけ。
  await expect(host.page.locator('[data-nav="kick:cancel"]')).toHaveClass(/btn--primary/);
  await expect(host.page.locator('[data-nav="kick:ok"]')).not.toHaveClass(/btn--primary/);
  await host.page.locator('[data-nav="kick:ok"]').click();
  await expect(host.page.locator('.seat')).toHaveCount(1);
  await expect.poll(() => b.frames.some((f) => f.t === 'kicked')).toBe(true);
  a.close();
  await host.assertClean();
  await host.context.close();
});

test('ゲームパッドでも同じ操作（十字・A・B）', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
  await context.addInitScript(() => {
    const pad = {
      id: 'test pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (globalThis as { __pad?: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  const host = await openHost(browser, base(), { context });
  const code = await host.code();
  const pad = new ScriptPad(base(), code, 'たろう');
  await pad.join();
  const tap = (i: number) =>
    host.page.evaluate(async (b) => {
      const p = (globalThis as { __pad?: { buttons: { pressed: boolean }[] } }).__pad;
      const btn = p?.buttons[b];
      if (!btn) return;
      btn.pressed = true;
      await new Promise((r) => setTimeout(r, 80));
      btn.pressed = false;
      await new Promise((r) => setTimeout(r, 80));
    }, i);
  await host.page.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
  await tap(15);
  await tap(15);
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  await tap(0);
  await host.expectState('detail');
  await tap(1);
  await host.expectState('home');
  pad.close();
  await host.assertClean();
  await context.close();
});

test('部屋があるあいだ、画面の消灯を防ぐ（Wake Lock を取る）', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
  await context.addInitScript(() => {
    const calls: string[] = [];
    (globalThis as { __wake?: string[] }).__wake = calls;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          calls.push(type);
          const s = Object.assign(new EventTarget(), { released: false, release: async () => undefined });
          return s;
        },
      },
    });
  });
  const host = await openHost(browser, base(), { context });
  await host.expectState('home');
  await expect.poll(() => host.page.evaluate(() => (globalThis as { __wake?: string[] }).__wake ?? [])).toContain('screen');
  await host.assertClean();
  await context.close();
});

test('公開のアドレス（PUBLIC_URL）：127.0.0.1 で開いても、QR・手入力・共有の宛先は公開のアドレスになる', async ({ browser }) => {
  const pub = env('IRORI_HOST_E2E_PUBLIC');
  const host = await openHost(browser, pub);
  await host.expectState('home');
  const code = await host.code();
  expect(await readQr(host)).toBe(`${PUBLIC_URL}/pad#${code}`);
  await expect(host.page.locator('.join__qr')).toHaveAttribute('data-url', `${PUBLIC_URL}/pad#${code}`);
  await expect(host.page.locator('.join__url')).toHaveText(`${new URL(PUBLIC_URL).host}/pad`);
  await expect(host.page.locator('[data-loopback]')).toHaveCount(0);
  await host.page.locator('[data-action="share"]').click();
  await expect(host.page.locator('[data-layer="share"] .share__url')).toHaveText(`${PUBLIC_URL}/`);
  // 部屋そのものは、開いたアドレスの Worker にある（案内の表示だけが変わる）。
  const pad = new ScriptPad(pub, code, 'たろう');
  await pad.join();
  await expect(host.page.locator('.seat')).toHaveCount(1);
  pad.close();
  await host.assertClean();
  await host.context.close();
});

test('スマホの幅（390×844）：最初の画面に、参加の入口（QR・コード）と参加者の札が入る。上の操作群は高さの2割以下', async ({ browser }) => {
  const pub = env('IRORI_HOST_E2E_PUBLIC');
  const size = { width: 390, height: 844 };
  const host = await openHost(browser, pub, { viewport: size });
  await host.expectState('home');
  const code = await host.code();
  const pads: ScriptPad[] = [];
  for (const n of ['たろう', 'はなこ', 'ゆい']) {
    const pad = new ScriptPad(pub, code, n);
    await pad.join();
    pads.push(pad);
  }
  await expect(host.page.locator('.seat')).toHaveCount(3);
  const box = async (sel: string) => {
    const b = await host.page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${sel} が見えない`);
    return b;
  };
  // 見る順：参加の板 → 参加者 → 選び方の1行（主役のすぐ上で、最初の画面に入る）→ 主役のカード → 棚。
  const order = await Promise.all(['.home__join', '.home__people', '.home__prompt', '.home__hero', '.home__shelf'].map(async (sel) => (await box(sel)).y));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  const qr = await box('.join__qr');
  const seat = await box('.seat');
  expect(qr.y + qr.height).toBeLessThanOrEqual(size.height);
  expect(qr.width).toBeLessThanOrEqual(220);
  expect(seat.y + seat.height).toBeLessThanOrEqual(size.height);
  const top = await box('.home__top');
  expect(top.y + top.height).toBeLessThanOrEqual(size.height * 0.2);
  const prompt = await box('.home__prompt');
  expect(prompt.y + prompt.height).toBeLessThanOrEqual(size.height);
  await expect(host.page.locator('.start-prompt__touch')).toBeVisible();
  await expect(host.page.locator('.start-prompt__wide')).toBeHidden();
  // 参加のページへの細い帯（48px以上）。音の知らせは、音のボタンの1か所だけ（帯は出さない）。
  const padlink = host.page.locator('a.padlink');
  await expect(padlink).toBeVisible();
  await expect(padlink).toHaveAttribute('href', '/pad');
  expect((await box('a.padlink')).height).toBeGreaterThanOrEqual(48);
  await expect(host.page.locator('[data-hint="sound"]')).toHaveCount(0);
  await expect(host.page.locator('.home__top [data-action="sound"]')).toBeVisible();
  for (const sel of ['[data-action="sound"]', '[data-action="lock"]', '[data-action="share"]', 'a[data-nav="tool:licenses"]']) {
    const b = await box(sel);
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(48);
  }
  for (const pad of pads) pad.close();
  await host.assertClean();
  await host.context.close();
});

test('ゲームの途中で空いた席に入った別の人は、そのゲームの参加者にならない（外したとき・退出したときの2通り）', async ({ browser }) => {
  test.setTimeout(120_000);
  const devUrl = env('IRORI_HOST_E2E_DEV');
  const devHost = new URL(devUrl).host;
  for (const how of ['kick', 'bye'] as const) {
    const host = await openHost(browser, base(), { path: `/?dev=${encodeURIComponent(devUrl)}`, allowHosts: [devHost] });
    await host.expectState('home');
    const code = await host.code();
    const [a, b, c] = [new ScriptPad(base(), code, 'たろう'), new ScriptPad(base(), code, 'はなこ'), new ScriptPad(base(), code, 'じろう')];
    for (const p of [a, b, c]) await p.join();
    await expect(host.page.locator('.seat')).toHaveCount(3);
    // 試験用の外部ゲーム（棚の先頭）を、確かめを通して始める。
    const k = host.page.keyboard;
    await k.press('Enter');
    await host.expectState('detail');
    await k.press('Enter');
    await expect(host.page.locator('[data-layer="confirm"]')).toBeVisible();
    await k.press('ArrowLeft');
    await k.press('Enter');
    await host.expectState('playing');
    await b.expectSpec((s) => s?.k === 'pad', '参加者にゲームの画面');
    const game = host.page.frameLocator('.stage iframe');
    await expect(game.locator('#msg')).toHaveText('players: 1,2,3');
    // 席2を空ける：メニューから外す、または本人が退出する。
    if (how === 'kick') {
      await k.press('Escape');
      await host.expectState('paused');
      await host.page.locator('[data-nav="menu:kick"]').click();
      await host.page.locator('[data-nav="menu:kick:2"]').click();
      await host.page.locator('[data-nav="kick:ok"]').click();
      await expect.poll(() => b.frames.some((f) => f.t === 'kicked')).toBe(true);
      await host.page.locator('[data-nav="menu:back"]').click();
      await host.page.locator('[data-nav="menu:continue"]').click();
      await host.expectState('playing');
    } else {
      b.bye();
    }
    await expect(host.page.locator('#app')).toHaveAttribute('data-players', '2');
    await expect(game.locator('#msg')).toHaveText('players: 1,3');
    // 別の人が入る。中継は空いた最小の番号を渡すので、席2になる。
    const d = new ScriptPad(base(), code, 'さぶろう');
    expect((await d.join()).id).toBe(2);
    await d.expectSpec((s) => s?.k === 'wait' && s.title === '次のゲームから参加できます', `${how}：空いた席に入った人は待機`);
    // その人のボタンは、ホストに届いても、ゲームには渡さない。目印に、あとから参加者のボタンを押す。
    d.press('poke');
    await expect.poll(() => host.received.some((f) => f.includes('"t":"in"') && f.includes('"p":2'))).toBe(true);
    a.press('poke');
    await expect(game.locator('#log')).toContainText('1:poke:1');
    expect(await game.locator('#log').textContent(), `${how}：席2の入力がゲームに届いた`).not.toMatch(/(^|\s)2:/);
    await expect(game.locator('#msg')).toHaveText('players: 1,3');
    // 結果にも出ない。
    a.press('end');
    await host.expectState('results');
    await expect(host.page.locator('.result')).toHaveCount(2);
    await expect(host.page.locator('.result[data-seat="2"]')).toHaveCount(0);
    for (const p of [a, c, d]) p.close();
    await host.assertClean();
    await host.context.close();
  }
});

test('棚の一覧が部屋より遅く届いても、棚が出たら選択の輪は選択中のゲームのカード。ホストの再読み込みでも同じ', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
  await context.route('**/registry/index.json', async (route) => {
    await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  const host = await openHost(browser, base(), { context });
  const focused = host.page.locator('#app [data-focused]').first();
  for (const round of ['開いたとき', '再読み込み']) {
    if (round === '再読み込み') await host.page.reload();
    await host.expectState('home');
    // 棚が出る前は、仮に上の帯のボタンに乗っている（この試験が直した場面を通っていることの確かめ）。
    await expect(host.page.locator('.card[data-game]')).toHaveCount(0);
    await expect(focused).toHaveAttribute('data-nav', /^tool:/);
    await expect(host.page.locator('.card[data-game]').first()).toBeVisible();
    await expect(focused, round).toHaveAttribute('data-nav', /^game:/);
    // リモコンの「右」（キーボードの →）で、棚の選択が動く。
    const before = await focused.getAttribute('data-nav');
    await host.page.keyboard.press('ArrowRight');
    await expect(focused).toHaveAttribute('data-nav', /^game:/);
    await expect(focused).not.toHaveAttribute('data-nav', before ?? '');
  }
  await host.assertClean();
  await context.close();
});

test('棚が12本になっても、カードは参加の板（QR とコード）に重ならない。右へ送ると、見える位置まで棚が流れる', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ja-JP' });
  const real = (await (await context.request.get(`${base()}/registry/index.json`)).json()) as { games: Array<{ id: string; title: Record<string, string> }> };
  const games = Array.from({ length: 12 }, (_, n) => {
    const g = real.games[n % real.games.length]!;
    return { ...g, id: `${g.id}-${n + 1}`, title: Object.fromEntries(Object.entries(g.title).map(([k, v]) => [k, `${v}${n + 1}`])) };
  });
  await context.route('**/registry/index.json', (route) => route.fulfill({ json: { ...real, games } }));
  const host = await openHost(browser, base(), { context });
  await host.expectState('home');
  await expect(host.page.locator('.card[data-game]')).toHaveCount(12);
  // 見えている部分（棚の箱で切られたあと）が、参加の板と重なるカードの一覧。QR の真ん中は、カードでなく QR。
  const overlaps = () =>
    host.page.evaluate(() => {
      const join = document.querySelector('.home__join')!.getBoundingClientRect();
      const box = document.querySelector('.home__shelf .shelf')!.getBoundingClientRect();
      const hit: string[] = [];
      for (const card of document.querySelectorAll<HTMLElement>('.card[data-game]')) {
        const r = card.getBoundingClientRect();
        const [l, rt, t, bt] = [Math.max(r.left, box.left), Math.min(r.right, box.right), Math.max(r.top, box.top), Math.min(r.bottom, box.bottom)];
        if (rt > l && bt > t && l < join.right && rt > join.left && t < join.bottom && bt > join.top) hit.push(card.dataset.game ?? '');
      }
      const qr = document.querySelector('.join__qr')!.getBoundingClientRect();
      const top = document.elementFromPoint(qr.left + qr.width / 2, qr.top + qr.height / 2);
      return { hit, qrOnTop: top?.closest('.home__join') !== null };
    });
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await host.page.setViewportSize(size);
    await expect.poll(overlaps).toEqual({ hit: [], qrOnTop: true });
  }
  // 選択を右端まで送る。最後のカードは、棚の中の見える位置まで流れてくる（重ならないまま）。
  const focused = host.page.locator('#app [data-focused]').first();
  await expect(focused).toHaveAttribute('data-nav', /^game:/);
  for (let i = 0; i < 11; i++) await host.page.keyboard.press('ArrowRight');
  await expect(focused).toHaveAttribute('data-nav', `game:${games[11]!.id}`);
  await expect
    .poll(() =>
      host.page.evaluate(() => {
        const box = document.querySelector('.home__shelf .shelf')!.getBoundingClientRect();
        const r = document.querySelector('.card[data-focused]')!.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1;
      }),
    )
    .toBe(true);
  expect(await overlaps()).toEqual({ hit: [], qrOnTop: true });
  await host.assertClean();
  await context.close();
});
