// quiz-4（4択クイズ）の終わり方3つ：全問／全員が時間切れ／全員退出（抜けた人も、抜けたときの点で結果に残る）。ホストの時計を差し替えて、締切を進める。
// 問題ごとに、スマホの choices の文字がその問題の選択肢に変わること、正解・誤答・時間切れで点が変わることを、
// ゲームの画面（枠の中の DOM）・スマホの答え合わせの画面・ホストの結果の3か所で突き合わせる。
// 正解は、ゲームの問題の表（games/quiz-4/questions.js）から、問題文で引く。
import { ANSWER_MS, REVEAL_MS, ROUNDS, TIMEOUT_POINTS, WRONG_POINTS } from '../../../games/quiz-4/logic.js';
import { QUESTIONS } from '../../../games/quiz-4/questions.js';
import { expect, test, type Host, type Pad } from './fixtures';
import { HOST } from './lib/tags';

interface Shown {
  round: number;
  question: string;
  choices: { id: string; label: string }[];
}

const answerOf = (question: string): string => {
  const q = QUESTIONS.find((x: { q: string }) => x.q === question);
  if (!q) throw new Error(`問題の表にない問題: ${question}`);
  return q.a as string;
};

/** ゲームの画面に出ている問題（出題中のときだけ）。 */
async function shown(host: Host, round: number): Promise<Shown> {
  await expect
    .poll(() => host.inGame(() => `${document.documentElement.dataset.phase}:${document.documentElement.dataset.round}`), { timeout: 20_000, message: `第${round}問の出題` })
    .toBe(`question:${round}`);
  const s = await host.inGame(() => ({
    round: Number(document.documentElement.dataset.round),
    question: document.getElementById('question')?.textContent ?? '',
    choices: [...document.querySelectorAll<HTMLElement>('#choices .choice')].map((li) => ({ id: li.dataset.id ?? '', label: li.querySelector('span:not(.choice__num)')?.textContent ?? '' })),
  }));
  if (!s) throw new Error('ゲームの画面が読めない');
  return s;
}

/** スマホに出ている選択肢（id と文字）。 */
async function padChoices(p: Pad): Promise<{ id: string; label: string; disabled: boolean }[]> {
  return p.page.locator('.irori-pad__choice').evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute('data-id') ?? '', label: el.textContent ?? '', disabled: (el as HTMLButtonElement).disabled })),
  );
}

test('quiz-4 全問：問題ごとに選択肢が変わり、正解・誤答・時間切れで点が変わる。8問の最後まで', HOST, async ({ rig }) => {
  test.setTimeout(240_000);
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('quiz-4', pads[0]);
  const expected = new Map<number, { score: number; correct: number }>([1, 2, 3].map((s) => [s, { score: 0, correct: 0 }]));
  let previous: string[] = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const s = await shown(host, r);
    expect(s.choices).toHaveLength(4);
    const labels = s.choices.map((c) => c.label);
    expect(labels, `第${r}問の選択肢は、前の問題と違う`).not.toEqual(previous);
    previous = labels;
    const right = s.choices.find((c) => c.label === answerOf(s.question));
    const wrong = s.choices.find((c) => c.label !== answerOf(s.question));
    if (!right || !wrong) throw new Error(`第${r}問の正解が選択肢にない: ${s.question}`);
    // スマホ3台とも、この問題の選択肢（id と文字）になっている。
    for (const p of pads) {
      await expect.poll(async () => (await padChoices(p)).map((c) => `${c.id}:${c.label}:${c.disabled}`)).toEqual(s.choices.map((c) => `${c.id}:${c.label}:false`));
    }
    // 役を問題ごとに回す：1台が正解、1台が誤答、1台は答えない（時間切れ）。
    const [good, bad, none] = [pads[(r - 1) % 3]!, pads[r % 3]!, pads[(r + 1) % 3]!];
    await good.choose(right.id);
    await bad.choose(wrong.id);
    // 答えた台は、二重に答えられない（disabled の画面に差し替わる）。押した答えは、ヒントに残る。
    for (const p of [good, bad]) await expect.poll(async () => (await padChoices(p)).every((c) => c.disabled)).toBe(true);
    await expect(good.page.locator('.irori-pad__hint')).toHaveText(`あなたの答え：${right.label}`);
    await expect(bad.page.locator('.irori-pad__hint')).toHaveText(`あなたの答え：${wrong.label}`);
    expect((await padChoices(none)).some((c) => c.disabled)).toBe(false);
    await host.advance(ANSWER_MS);
    // 答え合わせ：正解は +N（早いほど高い）、誤答と時間切れは減点。
    await good.expectKind('wait');
    await expect(good.page.locator('.irori-pad__title')).toHaveText(/^正解！ \+\d+$/);
    const plus = Number(((await good.waitText()).title.match(/\+(\d+)/) ?? [])[1]);
    expect(plus).toBeGreaterThanOrEqual(200);
    expect(plus).toBeLessThanOrEqual(1000);
    await bad.expectWait(`ざんねん ${WRONG_POINTS}`);
    await none.expectWait(`時間切れ ${TIMEOUT_POINTS}`);
    for (const [p, delta] of [[good, plus], [bad, WRONG_POINTS], [none, TIMEOUT_POINTS]] as const) {
      const e = expected.get(await p.seat())!;
      e.score += delta;
      if (p === good) e.correct += 1;
    }
    // ゲームの画面の点数も、同じ合計になっている。
    const scores = await host.inGame(() => [...document.querySelectorAll('#seats .seat__score')].map((el) => Number(el.textContent)));
    expect(scores).toEqual([1, 2, 3].map((seat) => expected.get(seat)!.score));
    await host.advance(REVEAL_MS + 200);
  }
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.score, r.label]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual(
    [1, 2, 3].map((seat) => [seat, expected.get(seat)!.score, `${expected.get(seat)!.correct}問正解`]),
  );
  // 順位は点数の高い順。
  const byRank = [...rows].sort((a, b) => a.rank - b.rank).map((r) => r.score);
  expect(byRank).toEqual([...byRank].sort((a, b) => b - a));
  await pads[0]!.tap('right');
  await pads[0]!.tap('ok');
  await host.expectState('home');
});

test('quiz-4 全員が時間切れ：誰も答えないまま8問が進み、全員 -1600点・0問正解で終わる', HOST, async ({ rig }) => {
  test.setTimeout(180_000);
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('quiz-4', pads[0]);
  let previous = '';
  for (let r = 1; r <= ROUNDS; r++) {
    const s = await shown(host, r);
    expect(s.question).not.toBe(previous);
    previous = s.question;
    await expect.poll(async () => (await padChoices(pads[2]!)).map((c) => c.label)).toEqual(s.choices.map((c) => c.label));
    await host.advance(ANSWER_MS);
    for (const p of pads) await p.expectWait(`時間切れ ${TIMEOUT_POINTS}`);
    await host.advance(REVEAL_MS + 200);
  }
  const rows = await host.results();
  expect(rows.map((r) => [r.score, r.label])).toEqual([1, 2, 3].map(() => [ROUNDS * TIMEOUT_POINTS, '0問正解']));
  expect(rows.map((r) => r.seat)).toEqual([1, 2, 3]);
});

test('quiz-4 全員退出：1問目のあと、出題の途中で3台が bye。抜けた人の札は「退出」、結果には3人とも抜けたときの点で残る', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('quiz-4', pads[0]);
  const s = await shown(host, 1);
  const right = s.choices.find((c) => c.label === answerOf(s.question));
  const wrong = s.choices.find((c) => c.label !== answerOf(s.question));
  if (!right || !wrong) throw new Error(`第1問の正解が選択肢にない: ${s.question}`);
  await pads[0]!.choose(right.id);
  await pads[1]!.choose(wrong.id);
  await pads[2]!.choose(wrong.id); // 全員が答えたので、締切を待たずに答え合わせ
  await expect(pads[0]!.page.locator('.irori-pad__title')).toHaveText(/^正解！ \+\d+$/);
  const plus = Number(((await pads[0]!.waitText()).title.match(/\+(\d+)/) ?? [])[1]);
  await host.advance(REVEAL_MS + 200);
  await shown(host, 2);
  await pads[1]!.leave();
  // ゲームの札：席が消えた人は「切断」でなく「退出」。点はそのまま見せる。
  const chips = () => host.inGame(() => [...document.querySelectorAll('#seats .seat')].map((li) => `${li.querySelector('.seat__score')?.textContent}:${li.querySelector('.seat__chip')?.textContent ?? ''}`));
  await expect.poll(chips).toEqual([`${plus}:`, `${WRONG_POINTS}:退出`, `${WRONG_POINTS}:`]);
  await pads[0]!.leave();
  await pads[2]!.leave();
  const rows = await host.results();
  expect(rows.map((r) => [r.seat, r.score, r.label, r.gone])).toEqual([
    [1, plus, '1問正解', true],
    [2, WRONG_POINTS, '0問正解', true],
    [3, WRONG_POINTS, '0問正解', true],
  ]);
  await host.key('Escape');
  await host.expectState('home');
});
