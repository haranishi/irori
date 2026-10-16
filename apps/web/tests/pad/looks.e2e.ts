// 見た目の決まり（採点の2周目で直したところ）：押せない状態の見た目は1つ、縦に並ぶボタンの間は24px以上、
// つなぎ直しの案内は枠の真ん中、短い知らせは「…」の近く、入力画面は枠とボタンの間を詰め、誤りが出ても動かない。
import type { Locator } from '@playwright/test';
import type { PadSpec } from '@irori/protocol';
import { act, expect, joinRoom, openPad, screen, stays, test } from './e2e/fixtures';

/** 押せない部品の見た目：塗りと影はなく、輪郭は --line-ui、文字は --text-dim。 */
const DISABLED = { bg: 'rgba(0, 0, 0, 0)', color: 'rgb(201, 184, 166)', border: 'rgb(138, 114, 96)', shadow: 'none' };

async function lookOf(l: Locator): Promise<typeof DISABLED> {
  return l.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, shadow: s.boxShadow };
  });
}

async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (!b) throw new Error('見えていない');
  return b;
}

const LANDSCAPE = { width: 844, height: 390 };
/** hello-pad の PAD と同じ形（games/hello-pad/logic.js）。 */
const HOP_END: PadSpec = { k: 'pad', stick: 'stick', hint: 'スティックで動く', buttons: [{ id: 'hop', label: 'ぴょん' }, { id: 'end', label: 'おわる', color: 'gray' }] };

test('押せない状態の見た目は1つ：入力画面の「部屋をさがす」、回数の上限の「もう一度試す」、部品の押せないボタン', async ({ page, line, makeHost, watch }) => {
  await openPad(page, line);
  await expect(act(page, 'find')).toBeDisabled();
  expect(await lookOf(act(page, 'find'))).toEqual(DISABLED);

  watch.allowNetworkErrors({ resources: true });
  await page.route('**/api/rooms/*', (r) => r.fulfill({ status: 429, headers: { 'Retry-After': '20' }, contentType: 'application/json', body: '{"error":"rate","retryAfterSec":20}' }));
  await openPad(page, line, 'BCDF');
  await expect(page.locator('[data-state="rate"]')).toBeVisible();
  await expect(act(page, 'retry')).toBeDisabled();
  expect(await lookOf(act(page, 'retry'))).toEqual(DISABLED);
  await page.unroute('**/api/rooms/*');

  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す', disabled: true });
  const buzzer = page.locator('.irori-pad__buzzer');
  await expect(buzzer).toBeDisabled();
  expect(await lookOf(buzzer)).toEqual(DISABLED);
  // 押せる灰色（「おわる」）は塗りのまま。押せない見た目とは違う。
  host.setPad(you.id, HOP_END);
  const end = page.locator('.irori-pad__btn[data-id="end"]');
  await expect(end).toBeEnabled();
  expect((await lookOf(end)).bg).toBe('rgb(106, 93, 83)');
});

test('傾きの許可の前は、ほかのボタンを押せない見た目にして押せなくし、「センサーを許可すると使えます。」と添える。許可したら戻す', async ({ page, line, makeHost }) => {
  await page.addInitScript(() => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    D.requestPermission = async () => 'granted';
  });
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'tilt', hint: '傾けて曲がる', buttons: [{ id: 'boost', label: '加速', color: 'yellow' }] });
  const boost = page.locator('.irori-pad__btn[data-id="boost"]');
  const note = page.locator('.pp-tilt-note');
  await expect(page.locator('.irori-pad__allow')).toBeVisible();
  await expect(note).toHaveText('センサーを許可すると使えます。');
  expect(await page.locator('.irori-pad__btns').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  expect(await lookOf(boost)).toEqual(DISABLED);
  // 押しても届かない。
  await boost.tap({ force: true });
  await stays(() => host.events(you.id).length, 0, 500, '許可の前の加速');
  // 許可したら、添え書きは消え、ボタンは押せる。
  await page.locator('.irori-pad__allow').tap();
  await expect(page.locator('.irori-pad__allow')).toBeHidden();
  await expect(note).toHaveCount(0);
  expect(await page.locator('.irori-pad__btns').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  // 色は短い移り変わりで戻るので、戻りきるまで待つ。
  await expect.poll(async () => (await lookOf(boost)).bg).toBe('rgb(180, 142, 62)');
  await boost.tap();
  await host.until(() => (host.events(you.id).some((i) => i.k === 'btn' && i.id === 'boost' && i.d === 0) ? true : undefined), '加速');
});

for (const vp of [{ name: '縦', size: { width: 390, height: 844 } }, { name: '横', size: LANDSCAPE }]) {
  test(`縦に並ぶ操作ボタンの間は24px以上（${vp.name}：「ぴょん」と「おわる」、リモコンの「決定」と「戻る」）`, async ({ page, line, makeHost }) => {
    await page.setViewportSize(vp.size);
    const host = await makeHost();
    const you = await joinRoom(page, line, host);
    host.setPad(you.id, HOP_END);
    const hop = await box(page.locator('.irori-pad__btn[data-id="hop"]'));
    const end = await box(page.locator('.irori-pad__btn[data-id="end"]'));
    expect(end.y - (hop.y + hop.height)).toBeGreaterThanOrEqual(24);
    // ボタンは48px以上のまま。
    for (const b of [hop, end]) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(48);
    host.setPad(you.id, { k: 'remote' });
    const ok = await box(page.locator('.irori-pad__btn[data-id="ok"]'));
    const back = await box(page.locator('.irori-pad__btn[data-id="back"]'));
    expect(back.y - (ok.y + ok.height)).toBeGreaterThanOrEqual(24);
  });

  test(`切れている間は、枠の真ん中に「つなぎ直しています…」のカードを出し、「今すぐつなぎ直す」はすぐ押せる（${vp.name}）`, async ({ page, line, makeHost }) => {
    await page.setViewportSize(vp.size);
    const host = await makeHost();
    const you = await joinRoom(page, line, host);
    host.setPad(you.id, { k: 'buzzer', label: '押す' });
    await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
    line.blockNew = true;
    line.drop();
    const card = page.locator('.pp-banner .pp-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('つながりが切れました');
    await expect(card).toContainText('つなぎ直しています…');
    await expect(act(page, 'reconnect-now')).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('.irori-pad__buzzer')).toBeHidden();
    const stage = await box(page.locator('.pp-stage'));
    const c = await box(card);
    expect(Math.abs(c.x + c.width / 2 - (stage.x + stage.width / 2))).toBeLessThanOrEqual(stage.width * 0.1);
    expect(Math.abs(c.y + c.height / 2 - (stage.y + stage.height / 2))).toBeLessThanOrEqual(stage.height * 0.1);
    line.blockNew = false;
    await act(page, 'reconnect-now').tap();
    await expect(page.locator('.pp-banner')).toBeHidden();
    await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  });

  test(`短い知らせは右上の「…」のすぐそばに出し、操作のボタンにかぶせない（${vp.name}）`, async ({ page, line, makeHost }) => {
    await page.setViewportSize(vp.size);
    const host = await makeHost();
    const you = await joinRoom(page, line, host);
    host.setPad(you.id, HOP_END);
    await expect(page.locator('.irori-pad__btn[data-id="hop"]')).toBeVisible();
    await act(page, 'seat').tap();
    const toast = page.locator('.pp-toast');
    await expect(toast).toBeVisible();
    const t = await box(toast);
    const m = await box(act(page, 'menu'));
    if (vp.size.width < vp.size.height) {
      // 縦：「…」の真下、右端をそろえる。
      expect(t.y).toBeGreaterThanOrEqual(m.y + m.height - 1);
      expect(t.y - (m.y + m.height)).toBeLessThanOrEqual(24);
      expect(Math.abs(t.x + t.width - (m.x + m.width))).toBeLessThanOrEqual(24);
    } else {
      // 横：「…」の左、同じ高さ。
      expect(t.x + t.width).toBeLessThanOrEqual(m.x);
      expect(Math.abs(t.y + t.height / 2 - (m.y + m.height / 2))).toBeLessThanOrEqual(12);
    }
    for (const sel of ['.irori-pad__btn[data-id="hop"]', '.irori-pad__btn[data-id="end"]', '.irori-pad__hint']) {
      expect(overlaps(t, await box(page.locator(sel))), sel).toBe(false);
    }
  });
}

test('入力画面：枠の下にコードの在りかを書き、ボタンまでの間を詰める。誤りの知らせが出ても、ボタンは動かない', async ({ page, line }) => {
  await openPad(page, line);
  await expect(screen(page, 'entry')).toBeVisible();
  const boxes = page.locator('.pp-code');
  const hint = page.locator('.pp-hint');
  await expect(hint).toHaveText('大きな画面の右下に出ている4文字です。');
  const b = await box(boxes);
  const h = await box(hint);
  const f1 = await box(act(page, 'find'));
  expect(h.y).toBeGreaterThan(b.y + b.height);
  expect(h.y + h.height).toBeLessThan(f1.y);
  expect(f1.y - (b.y + b.height)).toBeLessThanOrEqual(92);
  // 使えない文字を打つと、同じ場所に知らせが出る（案内と入れ替わる）。ボタンの位置は変わらない。
  await page.locator('.pp-code__box').nth(0).pressSequentially('A');
  await expect(page.locator('.pp-msg')).toContainText('母音を除く英字');
  await expect(hint).toBeHidden();
  const f2 = await box(act(page, 'find'));
  expect(Math.round(f2.y)).toBe(Math.round(f1.y));
});

test('「コードを変える」は48px以上。青の席でも、札の縁は地から浮く（地との比3:1以上）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code);
  expect((await box(page.locator('.pp-link'))).height).toBeGreaterThanOrEqual(48);
  for (let i = 0; i < 4; i++) await host.addNodePad(`だれか${i}`);
  const you = await joinRoom(page, line, host);
  expect(you.id).toBe(5);
  const [edge, ground] = await page.locator('.pp-badge').evaluate((el) => [getComputedStyle(el).borderTopColor, getComputedStyle(el).backgroundColor]);
  expect(contrast(edge!, ground!)).toBeGreaterThanOrEqual(3);
});

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** rgb(…) と、color-mix の結果の color(srgb 0〜1 …) の両方を読む。 */
function contrast(a: string, b: string): number {
  const lum = (css: string) => {
    const unit = css.startsWith('color(') ? 1 : 255;
    const [r, g, bl] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / unit;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

