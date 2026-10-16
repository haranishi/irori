// ゲームの最中に起こす出来事（B1・B2 の試験にあるものは重ねず、ゲームの最中の振る舞いだけを足す）。
//   スマホの再読み込み → 出題中の選択肢が戻り、そのまま答えられる（ホストが pad? に応えて送り直す）
//   スマホの回線が切れる → ゲームは切断を棄権にせず、戻ったスマホには連打の画面が戻って、続きから押せる
//   回線が黙って死ぬ → 画面に戻ったときに確かめて入り直し、同じ席・同じ画面で続けられる（ゲームは切断に気づかない）
//   ホストの再読み込み → ゲームは結果なしで終わり、同じ部屋・同じ席のままホームに戻る。次のゲームは遊べる
//   ゲームの最中に外す（kick）→ 外された画面は「コードを入れ直す」だけ。外した席は結果に出ない
// 既知の不具合1・2は、B1 が直したので、契約の形で確かめる（lib/known.ts の changed の案内に従って書き換えた）。
import { TAPS_TO_FINISH } from '../../../games/tap-race/logic.js';
import { ANSWER_MS } from '../../../games/quiz-4/logic.js';
import { QUESTIONS } from '../../../games/quiz-4/questions.js';
import { expect, test, type Host } from './fixtures';
import { HOST, PHONE } from './lib/tags';

const answerOf = (q: string) => (QUESTIONS.find((x: { q: string }) => x.q === q) as { a: string } | undefined)?.a;

async function question(host: Host) {
  await expect.poll(() => host.inGame(() => document.documentElement.dataset.phase), { timeout: 20_000 }).toBe('question');
  return (await host.inGame(() => ({
    text: document.getElementById('question')?.textContent ?? '',
    choices: [...document.querySelectorAll<HTMLElement>('#choices .choice')].map((li) => ({ id: li.dataset.id ?? '', label: li.querySelector('span:not(.choice__num)')?.textContent ?? '' })),
  })))!;
}

test('出題中にスマホを再読み込みしても、同じ席に戻り、その問題の選択肢が戻って答えられる', PHONE, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('quiz-4', pads[0]);
  const q = await question(host);
  const right = q.choices.find((c) => c.label === answerOf(q.text))!;
  await pads[1]!.expectKind('choices');
  await pads[1]!.page.reload();
  await expect(pads[1]!.play).toBeVisible();
  expect(await pads[1]!.seat()).toBe(2);
  await pads[1]!.expectKind('choices');
  await expect(pads[1]!.page.locator('.irori-pad__choice')).toHaveText(q.choices.map((c) => c.label));
  await pads[1]!.choose(right.id);
  await pads[0]!.choose(right.id);
  await pads[2]!.choose(right.id);
  // 3人とも答えたので、すぐ答え合わせ。再読み込みした台も正解として数えられる。
  await expect(pads[1]!.page.locator('.irori-pad__title')).toHaveText(/^正解！ \+\d+$/);
  expect(host.received.filter((r) => r.f.t === 'joined')).toHaveLength(3);
  await host.advance(ANSWER_MS);
});

test('連打の最中にスマホの回線が切れても、戻れば回数を保ったまま続きから連打できる（棄権にならない）', PHONE, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう'], { line: true });
  rig.allowSocketErrors();
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 15_000);
  await pads[1]!.tapMany('buzzer', 3);
  // 切る前に、3回がホストへ届いたことを確かめる（遅い環境で、送信待ちのまま回線を切ると、届かない分が出る）。
  await expect.poll(() => host.inputs(2).filter((r) => r.f.i?.id === 'buzzer' && r.f.i.d === 1).length).toBe(3);
  pads[1]!.cut();
  await expect.poll(() => host.received.some((r) => r.f.t === 'online' && r.f.p === 2 && r.f.on === false)).toBe(true);
  await pads[1]!.expectLink('lost');
  pads[1]!.restore();
  await pads[1]!.expectLink('open', 20_000);
  // 戻ったスマホには連打の画面が戻り、切れる前の3回の続きから押せる。
  await pads[1]!.expectKind('buzzer');
  expect(await pads[1]!.seat()).toBe(2);
  await pads[1]!.tapMany('buzzer', TAPS_TO_FINISH - 3);
  await pads[1]!.expectWait('完走！ 1位');
  await pads[0]!.tapMany('buzzer', TAPS_TO_FINISH);
  await pads[2]!.tapMany('buzzer', TAPS_TO_FINISH);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank])).toEqual([
    [2, 1],
    [1, 2],
    [3, 3],
  ]);
});

test('連打の最中に回線が黙って死んでも、画面に戻ったら入り直し、同じ画面で続けて完走できる', PHONE, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ'], { line: true });
  rig.allowSocketErrors();
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 15_000);
  await pads[1]!.tapMany('buzzer', 10);
  const downs = () => host.inputs(2).filter((r) => r.f.i?.id === 'buzzer' && r.f.i.d === 1).length;
  await expect.poll(downs).toBe(10);
  pads[1]!.freeze();
  // 死んだ回線に押した分は、どこにも届かない。
  await pads[1]!.tapMany('buzzer', 5);
  await pads[1]!.comeBack();
  await expect.poll(() => pads[1]!.line!.wsOpened, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await pads[1]!.expectLink('open', 20_000);
  await pads[1]!.expectKind('buzzer');
  expect(downs()).toBe(10);
  // 席は切れていない扱い（ゲームは棄権にしていない）。残りを押して完走できる。
  expect(host.received.some((r) => r.f.t === 'online' && r.f.p === 2 && r.f.on === false)).toBe(false);
  await pads[1]!.tapMany('buzzer', 30);
  await expect.poll(downs).toBe(40);
  await pads[0]!.tapMany('buzzer', 40);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank])).toEqual([
    [2, 1],
    [1, 2],
  ]);
});

test('ゲームの最中にホストを再読み込みすると、ゲームは結果なしで終わり、同じ部屋・同じ席でホームに戻る', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const code = await host.code();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  for (const p of pads) await p.expectKind('pad');
  await host.page.reload();
  await host.expectState('home', 20_000);
  expect(await host.code()).toBe(code);
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
  await expect(host.page.locator('.seat[data-seat]')).toHaveCount(3);
  expect((await host.seats()).map((s) => [s.seat, s.leader])).toEqual([
    [1, true],
    [2, false],
    [3, false],
  ]);
  // スマホには、コンソールの画面（リーダーにリモコン、ほかは待機）が戻る。
  await pads[0]!.expectKind('remote');
  await pads[1]!.expectKind('wait');
  await pads[2]!.expectKind('wait');
  expect(host.received.filter((r) => r.f.t === 'pad?').map((r) => r.f.p).sort()).toEqual([1, 2, 3]);
  // 次のゲームは、ふつうに遊べる。
  await host.choose('hello-pad', pads[0]);
  await pads[0]!.tap('end');
  expect((await host.results()).map((r) => r.seat).sort()).toEqual([1, 2, 3]);
});

/** ホストのメニュー（Esc）から席を外し、ゲームに戻る。 */
async function kickFromMenu(host: Host, seat: number): Promise<void> {
  await host.key('Escape');
  await host.expectState('paused');
  await host.page.locator('[data-nav="menu:kick"]').click();
  await host.page.locator(`[data-nav="menu:kick:${seat}"]`).click();
  await host.page.locator('[data-nav="kick:ok"]').click();
  await expect.poll(() => host.received.find((r) => r.f.t === 'left' && r.f.p === seat)?.f.why).toBe('kick');
  await host.page.locator('[data-nav="menu:back"]').click();
  await host.page.locator('[data-nav="menu:continue"]').click();
  await host.expectState('playing');
}

test('ゲームの最中に外した（kick）席：外された画面は「コードを入れ直す」だけで、押すとコードの入力に戻る。外した席は結果に出ない', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  await pads[1]!.tap('hop');
  await kickFromMenu(host, 2);
  await pads[1]!.expectEnded('kicked');
  await expect(pads[1]!.page.locator('[data-act="reenter"]')).toBeVisible();
  await expect(pads[1]!.page.locator('[data-act="rejoin"]')).toHaveCount(0);
  await pads[1]!.page.locator('[data-act="reenter"]').tap();
  await expect(pads[1]!.page.locator('[data-screen="entry"]')).toBeVisible();
  await expect(pads[1]!.page.locator('.pp-code__box')).toHaveCount(4);
  // 残りの2人でゲームは続き、リーダーが終える。外した人の「ぴょん」は、結果に出ない。
  await pads[0]!.expectKind('pad');
  await pads[2]!.tap('hop');
  await pads[0]!.tap('end');
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.label])).toEqual([
    [3, 'ぴょん1回'],
    [1, 'ぴょん0回'],
  ]);
});

test('ゲームの途中で空いた席に入った人は、そのゲームの参加者にならない：待機の画面で、結果にも出ない（docs/sdk.md。元は既知の不具合1）', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const code = await host.code();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  await kickFromMenu(host, 2);
  await pads[1]!.expectEnded('kicked');
  // 外された人が「コードを入れ直す」から、もう一度コードを打って入る。空いた席の2に入る。
  await pads[1]!.page.locator('[data-act="reenter"]').tap();
  await pads[1]!.page.locator('.pp-code__box').first().click();
  await pads[1]!.page.keyboard.type(code);
  await expect(pads[1]!.page.locator('[data-act="join"]')).toBeVisible();
  await pads[1]!.page.locator('[data-act="join"]').tap();
  await expect(pads[1]!.play).toBeVisible();
  expect(await pads[1]!.seat()).toBe(2);
  // このゲームの参加者ではないので、待機の画面（次のゲームから）。遊んでいるゲームの画面は出ない。
  await expect(pads[1]!.pad).toHaveAttribute('data-kind', 'wait');
  await expect(pads[1]!.page.locator('.irori-pad__btn[data-id="hop"]')).toHaveCount(0);
  // 残りの2人で続き、リーダーが終える。席2は結果に出ない。
  await pads[2]!.tap('hop');
  await pads[0]!.tap('end');
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.label])).toEqual([
    [3, 'ぴょん1回'],
    [1, 'ぴょん0回'],
  ]);
});

test('棚の読み込みが部屋につながるより遅くても、棚が出たら、ホームの選択の輪は棚のカードに乗り、リモコンの右で動く（元は既知の不具合2）', HOST, async ({ rig }) => {
  const slow = async (ctx: import('@playwright/test').BrowserContext) => {
    await ctx.route('**/registry/index.json', async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    });
  };
  const host = await rig.openHost({ init: slow });
  await expect(host.page.locator('.card[data-game]').first()).toBeVisible();
  // docs/ux.md の④（主役は選択中のゲームのカード）：棚が出たら、輪は棚のカード（game:…）。
  const focused = host.root.locator('[data-focused]').first();
  await expect(focused).toHaveAttribute('data-nav', /^game:/);
  const order = await host.shelf();
  expect(await focused.getAttribute('data-nav')).toBe(`game:${order[0]}`);
  // リーダーのリモコンの「右」（ここではホストの →）で、棚の選択が動く。
  await host.key('ArrowRight');
  await expect(focused).toHaveAttribute('data-nav', `game:${order[1]}`);
});
