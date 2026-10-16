// 画面の指定（6種＋リーダーのリモコン）ごとに、実 Worker を通して描画と入力の送信を確かめる。
// 入力は本物の指（CDP のタッチ）で行い、ホストに届いたフレーム（席番号 p つき）で判定する。
import type { InputEvent, PadSpec } from '@irori/protocol';
import { Finger, act, centerOf, expect, joinRoom, test } from './e2e/fixtures';

test('wait：見出しと本文を出し、入力は送らない', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'wait', title: 'たろうが選んでいます', body: '大きな画面を見てください。' });
  await expect(page.locator('.irori-pad[data-kind="wait"] .irori-pad__title')).toHaveText('たろうが選んでいます');
  await expect(page.locator('.irori-pad__text')).toHaveText('大きな画面を見てください。');
  await page.locator('.pp-pad').tap();
  expect(host.events(you.id)).toEqual([]);
});

test('pad：十字とボタン。押すと d:1、離すと d:0。十字は8方向の axis', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'pad', stick: 'dpad', buttons: [{ id: 'a', label: 'ジャンプ', color: 'red' }, { id: 'b', label: 'ダッシュ' }] });
  const a = page.locator('.irori-pad__btn[data-id="a"]');
  await expect(a).toBeVisible();
  // 押してから離すまで、ボタンの文字は見えている（48px以上）。
  const box = await a.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(48);
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await a.tap();
  await host.eventsAtLeast(you.id, 2);
  expect(host.events(you.id)).toEqual([
    { k: 'btn', id: 'a', d: 1 },
    { k: 'btn', id: 'a', d: 0 },
  ]);
  // 十字：中心から右へなぞって離す。
  const dpad = page.locator('.irori-pad__dpad');
  const c = await centerOf(dpad);
  const f = await Finger.on(page);
  await f.drag([c, { x: c.x + 30, y: c.y }, { x: c.x + 60, y: c.y }]);
  const evs = await host.until(() => {
    const e = host.events(you.id).filter((i) => i.k === 'axis');
    return e.length >= 2 && e.at(-1)!.k === 'axis' && (e.at(-1) as Extract<InputEvent, { k: 'axis' }>).x === 0 ? e : undefined;
  }, '十字の右と中立');
  expect(evs[0]).toEqual({ k: 'axis', id: 'dpad', x: 1, y: 0 });
  expect(evs.at(-1)).toEqual({ k: 'axis', id: 'dpad', x: 0, y: 0 });
});

test('pad（スティック）：倒すと -1〜1 の axis、離すと 0,0', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'pad', stick: 'stick', buttons: [] });
  const stick = page.locator('.irori-pad__stick');
  await expect(stick).toBeVisible();
  const c = await centerOf(stick);
  const b = (await stick.boundingBox())!;
  const f = await Finger.on(page);
  await f.drag([c, { x: c.x, y: c.y - b.height / 4 }, { x: c.x, y: c.y - b.height }]);
  const axes = await host.until(() => {
    const e = host.events(you.id).filter((i): i is Extract<InputEvent, { k: 'axis' }> => i.k === 'axis');
    return e.length >= 2 && e.at(-1)!.x === 0 && e.at(-1)!.y === 0 ? e : undefined;
  }, 'スティックを離した 0,0');
  expect(Math.min(...axes.map((e) => e.y))).toBe(-1);
  for (const e of axes) {
    expect(e.id).toBe('stick');
    expect(e.x).toBeGreaterThanOrEqual(-1);
    expect(e.x).toBeLessThanOrEqual(1);
  }
});

test('buzzer：大きなボタン1つ。押した瞬間に d:1、離して d:0', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す！', color: 'red' });
  const buzzer = page.locator('.irori-pad__buzzer');
  await expect(buzzer).toHaveText('押す！');
  const f = await Finger.on(page);
  const c = await centerOf(buzzer);
  await f.down(c.x, c.y);
  await host.until(() => (host.events(you.id).length === 1 ? true : undefined), '押した瞬間の d:1');
  expect(host.events(you.id)).toEqual([{ k: 'btn', id: 'buzzer', d: 1 }]);
  await f.up();
  await host.eventsAtLeast(you.id, 2);
  expect(host.events(you.id)).toEqual([
    { k: 'btn', id: 'buzzer', d: 1 },
    { k: 'btn', id: 'buzzer', d: 0 },
  ]);
});

test('choices：選ぶと pick を1回だけ送る（2回目は送らない）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'choices', options: [{ id: 'a', label: 'りんご' }, { id: 'b', label: 'みかん' }, { id: 'c', label: 'ぶどう' }] });
  await page.locator('.irori-pad__choice[data-id="b"]').tap();
  await host.eventsAtLeast(you.id, 1);
  await page.locator('.irori-pad__choice[data-id="a"]').tap();
  // 2回目が届かないことは、続けて押した別の画面の入力が先に来ることで確かめる（時間を決め打ちで待たない）。
  host.setPad(you.id, { k: 'buzzer', label: '次' });
  await page.locator('.irori-pad__buzzer').tap();
  await host.eventsAtLeast(you.id, 3);
  expect(host.events(you.id)).toEqual([
    { k: 'pick', id: 'b' },
    { k: 'btn', id: 'buzzer', d: 1 },
    { k: 'btn', id: 'buzzer', d: 0 },
  ]);
});

test('touch：なぞると s → m… → e。座標は面の内側で 0〜1', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'touch', mode: 'area', hint: 'なぞる' });
  const area = page.locator('.irori-pad__touch');
  await expect(area).toBeVisible();
  const b = (await area.boundingBox())!;
  const f = await Finger.on(page);
  await f.drag([
    { x: b.x + b.width * 0.2, y: b.y + b.height * 0.2 },
    { x: b.x + b.width * 0.4, y: b.y + b.height * 0.4 },
    { x: b.x + b.width * 0.6, y: b.y + b.height * 0.6 },
    { x: b.x + b.width * 0.8, y: b.y + b.height * 0.8 },
  ], 60);
  const ptrs = await host.until(() => {
    const e = host.events(you.id).filter((i): i is Extract<InputEvent, { k: 'ptr' }> => i.k === 'ptr');
    return e.at(-1)?.ph === 'e' ? e : undefined;
  }, 'なぞりの終わり（e）');
  expect(ptrs[0]!.ph).toBe('s');
  expect(ptrs[0]!.x).toBeCloseTo(0.2, 1);
  expect(ptrs.filter((p) => p.ph === 'm').length).toBeGreaterThanOrEqual(1);
  expect(ptrs.at(-1)!.x).toBeCloseTo(0.8, 1);
  for (const p of ptrs) {
    expect(p.id).toBe('touch');
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(1);
  }
});

test('tilt：許可のボタンは tilt の画面で出し、許可されたら傾きを送る。ボタンも押せる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  // iOS と同じく、利用者の操作の中で許可を求める形にする（許可は「許可する」で返す）。
  await page.addInitScript(() => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    (window as unknown as { __asked: number }).__asked = 0;
    D.requestPermission = async () => {
      (window as unknown as { __asked: number }).__asked++;
      return 'granted';
    };
  });
  const you = await joinRoom(page, line, host);
  // 参加のタップでは、まだ許可を求めない（求めるのは tilt の画面のボタン）。
  expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(0);
  host.setPad(you.id, { k: 'tilt', hint: '傾けて曲がる', buttons: [{ id: 'boost', label: '加速', color: 'yellow' }] });
  const allow = page.locator('.irori-pad__allow');
  await expect(allow).toBeVisible();
  await allow.tap();
  await expect(allow).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10, beta: 20, gamma: -30 }));
  });
  const tilt = await host.until(() => host.events(you.id).find((i) => i.k === 'tilt'), '傾き');
  expect(tilt).toEqual({ k: 'tilt', a: 10, b: 20, g: -30 });
  await page.locator('.irori-pad__btn[data-id="boost"]').tap();
  await host.until(() => (host.events(you.id).some((i) => i.k === 'btn' && i.id === 'boost' && i.d === 0) ? true : undefined), '加速のボタン');
});

test('remote（リーダーのリモコン）：十字と決定・戻るが btn として届く', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'remote' });
  await page.locator('.irori-pad__btn[data-id="up"]').tap();
  await page.locator('.irori-pad__btn[data-id="ok"]').tap();
  await page.locator('.irori-pad__btn[data-id="back"]').tap();
  await host.eventsAtLeast(you.id, 6);
  expect(host.events(you.id)).toEqual([
    { k: 'btn', id: 'up', d: 1 },
    { k: 'btn', id: 'up', d: 0 },
    { k: 'btn', id: 'ok', d: 1 },
    { k: 'btn', id: 'ok', d: 0 },
    { k: 'btn', id: 'back', d: 1 },
    { k: 'btn', id: 'back', d: 0 },
  ]);
});

test('同じ指定の再送では作り直さない（押している指を切らない）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  const spec: PadSpec = { k: 'pad', stick: 'none', buttons: [{ id: 'a', label: 'A' }] };
  host.setPad(you.id, spec);
  const a = page.locator('.irori-pad__btn[data-id="a"]');
  await expect(a).toBeVisible();
  const f = await Finger.on(page);
  const c = await centerOf(a);
  await f.down(c.x, c.y);
  await host.eventsAtLeast(you.id, 1);
  host.setPad(you.id, spec); // ホストが同じ画面を送り直した
  host.fx(you.id, [10]); // 目印：フレームは届いた順に当たるので、縁が光れば再送も処理済み
  await expect(page.locator('.pp-frame')).toHaveAttribute('data-fx', '');
  // 押している部品は作り直されず、押したまま。離し（d:0）も送っていない。
  await expect(page.locator('.irori-pad__btn[data-id="a"]')).toHaveAttribute('data-pressed', '');
  expect(host.events(you.id)).toEqual([{ k: 'btn', id: 'a', d: 1 }]);
  await f.up();
  await host.eventsAtLeast(you.id, 2);
  expect(host.events(you.id)).toEqual([
    { k: 'btn', id: 'a', d: 1 },
    { k: 'btn', id: 'a', d: 0 },
  ]);
});

test('fx：振動の指示は navigator.vibrate に渡し、縁を光らせる（振動のない端末でも分かる）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await page.addInitScript(() => {
    (window as unknown as { __vib: number[][] }).__vib = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (p: number[]) => {
        (window as unknown as { __vib: number[][] }).__vib.push(p);
        return true;
      },
    });
  });
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  host.fx(you.id, [80, 40, 80]);
  await expect(page.locator('.pp-frame')).toHaveAttribute('data-fx', '');
  expect(await page.evaluate(() => (window as unknown as { __vib: number[][] }).__vib)).toEqual([[80, 40, 80]]);
  await expect(page.locator('.pp-frame')).not.toHaveAttribute('data-fx', '');
});

test('orient：横向きが要る画面を縦で開くと案内を重ね、横にすると消える。「このまま使う」でも消せる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'pad', stick: 'dpad', orient: 'landscape', buttons: [{ id: 'a', label: 'A' }] });
  const cover = page.locator('[data-cover="orient"]');
  await expect(cover).toBeVisible();
  await expect(cover).toContainText('横向きがおすすめです');
  // 案内が出ている間は、下の操作は押せず、案内の外にのぞかない。
  expect(await page.locator('.pp-pad').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await expect(page.locator('.irori-pad__dpad')).toBeHidden();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(cover).toBeHidden();
  await page.locator('.irori-pad__btn[data-id="a"]').tap();
  await host.eventsAtLeast(you.id, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cover).toBeVisible();
  await act(page, 'keep-orient').tap();
  await expect(cover).toBeHidden();
  // 同じ指定の再送では、閉じた案内を出し直さない。縦向きが要る画面を横で開くと、縦の案内を出す。
  host.setPad(you.id, { k: 'pad', stick: 'dpad', orient: 'landscape', buttons: [{ id: 'a', label: 'A' }] });
  await page.setViewportSize({ width: 844, height: 390 });
  host.setPad(you.id, { k: 'pad', stick: 'dpad', orient: 'portrait' });
  await expect(cover).toBeVisible();
  await expect(cover).toContainText('縦向きがおすすめです');
});
