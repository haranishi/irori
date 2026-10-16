// あつめて点の規則の試験。終わり方は2つ（時間切れ・全員退出）で、どちらも end まで通す。
// 切断の扱い：online が偽なのは「いま動かせない」だけ。席が全部消えたときだけ終わる。
import { describe, expect, it } from 'vitest';
import {
  AXIS_HOLD_MS, BOUNDS, DOT_R, GAME_MS, INTRO_MS, MAX_DOTS, MAX_DT, MOVER_R, PADS, RESPAWN_MS, SPAWN_GAP, SPEED,
  begin, createClock, createField, handleInput, makeRng, results, segmentDistance, step, updatePlayers,
} from './logic.js';

const seats = (n, offline = []) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, online: !offline.includes(i + 1) }));
const axis = (x, y) => ({ k: 'axis', id: 'stick', x, y });
const ends = (effects) => effects.filter((e) => e.t === 'end');

/** 遊び始めたところ（点8つが出た直後）。時刻は INTRO_MS。 */
function playing(n = 2, offline = [], seed = 1) {
  const field = createField(seats(n, offline), 0, makeRng(seed));
  begin(field);
  step(field, 0, INTRO_MS);
  return field;
}
const t0 = INTRO_MS;

/** fps の速さで、seconds 秒ぶん step を回す。 */
function run(field, fps, seconds, from) {
  const frames = Math.round(fps * seconds);
  let effects = [];
  for (let i = 1; i <= frames; i++) effects = [...effects, ...step(field, 1 / fps, from + (i * 1000) / fps)];
  return effects;
}

describe('始まり', () => {
  it('始めた時点の席を、切れている席も含めて円の上に置く。説明の3秒のあいだは動かない', () => {
    const field = createField(seats(3, [2]), 0, makeRng(1));
    expect([...field.movers.keys()]).toEqual([1, 2, 3]);
    expect(field.movers.get(2)?.online).toBe(false);
    expect(begin(field)).toEqual([1, 2, 3].map((to) => ({ t: 'pad', spec: PADS.intro, to })));
    handleInput(field, 1, axis(1, 0), 100);
    const x = field.movers.get(1).x;
    expect(step(field, 0.1, INTRO_MS - 1)).toEqual([]);
    expect(field.movers.get(1).x).toBe(x);
    const fx = step(field, 0.1, INTRO_MS);
    expect(field.phase).toBe('play');
    expect(fx).toEqual([1, 2, 3].map((to) => ({ t: 'pad', spec: PADS.play, to })));
    expect(field.dots).toHaveLength(MAX_DOTS);
  });

  it('始めた時点で誰もいなければ、すぐ end。全員が切れているだけなら始める', () => {
    expect(ends(begin(createField([], 0, makeRng(1))))).toEqual([{ t: 'end', why: 'left', results: [] }]);
    expect(ends(begin(createField(seats(2, [1, 2]), 0, makeRng(1))))).toEqual([]);
  });

  it('点は、誰かのすぐ近くと、ほかの点の上には出さない', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const field = playing(4, [], seed);
      for (const d of field.dots) {
        for (const m of field.movers.values()) expect(Math.hypot(m.x - d.x, m.y - d.y)).toBeGreaterThanOrEqual(SPAWN_GAP);
        expect(d.x).toBeGreaterThanOrEqual(BOUNDS.left);
        expect(d.y).toBeLessThanOrEqual(BOUNDS.bottom);
      }
    }
  });
});

describe('動き', () => {
  it('dt で進めるので、20fps・60fps・144fps のどれでも1秒で同じだけ動く', () => {
    const moved = (fps) => {
      const field = playing(1);
      field.dots = [];
      const m = field.movers.get(1);
      const x0 = m.x;
      handleInput(field, 1, axis(1, 0), t0);
      run(field, fps, 1, t0);
      return m.x - x0;
    };
    expect(moved(60)).toBeCloseTo(SPEED, 5);
    expect(moved(20)).toBeCloseTo(SPEED, 5);
    expect(moved(144)).toBeCloseTo(SPEED, 5);
  });

  it('止まっていたタブが戻ったときの大きな dt は、MAX_DT に抑える', () => {
    const field = playing(1);
    field.dots = [];
    const m = field.movers.get(1);
    const x0 = m.x;
    handleInput(field, 1, axis(1, 0), t0);
    step(field, 5, t0 + 100);
    expect(m.x - x0).toBeCloseTo(SPEED * MAX_DT, 5);
  });

  it('最後のスティックの入力から3秒（の1ミリ秒前）までは動き、3秒ちょうどで止まる。入力が来れば、また動く', () => {
    const field = playing(1);
    field.dots = [];
    const m = field.movers.get(1);
    handleInput(field, 1, axis(0, 1), t0);
    m.y = BOUNDS.top;
    step(field, 0.01, t0 + AXIS_HOLD_MS - 1);
    const y1 = m.y;
    expect(y1).toBeGreaterThan(BOUNDS.top);
    step(field, 0.01, t0 + AXIS_HOLD_MS);
    expect(m.y).toBe(y1);
    handleInput(field, 1, axis(0, 1), t0 + AXIS_HOLD_MS + 5);
    step(field, 0.01, t0 + AXIS_HOLD_MS + 10);
    expect(m.y).toBeGreaterThan(y1);
  });

  it('席が切れたら、その場で止める', () => {
    const field = playing(2);
    field.dots = [];
    const m = field.movers.get(1);
    handleInput(field, 1, axis(1, 0), t0);
    updatePlayers(field, seats(2, [1]));
    const x = m.x;
    step(field, 0.05, t0 + 50);
    expect(m.x).toBe(x);
  });

  it('動ける範囲の外へは出ない。スティック以外の入力と、参加者でない席は無視する', () => {
    const field = playing(1);
    field.dots = [];
    handleInput(field, 1, axis(-1, -1), t0);
    handleInput(field, 1, { k: 'btn', id: 'a', d: 1 }, t0);
    handleInput(field, 7, axis(1, 1), t0);
    run(field, 30, 1.9, t0);
    expect(field.movers.get(1)).toMatchObject({ x: BOUNDS.left, y: BOUNDS.top });
    expect(field.movers.has(7)).toBe(false);
  });
});

describe('点を取る', () => {
  it('触れたら1点。その人だけを振動させ、点は0.7秒たってから別の場所に出直す', () => {
    const field = playing(2);
    const m = field.movers.get(1);
    field.dots = [{ x: m.x + 40, y: m.y, live: true, at: 0 }];
    handleInput(field, 1, axis(1, 0), t0);
    const fx = step(field, 0.05, t0 + 50);
    expect(m.score).toBe(1);
    expect(fx).toEqual([{ t: 'buzz', ms: [30], to: 1 }]);
    expect(field.dots[0].live).toBe(false);
    step(field, 0, t0 + 50 + RESPAWN_MS - 1);
    expect(field.dots[0].live).toBe(false);
    step(field, 0, t0 + 50 + RESPAWN_MS);
    expect(field.dots[0].live).toBe(true);
    expect(field.dots).toHaveLength(1);
  });

  it('1フレームで点を飛び越えても、通った道すじで取れる', () => {
    const field = playing(1);
    const m = field.movers.get(1);
    m.x = BOUNDS.left + 10;
    field.dots = [{ x: m.x + 20, y: m.y + MOVER_R + DOT_R - 1, live: true, at: 0 }];
    handleInput(field, 1, axis(1, 0), t0);
    step(field, MAX_DT, t0 + 100); // 30px 進む。終点では点から離れている
    expect(Math.hypot(m.x - field.dots[0].x, m.y - (m.y + MOVER_R + DOT_R - 1))).toBeGreaterThan(MOVER_R + DOT_R);
    expect(m.score).toBe(1);
  });

  it('2人が同じ点に触れたら、近いほうが取る', () => {
    const field = playing(2);
    const a = field.movers.get(1);
    const b = field.movers.get(2);
    a.x = 300;
    a.y = 300;
    b.x = 340;
    b.y = 300;
    field.dots = [{ x: 325, y: 300, live: true, at: 0 }];
    step(field, 0.016, t0 + 16);
    expect([a.score, b.score]).toEqual([0, 1]);
  });

  it('点と線分の距離', () => {
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });
});

describe('終わり方', () => {
  it('1：45秒たったら end（1ミリ秒前は続く）。取った数の多い順', () => {
    const field = playing(3);
    field.movers.get(1).score = 4;
    field.movers.get(2).score = 9;
    field.movers.get(3).score = 4;
    field.dots = [];
    expect(ends(step(field, 0.016, t0 + GAME_MS - 1))).toEqual([]);
    const [end] = ends(step(field, 0.016, t0 + GAME_MS));
    expect(end).toEqual({
      t: 'end',
      why: 'time',
      results: [
        { p: 2, score: 9, label: '9こ' },
        { p: 1, score: 4, label: '4こ' },
        { p: 3, score: 4, label: '4こ' },
      ],
    });
    expect(step(field, 0.016, t0 + GAME_MS + 16)).toEqual([]);
    expect(updatePlayers(field, [])).toEqual([]);
  });

  it('2：全員の席が消えたら end。全員が切れているだけなら、点を保って続く', () => {
    const field = playing(3);
    field.movers.get(3).score = 2;
    expect(updatePlayers(field, seats(3, [1, 2, 3]))).toEqual([]);
    expect(field.phase).toBe('play');
    expect(updatePlayers(field, seats(3))).toEqual([]);
    expect(field.movers.get(3)).toMatchObject({ online: true, score: 2 });
    expect(updatePlayers(field, [{ id: 3, name: 'P3', online: false }])).toEqual([]);
    const [end] = ends(updatePlayers(field, []));
    expect(end).toEqual({ t: 'end', why: 'left', results: [] });
  });

  it('説明のあいだに全員の席が消えても end', () => {
    const field = createField(seats(2), 0, makeRng(1));
    begin(field);
    expect(ends(updatePlayers(field, []))[0]?.why).toBe('left');
  });

  it('あとから来た席は入れない', () => {
    const field = playing(1);
    expect(updatePlayers(field, [...seats(1), { id: 3, name: 'P3', online: true }])).toEqual([]);
    expect(field.movers.has(3)).toBe(false);
    expect(results(field).map((r) => r.p)).toEqual([1]);
  });

  it('一時停止のあいだは時計が止まり、終わりも延びる', () => {
    let real = 0;
    const clock = createClock(() => real);
    const field = createField(seats(1), clock.now(), makeRng(2));
    begin(field);
    real = INTRO_MS;
    step(field, 0, clock.now());
    real = INTRO_MS + 1000;
    clock.pause();
    real = INTRO_MS + 100_000;
    expect(ends(step(field, 0, clock.now()))).toEqual([]);
    clock.resume();
    real = INTRO_MS + 100_000 + GAME_MS - 1000 - 1;
    expect(ends(step(field, 0, clock.now()))).toEqual([]);
    real += 1;
    expect(ends(step(field, 0, clock.now()))[0]?.why).toBe('time');
  });
});

describe('コンソールに渡す形', () => {
  it('画面の文字は上限内（ヒント40・見出し24・本文120）', () => {
    const graphemes = (s) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)].length;
    expect(graphemes(PADS.play.hint)).toBeLessThanOrEqual(40);
    for (const s of [PADS.intro]) {
      expect(graphemes(s.title)).toBeLessThanOrEqual(24);
      expect(graphemes(s.body)).toBeLessThanOrEqual(120);
    }
  });
});
