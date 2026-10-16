// 再接続：切れたら帯を出して自動で入り直し、同じ札で同じ席に戻る。戻った画面は、ホストの今の画面（pad? に応えた再送）。
// 画面ロックのあとの死んだ接続は、画面に戻ったとき（visibilitychange）の probe で、30秒を待たずに捨てて入り直す。
import type { PadSpec } from '@irori/protocol';
import { comeBack, expect, joinRoom, test } from './e2e/fixtures';

const CHOICES: PadSpec = { k: 'choices', options: [{ id: 'a', label: 'りんご' }, { id: 'b', label: 'みかん' }, { id: 'c', label: 'ぶどう' }] };

test('回線を切ると帯を出し、同じ席に戻る。戻った画面は、切れている間にホストが変えた画面', async ({ page, line, makeHost, watch }) => {
  watch.allowNetworkErrors();
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  line.blockNew = true; // 入り直しをいったん止めて、切れている間の様子を見る
  line.drop();
  await expect(page.locator('.pp-banner')).toBeVisible();
  await expect(page.locator('.pp-banner')).toContainText('つながりが切れました');
  await expect(page.locator('.pp-play')).toHaveAttribute('data-link', 'lost');
  expect(await page.locator('.pp-pad').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  // 切れている間は、押しても届かない操作を見せない（帯の下に隠す）。
  await expect(page.locator('.irori-pad__buzzer')).toBeHidden();
  await host.until(() => (host.frames.some((f) => f.t === 'online' && f.p === you.id && !f.on) ? true : undefined), '切れた知らせ');
  // 切れている間に、ゲームが画面を進めた（中継は届けられないので捨てる。ホストは覚えている）。
  host.setPad(you.id, CHOICES);
  line.unblock();
  await expect(page.locator('.pp-banner')).toBeHidden();
  await expect(page.locator('.irori-pad__choice[data-id="b"]')).toBeVisible();
  await page.locator('.irori-pad__choice[data-id="b"]').tap();
  const pick = await host.until(() => host.inputs().find((f) => f.i.k === 'pick'), '戻ったあとの選択');
  expect(pick.p).toBe(you.id);
  expect(pick.i).toEqual({ k: 'pick', id: 'b' });
  // 新しい参加ではない（同じ席）。
  expect(host.joined().map((p) => p.id)).toEqual([you.id]);
  expect(host.frames.some((f) => f.t === 'online' && f.p === you.id && f.on)).toBe(true);
});

test('再読み込みしても、参加の画面を出さずに同じ席へ戻り、直前の画面が戻る', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host, 'はなこ');
  host.setPad(you.id, CHOICES);
  await expect(page.locator('.irori-pad__choice[data-id="a"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('.irori-pad__choice[data-id="a"]')).toBeVisible();
  await expect(page.locator('.pp-badge__name')).toHaveText('はなこ');
  await page.locator('.irori-pad__choice[data-id="c"]').tap();
  const pick = await host.until(() => host.inputs().find((f) => f.i.k === 'pick'), '再読み込み後の選択');
  expect(pick.p).toBe(you.id);
  expect(host.joined().length).toBe(1);
});

test('画面に戻ったら、死んだ接続（回線が止まった）を30秒待たずに入り直し、ホストの画面に合わせ直す', async ({ page, line, makeHost, watch }) => {
  watch.allowNetworkErrors();
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, CHOICES);
  await expect(page.locator('.irori-pad__choice[data-id="a"]')).toBeVisible();
  // 画面ロックの間に回線が死んだ。スマホもサーバーも気づかない。
  line.freeze();
  // 気づかないまま選ぶと、その選択は届かずに消える（スマホの上では「選んだ」ことになっている）。
  await page.locator('.irori-pad__choice[data-id="a"]').tap();
  await expect(page.locator('.irori-pad__choices')).toHaveAttribute('data-picked', '');
  const t0 = Date.now();
  await comeBack(page);
  // 入り直すと、ホストが送り直した同じ画面を当て直す（選んでいない状態に戻り、もう一度選べる）。
  await expect(page.locator('.irori-pad__choices')).not.toHaveAttribute('data-picked', '', { timeout: 10_000 });
  const took = Date.now() - t0;
  expect(took).toBeLessThan(10_000);
  await page.locator('.irori-pad__choice[data-id="b"]').tap();
  await host.until(() => host.inputs().find((f) => f.i.k === 'pick'), '入り直したあとの選択');
  expect(host.inputs().filter((f) => f.i.k === 'pick').map((f) => [f.p, f.i])).toEqual([[you.id, { k: 'pick', id: 'b' }]]);
  console.log(`死んだ接続から入り直すまで ${took}ms（pong の期限は30秒）`);
});

test('画面に戻ったら、サーバー側から切れた接続も30秒待たずに入り直す', async ({ page, line, makeHost, watch }) => {
  watch.allowNetworkErrors();
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  line.cutServer();
  await host.until(() => (host.frames.some((f) => f.t === 'online' && f.p === you.id && !f.on) ? true : undefined), 'サーバーが切れたと知る');
  const t0 = Date.now();
  await comeBack(page);
  await host.until(() => (host.frames.some((f) => f.t === 'online' && f.p === you.id && f.on) ? true : undefined), '同じ席に戻る', 10_000);
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect(page.locator('.pp-banner')).toBeHidden();
  await page.locator('.irori-pad__buzzer').tap();
  await host.until(() => (host.events(you.id).some((i) => i.k === 'btn' && i.d === 0) ? true : undefined), '戻ったあとの入力');
  expect(host.joined().length).toBe(1);
});

test('入り直した直後の入力も、同じ席の入力として届く（直後〜300ms）', async ({ page, line, makeHost, watch }) => {
  watch.allowNetworkErrors();
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  const buzzer = page.locator('.irori-pad__buzzer');
  await expect(buzzer).toBeVisible();
  for (const delay of [0, 40, 120, 300]) {
    line.drop();
    await expect(page.locator('.pp-banner')).toBeVisible();
    await expect(page.locator('.pp-banner')).toBeHidden();
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const before = host.events(you.id).length;
    await buzzer.tap();
    await host.eventsAtLeast(you.id, before + 2);
    // 押した・離したが1回ずつ。取りこぼしも、二重も、押しっぱなしもない。
    expect(host.events(you.id).slice(before)).toEqual([
      { k: 'btn', id: 'buzzer', d: 1 },
      { k: 'btn', id: 'buzzer', d: 0 },
    ]);
  }
  expect(host.inputs().every((f) => f.p === you.id)).toBe(true);
  expect(host.joined().length).toBe(1);
});
