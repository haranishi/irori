// 拡大：viewport では拡大を止めない（WCAG 1.4.4。user-scalable=no も maximum-scale も書かない）。
// そのうえで、部屋の中の操作画面は touch-action: none なので、2本指で同時に操作しても画面は拡大されない。
// 2本指は CDP の Input.dispatchTouchEvent で出す（Chromium だけ。WebKit は zoom-webkit.e2e.ts で、設定を確かめる）。
import type { CDPSession, Locator, Page } from '@playwright/test';
import type { PadSpec } from '@irori/protocol';
import { expect, joinRoom, openPad, screen, test } from './e2e/fixtures';

type Pt = { x: number; y: number };

async function center(l: Locator): Promise<Pt> {
  const b = await l.boundingBox();
  if (!b) throw new Error('見えていない');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** 2本の指を a・b に置き、互いに離れる向きへ動かして離す（つまんで広げる形）。 */
async function twoFingers(cdp: CDPSession, a: Pt, b: Pt, spread = 90): Promise<void> {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const at = (k: number) => [
    { x: a.x - ux * k, y: a.y - uy * k, id: 1 },
    { x: b.x + ux * k, y: b.y + uy * k, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at((spread * i) / 12) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const scale = (page: Page) => page.evaluate(() => window.visualViewport?.scale ?? 1);

test('viewport は拡大を止めない（user-scalable=no・maximum-scale を書かない）。入る前の画面は、2本指で広げると拡大できる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  const content = (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '';
  expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/);
  expect(content).not.toMatch(/maximum-scale/);
  expect(content).toContain('interactive-widget=resizes-content');
  // 2本指の操作が本当に拡大を起こせることを、ここで確かめておく（下の「拡大されない」が空の確かめにならないように）。
  const cdp = await page.context().newCDPSession(page);
  const t = await center(page.locator('.pp-h1'));
  await twoFingers(cdp, { x: t.x - 40, y: t.y + 60 }, { x: t.x + 40, y: t.y + 60 });
  await expect.poll(() => scale(page)).toBeGreaterThan(1.1);
});

const SCENES: { name: string; spec: PadSpec; fingers: (page: Page) => Promise<[Pt, Pt]> }[] = [
  {
    name: '札の格子を2本指で広げる',
    spec: { k: 'tiles', tiles: [{ id: 'a', label: '札A' }, { id: 'b', label: '札B' }], ok: '出す' },
    fingers: async (page) => [await center(page.locator('[data-id="a"]')), await center(page.locator('[data-id="b"]'))],
  },
  {
    name: '十字とボタンを同時に押す',
    spec: { k: 'pad', stick: 'dpad', buttons: [{ id: 'hop', label: 'ぴょん' }, { id: 'end', label: 'おわる', color: 'gray' }] },
    fingers: async (page) => [await center(page.locator('.irori-pad__dpad')), await center(page.locator('.irori-pad__btn[data-id="hop"]'))],
  },
  {
    name: 'スティックとボタンを同時に押す',
    spec: { k: 'pad', stick: 'stick', buttons: [{ id: 'hop', label: 'ぴょん' }] },
    fingers: async (page) => [await center(page.locator('.irori-pad__stick')), await center(page.locator('.irori-pad__btn[data-id="hop"]'))],
  },
  {
    name: '早押しを2本指でたたく',
    spec: { k: 'buzzer', label: '押す' },
    fingers: async (page) => {
      const c = await center(page.locator('.irori-pad__buzzer'));
      return [{ x: c.x - 30, y: c.y }, { x: c.x + 30, y: c.y }];
    },
  },
  {
    name: 'なぞる面を2本指で広げる',
    spec: { k: 'touch', mode: 'area', hint: 'なぞる' },
    fingers: async (page) => {
      const c = await center(page.locator('.irori-pad__touch'));
      return [{ x: c.x - 30, y: c.y - 30 }, { x: c.x + 30, y: c.y + 30 }];
    },
  },
  {
    name: '傾きの画面の空いた所とボタン',
    spec: { k: 'tilt', hint: '傾けて曲がる', buttons: [{ id: 'boost', label: '加速' }] },
    fingers: async (page) => {
      const t = await center(page.locator('.irori-pad__tilt'));
      return [t, await center(page.locator('.irori-pad__btn[data-id="boost"]'))];
    },
  },
  {
    // 部品（.irori-pad）の外で、部品の touch-action が届かない所。画面全体の touch-action: none と、touchmove の
    // preventDefault（play.ts）の二重で守る（片方だけ壊しても拡大は起きないので、変異はこの2つを別々には見つけない）。
    name: '上の段の空いた所（札と「…」の間）',
    spec: { k: 'pad', stick: 'dpad', buttons: [{ id: 'hop', label: 'ぴょん' }] },
    fingers: async (page) => {
      const b = (await page.locator('.pp-badge').boundingBox())!;
      const m = (await page.locator('[data-act="menu"]').boundingBox())!;
      const y = b.y + b.height / 2;
      const mid = (b.x + b.width + m.x) / 2;
      return [{ x: mid - 15, y }, { x: mid + 15, y }];
    },
  },
];

for (const s of SCENES) {
  test(`部屋の中では、2本指で同時に操作しても拡大されない：${s.name}`, async ({ page, line, makeHost }) => {
    const host = await makeHost();
    const you = await joinRoom(page, line, host);
    host.setPad(you.id, s.spec);
    await expect(page.locator(`.irori-pad[data-kind="${s.spec.k}"]`)).toBeVisible();
    const [a, b] = await s.fingers(page);
    const cdp = await page.context().newCDPSession(page);
    await twoFingers(cdp, a, b);
    // 拡大は指を動かしている間に起きる。離したあとも1倍のまま（少し待って、拡大の動きが残っていないことも見る）。
    expect(await scale(page)).toBe(1);
    await page.waitForTimeout(300);
    expect(await scale(page)).toBe(1);
  });
}
