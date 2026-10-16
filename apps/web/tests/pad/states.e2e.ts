// 自動では入り直さない終わり方：外された（kicked）・閉じた（closed）・満員（full）・ロック（locked）・部屋がない（no-room）・
// ほかの画面に取って代わられた（replaced）。どれも理由と次の行動のボタンを出す。
import { act, comeBackAll, expect, joinRoom, openPad, screen, stays, test } from './e2e/fixtures';

test('kicked：外されたと出し、画面に戻っても入り直さない。出口は「コードを入れ直す」だけで、入れ直せば新しい参加', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.kick(you.id);
  await expect(page.locator('[data-state="kicked"]')).toBeVisible();
  await expect(page.locator('[data-state="kicked"] h1')).toHaveText('部屋から外されました');
  // 本文は「声をかけてから、コードを入れ直して」。すぐ入り直せるボタンは置かない。
  await expect(page.locator('[data-state="kicked"] .pp-lead')).toHaveText('大きな画面の人に声をかけてから、コードを入れ直してください。');
  await expect(page.locator('[data-state="kicked"] button')).toHaveCount(1);
  await expect(page.locator('[data-state="kicked"] .pp-btn--primary')).toHaveAttribute('data-act', 'reenter');
  expect(await page.evaluate((code) => sessionStorage.getItem(`irori:resume:${code}`), host.code)).toBeNull();
  const opened = line.wsOpened;
  await comeBackAll(page);
  await stays(
    async () => ({ ws: line.wsOpened, joined: host.joined().length, kicked: await page.locator('[data-state="kicked"]').isVisible() }),
    { ws: opened, joined: 1, kicked: true },
    1_500,
    '外されたあとの接続',
  );
  await act(page, 'reenter').tap();
  await expect(screen(page, 'entry')).toBeVisible();
  const boxes = page.locator('.pp-code__box');
  await boxes.nth(0).focus();
  for (let i = 0; i < 4; i++) await boxes.nth(i).pressSequentially(host.code[i]!);
  await act(page, 'join').tap();
  await host.joinedNth(2);
  await expect(screen(page, 'play')).toBeVisible();
});

test('closed：部屋が閉じられたと出し、コードを入れ直せる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await joinRoom(page, line, host);
  host.closeRoom();
  await expect(page.locator('[data-state="closed"]')).toBeVisible();
  const opened = line.wsOpened;
  await comeBackAll(page);
  await stays(() => line.wsOpened, opened, 1_500, '閉じたあとの接続');
  await act(page, 'reenter').tap();
  await expect(screen(page, 'entry')).toBeVisible();
  await expect(page.locator('.pp-code__box').first()).toHaveValue('');
  expect(new URL(page.url()).hash).toBe('');
});

test('full：満員の部屋は、参加の前に理由を出す。席が空いたら「もう一度試す」で入れる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const pads = [];
  for (let i = 0; i < 8; i++) pads.push(await host.addNodePad(`席${i + 1}`));
  await openPad(page, line, host.code);
  await expect(page.locator('[data-state="full"]')).toBeVisible();
  await expect(page.locator('[data-state="full"]')).toContainText('8人まで');
  pads[0]!.leave();
  await host.until(() => host.frames.find((f) => f.t === 'left'), '1人の退出');
  await act(page, 'retry').tap();
  await expect(screen(page, 'join')).toBeVisible();
});

test('full：参加を押す前に埋まったら、つないだときに満員と出す', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  for (let i = 0; i < 7; i++) await host.addNodePad(`席${i + 1}`);
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  await host.addNodePad('最後の人');
  await act(page, 'join').tap();
  await expect(page.locator('[data-state="full"]')).toBeVisible();
  expect(host.joined().length).toBe(8);
});

test('locked：ロックされた部屋は理由を出し、ロックが外れたら「もう一度試す」で入れる', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  host.lock(true);
  await expect.poll(async () => (await host.status()).locked).toBe(true);
  await openPad(page, line, host.code);
  await expect(page.locator('[data-state="locked"]')).toBeVisible();
  await expect(page.locator('[data-state="locked"] h1')).toHaveText('締め切られています');
  host.lock(false);
  await expect.poll(async () => (await host.status()).locked).toBe(false);
  await act(page, 'retry').tap();
  await expect(screen(page, 'join')).toBeVisible();
});

test('locked：参加を押す前にロックされたら、つないだときにロックと出す', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  host.lock(true);
  await expect.poll(async () => (await host.status()).locked).toBe(true);
  await act(page, 'join').tap();
  await expect(page.locator('[data-state="locked"]')).toBeVisible();
  expect(host.joined()).toEqual([]);
});

test('no-room：札を持ったまま部屋が消えていたら、入力の画面に「見つかりません」と出し、札を捨てる', async ({ page, line }) => {
  // 形は正しいが、存在しない部屋の札（閉じたあとのタブを開き直した場合など）。
  await page.addInitScript(() => sessionStorage.setItem('irori:resume:BCDF', 'old-token-of-a-gone-room'));
  await openPad(page, line, 'BCDF');
  await expect(screen(page, 'entry')).toBeVisible();
  await expect(page.locator('.pp-msg')).toHaveText('部屋「BCDF」が見つかりません。コードを確かめてください。');
  await expect(page.locator('.pp-code__box').nth(0)).toHaveValue('B');
  expect(await page.evaluate(() => sessionStorage.getItem('irori:resume:BCDF'))).toBeNull();
});

test('replaced：同じ札が別の画面でつながると、古い側は案内を出して自動では入り直さない。「ここで続ける」で取り返す', async ({ page, line, makeHost, watch }) => {
  watch.allowNetworkErrors();
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  const token = await page.evaluate((code) => sessionStorage.getItem(`irori:resume:${code}`), host.code);
  // タブの複製と同じ：同じ札を持つ2つ目の画面。
  const other = await page.context().newPage();
  await other.addInitScript(([k, v]) => sessionStorage.setItem(k!, v!), [`irori:resume:${host.code}`, token]);
  await openPad(other, line, host.code);
  await expect(screen(other, 'play')).toBeVisible();
  await expect(page.locator('[data-state="replaced"]')).toBeVisible();
  await expect(page.locator('[data-state="replaced"] h1')).toHaveText('ほかのスマホやタブで開かれました');
  // 新しい側に、ホストが画面を送り直している（同じ席）。
  await expect(other.locator('.irori-pad__buzzer')).toBeVisible();
  // 古い側は、画面に戻っても・回線が戻っても、自分からは入り直さない（新しい側が追い出されない）。
  await comeBackAll(page);
  await stays(async () => ({ replaced: await page.locator('[data-state="replaced"]').isVisible(), other: await screen(other, 'play').isVisible() }), { replaced: true, other: true }, 1_500, '取って代わられたあと');
  // 押したときだけ入り直し、今度は新しい側が replaced になる。
  await act(page, 'continue').tap();
  await expect(screen(page, 'play')).toBeVisible();
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  await expect(other.locator('[data-state="replaced"]')).toBeVisible();
  // 席は1つのまま（新しい参加ではない）。
  expect(host.joined().map((p) => p.id)).toEqual([you.id]);
});
