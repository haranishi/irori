// アクセシビリティ：@axe-core/playwright（WCAG 2.2 の A・AA の規則）で、ホストの主要な画面と、スマホの6種（と十字キー・
// コンソールのリモコン）に違反がないこと。あわせて、どのボタンにも名前があり、選択（フォーカス）の輪が見えること。
// スマホの6種は、試験だけのゲーム c1-probe（席ごとに違う種類を出す。前処理の extra の Worker）で出す。
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { env } from './lib/env.mjs';
import { expect, test, type Host, type Pad } from './fixtures';
import { HOST, ONLY_PC, PHONE } from './lib/tags';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function noViolations(page: Page, where: string, skip: string[] = []): Promise<void> {
  // preload（CSS の読み込み直し）は切る。WebKit では、枠の中の axe が自分の CSS を取りに行き、ゲームの CSP に止められて
  // 見張りに「CSP 違反」として出る（試験の道具が起こすもので、画面の不具合ではない）。
  // options() は withTags・disableRules を上書きするので、規則の選び方も options の中に書く。
  const r = await new AxeBuilder({ page })
    .options({ preload: false, runOnly: { type: 'tag', values: TAGS }, rules: Object.fromEntries(skip.map((id) => [id, { enabled: false }])) })
    .analyze();
  const found = r.violations.map((v) => `${v.id}（${v.impact}）: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' / ')}`);
  expect(found, `${where} の axe の違反`).toEqual([]);
  expect(r.passes.length, `${where}：axe が規則を1つも当てていない`).toBeGreaterThan(5);
}

/** 見えているボタンとリンクに、読み上げの名前があること。 */
async function everyControlNamed(page: Page, where: string): Promise<void> {
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => {
        const label = el.getAttribute('aria-label')?.trim();
        const by = el.getAttribute('aria-labelledby');
        const byText = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join('').trim() : '';
        return !label && !byText && !(el.textContent ?? '').trim();
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  );
  expect(unnamed, `${where}：名前のないボタン`).toEqual([]);
}

/** 選択の輪：いま選択中（フォーカス）の要素に、見える太さの輪（outline）がある。 */
async function ringVisible(page: Page, where: string): Promise<void> {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, nav: el.dataset.nav ?? el.dataset.act ?? el.dataset.id ?? '', style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor };
  });
  expect(ring, `${where}：選択中の要素がない`).not.toBeNull();
  expect(ring!.style, `${where}（${ring!.nav}）の輪の線`).not.toBe('none');
  expect(ring!.width, `${where}（${ring!.nav}）の輪の太さ`).toBeGreaterThanOrEqual(2);
  expect(ring!.color, `${where}（${ring!.nav}）の輪の色`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
}

async function hostScreen(host: Host, where: string): Promise<void> {
  await noViolations(host.page, where);
  await everyControlNamed(host.page, where);
  await ringVisible(host.page, where);
}

test('ホストの主要な画面（ホーム・詳細・メニュー・結果・共有・外す）に axe の違反がなく、輪が見える', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  for (const w of rig.watches) w.blankPagesOk = true;
  await hostScreen(host, 'ホーム（誰もいない）');
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await expect(host.page.locator('.seat[data-seat]')).toHaveCount(3);
  await pads[0]!.tap('right');
  await pads[0]!.tap('right');
  await expect(host.page.locator('.hero')).toHaveAttribute('data-game', 'hello-pad');
  await hostScreen(host, 'ホーム（3人）');
  await pads[0]!.tap('ok');
  await host.expectState('detail');
  await hostScreen(host, 'ゲームの詳細');
  await pads[0]!.tap('ok');
  await host.expectState('playing', 20_000);
  await host.key('Escape');
  await host.expectState('paused');
  await hostScreen(host, 'ゲーム中のメニュー');
  await host.page.locator('[data-nav="menu:kick"]').click();
  await host.page.locator('[data-nav="menu:kick:3"]').click();
  await expect(host.page.locator('[data-layer="kick"]')).toBeVisible();
  await hostScreen(host, '外す確かめ');
  await host.key('Escape');
  await host.key('Escape');
  await host.key('Escape');
  await host.expectState('playing');
  await pads[0]!.tap('end');
  await host.expectState('results');
  await hostScreen(host, '結果');
  await host.page.locator('[data-nav="results:share"]').click();
  await expect(host.page.locator('[data-layer="share"]')).toBeVisible();
  await host.key('ArrowDown');
  await hostScreen(host, '共有');
});

/** スマホの画面：axe・名前・Tab で移ったときの輪。WebKit は Tab でボタンに移らない（Safari の既定）ので Option+Tab。 */
async function padScreen(p: Pad, where: string, skip: string[] = []): Promise<void> {
  await noViolations(p.page, where, skip);
  await everyControlNamed(p.page, where);
  await p.page.keyboard.press(p.engine === 'webkit' ? 'Alt+Tab' : 'Tab');
  await ringVisible(p.page, `${where}（Tab）`);
}

test('スマホの6種（待機・パッド・早押し・選択・なぞる・傾き）と十字キー・リモコンに axe の違反がなく、輪が見える', PHONE, async ({ rig }) => {
  test.setTimeout(240_000);
  const host = await rig.openHost({ base: env('extra') });
  const names = ['いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな'];
  // 傾きのセンサーの許可（requestPermission）に「許可」と答える端末にする（Chromium だけが名前を知っている）。
  const grant = rig.engine === 'chromium' ? { init: (ctx: BrowserContext) => ctx.grantPermissions(['accelerometer', 'gyroscope']) } : {};
  const pads = await rig.join(host, names, grant);
  for (const w of rig.watches) w.blankPagesOk = true;
  await pads[0]!.expectKind('remote');
  await padScreen(pads[0]!, 'リモコン');
  await pads[1]!.expectKind('wait');
  await padScreen(pads[1]!, 'コンソールの待機');
  await host.choose('c1-probe', pads[0]);
  const kinds = ['wait', 'pad', 'buzzer', 'choices', 'touch', 'tilt', 'pad'];
  for (const [i, p] of pads.entries()) {
    await p.expectKind(kinds[i]!);
    const asking = kinds[i] === 'tilt' && (await p.page.locator('.irori-pad__allow').count()) > 0;
    // 傾きは、許可の前（ほかのボタンは押せない）と、許可のあとの両方に当てる。
    await padScreen(p, `${kinds[i]}${i === 6 ? '（十字キー）' : ''}${asking ? '（許可の前）' : ''}`);
    if (asking) {
      await p.page.locator('.irori-pad__allow').tap();
      await expect(p.page.locator('.irori-pad__allow')).toHaveCount(0);
      await padScreen(p, 'tilt（許可のあと）');
    }
  }
  await expect(pads[6]!.page.locator('.irori-pad__dpad')).toBeVisible();
  await expect(pads[1]!.page.locator('.irori-pad__stick')).toBeVisible();
});

test('スマホの画面の viewport は拡大を止めない（WCAG 1.4.4）', PHONE, async ({ rig }) => {
  // 以前は user-scalable=no で拡大を止めていた（C1 報告の不具合3。B2 が直した）。直った形を確かめる。
  // 部屋の中の操作画面は touch-action で指の拡大を止める（スマホの画面の試験 apps/web/tests/pad/zoom*.e2e.ts）。
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう']);
  for (const w of rig.watches) w.blankPagesOk = true;
  const r = await new AxeBuilder({ page: pads[0]!.page }).options({ preload: false, runOnly: { type: 'rule', values: ['meta-viewport'] } }).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  // 規則が当たったうえでの0件であること（当たっていない0件は、確かめたことにならない）。
  expect(r.passes.map((v) => v.id)).toEqual(['meta-viewport']);
  const content = (await pads[0]!.page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
  expect(content).not.toContain('user-scalable=no');
  expect(content).not.toMatch(/maximum-scale/);
});

test('棚に7本並んでも、カードの見えている部分は参加の板（QR とコード）と重ならない。右端まで送ると、棚の中に流れてくる（元は既知の不具合4）', HOST, async ({ rig }) => {
  const host = await rig.openHost({ base: env('extra') });
  await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await expect(host.page.locator('.card[data-game]')).toHaveCount(7);
  await expect(host.page.locator('.seat[data-seat]')).toHaveCount(3);
  // 棚は自分の列の中で横に送る。カードのうち棚の箱で切られずに見えている部分が、参加の板と重ならないこと。
  // あわせて、QR の真ん中に見えているのは QR（カードが上に重なっていない）。
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
  expect(await overlaps()).toEqual({ hit: [], qrOnTop: true });
  // 選択を右端のカードまで送る。棚が流れて、そのカードは棚の中で見え、重ならないまま。
  const order = await host.shelf();
  const focused = host.root.locator('[data-focused]').first();
  await expect(focused).toHaveAttribute('data-nav', /^game:/);
  for (let i = 0; i < order.length - 1; i++) await host.key('ArrowRight');
  await expect(focused).toHaveAttribute('data-nav', `game:${order.at(-1)}`);
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
});

test('傾きの許可を待つ間は、ほかのボタンは指でもキーボードでも押せない。許可のあとは押せて、入力がゲームに届く', ONLY_PC, async ({ rig }) => {
  // 許可の段（DeviceOrientationEvent.requestPermission）があるのは、この組の Chromium。WebKit の試験環境には無い。
  // 以前は、薄く見えるだけでキーボードからは押せた（C1 報告の不具合5。B2 が直した）。直った形を確かめる。
  const host = await rig.openHost({ base: env('extra') });
  const grant = { init: (ctx: BrowserContext) => ctx.grantPermissions(['accelerometer', 'gyroscope']) };
  const pads = await rig.join(host, ['いち', 'に', 'さん', 'よん', 'ご', 'ろく'], grant);
  await host.choose('c1-probe', pads[0]);
  const tilt = pads[5]!;
  await tilt.expectKind('tilt');
  await expect(tilt.page.locator('.irori-pad__allow')).toBeVisible();
  const fire = tilt.page.locator('button[data-id="fire"]');
  // 押せないことが、読み上げとキーボードにも伝わっている（inert か disabled）。
  expect(await fire.evaluate((el) => (el as HTMLButtonElement).disabled || el.closest('[inert]') !== null || el.getAttribute('aria-disabled') === 'true')).toBe(true);
  await fire.focus().catch(() => undefined);
  await tilt.page.keyboard.press('Enter');
  await tilt.page.waitForTimeout(400);
  expect(host.inputs(6)).toEqual([]);
  // 許可すると押せるようになり、キーボードの決定も届く。
  await tilt.page.locator('.irori-pad__allow').tap();
  await expect(tilt.page.locator('.irori-pad__allow')).toHaveCount(0);
  await fire.focus();
  await tilt.page.keyboard.press('Enter');
  await expect.poll(() => host.inputs(6).map((r) => `${r.f.i?.id}:${r.f.i?.d}`)).toEqual(['fire:1', 'fire:0']);
  await expect.poll(() => host.inGame(() => JSON.parse(document.documentElement.dataset.log ?? '[]').length)).toBe(2);
});
