// 4択クイズの規則の試験。終わり方は2つ（8問を終える・全員退出）で、どちらも end まで通す。
// 切断の扱い：online が偽なのは「いま答えられない」だけ。切れているあいだに締め切られた問題は0点（減点しない）。
import { describe, expect, it } from 'vitest';
import {
  ANSWER_MS, AWAY_POINTS, INTRO_MS, MAX_POINTS, MIN_POINTS, PADS, REVEAL_MS, ROUNDS, TIMEOUT_POINTS, WRONG_POINTS,
  answer, begin, createClock, createQuiz, makeRng, nextHistory, pickQuestions, pointsFor, results, seatTag, shuffle, tick, toRound, updatePlayers,
} from './logic.js';
import { QUESTIONS } from './questions.js';

const seats = (n, offline = []) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, online: !offline.includes(i + 1) }));
/** 席の一覧から、指定の席を消す（猶予切れ・退出・外された）。 */
const without = (list, ...gone) => list.filter((s) => !gone.includes(s.id));
const pick = (id) => ({ k: 'pick', id });
const ends = (effects) => effects.filter((e) => e.t === 'end');
const graphemes = (s) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)].length;

/** 固定の8問（正解はいつも c0）。 */
const fixedRounds = Array.from({ length: ROUNDS }, (_, i) => ({
  id: `q${i}`,
  text: `問題${i + 1}`,
  choices: ['あ', 'い', 'う', 'え'].map((label, j) => ({ id: `c${j}`, label })),
  answer: 'c0',
}));

/** 第1問が出たところまで進めたクイズ。出題の時刻を返す。 */
function asked(n = 3, offline = []) {
  const quiz = createQuiz(seats(n, offline), fixedRounds, 0);
  begin(quiz);
  tick(quiz, INTRO_MS);
  return { quiz, at: INTRO_MS };
}

describe('点のつけ方', () => {
  it('正解は出題の瞬間が1000点、締切の直前が200点で、直線で下がる。まちがい・時間切れは-200、切断は0', () => {
    expect(pointsFor(0)).toBe(MAX_POINTS);
    expect(pointsFor(ANSWER_MS / 2)).toBe(600);
    expect(pointsFor(ANSWER_MS - 1)).toBe(MIN_POINTS);
    expect(pointsFor(-5)).toBe(MAX_POINTS);
    expect(WRONG_POINTS).toBe(-200);
    expect(TIMEOUT_POINTS).toBe(-200);
    expect(AWAY_POINTS).toBe(0);
  });
});

describe('問題の選び方', () => {
  it('同じ種なら同じ並び。混ぜても中身は変わらない', () => {
    expect(shuffle([1, 2, 3, 4, 5], makeRng(7))).toEqual(shuffle([1, 2, 3, 4, 5], makeRng(7)));
    expect([...shuffle([1, 2, 3, 4, 5], makeRng(9))].sort()).toEqual([1, 2, 3, 4, 5]);
    const rng = makeRng(0);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('8問を重ならずに選ぶ。前に出た問題は、足りるかぎり避ける', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ids = pickQuestions(QUESTIONS, ROUNDS, makeRng(seed)).map((q) => q.id);
      expect(ids).toHaveLength(ROUNDS);
      expect(new Set(ids).size).toBe(ROUNDS);
      const next = pickQuestions(QUESTIONS, ROUNDS, makeRng(seed + 1000), ids).map((q) => q.id);
      expect(next.filter((id) => ids.includes(id))).toEqual([]);
    }
    // 避ける数が多すぎるときは、避けたものからも足して8問にする。
    const almostAll = QUESTIONS.slice(3).map((q) => q.id);
    const ids = pickQuestions(QUESTIONS, ROUNDS, makeRng(3), almostAll).map((q) => q.id);
    expect(new Set(ids).size).toBe(ROUNDS);
    expect(ids.slice(0, 3).sort()).toEqual(QUESTIONS.slice(0, 3).map((q) => q.id).sort());
  });

  it('覚えるのは「問題の数 − 8」問（前の2回ぶん）。同じ部屋で続けて遊んでも、3回のうちに同じ問題が出ない', () => {
    const keep = QUESTIONS.length - ROUNDS;
    expect(nextHistory(['a', 'b', 'c'], ['x', 'a'], 4)).toEqual(['x', 'a', 'b', 'c']);
    expect(nextHistory([], ['x'], 0)).toEqual([]);
    for (let seed = 1; seed <= 30; seed++) {
      const rng = makeRng(seed);
      let history = [];
      const games = [];
      for (let g = 0; g < 3; g++) {
        const ids = pickQuestions(QUESTIONS, ROUNDS, rng, history).map((q) => q.id);
        history = nextHistory(history, ids, keep);
        games.push(ids);
      }
      expect(new Set(games.flat()).size, `種${seed}`).toBe(ROUNDS * 3);
      expect(history.length).toBeLessThanOrEqual(keep);
    }
  });

  it('選択肢は4つで、並びを混ぜ、正解の id を覚える', () => {
    const q = QUESTIONS[0];
    const round = toRound(q, makeRng(5));
    expect(round.choices.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(round.choices.map((c) => c.label).sort()).toEqual([q.a, ...q.w].sort());
    expect(round.choices.find((c) => c.id === round.answer)?.label).toBe(q.a);
    const places = new Set(Array.from({ length: 40 }, (_, s) => toRound(q, makeRng(s + 1)).answer));
    expect(places.size).toBeGreaterThan(1);
  });
});

describe('問題の中身', () => {
  it('20問以上。id は重ならず、選択肢は12文字以内で、正解は1つ', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    for (const q of QUESTIONS) {
      const all = [q.a, ...q.w];
      expect(new Set(all).size, q.id).toBe(4);
      for (const label of all) expect(graphemes(label), `${q.id}: ${label}`).toBeLessThanOrEqual(12);
      expect(q.q.length, q.id).toBeGreaterThan(4);
      expect(q.src, q.id).toMatch(/^https:\/\/[^\s]+$/);
    }
  });

  it('2つの県の組み合わせの問題で、誤りが正解の県を含まない（紛らわしすぎない）', () => {
    for (const q of QUESTIONS.filter((x) => x.a.includes('と'))) {
      for (const part of q.a.split('と')) {
        for (const w of q.w) expect(w.includes(part), `${q.id}: ${w}`).toBe(false);
      }
    }
  });
});

describe('出題と回答', () => {
  it('始めた時点の席は、切れている席も含めて全員が参加者。説明の3秒が過ぎたら第1問', () => {
    const quiz = createQuiz(seats(3, [3]), fixedRounds, 0);
    expect(begin(quiz)).toEqual([1, 2, 3].map((to) => ({ t: 'pad', spec: PADS.intro, to })));
    expect(quiz.seats.get(3)?.online).toBe(false);
    expect(tick(quiz, INTRO_MS - 1)).toEqual([]);
    const fx = tick(quiz, INTRO_MS);
    expect(quiz.phase).toBe('question');
    expect(fx).toEqual([1, 2, 3].map((to) => ({ t: 'pad', spec: PADS.ask(fixedRounds[0], 1), to })));
  });

  it('答えたら、その人のスマホに選んだ答えを残して押せなくする。二度目・知らない id・参加者でない席は受けない', () => {
    const { quiz, at } = asked(3);
    const fx = answer(quiz, 1, pick('c2'), at + 100);
    expect(fx).toEqual([{ t: 'pad', spec: PADS.ask(fixedRounds[0], 1, 'c2'), to: 1 }]);
    expect(fx[0].spec).toMatchObject({ k: 'choices', disabled: true, hint: 'あなたの答え：う' });
    expect(answer(quiz, 1, pick('c0'), at + 200)).toEqual([]);
    expect(answer(quiz, 2, pick('c9'), at + 200)).toEqual([]);
    expect(answer(quiz, 6, pick('c0'), at + 200)).toEqual([]);
    expect(answer(quiz, 2, { k: 'btn', id: 'c0', d: 1 }, at + 200)).toEqual([]);
    expect(quiz.seats.get(1)?.pick).toBe('c2');
    expect(quiz.seats.get(2)?.pick).toBe(null);
  });

  it('全員が答えたら締切を待たずに答え合わせ。正解は早いほど高く、まちがいは-200', () => {
    const { quiz, at } = asked(3);
    answer(quiz, 1, pick('c0'), at);
    answer(quiz, 2, pick('c0'), at + 7500);
    const fx = answer(quiz, 3, pick('c3'), at + 9000);
    expect(quiz.phase).toBe('reveal');
    expect([...quiz.seats.values()].map((s) => s.delta)).toEqual([1000, 600, WRONG_POINTS]);
    expect(fx.filter((e) => e.t === 'pad' && e.spec.k === 'wait').map((e) => [e.to, e.spec.title])).toEqual([
      [1, '正解！ +1000'],
      [2, '正解！ +600'],
      [3, 'ざんねん -200'],
    ]);
    expect(fx.at(-1)?.spec.body).toBe('答え：あ');
  });

  it('時間切れ：締切の1ミリ秒前は続き、締切ちょうどで、つながっていて答えなかった人は-200', () => {
    const { quiz, at } = asked(2);
    answer(quiz, 1, pick('c0'), at + 1500);
    expect(tick(quiz, at + ANSWER_MS - 1)).toEqual([]);
    const fx = tick(quiz, at + ANSWER_MS);
    expect(quiz.phase).toBe('reveal');
    expect(quiz.seats.get(1)?.delta).toBe(pointsFor(1500));
    expect(quiz.seats.get(2)?.delta).toBe(TIMEOUT_POINTS);
    expect(quiz.seats.get(2)?.score).toBe(-200);
    expect(fx.find((e) => e.to === 2)?.spec.title).toBe('時間切れ -200');
  });

  it('締切の1ミリ秒前の正解は200点、締切ちょうどの回答は受けずに時間切れの-200', () => {
    const early = asked(2);
    answer(early.quiz, 1, pick('c0'), early.at + ANSWER_MS - 1);
    tick(early.quiz, early.at + ANSWER_MS);
    expect(early.quiz.seats.get(1)?.delta).toBe(MIN_POINTS);

    const late = asked(2);
    const fx = answer(late.quiz, 1, pick('c0'), late.at + ANSWER_MS);
    expect(late.quiz.phase).toBe('reveal');
    expect(late.quiz.seats.get(1)?.pick).toBe(null);
    expect(late.quiz.seats.get(1)?.delta).toBe(TIMEOUT_POINTS);
    expect(fx.find((e) => e.to === 1)?.spec.title).toBe('時間切れ -200');
  });

  it('答え合わせのあと3.5秒で次の問題。前の問題の答えは持ち越さない', () => {
    const { quiz, at } = asked(2);
    answer(quiz, 1, pick('c0'), at + 100);
    answer(quiz, 2, pick('c0'), at + 100);
    expect(tick(quiz, at + 100 + REVEAL_MS - 1)).toEqual([]);
    const fx = tick(quiz, at + 100 + REVEAL_MS);
    expect(quiz.index).toBe(1);
    expect(fx[0]).toEqual({ t: 'pad', spec: PADS.ask(fixedRounds[1], 2), to: 1 });
    expect(quiz.seats.get(1)?.pick).toBe(null);
  });
});

describe('切断は「いま答えられない」だけ', () => {
  it('切れている人は待たずに締め切り、その問題は0点（減点しない）。スマホには、戻ったときの説明を置く', () => {
    const { quiz, at } = asked(3);
    answer(quiz, 1, pick('c0'), at + 10);
    expect(updatePlayers(quiz, seats(3, [3]), at + 20)).toEqual([]);
    const fx = answer(quiz, 2, pick('c1'), at + 30);
    expect(quiz.phase).toBe('reveal');
    expect(quiz.seats.get(3)).toMatchObject({ delta: AWAY_POINTS, away: true, score: 0 });
    expect(fx.find((e) => e.to === 3)?.spec).toEqual({ k: 'wait', title: 'この問題は0点', body: 'つながっていなかったので、減点はしません。答え：あ' });
    expect(quiz.seats.get(2)?.delta).toBe(WRONG_POINTS);
  });

  it('切れたまま締切を迎えても0点。締切の前に戻れば答えられ、戻って答えなければ-200（境目は締切の時点）', () => {
    const away = asked(2);
    updatePlayers(away.quiz, seats(2, [2]), away.at + 10);
    answer(away.quiz, 1, pick('c0'), away.at + 20); // つながっている人が全員答えたので、すぐ締め切る
    expect(away.quiz.seats.get(2)).toMatchObject({ delta: 0, away: true });

    const back = asked(3);
    updatePlayers(back.quiz, seats(3, [3]), back.at + 10);
    updatePlayers(back.quiz, seats(3), back.at + ANSWER_MS - 1); // 締切の1ミリ秒前に戻った
    answer(back.quiz, 3, pick('c0'), back.at + ANSWER_MS - 1);
    tick(back.quiz, back.at + ANSWER_MS);
    expect(back.quiz.seats.get(3)).toMatchObject({ delta: MIN_POINTS, away: false });
    expect(back.quiz.seats.get(1)?.delta).toBe(TIMEOUT_POINTS);
  });

  it('切れていた問題のあとも点は保ち、次の問題では、つながっていれば普通に数える', () => {
    const { quiz, at } = asked(2);
    answer(quiz, 2, pick('c0'), at);
    tick(quiz, at + ANSWER_MS); // 2は正解、1は時間切れ
    updatePlayers(quiz, seats(2, [2]), at + ANSWER_MS + 10);
    tick(quiz, at + ANSWER_MS + REVEAL_MS);
    answer(quiz, 1, pick('c0'), at + ANSWER_MS + REVEAL_MS); // 2は切れているので、ここで締め切る
    expect(quiz.seats.get(2)).toMatchObject({ score: 1000, delta: 0, away: true });
    updatePlayers(quiz, seats(2), at + ANSWER_MS + REVEAL_MS + 100);
    tick(quiz, at + ANSWER_MS + REVEAL_MS * 2);
    answer(quiz, 2, pick('c1'), at + ANSWER_MS + REVEAL_MS * 2);
    answer(quiz, 1, pick('c0'), at + ANSWER_MS + REVEAL_MS * 2);
    expect(quiz.seats.get(2)).toMatchObject({ score: 800, away: false });
  });

  it('全員が切れているだけなら終わらない。席が全部消えたときだけ終わる', () => {
    const { quiz, at } = asked(2);
    expect(updatePlayers(quiz, seats(2, [1, 2]), at + 10)).toEqual([]);
    expect(quiz.phase).toBe('question');
    const fx = tick(quiz, at + ANSWER_MS);
    expect([...quiz.seats.values()].map((s) => s.delta)).toEqual([0, 0]);
    expect(fx.every((e) => e.t === 'pad')).toBe(true);
  });

  it('札の印：席が消えた人は、どの場面でも「退出」（点はそのまま）。切れているだけなら「切断 0」', () => {
    const { quiz, at } = asked(3);
    answer(quiz, 1, pick('c0'), at);
    expect([1, 2, 3].map((p) => seatTag(quiz, p).text)).toEqual(['回答済み', '', '']);
    // 2は切れただけ、3は席が消えた。つながっている1は答えたので、ここで答え合わせ。
    updatePlayers(quiz, without(seats(3, [2]), 3), at + 10);
    expect(quiz.phase).toBe('reveal');
    expect([1, 2, 3].map((p) => seatTag(quiz, p))).toEqual([
      { text: '+1000', good: true }, { text: '切断 0', good: false }, { text: '退出', good: false },
    ]);
    tick(quiz, at + 10 + REVEAL_MS); // 次の問題でも、席が消えた人は「退出」のまま
    expect(quiz.phase).toBe('question');
    expect([1, 2, 3].map((p) => seatTag(quiz, p).text)).toEqual(['', '', '退出']);
    expect(quiz.seats.get(3)?.score).toBe(0);
    expect(seatTag(quiz, 9)).toEqual({ text: '', good: false });
  });

  it('あとから来た席は入れない', () => {
    const { quiz, at } = asked(2);
    expect(updatePlayers(quiz, [...seats(2), { id: 4, name: 'P4', online: true }], at)).toEqual([]);
    expect(answer(quiz, 4, pick('c0'), at + 10)).toEqual([]);
    expect(quiz.seats.has(4)).toBe(false);
  });

  it('一時停止のあいだは締切が延びる', () => {
    let real = 0;
    const clock = createClock(() => real);
    const quiz = createQuiz(seats(1), fixedRounds, clock.now());
    begin(quiz);
    real = INTRO_MS;
    tick(quiz, clock.now());
    real = INTRO_MS + 5000;
    clock.pause();
    real = INTRO_MS + 65_000;
    expect(tick(quiz, clock.now())).toEqual([]);
    clock.resume();
    real = INTRO_MS + 65_000 + 9_999;
    expect(tick(quiz, clock.now())).toEqual([]);
    expect(quiz.phase).toBe('question');
    real += 1;
    tick(quiz, clock.now());
    expect(quiz.phase).toBe('reveal');
  });
});

describe('終わり方', () => {
  it('1：8問を終えたら end。合計点の高い順で、正解の数をラベルに', () => {
    const { quiz } = asked(3);
    let now = INTRO_MS;
    let last = [];
    for (let i = 0; i < ROUNDS; i++) {
      answer(quiz, 1, pick('c0'), now); // 毎回すぐ正解：+1000
      answer(quiz, 2, pick(i % 2 === 0 ? 'c0' : 'c1'), now + 7500); // 4問正解(+600)・4問まちがい(-200)
      last = tick(quiz, now + ANSWER_MS); // 3は答えない：-200
      now += ANSWER_MS;
      last = [...last, ...tick(quiz, now + REVEAL_MS)];
      now += REVEAL_MS;
    }
    expect(ends(last)[0]).toEqual({
      t: 'end',
      why: 'done',
      results: [
        { p: 1, score: 8000, label: '8問正解' },
        { p: 2, score: 1600, label: '4問正解' },
        { p: 3, score: -1600, label: '0問正解' },
      ],
    });
    expect(tick(quiz, now + 99_999)).toEqual([]);
    expect(answer(quiz, 1, pick('c0'), now)).toEqual([]);
  });

  it('2：全員の席が消えたら end（出題中・説明中・答え合わせ中のどこでも）。消えた人も、そのときの点で結果に載る', () => {
    const during = asked(2);
    answer(during.quiz, 1, pick('c0'), during.at); // 1は+1000
    answer(during.quiz, 2, pick('c1'), during.at); // 2は-200。全員が答えたので答え合わせ
    expect(updatePlayers(during.quiz, without(seats(2), 1), during.at + 10)).toEqual([]);
    tick(during.quiz, during.at + REVEAL_MS); // 第2問へ（1の席はもうない）
    expect(during.quiz.phase).toBe('question');
    expect(ends(updatePlayers(during.quiz, [], during.at + REVEAL_MS + 20))).toEqual([{
      t: 'end',
      why: 'left',
      results: [
        { p: 1, score: 1000, label: '1問正解' },
        { p: 2, score: -200, label: '0問正解' },
      ],
    }]);

    const intro = createQuiz(seats(2), fixedRounds, 0);
    begin(intro);
    expect(ends(updatePlayers(intro, [], 10))).toEqual([{
      t: 'end',
      why: 'left',
      results: [{ p: 1, score: 0, label: '0問正解' }, { p: 2, score: 0, label: '0問正解' }],
    }]);

    const reveal = asked(2);
    answer(reveal.quiz, 1, pick('c0'), reveal.at);
    answer(reveal.quiz, 2, pick('c0'), reveal.at);
    expect(reveal.quiz.phase).toBe('reveal');
    const [end] = ends(updatePlayers(reveal.quiz, [], reveal.at + 10));
    expect(end?.why).toBe('left');
    expect(end?.results.map((r) => [r.p, r.score])).toEqual([[1, 1000], [2, 1000]]);
  });

  it('8問を終えたときも、途中で席が消えた人は、消えたときの点のまま結果に載る（それより後の問題は0点）', () => {
    const { quiz } = asked(3);
    let now = INTRO_MS;
    answer(quiz, 3, pick('c0'), now); // 3は第1問だけ答えて正解（+1000）
    tick(quiz, now + ANSWER_MS); // 1と2は時間切れ（-200）
    updatePlayers(quiz, without(seats(3), 3), now + ANSWER_MS + 10);
    now += ANSWER_MS;
    let last = [];
    for (let i = 0; i < ROUNDS; i++) {
      last = tick(quiz, now + REVEAL_MS);
      now += REVEAL_MS;
      if (i === ROUNDS - 1) break;
      answer(quiz, 1, pick('c0'), now);
      last = answer(quiz, 2, pick('c0'), now); // 3は待たずに締め切る
    }
    expect(ends(last)[0]).toEqual({
      t: 'end',
      why: 'done',
      results: [
        { p: 1, score: 6800, label: '7問正解' },
        { p: 2, score: 6800, label: '7問正解' },
        { p: 3, score: 1000, label: '1問正解' },
      ],
    });
  });

  it('始めた時点で誰もいなければ、すぐ end', () => {
    expect(ends(begin(createQuiz([], fixedRounds, 0)))).toEqual([{ t: 'end', why: 'left', results: [] }]);
  });
});

describe('8人', () => {
  it('3人が切れたまま締め切られても0点、残り5人は正解・まちがい・時間切れで数え、結果は8人ぶん', () => {
    const { quiz, at } = asked(8, [6, 7, 8]);
    answer(quiz, 1, pick('c0'), at);
    answer(quiz, 2, pick('c0'), at + 7500);
    answer(quiz, 3, pick('c1'), at + 100);
    answer(quiz, 4, pick('c2'), at + 100);
    tick(quiz, at + ANSWER_MS); // 5 は時間切れ
    expect([...quiz.seats].map(([p, s]) => [p, s.delta, s.away])).toEqual([
      [1, 1000, false], [2, 600, false], [3, -200, false], [4, -200, false],
      [5, -200, false], [6, 0, true], [7, 0, true], [8, 0, true],
    ]);
    expect(results(quiz).map((r) => [r.p, r.score])).toEqual([[1, 1000], [2, 600], [6, 0], [7, 0], [8, 0], [3, -200], [4, -200], [5, -200]]);
  });
});

describe('コンソールに渡す形', () => {
  it('どの問題でも、画面の文字は上限内（選択肢12・ヒント40・見出し24・本文120）', () => {
    for (const q of QUESTIONS) {
      const r = toRound(q, makeRng(1));
      for (const spec of [PADS.ask(r, 8), ...r.choices.map((c) => PADS.ask(r, 8, c.id))]) {
        expect(spec.options).toHaveLength(4);
        expect(graphemes(spec.hint)).toBeLessThanOrEqual(40);
        for (const o of spec.options) expect(o.id).toMatch(/^[a-z0-9_-]{1,24}$/);
      }
      const seatsToTry = [
        { pick: null, delta: -200, away: false },
        { pick: r.answer, delta: 1000, away: false },
        { pick: 'zz', delta: -200, away: false },
        { pick: null, delta: 0, away: true },
      ];
      for (const seat of seatsToTry) {
        const spec = PADS.reveal(r, seat);
        expect(graphemes(spec.title)).toBeLessThanOrEqual(24);
        expect(graphemes(spec.body)).toBeLessThanOrEqual(120);
      }
    }
    expect(graphemes(PADS.intro.title)).toBeLessThanOrEqual(24);
    expect(graphemes(PADS.intro.body)).toBeLessThanOrEqual(120);
    expect(PADS.intro.body).toContain('押し直しはできない');
  });
});
