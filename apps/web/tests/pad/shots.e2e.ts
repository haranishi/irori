// 画面の確認用のスクリーンショット。縦（390×844）と横（844×390）で、iPhone のノッチ・ホームバー相当の安全領域を付けて撮る。
// 置き場所：.agent-harness/runs/2026-10-16-bootstrap/review/shots-pad/。ファイルを書くので、IRORI_PAD_SHOTS=1 のときだけ動かす。
import type { Page } from '@playwright/test';
import type { PadSpec } from '@irori/protocol';
import { HOST_JA } from '../../src/host/messages';
import { SHOTS_DIR, shotsEnabled } from './e2e/env.mjs';
import { act, expect, joinRoom, openPad, screen, test } from './e2e/fixtures';
import type { TestHost } from './e2e/host';
import type { Line } from './e2e/line.mjs';

/** ホスト（B1）がスマホへ送る文言。撮影は本物の文言で撮る（書き写さない）。 */
const HOST = (key: string, vars: Record<string, string> = {}): string =>
  (HOST_JA[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** キーボードが出たときの見える範囲（縦・横）。 */
const KEYBOARD = { portrait: { width: 390, height: 420 }, landscape: { width: 844, height: 190 } } as const;

/** quiz-4 の1問目と同じ形（選択肢の id は c0〜c3）。 */
const QUIZ = [
  { id: 'c0', label: '岡山県' },
  { id: 'c1', label: '兵庫県' },
  { id: 'c2', label: '鳥取県' },
  { id: 'c3', label: '大阪府' },
];

const ORIENTS = [
  { name: 'portrait', viewport: { width: 390, height: 844 }, insets: { top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } },
  { name: 'landscape', viewport: { width: 844, height: 390 }, insets: { top: 0, topMax: 0, bottom: 21, bottomMax: 21, left: 47, leftMax: 47, right: 47, rightMax: 47 } },
] as const;

interface Ctx {
  page: Page;
  line: Line;
  makeHost: () => Promise<TestHost>;
  orient: 'portrait' | 'landscape';
  /** 撮る対象のページ（既定は page）。 */
  target?: Page;
}

async function inRoom(c: Ctx, spec?: PadSpec, name?: string): Promise<{ host: TestHost; id: number }> {
  const host = await c.makeHost();
  if (name !== undefined) await c.page.addInitScript((n) => localStorage.setItem('irori:name', n), name);
  const you = await joinRoom(c.page, c.line, host);
  if (spec) {
    host.setPad(you.id, spec);
    // 案内が重なる場面では操作は隠れるので、描かれたこと（DOM にあること）で待つ。
    await expect(c.page.locator(`.irori-pad[data-kind="${spec.k}"]`)).toBeAttached();
  }
  return { host, id: you.id };
}

const SCENES: [string, (c: Ctx) => Promise<void>][] = [
  ['01-entry', async (c) => {
    await openPad(c.page, c.line);
    await expect(screen(c.page, 'entry')).toBeVisible();
  }],
  ['02-entry-typing', async (c) => {
    await openPad(c.page, c.line);
    await c.page.locator('.pp-code__box').nth(0).pressSequentially('k');
    await c.page.locator('.pp-code__box').nth(1).pressSequentially('7');
    await expect(c.page.locator('.pp-code__box').nth(2)).toBeFocused();
  }],
  ['03-entry-no-room', async (c) => {
    await openPad(c.page, c.line, 'BCDF');
    await expect(c.page.locator('.pp-msg')).toBeVisible();
  }],
  ['04-checking', async (c) => {
    await c.page.route('**/api/rooms/*', () => undefined); // 返事を止めて、確かめている画面のままにする
    await openPad(c.page, c.line, 'BCDF');
    await expect(screen(c.page, 'checking')).toBeVisible();
  }],
  ['05-join', async (c) => {
    const host = await c.makeHost();
    await openPad(c.page, c.line, host.code);
    await expect(screen(c.page, 'join')).toBeVisible();
  }],
  ['06-join-name', async (c) => {
    const host = await c.makeHost();
    await c.page.addInitScript(() => localStorage.setItem('irori:name', 'はなこ'));
    await openPad(c.page, c.line, host.code);
    await expect(c.page.locator('#pp-name')).toHaveValue('はなこ');
    await c.page.locator('#pp-name').focus();
  }],
  ['07-connecting', async (c) => {
    const host = await c.makeHost();
    await openPad(c.page, c.line, host.code);
    c.line.blockNew = true;
    await act(c.page, 'join').tap();
    await expect(screen(c.page, 'connecting')).toBeVisible();
  }],
  ['08-connecting-slow', async (c) => {
    const host = await c.makeHost();
    await openPad(c.page, c.line, host.code);
    c.line.blockNew = true;
    await act(c.page, 'join').tap();
    await expect(act(c.page, 'retry')).toBeVisible({ timeout: 12_000 });
  }],
  ['09-wait-joined', async (c) => {
    await inRoom(c);
  }],
  ['10-wait-host', async (c) => {
    await inRoom(c, { k: 'wait', title: HOST('host.pad.choosing', { name: 'たろう' }), body: HOST('host.pad.choosingBody') });
  }],
  ['11-remote', async (c) => {
    await inRoom(c, { k: 'remote', hint: HOST('host.pad.remoteHint') });
  }],
  ['12-pad-dpad', async (c) => {
    await inRoom(c, { k: 'pad', stick: 'dpad', hint: '十字で動いて、ぴょんで跳ぶ', buttons: [{ id: 'hop', label: 'ぴょん' }, { id: 'end', label: 'おわる', color: 'gray' }] });
  }],
  ['13-pad-stick', async (c) => {
    // hello-pad の PAD（games/hello-pad/logic.js）
    await inRoom(c, { k: 'pad', stick: 'stick', hint: 'スティックで動く', buttons: [{ id: 'hop', label: 'ぴょん' }, { id: 'end', label: 'おわる', color: 'gray' }] });
  }],
  ['14-buzzer', async (c) => {
    // tap-race の race（games/tap-race/logic.js）
    await inRoom(c, { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' });
  }],
  ['15-choices', async (c) => {
    // quiz-4 の ask（games/quiz-4/logic.js）
    await inRoom(c, { k: 'choices', hint: '第1問　15秒以内に選ぼう', options: QUIZ });
  }],
  ['16-touch', async (c) => {
    await inRoom(c, { k: 'touch', mode: 'area', hint: '指でなぞって、線を描く' });
  }],
  ['17-tilt', async (c) => {
    await inRoom(c, { k: 'tilt', hint: '傾けてハンドルを切る', buttons: [{ id: 'boost', label: '加速' }] });
  }],
  ['18-reconnecting', async (c) => {
    await inRoom(c, { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' });
    c.line.blockNew = true;
    c.line.drop();
    await expect(c.page.locator('.pp-banner')).toBeVisible();
    await expect(act(c.page, 'reconnect-now')).toBeVisible({ timeout: 12_000 });
  }],
  ['19-host-waiting', async (c) => {
    const { host } = await inRoom(c, { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' });
    host.disconnect();
    await expect(c.page.locator('[data-cover="host"]')).toBeVisible();
  }],
  ['20-orient', async (c) => {
    const orient = c.orient === 'portrait' ? 'landscape' : 'portrait';
    await inRoom(c, { k: 'pad', stick: 'dpad', orient, hint: '十字で動いて、ぴょんで跳ぶ', buttons: [{ id: 'hop', label: 'ぴょん' }] });
    await expect(c.page.locator('[data-cover="orient"]')).toBeVisible();
  }],
  ['21-menu', async (c) => {
    await inRoom(c, { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' }, 'たろう');
    await act(c.page, 'menu').tap();
    await expect(c.page.locator('.pp-menu')).toBeVisible();
  }],
  ['22-toast-hint', async (c) => {
    await inRoom(c, { k: 'pad', stick: 'stick', hint: 'スティックで動く', buttons: [{ id: 'hop', label: 'ぴょん' }, { id: 'end', label: 'おわる', color: 'gray' }] }, 'たろう');
    await act(c.page, 'seat').tap();
    await expect(c.page.locator('.pp-toast')).toBeVisible();
  }],
  ['23-long-name', async (c) => {
    const host = await c.makeHost();
    for (let i = 0; i < 4; i++) await host.addNodePad(`だれか${i}`);
    await c.page.addInitScript(() => localStorage.setItem('irori:name', 'ながいながいなまえのひと'));
    const you = await joinRoom(c.page, c.line, host);
    host.setPad(you.id, { k: 'choices', hint: '第2問　15秒以内に選ぼう', options: QUIZ });
    await expect(c.page.locator('.irori-pad[data-kind="choices"]')).toBeVisible();
  }],
  ['24-kicked', async (c) => {
    const { host, id } = await inRoom(c);
    host.kick(id);
    await expect(c.page.locator('[data-state="kicked"]')).toBeVisible();
  }],
  ['25-closed', async (c) => {
    const { host } = await inRoom(c);
    host.closeRoom();
    await expect(c.page.locator('[data-state="closed"]')).toBeVisible();
  }],
  ['26-full', async (c) => {
    const host = await c.makeHost();
    for (let i = 0; i < 8; i++) await host.addNodePad(`席${i + 1}`);
    await openPad(c.page, c.line, host.code);
    await expect(c.page.locator('[data-state="full"]')).toBeVisible();
  }],
  ['27-locked', async (c) => {
    const host = await c.makeHost();
    host.lock(true);
    await expect.poll(async () => (await host.status()).locked).toBe(true);
    await openPad(c.page, c.line, host.code);
    await expect(c.page.locator('[data-state="locked"]')).toBeVisible();
  }],
  ['28-replaced', async (c) => {
    const { host } = await inRoom(c, { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' });
    const token = await c.page.evaluate((code) => sessionStorage.getItem(`irori:resume:${code}`), host.code);
    const other = await c.page.context().newPage();
    await other.addInitScript(([k, v]) => sessionStorage.setItem(k!, v!), [`irori:resume:${host.code}`, token]);
    await openPad(other, c.line, host.code);
    await expect(screen(other, 'play')).toBeVisible();
    await expect(c.page.locator('[data-state="replaced"]')).toBeVisible();
  }],
  ['29-left', async (c) => {
    await inRoom(c, { k: 'buzzer', label: '連打!', hint: '40回たたいたら完走' });
    await act(c.page, 'menu').tap();
    await expect(c.page.locator('.pp-menu')).toBeVisible();
    await act(c.page, 'leave').tap();
    await expect(c.page.locator('[data-state="left"]')).toBeVisible();
  }],
  ['30-network', async (c) => {
    await c.page.route('**/api/rooms/*', (r) => r.abort('internetdisconnected'));
    await openPad(c.page, c.line, 'BCDF');
    await expect(c.page.locator('[data-state="network"]')).toBeVisible();
  }],
  ['31-rate', async (c) => {
    await c.page.route('**/api/rooms/*', (r) => r.fulfill({ status: 429, headers: { 'Retry-After': '20' }, contentType: 'application/json', body: '{"error":"rate","retryAfterSec":20}' }));
    await openPad(c.page, c.line, 'BCDF');
    await expect(c.page.locator('[data-state="rate"]')).toBeVisible();
  }],
  ['32-keyboard-entry', async (c) => {
    await c.page.setViewportSize(KEYBOARD[c.orient]);
    await openPad(c.page, c.line);
    await c.page.locator('.pp-code__box').nth(0).pressSequentially('k');
    await expect(c.page.locator('.pp-code__box').nth(1)).toBeFocused();
  }],
  ['33-keyboard-join', async (c) => {
    const host = await c.makeHost();
    await c.page.setViewportSize(KEYBOARD[c.orient]);
    await openPad(c.page, c.line, host.code);
    await c.page.locator('#pp-name').tap();
    await c.page.locator('#pp-name').pressSequentially('たろう');
  }],
];

for (const o of ORIENTS) {
  test.describe(`画面の確認（${o.name}）`, () => {
    test.skip(!shotsEnabled(), 'IRORI_PAD_SHOTS=1 のときだけ撮る（ファイルを書くため）');
    test.use({ viewport: o.viewport, screen: o.viewport });
    for (const [name, scene] of SCENES) {
      test(name, async ({ page, line, makeHost, watch }) => {
        watch.allowNetworkErrors({ resources: name === '30-network' || name === '31-rate' });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: o.insets });
        await scene({ page, line, makeHost, orient: o.name });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.screenshot({ path: `${SHOTS_DIR}/${name}-${o.name}.png`, animations: 'disabled', caret: 'hide' });
      });
    }
  });
}
