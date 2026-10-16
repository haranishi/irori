// メニューの入口は右上の「…」（48px以上・名前の長さで動かない）。左上の札の長押しは近道として残し、短いタップでは開かない。
import { Finger, act, centerOf, expect, joinRoom, openPad, screen, test } from './e2e/fixtures';

test('右上の「…」を押すとメニューが開く。48px以上で、名前の長さによらず右上の同じ場所にある', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await joinRoom(page, line, host, 'た');
  const page2 = await page.context().newPage();
  await page2.addInitScript(() => localStorage.setItem('irori:name', 'ながいながいなまえのひと'));
  await openPad(page2, line, host.code);
  await act(page2, 'join').tap();
  await expect(screen(page2, 'play')).toBeVisible();
  const a = (await act(page, 'menu').boundingBox())!;
  const b = (await act(page2, 'menu').boundingBox())!;
  for (const box of [a, b]) {
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
  expect(Math.round(a.x + a.width)).toBe(Math.round(b.x + b.width));
  expect(Math.round(a.y)).toBe(Math.round(b.y));
  // 縁の内側の右上（画面の右半分・上の1割）。
  expect(a.x).toBeGreaterThan(390 / 2);
  expect(a.y).toBeLessThan(844 * 0.1);
  await act(page, 'menu').tap();
  const menu = page.locator('.pp-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('#pp-menu-title')).toHaveText('メニュー');
  // メニューの下地は不透明（下の札や操作が透けて見えない）。
  const look = await menu.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity }));
  expect(look.bg).toMatch(/^rgb\(/);
  expect(look.opacity).toBe('1');
  // メニューは札ごと覆う（札の真ん中を押しても、札には届かない）。
  const c = await centerOf(page.locator('.pp-badge'));
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.pp-menu') !== null, [c.x, c.y])).toBe(true);
  // メニューの下の操作は押せない。
  expect(await page.locator('.pp-pad').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await act(page, 'close-menu').tap();
  await expect(menu).toBeHidden();
  expect(await page.locator('.pp-pad').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
});

test('札の短いタップでは開かず、右上の「…」へ案内する。長押し（600ms）は近道として開く', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host, 'たろう');
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  const badge = act(page, 'seat');
  const menu = page.locator('.pp-menu');
  await badge.tap();
  await expect(page.locator('.pp-toast')).toHaveText('メニューは、右上の「…」から開けます。');
  await expect(menu).toBeHidden();
  const f = await Finger.on(page);
  // 300ms の押しでも開かない。
  await f.hold(badge, 300);
  await expect(menu).toBeHidden();
  // 押している間は、長押しの進み具合を出す。
  const c = await centerOf(badge);
  await f.down(c.x, c.y);
  await expect(badge).toHaveAttribute('data-holding', '');
  await expect(menu).toBeVisible();
  await f.up();
  await expect(badge).not.toHaveAttribute('data-holding', '');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('たろう');
});

test('長押しのあと指がずれたら開かない（スクロールや迷いの指）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await joinRoom(page, line, host);
  const badge = act(page, 'seat');
  const b = (await badge.boundingBox())!;
  const f = await Finger.on(page);
  await f.down(b.x + 30, b.y + b.height / 2);
  await f.move(b.x + 90, b.y + b.height / 2);
  await new Promise((r) => setTimeout(r, 750));
  await f.up();
  await expect(page.locator('.pp-menu')).toBeHidden();
});

test('「一時停止を頼む」は {k:"menu"} をホストへ送り、メニューを閉じて知らせる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  await act(page, 'menu').tap();
  await expect(page.locator('.pp-menu')).toBeVisible();
  await act(page, 'pause').tap();
  const ev = await host.until(() => host.events(you.id).find((i) => i.k === 'menu'), 'メニューの依頼');
  expect(ev).toEqual({ k: 'menu' });
  await expect(page.locator('.pp-menu')).toBeHidden();
  await expect(page.locator('.pp-toast')).toHaveText('大きな画面にメニューを出しました。');
});

test('「退出する」は取り消せない操作として見た目を分け、bye を送って席を空ける。「もう一度入る」は新しい参加', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  await act(page, 'menu').tap();
  const leave = act(page, 'leave');
  await expect(leave).toContainText('取り消せません');
  const look = await leave.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(look).not.toBe(await act(page, 'pause').evaluate((el) => getComputedStyle(el).borderTopColor));
  await leave.tap();
  await expect(page.locator('[data-state="left"]')).toBeVisible();
  const left = await host.until(() => host.frames.find((x) => x.t === 'left'), '退出');
  expect(left).toEqual({ t: 'left', p: you.id, why: 'bye' });
  // 札は消える（同じタブで開き直しても、前の席には戻らない）。
  expect(await page.evaluate((code) => sessionStorage.getItem(`irori:resume:${code}`), host.code)).toBeNull();
  // 行き先をボタンに書く。主は同じ部屋、副は別の部屋。
  await expect(act(page, 'rejoin')).toHaveText('同じ部屋にもう一度入る');
  await expect(act(page, 'rejoin')).toHaveClass(/pp-btn--primary/);
  await expect(act(page, 'reenter')).toHaveText('別の部屋のコードを入れる');
  await act(page, 'rejoin').tap();
  await host.joinedNth(2);
  await expect(screen(page, 'play')).toBeVisible();
});

test('メニューのいちばん下に「ライセンスとクレジット」のリンクがあり、/licenses.txt（BudouX の帰属表示を含む）を新しいタブで開く', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await joinRoom(page, line, host);
  await act(page, 'menu').tap();
  const link = act(page, 'licenses');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('ライセンスとクレジット');
  await expect(link).toHaveAttribute('href', '/licenses.txt');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(((await link.getAttribute('rel')) ?? '').split(/\s+/).sort()).toEqual(['noopener', 'noreferrer']);
  // 並びのいちばん下（「退出する」と「閉じる」より下）。押せる高さは44px以上。
  const l = (await link.boundingBox())!;
  for (const other of ['leave', 'close-menu']) {
    const o = (await act(page, other).boundingBox())!;
    expect(l.y, other).toBeGreaterThanOrEqual(o.y + o.height);
  }
  expect(l.height).toBeGreaterThanOrEqual(44);
  // 取り消せない操作（退出）の見た目と分ける：枠も塗りもない。
  const look = await link.evaluate((el) => ({ border: getComputedStyle(el).borderTopStyle, bg: getComputedStyle(el).backgroundColor }));
  expect(look).toEqual({ border: 'none', bg: 'rgba(0, 0, 0, 0)' });
  // 指で押すと、新しいタブで開く。中身には BudouX の帰属表示がある。
  const [tab] = await Promise.all([page.context().waitForEvent('page'), link.tap()]);
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe('/licenses.txt');
  expect(await tab.locator('body').innerText()).toContain('BudouX');
  await tab.close();
  // メニューは開いたまま（ゲームの画面からは離れない）。
  await expect(page.locator('.pp-menu')).toBeVisible();
});
