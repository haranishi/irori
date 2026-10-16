// 押すタイミングの試験：画面の差し替えと押下が同時に起きる（0〜500msで振る）・ページの CPU を10倍遅くした通し。
// （参加ボタンの連打は join.e2e.ts、入り直した直後の入力は reconnect.e2e.ts。）
import type { PadSpec } from '@irori/protocol';
import { Finger, centerOf, expect, joinRoom, test } from './e2e/fixtures';

/** 固定の種から作る乱数（毎回同じ振り方で再現できるように）。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const A: PadSpec = { k: 'pad', stick: 'none', buttons: [{ id: 'a', label: 'A', color: 'red' }] };
const B: PadSpec = { k: 'buzzer', label: '次', color: 'blue' };

test('押している最中に画面が差し替わっても、離しを1回だけ補い、古い画面の入力は残らない（0〜500msで12通り）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  const rand = seeded(20261016);
  const f = await Finger.on(page);
  for (let i = 0; i < 12; i++) {
    const swapAt = Math.round(rand() * 500);
    const upAt = Math.round(rand() * 500);
    host.setPad(you.id, A);
    const a = page.locator('.irori-pad__btn[data-id="a"]');
    await expect(a).toBeVisible();
    const base = host.events(you.id).length;
    const c = await centerOf(a);
    await f.down(c.x, c.y);
    await host.eventsAtLeast(you.id, base + 1);
    await Promise.all([delay(swapAt).then(() => host.setPad(you.id, B)), delay(upAt).then(() => f.up())]);
    const buzzer = page.locator('.irori-pad__buzzer');
    await expect(buzzer).toBeVisible();
    // 目印に新しい画面のボタンを押す。これより前に届いたものが、この回の入力のすべて。
    await buzzer.tap();
    await host.eventsAtLeast(you.id, base + 4);
    expect(host.events(you.id).slice(base), `差し替え ${swapAt}ms・指を離す ${upAt}ms`).toEqual([
      { k: 'btn', id: 'a', d: 1 },
      { k: 'btn', id: 'a', d: 0 },
      { k: 'btn', id: 'buzzer', d: 1 },
      { k: 'btn', id: 'buzzer', d: 0 },
    ]);
  }
});

test('スティックを倒したまま画面が差し替わったら、0,0 を補う（0〜500msで6通り）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  const rand = seeded(7);
  const f = await Finger.on(page);
  for (let i = 0; i < 6; i++) {
    const swapAt = Math.round(rand() * 500);
    host.setPad(you.id, { k: 'pad', stick: 'stick' });
    const stick = page.locator('.irori-pad__stick');
    await expect(stick).toBeVisible();
    const c = await centerOf(stick);
    const b = (await stick.boundingBox())!;
    const base = host.events(you.id).length;
    await f.down(c.x, c.y);
    await f.move(c.x + b.width / 2, c.y);
    await host.until(() => (host.events(you.id).slice(base).some((e) => e.k === 'axis' && e.x === 1) ? true : undefined), '右へ倒した');
    await delay(swapAt);
    host.setPad(you.id, B);
    await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
    await f.up();
    await page.locator('.irori-pad__buzzer').tap();
    await host.until(() => (host.events(you.id).slice(base).some((e) => e.k === 'btn' && e.id === 'buzzer' && e.d === 0) ? true : undefined), '目印のボタン');
    const evs = host.events(you.id).slice(base);
    const lastAxis = evs.filter((e) => e.k === 'axis').at(-1);
    expect(lastAxis, `差し替え ${swapAt}ms`).toEqual({ k: 'axis', id: 'stick', x: 0, y: 0 });
    // 0,0 は目印より前に届いている（差し替えの瞬間に補った）。
    const zeroAt = evs.findIndex((e) => e.k === 'axis' && e.x === 0 && e.y === 0);
    const markAt = evs.findIndex((e) => e.k === 'btn' && e.id === 'buzzer');
    expect(zeroAt).toBeLessThan(markAt);
  }
});

test('ページの CPU を10倍遅くしても、参加・操作・入り直しが通る', async ({ page, line, makeHost, watch }) => {
  test.slow();
  watch.allowNetworkErrors();
  const host = await makeHost();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 10 });
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  const buzzer = page.locator('.irori-pad__buzzer');
  await expect(buzzer).toBeVisible({ timeout: 20_000 });
  await buzzer.tap();
  await host.eventsAtLeast(you.id, 2, 20_000);
  line.drop();
  await expect(page.locator('.pp-banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pp-banner')).toBeHidden({ timeout: 30_000 });
  await buzzer.tap();
  await host.eventsAtLeast(you.id, 4, 20_000);
  expect(host.events(you.id)).toEqual([
    { k: 'btn', id: 'buzzer', d: 1 },
    { k: 'btn', id: 'buzzer', d: 0 },
    { k: 'btn', id: 'buzzer', d: 1 },
    { k: 'btn', id: 'buzzer', d: 0 },
  ]);
  expect(host.joined().length).toBe(1);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
