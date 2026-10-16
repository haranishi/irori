// 入り方：QRのURLの # からコードを取り、「参加する」を1回押すだけで入る。コードがないときだけ4つの枠で打つ。
import { look } from '@irori/pad-ui';
import { act, comeBack, expect, joinRoom, openPad, screen, test } from './e2e/fixtures';

test('QRのURLで開くと参加の画面が出て、「参加する」を1回押すだけで入れる。札は sessionStorage に置く', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code.toLowerCase());
  await expect(screen(page, 'join')).toBeVisible();
  await expect(page.locator('.pp-room__code')).toHaveText(host.code);
  // 名前は任意。見本の文字は見出しと同じで、ふだんは見せない（見出しが見えている）。本名や連絡先を入れない案内を必ず出す。
  const name = page.locator('#pp-name');
  await expect(name).toHaveValue('');
  await expect(name).toHaveAttribute('placeholder', '名前（なくても入れます）');
  expect(await name.evaluate((el) => getComputedStyle(el, '::placeholder').color)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('#pp-privacy')).toHaveText('ニックネームで大丈夫です。本名や連絡先は入れないでください。');
  // 名前の欄のすぐ下の一文は、名前を入れると文言だけ替わり、場所は残る（下の「参加する」は動かない）。
  const note = page.locator('#pp-name-empty');
  await expect(note).toHaveText('空のままなら「プレイヤー3」のように呼ばれます。');
  const before = (await act(page, 'join').boundingBox())!;
  await name.fill('た');
  await expect(note).toHaveText('大きな画面には、この名前で出ます。');
  const after = (await act(page, 'join').boundingBox())!;
  expect(Math.round(after.y)).toBe(Math.round(before.y));
  await name.fill('');
  await expect(note).toHaveText('空のままなら「プレイヤー3」のように呼ばれます。');
  await act(page, 'join').tap();
  const you = await host.joinedNth(1);
  expect(you).toMatchObject({ id: 1, name: 'プレイヤー1', online: true });
  await expect(screen(page, 'play')).toBeVisible();
  // 縁は席の色、左上に席の形と名前。色だけに頼らず、形と名前も出す。
  const l = look(1);
  const border = await page.locator('.pp-frame').evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(border).toBe(hexToRgb(l.color));
  await expect(page.locator('.pp-badge [data-shape]')).toHaveAttribute('data-shape', l.shape);
  await expect(page.locator('.pp-badge__name')).toHaveText('プレイヤー1');
  await expect(page.locator('.pp-look')).toHaveText(l.label);
  // 形の名前も16px以上。
  expect(await page.locator('.pp-look').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  // URL は正しい大文字のコードに直り、札はこのタブにだけ残る。
  expect(new URL(page.url()).hash).toBe(`#${host.code}`);
  const token = await page.evaluate((code) => sessionStorage.getItem(`irori:resume:${code}`), host.code);
  expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  // 入ってすぐ、ホストが何も送らないうちは、待ちの画面に自分の形を出す。
  await expect(page.locator('.irori-pad[data-kind="wait"] .irori-pad__title')).toHaveText('参加しました');
});

test('コードがないときだけ4つの枠を出す。小文字・全角は直し、自動で次の枠へ進み、貼り付けは振り分ける', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line);
  await expect(screen(page, 'entry')).toBeVisible();
  const boxes = page.locator('.pp-code__box');
  await expect(boxes).toHaveCount(4);
  await expect(boxes.nth(0)).toBeFocused();
  const [c0, c1, c2, c3] = [...host.code];
  // 1文字目：小文字で打つと大文字になり、次の枠へ進む。
  await boxes.nth(0).pressSequentially(c0!.toLowerCase());
  await expect(boxes.nth(0)).toHaveValue(c0!);
  await expect(boxes.nth(1)).toBeFocused();
  // 使えない文字（母音）は入らず、案内が出る。
  await boxes.nth(1).pressSequentially('A');
  await expect(boxes.nth(1)).toHaveValue('');
  await expect(page.locator('.pp-msg')).toContainText('母音を除く英字');
  // 2文字目：全角で打っても半角の大文字になる。
  await boxes.nth(1).pressSequentially(String.fromCharCode(c1!.charCodeAt(0) + 0xfee0));
  await expect(boxes.nth(1)).toHaveValue(c1!);
  // 残りの2文字は、貼り付けで振り分ける（区切りの横棒は無視する）。
  await page.evaluate(
    ([text]) => {
      const box = document.querySelectorAll<HTMLInputElement>('.pp-code__box')[2]!;
      const data = new DataTransfer();
      data.setData('text', text!);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [`${c2}-${c3}`],
  );
  // 4文字そろうと、部屋を確かめて参加の画面へ進む。URL にもコードが入る（再読み込みでも同じ部屋）。
  await expect(screen(page, 'join')).toBeVisible();
  await expect(page.locator('.pp-room__code')).toHaveText(host.code);
  expect(new URL(page.url()).hash).toBe(`#${host.code}`);
});

test('部屋のURLを丸ごと貼っても、# の後ろのコードだけを使う', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line);
  await page.evaluate(
    ([text]) => {
      const box = document.querySelector<HTMLInputElement>('.pp-code__box')!;
      const data = new DataTransfer();
      data.setData('text', text!);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [`https://irori.example/pad#${host.code}`],
  );
  await expect(screen(page, 'join')).toBeVisible();
  await expect(page.locator('.pp-room__code')).toHaveText(host.code);
});

test('存在しない部屋は「見つかりません」と出し、コードを入れ直せる', async ({ page, line, makeHost }) => {
  await openPad(page, line, 'BCDF');
  await expect(screen(page, 'entry')).toBeVisible();
  await expect(page.locator('.pp-msg')).toHaveText('部屋「BCDF」が見つかりません。コードを確かめてください。');
  await expect(page.locator('.pp-code')).toHaveAttribute('data-error', '');
  // 打ち直すと誤りの知らせは消え、正しい部屋なら参加の画面へ進む。
  const host = await makeHost();
  const boxes = page.locator('.pp-code__box');
  await boxes.nth(0).focus();
  for (let i = 0; i < 4; i++) await boxes.nth(i).pressSequentially(host.code[i]!);
  await expect(screen(page, 'join')).toBeVisible();
});

test('形の正しくないコードの URL は、入力の画面に知らせを出す', async ({ page, line }) => {
  await openPad(page, line, 'AEIO');
  await expect(screen(page, 'entry')).toBeVisible();
  await expect(page.locator('.pp-msg')).toHaveText('コードの形が違います。4文字を入れ直してください。');
});

test('前回の名前が入り、名前は textContent で描く（HTML として解釈しない）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await page.addInitScript(() => localStorage.setItem('irori:name', 'はなこ'));
  await openPad(page, line, host.code);
  await expect(page.locator('#pp-name')).toHaveValue('はなこ');
  await page.locator('#pp-name').fill('<b>悪</b>');
  await act(page, 'join').tap();
  const you = await host.joinedNth(1);
  expect(you.name).toBe('<b>悪</b>');
  await expect(page.locator('.pp-badge__name')).toHaveText('<b>悪</b>');
  expect(await page.locator('.pp-play b').count()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('irori:name'))).toBe('<b>悪</b>');
});

test('名前は12文字まで。超えた分は入力欄で切る', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code);
  await page.locator('#pp-name').fill('あいうえおかきくけこさしすせそ');
  await expect(page.locator('#pp-name')).toHaveValue('あいうえおかきくけこさし');
  await act(page, 'join').tap();
  expect((await host.joinedNth(1)).name).toBe('あいうえおかきくけこさし');
});

test('「参加する」を連打しても、席は1つだけ', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  const button = act(page, 'join');
  const box = await button.boundingBox();
  if (!box) throw new Error('参加のボタンが見えない');
  // 指で5回、間を空けずに押す。
  await Promise.all(Array.from({ length: 5 }, () => page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)));
  await expect(screen(page, 'play')).toBeVisible();
  await host.joinedNth(1);
  // 2つ目の席ができていないこと：もう1人つないで、その人が2番になることで確かめる（待つ時間を決め打ちしない）。
  const other = await host.addNodePad('ほかの人');
  expect(other.id).toBe(2);
  expect(host.joined().map((p) => p.id)).toEqual([1, 2]);
});

test('参加のタップで画面の消灯を防ぎ、画面に戻ったら取り直す（Wake Lock は差し替えて数える）', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  await page.addInitScript(() => {
    const w = window as unknown as { __wake: { requests: number; sentinels: EventTarget[] } };
    w.__wake = { requests: 0, sentinels: [] };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__wake.requests++;
          const s = new EventTarget() as EventTarget & { released: boolean; release: () => Promise<void> };
          s.released = false;
          s.release = async () => {
            s.released = true;
            s.dispatchEvent(new Event('release'));
          };
          w.__wake.sentinels.push(s);
          return s;
        },
      },
    });
  });
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __wake: { requests: number } }).__wake.requests)).toBe(0);
  await act(page, 'join').tap();
  await host.joinedNth(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: { requests: number } }).__wake.requests)).toBe(1);
  // 画面が隠れるとブラウザは手放す。戻ったら取り直す。
  await page.evaluate(() => {
    const s = (window as unknown as { __wake: { sentinels: (EventTarget & { release: () => Promise<void> })[] } }).__wake.sentinels[0]!;
    return s.release();
  });
  await comeBack(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: { requests: number } }).__wake.requests)).toBe(2);
});

test('ホストの画面が落ちている部屋では「ホストを待っています」を出し、戻ったら消えて画面も戻る', async ({ page, line, makeHost }) => {
  const host = await makeHost();
  const you = await joinRoom(page, line, host);
  host.setPad(you.id, { k: 'buzzer', label: '押す' });
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  host.disconnect();
  await expect(page.locator('[data-cover="host"]')).toBeVisible();
  await expect(page.locator('[data-cover="host"]')).toContainText('大きな画面を待っています');
  // 待っている間、下の操作は押せず（inert）、見えもしない（案内の下からのぞかせない）。
  expect(await page.locator('.pp-pad').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await expect(page.locator('.irori-pad__buzzer')).toBeHidden();
  await host.connect();
  await expect(page.locator('[data-cover="host"]')).toBeHidden();
  await expect(page.locator('.irori-pad__buzzer')).toBeVisible();
  // 入ってからホストが落ちていても、新しく入る人には同じ案内が出る。
  host.disconnect();
  const page2 = await page.context().newPage();
  await openPad(page2, line, host.code);
  await act(page2, 'join').tap();
  await expect(screen(page2, 'play')).toBeVisible();
  await expect(page2.locator('[data-cover="host"]')).toBeVisible();
  await host.connect();
  await expect(page2.locator('[data-cover="host"]')).toBeHidden();
});

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
