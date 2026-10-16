// 押すタイミング：本物のゲームの最中に、連打・画面の差し替え・入り直しを、間隔を0〜500msで振って流す。
// 振り方は固定の種から作る（毎回同じ並びで再現できる）。CDP でページの CPU を6倍遅くした通しを、
// tap-race と入り直しで1本ずつ（Chromium の組だけ）。B2 の試験（Node のホスト役との組み合わせ）とは重ねない。
import { ANSWER_MS, REVEAL_MS } from '../../../games/quiz-4/logic.js';
import { QUESTIONS } from '../../../games/quiz-4/questions.js';
import { GAME_MS } from '../../../games/dot-grab/logic.js';
import { TAPS_TO_FINISH } from '../../../games/tap-race/logic.js';
import { expect, test, type Host, type Pad } from './fixtures';
import { HOST, ONLY_DC, ONLY_PC, PHONE } from './lib/tags';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const buzzerDowns = (host: Host, p: number) => host.inputs(p).filter((r) => r.f.i?.id === 'buzzer' && r.f.i.d === 1).length;
const hops = (host: Host, p: number) => host.inputs(p).filter((r) => r.f.i?.id === 'hop' && r.f.i.d === 1).length;

/** 間隔を rand で 0〜max ms に振りながら、count 回たたく。 */
async function tapJittered(p: Pad, id: string, count: number, rand: () => number, max = 500): Promise<void> {
  const c = await p.centerOf(p.button(id));
  for (let i = 0; i < count; i++) {
    await p.page.touchscreen.tap(c.x, c.y);
    await sleep(Math.round(rand() * max));
  }
}

/** CDP で、ページの CPU を rate 倍遅くする（Chromium だけ）。 */
async function throttle(pages: import('@playwright/test').Page[], rate: number): Promise<void> {
  for (const page of pages) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
}

test('連打の間隔を0〜500msで振っても、3台が同時にたたいた数が1回ずつ正しく数えられる（時間切れで数を読む）', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 15_000);
  const counts = [11, 8, 5];
  await Promise.all(pads.map((p, i) => tapJittered(p, 'buzzer', counts[i]!, seeded(20261016 + i))));
  await expect.poll(() => [1, 2, 3].map((s) => buzzerDowns(host, s))).toEqual(counts);
  await host.advance(31_000);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.label])).toEqual([
    [1, '11回'],
    [2, '8回'],
    [3, '5回'],
  ]);
});

test('完走の瞬間とその後も連打を続けても、完走の画面に差し替わり、40回を超えた分は数えない', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 15_000);
  const rand = seeded(7);
  // 40回のあと、さらに5回（間隔は0〜60ms）。差し替わった後のタップは、待機の画面に当たって何も送らない。
  const c = await pads[0]!.centerOf(pads[0]!.button('buzzer'));
  for (let i = 0; i < TAPS_TO_FINISH + 5; i++) {
    await pads[0]!.page.touchscreen.tap(c.x, c.y);
    await sleep(Math.round(rand() * 60));
  }
  await pads[0]!.expectWait('完走！ 1位');
  expect(buzzerDowns(host, 1)).toBeGreaterThanOrEqual(TAPS_TO_FINISH);
  expect(buzzerDowns(host, 1)).toBeLessThanOrEqual(TAPS_TO_FINISH + 5);
  // 押した・離したは対になっている（最後に押したまま差し替わっても、離しが補われる）。
  const ups = host.inputs(1).filter((r) => r.f.i?.id === 'buzzer' && r.f.i.d === 0).length;
  expect(ups).toBe(buzzerDowns(host, 1));
  await pads[1]!.tapMany('buzzer', TAPS_TO_FINISH);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank])).toEqual([
    [1, 1],
    [2, 2],
  ]);
});

test('押したまま画面が差し替わっても、離し（d:0）が補われる：hello-pad でリーダーが「おわる」を押すまで0〜500msで振る', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  const rand = seeded(42);
  // 「おわる」はリーダー（席1）のスマホにだけある。席2が「ぴょん」を押したまま、リーダーが終える。
  for (let round = 0; round < 4; round++) {
    if (round === 0) await host.choose('hello-pad', pads[0]);
    else await pads[0]!.tap('ok');
    await host.expectPhase('play');
    await pads[1]!.expectKind('pad');
    const before = host.inputs(2).length;
    const c = await pads[1]!.centerOf(pads[1]!.button('hop'));
    await pads[1]!.finger.down(c.x, c.y);
    await expect.poll(() => host.inputs(2).slice(before).length).toBe(1);
    const wait = Math.round(rand() * 500);
    await sleep(wait);
    await pads[0]!.tap('end');
    await host.expectState('results');
    // 結果の待機の画面に差し替わると、押したままのボタンの離しが届く。古い画面の入力は残らない。
    await expect.poll(() => host.inputs(2).slice(before).map((r) => `${r.f.i?.id}:${r.f.i?.d}`), { message: `押してから ${wait}ms で差し替え` }).toEqual(['hop:1', 'hop:0']);
    await pads[1]!.finger.up();
    await pads[1]!.expectKind('wait');
    await sleep(200);
    expect(host.inputs(2).slice(before)).toHaveLength(2);
  }
});

test('スティックを倒したまま時間切れになっても、画面の差し替えで 0,0 が補われる（dot-grab）', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('dot-grab', pads[0]);
  await host.expectPhase('play', 15_000);
  await pads[0]!.expectKind('pad');
  await pads[0]!.stickDown(0.6, 0);
  await expect.poll(() => host.inputs(1).some((r) => r.f.i?.k === 'axis' && (r.f.i.x ?? 0) > 0.5)).toBe(true);
  await host.advance(GAME_MS);
  await host.results();
  await expect.poll(() => host.inputs(1).filter((r) => r.f.i?.k === 'axis').map((r) => [r.f.i?.x, r.f.i?.y]).at(-1)).toEqual([0, 0]);
  await pads[0]!.stickUp();
  await pads[0]!.expectKind('remote');
});

test('締切の直前（0〜500ms前）に答えても、ゲーム・スマホの答え合わせ・結果の3か所で同じに数えられる', HOST, async ({ rig }) => {
  test.setTimeout(240_000);
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('quiz-4', pads[0]);
  const offsets = [0, 16, 50, 120, 250, 400, 500, 30];
  let total = 0;
  let correct = 0;
  const outcomes: string[] = [];
  for (let r = 1; r <= offsets.length; r++) {
    // 出題に気づくまでの遅れを小さくするため、50ms ごとに見る。
    await expect.poll(() => host.inGame(() => `${document.documentElement.dataset.phase}:${document.documentElement.dataset.round}`), { timeout: 20_000, intervals: [50] }).toBe(`question:${r}`);
    const q = (await host.inGame(() => ({
      text: document.getElementById('question')?.textContent ?? '',
      choices: [...document.querySelectorAll<HTMLElement>('#choices .choice')].map((li) => ({ id: li.dataset.id ?? '', label: li.querySelector('span:not(.choice__num)')?.textContent ?? '' })),
    })))!;
    const answer = (QUESTIONS.find((x: { q: string }) => x.q === q.text) as { a: string }).a;
    const right = q.choices.find((c) => c.label === answer)!;
    await host.advance(ANSWER_MS - offsets[r - 1]!, { step: 8_000, pause: 20 });
    // 締切を過ぎて画面が答え合わせに替わっていたら、押せない（それも振り方の1つ）。
    await pads[0]!.page.locator(`.irori-pad__choice[data-id="${right.id}"]:not([disabled])`).tap({ timeout: 1_000 }).catch(() => undefined);
    await host.advance(offsets[r - 1]! + 300);
    await pads[0]!.expectKind('wait');
    const title = (await pads[0]!.waitText()).title;
    const plus = /^正解！ \+(\d+)$/.exec(title);
    const delta = plus ? Number(plus[1]) : -200;
    expect(plus !== null || title === '時間切れ -200', `第${r}問（締切の${offsets[r - 1]}ms前）: ${title}`).toBe(true);
    total += delta;
    if (plus) correct++;
    outcomes.push(`${offsets[r - 1]}ms前→${plus ? '正解' : '時間切れ'}`);
    const shown = await host.inGame(() => Number(document.querySelector('#seats .seat__score')?.textContent));
    expect(shown, `第${r}問のあとのゲームの点`).toBe(total);
    await host.advance(REVEAL_MS + 200);
  }
  const rows = await host.results();
  const me = rows.find((x) => x.seat === 1)!;
  expect([me.score, me.label]).toEqual([total, `${correct}問正解`]);
  // 境目の両側を通った（間に合った回と、間に合わなかった回の両方がある）。
  expect(correct, outcomes.join('、')).toBeGreaterThan(0);
  expect(correct, outcomes.join('、')).toBeLessThan(offsets.length);
  test.info().annotations.push({ type: '締切の前後', description: outcomes.join('、') });
});

test('入り直しの間（0〜500ms）と、戻った直後に押すまで（0〜500ms）を振っても、画面が戻り、押した分だけ数えられる', PHONE, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ'], { line: true });
  rig.allowSocketErrors();
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play');
  const rand = seeded(99);
  let pressed = 0;
  for (let i = 0; i < 5; i++) {
    await pads[1]!.expectKind('pad');
    const kind = i % 2 === 0 ? 'cut' : 'freeze';
    if (kind === 'cut') pads[1]!.cut();
    else pads[1]!.freeze();
    await sleep(Math.round(rand() * 500));
    if (kind === 'cut') pads[1]!.restore();
    else await pads[1]!.comeBack();
    await expect.poll(() => pads[1]!.line!.wsOpened, { timeout: 15_000 }).toBeGreaterThanOrEqual(i + 2);
    await pads[1]!.expectLink('open', 20_000);
    await pads[1]!.expectKind('pad');
    await sleep(Math.round(rand() * 500));
    await pads[1]!.tap('hop');
    pressed++;
    await expect.poll(() => hops(host, 2)).toBe(pressed);
  }
  await pads[0]!.tap('end');
  const rows = await host.results();
  expect(rows.find((r) => r.seat === 2)?.label).toBe(`ぴょん${pressed}回`);
});

test('CPU を6倍遅くしても、tap-race を3台で完走でき、数と順位が正しい', ONLY_DC, async ({ rig }) => {
  test.setTimeout(240_000);
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await throttle([host.page, ...pads.map((p) => p.page)], 6);
  await host.choose('tap-race', pads[0]);
  await host.expectPhase('race', 30_000);
  for (const p of pads) await p.tapMany('buzzer', TAPS_TO_FINISH);
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.rank])).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
  expect([1, 2, 3].map((s) => buzzerDowns(host, s))).toEqual([TAPS_TO_FINISH, TAPS_TO_FINISH, TAPS_TO_FINISH]);
});

test('CPU を6倍遅くしても、ゲームの最中に回線が切れて戻ると、画面が戻って続けられる', ONLY_PC, async ({ rig }) => {
  test.setTimeout(240_000);
  const host = await rig.openHost();
  const pads = await rig.join(host, ['たろう', 'はなこ'], { line: true });
  rig.allowSocketErrors();
  await throttle([host.page, ...pads.map((p) => p.page)], 6);
  await host.choose('hello-pad', pads[0]);
  await host.expectPhase('play', 30_000);
  await pads[1]!.tap('hop');
  pads[1]!.cut();
  await expect.poll(() => host.received.some((r) => r.f.t === 'online' && r.f.p === 2 && r.f.on === false)).toBe(true);
  pads[1]!.restore();
  await pads[1]!.expectLink('open', 30_000);
  await pads[1]!.expectKind('pad', 30_000);
  await pads[1]!.tap('hop');
  await expect.poll(() => hops(host, 2), { timeout: 20_000 }).toBe(2);
  await pads[0]!.tap('end');
  expect((await host.results()).find((r) => r.seat === 2)?.label).toBe('ぴょん2回');
});
