// 連打レースの規則の試験。終わり方は3つ（全員完走・時間切れ・全員退出）で、どれも end まで通す。
// 切断の扱い：online が偽なのは「いま押せない」だけで、回数を保ち、戻れば続きから押せる。席が消えたときだけ棄権。
import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS, OUT_LABEL, PADS, POINTS, RACE_MS, TAPS_TO_FINISH,
  begin, createClock, createRace, results, standings, tap, tick, updatePlayers,
} from './logic.js';

const seats = (n, offline = []) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, online: !offline.includes(i + 1) }));
/** 席の一覧から、指定の席を消す（猶予切れ・退出・外された）。 */
const without = (list, ...gone) => list.filter((s) => !gone.includes(s.id));
const press = { k: 'btn', id: 'buzzer', d: 1 };
const release = { k: 'btn', id: 'buzzer', d: 0 };
const ends = (effects) => effects.filter((e) => e.t === 'end');

/** スタートの合図まで進めたレース。時計は 0 から始める。 */
function started(n = 3, offline = []) {
  const race = createRace(seats(n, offline), 0);
  begin(race);
  tick(race, COUNTDOWN_MS);
  return race;
}
const go = COUNTDOWN_MS;

/** p に count 回たたかせる。最後の効果を返す。T は時刻と同じにする。 */
function mash(race, p, count, at) {
  let last = [];
  for (let i = 0; i < count; i++) last = tap(race, p, press, at, at);
  return last;
}

describe('始まり', () => {
  it('始めた時点の席は、切れている席も含めて全員が走者。最初の画面は「よーい」', () => {
    const race = createRace(seats(3, [3]), 0);
    expect([...race.runners.keys()]).toEqual([1, 2, 3]);
    expect(race.runners.get(3)?.online).toBe(false);
    expect(begin(race)).toEqual([
      { t: 'pad', spec: PADS.ready, to: 1 },
      { t: 'pad', spec: PADS.ready, to: 2 },
      { t: 'pad', spec: PADS.ready, to: 3 },
    ]);
  });

  it('3・2・1のあいだは何もしない。合図の時刻ちょうどで、切れている人にも連打の画面（戻ったときに出る）と振動', () => {
    const race = createRace(seats(2, [2]), 0);
    begin(race);
    expect(tick(race, go - 1)).toEqual([]);
    expect(race.phase).toBe('count');
    const fx = tick(race, go);
    expect(race.phase).toBe('race');
    expect(fx).toEqual([
      { t: 'pad', spec: PADS.race, to: 1 },
      { t: 'pad', spec: PADS.race, to: 2 },
      { t: 'buzz', ms: [80], to: 'all' },
    ]);
  });

  it('合図の前の連打・離す動き・別のボタン・走者でない席は数えない', () => {
    const race = createRace(seats(2), 0);
    begin(race);
    tap(race, 1, press, go - 1, go - 1);
    expect(race.runners.get(1)?.taps).toBe(0);
    tick(race, go);
    tap(race, 1, release, go + 10, go + 10);
    tap(race, 1, { k: 'btn', id: 'other', d: 1 }, go + 10, go + 10);
    tap(race, 1, { k: 'pick', id: 'buzzer' }, go + 10, go + 10);
    tap(race, 7, press, go + 10, go + 10);
    expect(race.runners.get(1)?.taps).toBe(0);
    expect(race.runners.has(7)).toBe(false);
  });
});

describe('完走', () => {
  it('39回では完走しない。40回目で完走し、その人に順位の画面と振動', () => {
    const race = started(3);
    expect(mash(race, 1, TAPS_TO_FINISH - 1, go + 1000)).toEqual([]);
    expect(race.runners.get(1)?.state).toBe('run');
    const fx = tap(race, 1, press, go + 2000, go + 2000);
    expect(race.runners.get(1)?.state).toBe('done');
    expect(fx).toEqual([
      { t: 'pad', spec: PADS.done(1, '2.00秒'), to: 1 },
      { t: 'buzz', ms: [40, 60, 40], to: 1 },
    ]);
    // 完走した人の連打は、もう数えない。
    tap(race, 1, press, go + 2100, go + 2100);
    expect(race.runners.get(1)?.taps).toBe(TAPS_TO_FINISH);
  });

  it('終わり方1：全員完走で end。順位の得点と秒数', () => {
    const race = started(3);
    mash(race, 2, TAPS_TO_FINISH, go + 4000);
    mash(race, 1, TAPS_TO_FINISH, go + 5500);
    const fx = mash(race, 3, TAPS_TO_FINISH, go + 9000);
    expect(ends(fx)[0]).toEqual({
      t: 'end',
      why: 'finish',
      results: [
        { p: 2, score: 800, label: '4.00秒' },
        { p: 1, score: 600, label: '5.50秒' },
        { p: 3, score: 500, label: '9.00秒' },
      ],
    });
    expect(race.phase).toBe('over');
  });

  it('順位は届いた順でなく T（サーバーの受信時刻）で決める。T が同じなら同じ順位', () => {
    const race = started(3);
    mash(race, 1, TAPS_TO_FINISH - 1, go + 100);
    mash(race, 2, TAPS_TO_FINISH - 1, go + 100);
    mash(race, 3, TAPS_TO_FINISH - 1, go + 100);
    tap(race, 1, press, go + 3000, 5_000_020);
    tap(race, 2, press, go + 3001, 5_000_010); // あとで届いたが、サーバーは先に受け取った
    const [end] = ends(tap(race, 3, press, go + 3002, 5_000_010));
    expect(end.results).toEqual([
      { p: 2, score: 800, label: '3.00秒' },
      { p: 3, score: 800, label: '3.00秒' },
      { p: 1, score: 500, label: '3.00秒' },
    ]);
  });

  it('完走の秒は0.01秒まで出す。0.01秒ちがいのゴールは、表示も分かれる（0.1秒だと、どちらも「11.6秒」だった）', () => {
    const race = started(2);
    mash(race, 1, TAPS_TO_FINISH, go + 11_630);
    const [end] = ends(mash(race, 2, TAPS_TO_FINISH, go + 11_640));
    expect(end.results).toEqual([
      { p: 1, score: 800, label: '11.63秒' },
      { p: 2, score: 600, label: '11.64秒' },
    ]);
  });
});

describe('時間切れ', () => {
  it('終わり方2：締切の1ミリ秒前は続き、締切ちょうどで end。完走した人が先、残りはたたいた数の順', () => {
    const race = started(4);
    mash(race, 3, TAPS_TO_FINISH, go + 8000);
    mash(race, 1, 25, go + 9000);
    mash(race, 2, 30, go + 9000);
    mash(race, 4, 25, go + 9000);
    expect(tick(race, go + RACE_MS - 1)).toEqual([]);
    const [end] = ends(tick(race, go + RACE_MS));
    expect(end.why).toBe('time');
    expect(end.results).toEqual([
      { p: 3, score: 800, label: '8.00秒' },
      { p: 2, score: 600, label: '30回' },
      { p: 1, score: 500, label: '25回' },
      { p: 4, score: 500, label: '25回' },
    ]);
  });

  it('1回もたたかなかった人は0点で最下位。1回でもたたけば、その順位の点', () => {
    const race = started(4);
    mash(race, 2, 1, go + 500);
    const [end] = ends(tick(race, go + RACE_MS));
    expect(end.results).toEqual([
      { p: 2, score: 800, label: '1回' },
      { p: 1, score: 0, label: '0回' },
      { p: 3, score: 0, label: '0回' },
      { p: 4, score: 0, label: '0回' },
    ]);
  });

  it('40回目が締切の1ミリ秒前なら完走、締切ちょうどなら数えずに時間切れ', () => {
    const early = started(2);
    mash(early, 1, TAPS_TO_FINISH - 1, go + 100);
    tap(early, 1, press, go + RACE_MS - 1, go + RACE_MS - 1);
    expect(early.runners.get(1)?.state).toBe('done');
    expect(early.phase).toBe('race');

    const late = started(2);
    mash(late, 1, TAPS_TO_FINISH - 1, go + 100);
    const [end] = ends(tap(late, 1, press, go + RACE_MS, go + RACE_MS));
    expect(late.runners.get(1)?.taps).toBe(TAPS_TO_FINISH - 1);
    expect(end.why).toBe('time');
    expect(end.results).toEqual([
      { p: 1, score: 800, label: '39回' },
      { p: 2, score: 0, label: '0回' },
    ]);
  });

  it('一時停止のあいだは時計が止まり、締切も延びる', () => {
    let real = 0;
    const clock = createClock(() => real);
    const race = createRace(seats(2), clock.now());
    begin(race);
    real = go;
    tick(race, clock.now());
    real = go + 10_000;
    clock.pause();
    real = go + 60_000; // 50秒止めていた
    expect(clock.now()).toBe(go + 10_000);
    expect(tick(race, clock.now())).toEqual([]);
    clock.resume();
    clock.resume(); // 二度呼んでも壊れない
    real = go + 60_000 + 19_999;
    expect(tick(race, clock.now())).toEqual([]);
    real = go + 60_000 + 20_000;
    expect(ends(tick(race, clock.now()))[0]?.why).toBe('time');
  });
});

describe('切断は「いま押せない」だけ。席が消えたら棄権', () => {
  it('一瞬切れて、すぐ戻ったら、回数を保ったまま続きから押せる（偽の時計で）', () => {
    let real = 0;
    const clock = createClock(() => real);
    const race = createRace(seats(3), clock.now());
    begin(race);
    real = go;
    tick(race, clock.now());
    real = go + 1000;
    mash(race, 2, 5, clock.now());
    expect(updatePlayers(race, seats(3, [2]))).toEqual([]);
    expect(race.runners.get(2)).toMatchObject({ state: 'run', taps: 5, online: false });
    real = go + 1300; // 300ms で戻った
    expect(updatePlayers(race, seats(3))).toEqual([]);
    expect(race.runners.get(2)).toMatchObject({ state: 'run', taps: 5, online: true });
    mash(race, 2, TAPS_TO_FINISH - 5, clock.now());
    expect(race.runners.get(2)?.state).toBe('done');
    expect(standings(race).find((s) => s.p === 2)).toMatchObject({ rank: 1, points: 800, label: '1.30秒' });
  });

  it('猶予のあいだ（切れてから席が消えるまで）は参加者のまま。消えたときに棄権になり、結果に「棄権」0点で残る', () => {
    const race = started(3);
    mash(race, 1, 30, go + 500);
    updatePlayers(race, seats(3, [1]));
    tick(race, go + RACE_MS - 1); // 猶予の途中（締切の直前）まで切れたまま
    expect(race.runners.get(1)).toMatchObject({ state: 'run', taps: 30 });
    updatePlayers(race, without(seats(3), 1)); // 猶予が切れて、席が消えた
    expect(race.runners.get(1)?.state).toBe('out');
    // 棄権したあとは、同じ番号の入力も数えない。
    tap(race, 1, press, go + RACE_MS - 1, go + RACE_MS - 1);
    expect(race.runners.get(1)?.taps).toBe(30);
    mash(race, 2, 3, go + 1000);
    const [end] = ends(tick(race, go + RACE_MS));
    expect(end.results).toEqual([
      { p: 2, score: 800, label: '3回' },
      { p: 3, score: 0, label: '0回' },
      { p: 1, score: 0, label: OUT_LABEL },
    ]);
  });

  it('全員完走は、まだ席にいる人で見る。切れている人は、戻るか時間切れになるまで待つ', () => {
    const race = started(3);
    mash(race, 1, TAPS_TO_FINISH, go + 2000);
    mash(race, 2, TAPS_TO_FINISH, go + 3000);
    updatePlayers(race, seats(3, [3]));
    expect(race.phase).toBe('race');
    const [end] = ends(tick(race, go + RACE_MS));
    expect(end.why).toBe('time');
    expect(end.results.map((r) => [r.p, r.score, r.label])).toEqual([
      [1, 800, '2.00秒'],
      [2, 600, '3.00秒'],
      [3, 0, '0回'],
    ]);
  });

  it('席が消えた人を除いた全員が完走したら、その時点で全員完走。棄権した人も結果に残る', () => {
    const race = started(3);
    mash(race, 3, 12, go + 500);
    updatePlayers(race, without(seats(3), 3));
    mash(race, 1, TAPS_TO_FINISH, go + 2000);
    const [end] = ends(mash(race, 2, TAPS_TO_FINISH, go + 2500));
    expect(end.why).toBe('finish');
    expect(end.results).toEqual([
      { p: 1, score: 800, label: '2.00秒' },
      { p: 2, score: 600, label: '2.50秒' },
      { p: 3, score: 0, label: OUT_LABEL },
    ]);
  });

  it('完走したあとで切れても、退出して席が消えても、記録と点は結果に残る', () => {
    const race = started(3);
    mash(race, 1, TAPS_TO_FINISH, go + 5000);
    updatePlayers(race, without(seats(3, [2]), 1));
    mash(race, 2, TAPS_TO_FINISH, go + 6000);
    expect(race.phase).toBe('race');
    const [end] = ends(mash(race, 3, TAPS_TO_FINISH, go + 7000));
    expect(end.results).toEqual([
      { p: 1, score: 800, label: '5.00秒' },
      { p: 2, score: 600, label: '6.00秒' },
      { p: 3, score: 500, label: '7.00秒' },
    ]);
  });

  it('全員が切れているだけなら終わらない（時間切れまで待つ）', () => {
    const race = started(2);
    expect(updatePlayers(race, seats(2, [1, 2]))).toEqual([]);
    expect(race.phase).toBe('race');
  });

  it('終わり方3：全員の席が消えたら end。全員「棄権」0点で結果に残る', () => {
    const race = started(3);
    mash(race, 2, 12, go + 500);
    expect(updatePlayers(race, [{ id: 1, name: 'P1', online: true }])).toEqual([]);
    const [end] = ends(updatePlayers(race, []));
    expect(end).toEqual({
      t: 'end',
      why: 'left',
      results: [1, 2, 3].map((p) => ({ p, score: 0, label: OUT_LABEL })),
    });
    expect(race.phase).toBe('over');
  });

  it('3・2・1のあいだに全員の席が消えても end。始めた時点で誰もいなければ、すぐ end', () => {
    const race = createRace(seats(2), 0);
    begin(race);
    expect(ends(updatePlayers(race, []))[0]?.why).toBe('left');
    expect(ends(begin(createRace([], 0)))).toEqual([{ t: 'end', why: 'left', results: [] }]);
  });

  it('あとから来た席はこのレースに入らず、連打も数えない', () => {
    const race = started(2);
    expect(updatePlayers(race, [...seats(2), { id: 5, name: 'P5', online: true }])).toEqual([]);
    expect(tap(race, 5, press, go + 10, go + 10)).toEqual([]);
    expect(race.runners.has(5)).toBe(false);
  });
});

describe('8人', () => {
  it('完走3人・途中2人・0回2人・棄権1人の時間切れ：点は 800・600・500・400・300、0回と棄権は0点', () => {
    const race = started(8);
    mash(race, 4, TAPS_TO_FINISH, go + 4000);
    mash(race, 7, TAPS_TO_FINISH, go + 5000);
    mash(race, 1, TAPS_TO_FINISH, go + 6000);
    mash(race, 2, 20, go + 7000);
    mash(race, 8, 3, go + 7000);
    mash(race, 6, 9, go + 7000);
    updatePlayers(race, without(seats(8, [5]), 6)); // 5は切れているだけ、6は席が消えた
    const [end] = ends(tick(race, go + RACE_MS));
    expect(end.results).toEqual([
      { p: 4, score: 800, label: '4.00秒' },
      { p: 7, score: 600, label: '5.00秒' },
      { p: 1, score: 500, label: '6.00秒' },
      { p: 2, score: 400, label: '20回' },
      { p: 8, score: 300, label: '3回' },
      { p: 3, score: 0, label: '0回' },
      { p: 5, score: 0, label: '0回' },
      { p: 6, score: 0, label: OUT_LABEL },
    ]);
  });

  it('8人全員が完走すれば、得点表のとおり', () => {
    const race = started(8);
    for (let p = 1; p <= 8; p++) mash(race, p, TAPS_TO_FINISH, go + p * 1000);
    expect(results(race).map((r) => r.score)).toEqual(POINTS);
  });
});

describe('終わったあと', () => {
  it('end は1回だけ。そのあとの入力・時計・席の変化では何も起きない', () => {
    const race = started(2);
    ends(tick(race, go + RACE_MS));
    expect(tap(race, 1, press, go + RACE_MS + 1, 0)).toEqual([]);
    expect(tick(race, go + RACE_MS + 5000)).toEqual([]);
    expect(updatePlayers(race, [])).toEqual([]);
  });
});

describe('コンソールに渡す形', () => {
  const graphemes = (s) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)].length;

  it('画面の文字は上限内（ボタン12・ヒント40・見出し24・本文120）', () => {
    for (const s of [PADS.ready, PADS.race, PADS.done(8, '29.99秒')]) {
      if ('label' in s) expect(graphemes(s.label)).toBeLessThanOrEqual(12);
      if ('hint' in s && s.hint) expect(graphemes(s.hint)).toBeLessThanOrEqual(40);
      if ('title' in s && s.title) expect(graphemes(s.title)).toBeLessThanOrEqual(24);
      if ('body' in s && s.body) expect(graphemes(s.body)).toBeLessThanOrEqual(120);
    }
  });

  it('得点表と、結果のラベルの長さ・席の重複', () => {
    expect(POINTS).toEqual([800, 600, 500, 400, 300, 200, 100, 50]);
    const race = started(8);
    for (let p = 1; p <= 8; p++) mash(race, p, TAPS_TO_FINISH, go + p * 1000);
    const list = results(race);
    expect(new Set(list.map((r) => r.p)).size).toBe(8);
    for (const r of list) expect(graphemes(r.label)).toBeLessThanOrEqual(12);
    expect(standings(race).every((s) => s.done)).toBe(true);
  });
});
