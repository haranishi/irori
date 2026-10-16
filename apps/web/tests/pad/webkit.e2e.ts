// iPhone の Safari に近いエンジン（Playwright の WebKit・iPhone 13 の画面）で、参加 → 操作 → 入り直しを1本通す。
// 実機ではない。振動・傾きの許可・Wake Lock・画面ロックでの切断は、ここでは確かめられない。
import { act, expect, openPad, screen, test } from './e2e/fixtures';

test('WebKit：QRのURLで参加し、押すと届き、回線が切れても同じ席に戻って続けられる', async ({ page, line, makeHost, watch }) => {
  watch.allowNetworkErrors();
  const host = await makeHost();
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  await act(page, 'join').tap();
  const you = await host.joinedNth(1);
  await expect(screen(page, 'play')).toBeVisible();
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  const buzzer = page.locator('.irori-pad__buzzer');
  await expect(buzzer).toBeVisible();
  await buzzer.tap();
  await host.eventsAtLeast(you.id, 2);
  line.drop();
  await expect(page.locator('.pp-banner')).toBeVisible();
  await expect(page.locator('.pp-banner')).toBeHidden();
  await expect(buzzer).toBeVisible();
  await buzzer.tap();
  await host.eventsAtLeast(you.id, 4);
  expect(host.events(you.id)).toEqual([
    { k: 'btn', id: 'buzzer', d: 1 },
    { k: 'btn', id: 'buzzer', d: 0 },
    { k: 'btn', id: 'buzzer', d: 1 },
    { k: 'btn', id: 'buzzer', d: 0 },
  ]);
  expect(host.joined().length).toBe(1);
});
