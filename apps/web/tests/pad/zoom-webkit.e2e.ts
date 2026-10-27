// 拡大（WebKit・iPhone 13 の画面）：viewport は拡大を止めない。部屋の中の操作画面は touch-action で指の拡大を止める。
// Playwright の WebKit では2本指の操作を出せないので、拡大を止める設定（touch-action）が操作画面に効いていることと、
// 続けてたたいても（ダブルタップ）拡大されないことを確かめる。2本指の拡大そのものは zoom.e2e.ts（Chromium）で見る。
import type { PadSpec } from '@irori/protocol';
import { expect, joinRoom, openPad, screen, test } from './e2e/fixtures';

const SPECS: { sel: string; spec: PadSpec }[] = [
  { sel: '.irori-pad__dpad', spec: { k: 'pad', stick: 'dpad', buttons: [{ id: 'hop', label: 'ぴょん' }] } },
  { sel: '.irori-pad__stick', spec: { k: 'pad', stick: 'stick', buttons: [{ id: 'hop', label: 'ぴょん' }] } },
  { sel: '.irori-pad__buzzer', spec: { k: 'buzzer', label: '押す' } },
  { sel: '.irori-pad__touch', spec: { k: 'touch', mode: 'area', hint: 'なぞる' } },
  { sel: '.irori-pad__tilt', spec: { k: 'tilt', hint: '傾けて曲がる', buttons: [{ id: 'boost', label: '加速' }] } },
];

test('WebKit：viewport は拡大を止めず、部屋の中の操作画面は指の拡大を止める（touch-action）。続けてたたいても拡大されない', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  const content = (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
  expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/);
  expect(content).not.toMatch(/maximum-scale/);
  // 入る前の画面は、指の拡大を止めない（ダブルタップの拡大だけを止める manipulation）。
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation');
  const you = await joinRoom(page, line, host);
  expect(await page.locator('.pp-play').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  for (const s of SPECS) {
    host.setPad(you.id, s.spec);
    const el = page.locator(s.sel);
    await expect(el).toBeVisible();
    expect(await el.evaluate((e) => getComputedStyle(e).touchAction), s.sel).toBe('none');
    await el.tap();
    await el.tap();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), s.sel).toBe(1);
  }
});


test('WebKit：tilesの札は縦にスクロールでき、ダブルタップで拡大しない', async ({ page, line, makeHost }) => {
  const host = await makeHost(); const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'tiles', tiles: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, label: `札${i}` })), ok: '出す', pass: 'パス' });
  const grid = page.locator('.irori-pad__tiles-grid'); await expect(grid).toBeVisible();
  expect(await grid.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  expect(await grid.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('[data-id="t0"]').tap(); await page.locator('[data-id="t0"]').tap();
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await grid.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('[data-id="t19"]')).toBeInViewport();
  await expect(page.locator('[data-action="ok"]')).toBeInViewport();
});
