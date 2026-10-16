// 遊んでいるときの画面の重なりと、結果の画面の収まり（実 Worker・実ブラウザ。重いので host.e2e.ts から分けた）。
// - ゲームの最中、ホストは案内をゲームの画面に重ねない（8人・4本のゲーム・3つの大きさで、始めの10秒を数える）
// - 結果のボタンは、1〜8人のどの人数でも、3つの大きさの画面に収まり、選んでいるボタンが見える
import { expect, test } from '@playwright/test';
import { env, openHost, ScriptPad } from './e2e/fixtures';

const base = () => env('IRORI_HOST_E2E_MAIN');
const SIZES3 = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
] as const;

test('8人で4本のゲームを始めても、始めの10秒、ホストの案内はゲームの中身（点・回数の札・問題文・絵）に重ならない（3つの大きさ）', async ({ browser }) => {
  test.setTimeout(300_000);
  const host = await openHost(browser, base(), { viewport: SIZES3[0] });
  await host.expectState('home');
  const code = await host.code();
  const pads: ScriptPad[] = [];
  for (let i = 1; i <= 8; i++) {
    const p = new ScriptPad(base(), code, `p${i}`);
    await p.join();
    pads.push(p);
  }
  await expect(host.page.locator('.seat')).toHaveCount(8);
  const order = await host.page.locator('.card[data-game]').evaluateAll((els) => els.map((el) => el.getAttribute('data-game') ?? ''));
  expect(order).toEqual(['dot-grab', 'hello-pad', 'quiz-4', 'tap-race']);
  const k = host.page.keyboard;
  const focused = host.page.locator('#app [data-focused]').first();
  /** ホストが重ねている案内と、ゲームの枠の中の中身（文字の葉・絵）が交わる数。 */
  const overlaps = async (): Promise<number> => {
    const hints = await host.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.hints .hint:not(.toast)')].map((el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }),
    );
    if (hints.length === 0) return 0;
    const frameEl = await host.page.$('.stage iframe');
    const frame = await frameEl?.contentFrame();
    const at = await frameEl?.boundingBox();
    if (!frame || !at) return 0;
    const items = await frame.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.tagName === 'CANVAS' || el.tagName === 'svg' || (el.children.length === 0 && (el.textContent ?? '').trim() !== ''))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom };
        })
        .filter((r) => r.r > r.l && r.b > r.t),
    );
    let n = 0;
    for (const h of hints) for (const i of items) if (h.l < i.r + at.x && h.r > i.l + at.x && h.t < i.b + at.y && h.b > i.t + at.y) n++;
    return n;
  };
  for (const size of SIZES3) {
    await host.page.setViewportSize(size);
    for (const [index, id] of order.entries()) {
      await host.expectState('home');
      // 棚のこのゲームを選んで始める（輪を棚の先頭から右へ）。
      for (let i = 0; i < 6 && (await focused.getAttribute('data-nav')) !== `game:${order[0]}`; i++) await k.press('ArrowLeft');
      for (let i = 0; i < index; i++) await k.press('ArrowRight');
      await expect(host.page.locator('.hero')).toHaveAttribute('data-game', id);
      await k.press('Enter');
      await host.expectState('detail');
      await k.press('Enter');
      await host.expectState('playing');
      // 始めの10秒を、0.5秒ごとに数える。
      let total = 0;
      for (let t = 0; t < 20; t++) {
        total += await overlaps();
        await host.page.waitForTimeout(500);
      }
      expect(total, `${size.width}x${size.height} ${id}`).toBe(0);
      // メニューから「ホームへ」。
      await k.press('Escape');
      await host.expectState('paused');
      await host.page.locator('[data-nav="menu:home"]').click();
    }
  }
  for (const p of pads) p.close();
  await host.assertClean();
  await host.context.close();
});

test('結果のボタン（もう一度・ホームへ・紹介）は、1〜8人のどの人数でも、3つの大きさの画面に収まり、選んでいるボタンが見える', async ({ browser }) => {
  test.setTimeout(240_000);
  const devUrl = env('IRORI_HOST_E2E_DEV');
  const devHost = new URL(devUrl).host;
  const host = await openHost(browser, base(), { path: `/?dev=${encodeURIComponent(devUrl)}`, allowHosts: [devHost], viewport: SIZES3[0] });
  await host.expectState('home');
  const code = await host.code();
  const k = host.page.keyboard;
  const pads: ScriptPad[] = [];
  for (let n = 1; n <= 8; n++) {
    const p = new ScriptPad(base(), code, `p${n}`);
    await p.join();
    pads.push(p);
    await expect(host.page.locator('.seat')).toHaveCount(n);
    // 試験用の外部ゲーム（棚の先頭）を始め、すぐ終える。全員が同じ点の1位（いちばん背の高い行）になる。
    await host.page.setViewportSize(SIZES3[0]);
    await host.page.locator('.card[data-game="dev"]').focus();
    await k.press('Enter');
    await host.expectState('detail');
    await k.press('Enter');
    if (n === 1) {
      await expect(host.page.locator('[data-layer="confirm"]')).toBeVisible();
      await k.press('ArrowLeft');
      await k.press('Enter');
    }
    await host.expectState('playing');
    await pads[0]!.expectSpec((s) => s?.k === 'pad', 'ゲームの画面');
    pads[0]!.press('end');
    await host.expectState('results');
    await expect(host.page.locator('.result')).toHaveCount(n);
    for (const size of SIZES3) {
      await host.page.setViewportSize(size);
      const fit = await host.page.evaluate(() => {
        const inView = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
        };
        const buttons = [...document.querySelectorAll('.results__actions .btn')];
        const focused = document.querySelector('.results [data-focused]');
        return { buttons: buttons.length, inside: buttons.filter(inView).length, focused: focused ? inView(focused) : false };
      });
      expect(fit, `${n}人 ${size.width}x${size.height}`).toEqual({ buttons: 3, inside: 3, focused: true });
    }
    await k.press('Escape');
    await host.expectState('home');
  }
  for (const p of pads) p.close();
  await host.assertClean();
  await host.context.close();
});
