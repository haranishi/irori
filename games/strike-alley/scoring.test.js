import { describe, expect, it } from 'vitest';
import { nextTurn, perfectScore, scoreCard } from './scoring.js';

/** 照合用の、別の書き方の得点計算（教科書どおりの指で進める形）。 */
function reference(rolls, frames) {
  let i = 0;
  let total = 0;
  for (let f = 0; f < frames; f++) {
    if (f === frames - 1) {
      total += rolls.slice(i).reduce((a, b) => a + b, 0);
      break;
    }
    if (rolls[i] === 10) {
      total += 10 + rolls[i + 1] + rolls[i + 2];
      i += 1;
    } else if (rolls[i] + rolls[i + 1] === 10) {
      total += 10 + rolls[i + 2];
      i += 2;
    } else {
      total += rolls[i] + rolls[i + 1];
      i += 2;
    }
  }
  return total;
}

/** 種つきの乱数（試験の再現のため）。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 規則どおりの無作為な1ゲーム。 */
function randomGame(frames, rand) {
  const rolls = [];
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(rand() * 11);
    rolls.push(a);
    if (f < frames - 1) {
      if (a < 10) rolls.push(Math.floor(rand() * (11 - a)));
      continue;
    }
    const b = Math.floor(rand() * (a === 10 ? 11 : 11 - a));
    rolls.push(b);
    if (a === 10) rolls.push(Math.floor(rand() * (b === 10 ? 11 : 11 - b)));
    else if (a + b === 10) rolls.push(Math.floor(rand() * 11));
  }
  return rolls;
}

describe('満点・全ガター・全スペア', () => {
  it('10フレームの満点は300（12投すべてストライク）', () => {
    const card = scoreCard(Array(12).fill(10), 10);
    expect(card.total).toBe(300);
    expect(card.complete).toBe(true);
    expect(card.frames.map((f) => f.cumulative)).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
    expect(card.frames[0].marks).toEqual(['', 'X']);
    expect(card.frames[9].marks).toEqual(['X', 'X', 'X']);
    expect(perfectScore(10)).toBe(300);
  });
  it('5フレームの満点は150（7投すべてストライク）で、最後のフレームを同じ規則で数える', () => {
    const card = scoreCard(Array(7).fill(10), 5);
    expect(card.total).toBe(150);
    expect(card.complete).toBe(true);
    expect(card.frames).toHaveLength(5);
    expect(card.frames[4].marks).toEqual(['X', 'X', 'X']);
    expect(perfectScore(5)).toBe(150);
  });
  it('全ガターは0点で、表示はすべて −', () => {
    const card = scoreCard(Array(20).fill(0), 10);
    expect(card.total).toBe(0);
    expect(card.complete).toBe(true);
    expect(card.frames.every((f) => f.marks.filter(Boolean).every((m) => m === '−'))).toBe(true);
    expect(card.frames[9].marks).toEqual(['−', '−', '']);
  });
  it('毎回5本の全スペアは150点（最後のボーナスも5本）', () => {
    const card = scoreCard(Array(21).fill(5), 10);
    expect(card.total).toBe(150);
    expect(card.frames[0].marks).toEqual(['5', '/']);
    expect(card.frames[9].marks).toEqual(['5', '/', '5']);
    expect(scoreCard(Array(11).fill(5), 5).total).toBe(75);
  });
});

describe('途中のフレーム', () => {
  it('ボーナスの球がそろうまで、累計は null。合計は投げた分だけ足す', () => {
    let card = scoreCard([10], 10);
    expect(card.frames[0].cumulative).toBeNull();
    expect(card.total).toBe(10);
    expect(card.complete).toBe(false);
    card = scoreCard([10, 7], 10);
    expect(card.frames[0].cumulative).toBeNull();
    expect(card.frames[1].marks).toEqual(['7', '']);
    expect(card.total).toBe(24);
    card = scoreCard([10, 7, 2], 10);
    expect(card.frames.slice(0, 2).map((f) => f.cumulative)).toEqual([19, 28]);
    expect(card.total).toBe(28);
    card = scoreCard([6, 4], 10);
    expect(card.frames[0].marks).toEqual(['6', '/']);
    expect(card.frames[0].cumulative).toBeNull();
    card = scoreCard([6, 4, 0], 10);
    expect(card.frames[0].cumulative).toBe(10);
    expect(card.frames[1].marks).toEqual(['−', '']);
  });
  it('前のフレームが未確定なら、あとの累計も null のまま（確定した点だけを積む）', () => {
    const card = scoreCard([10, 3, 4], 10);
    expect(card.frames.map((f) => f.cumulative).slice(0, 3)).toEqual([17, 24, null]);
    const open = scoreCard([10, 10, 3], 10);
    expect(open.frames.map((f) => f.cumulative).slice(0, 3)).toEqual([23, null, null]);
    expect(open.total).toBe(10 + 10 + 3 + 10 + 3 + 3);
  });
});

describe('最後のフレームの全パターン', () => {
  const cases = [];
  for (let a = 0; a <= 10; a++) {
    if (a === 10) {
      for (let b = 0; b <= 10; b++) {
        if (b === 10) for (let c = 0; c <= 10; c++) cases.push([a, b, c]);
        else for (let c = 0; c <= 10 - b; c++) cases.push([a, b, c]);
      }
    } else {
      for (let b = 0; b <= 10 - a; b++) {
        if (a + b === 10) for (let c = 0; c <= 10; c++) cases.push([a, b, c]);
        else cases.push([a, b]);
      }
    }
  }
  it.each([5, 10])('%iフレーム：全241通りで、点・表示・終了・次の球がそろう', (frames) => {
    const pre = Array((frames - 1) * 2).fill(0);
    expect(cases).toHaveLength(241);
    for (const balls of cases) {
      const card = scoreCard([...pre, ...balls], frames);
      expect(card.total).toBe(balls.reduce((x, y) => x + y, 0));
      expect(card.complete).toBe(true);
      expect(nextTurn([...pre, ...balls], frames).done).toBe(true);
      const marks = card.frames[frames - 1].marks;
      const [a, b, c] = balls;
      expect(marks[0]).toBe(a === 10 ? 'X' : a === 0 ? '−' : String(a));
      if (a === 10) expect(marks[1]).toBe(b === 10 ? 'X' : b === 0 ? '−' : String(b));
      else expect(marks[1]).toBe(a + b === 10 ? '/' : b === 0 ? '−' : String(b));
      if (c === undefined) expect(marks[2]).toBe('');
      else if (a === 10 && b !== 10) expect(marks[2]).toBe(b + c === 10 ? '/' : c === 0 ? '−' : String(c));
      else expect(marks[2]).toBe(c === 10 ? 'X' : c === 0 ? '−' : String(c));
      // 3投目の前の状態：立て直すか、何本残っているか。
      if (balls.length === 3) {
        const before = nextTurn([...pre, a, b], frames);
        expect(before).toMatchObject({ done: false, frame: frames - 1, ball: 2 });
        // 10・0は合計10でも、2投目を投げた棚。10本残ることと未投球は別。
        expect(before.reset).toBe(a < 10 && a + b === 10 || b === 10);
        expect(before.pinsLeft).toBe(before.reset ? 10 : 10 - b);
      }
    }
  });
  it('オープンなら2投で終わり、3投目は受け付けない', () => {
    const pre = Array(18).fill(0);
    expect(() => scoreCard([...pre, 3, 4, 1], 10)).toThrow(RangeError);
    expect(nextTurn([...pre, 3, 4], 10).done).toBe(true);
  });
});

describe('次の投球', () => {
  it.each([5, 10].flatMap((frames) => [
    { balls: [10], fresh: true, left: 10 },
    { balls: [10, 0], fresh: false, left: 10 },
    { balls: [10, 10], fresh: true, left: 10 },
    { balls: [0, 10], fresh: true, left: 10 },
    { balls: [10, 4], fresh: false, left: 6 },
  ].map((c) => ({ frames, ...c }))))('$frames フレーム・$balls ：0本でも投げた棚を未投球と誤認していた', ({ frames, balls, fresh, left }) => {
    expect(nextTurn([...Array((frames - 1) * 2).fill(0), ...balls], frames)).toEqual({
      done: false, frame: frames - 1, ball: balls.length, reset: fresh, pinsLeft: left,
    });
  });
  it('1投目で残れば同じフレームの2投目、ストライクなら次のフレーム', () => {
    expect(nextTurn([], 10)).toEqual({ done: false, frame: 0, ball: 0, reset: true, pinsLeft: 10 });
    expect(nextTurn([7], 10)).toEqual({ done: false, frame: 0, ball: 1, reset: false, pinsLeft: 3 });
    expect(nextTurn([7, 2], 10)).toEqual({ done: false, frame: 1, ball: 0, reset: true, pinsLeft: 10 });
    expect(nextTurn([10], 10)).toEqual({ done: false, frame: 1, ball: 0, reset: true, pinsLeft: 10 });
  });
  it('最後のフレームはストライクかスペアで立て直す', () => {
    const pre = Array(18).fill(1);
    expect(nextTurn([...pre, 10], 10)).toEqual({ done: false, frame: 9, ball: 1, reset: true, pinsLeft: 10 });
    expect(nextTurn([...pre, 10, 7], 10)).toEqual({ done: false, frame: 9, ball: 2, reset: false, pinsLeft: 3 });
    expect(nextTurn([...pre, 10, 10], 10)).toEqual({ done: false, frame: 9, ball: 2, reset: true, pinsLeft: 10 });
    expect(nextTurn([...pre, 9, 1], 10)).toEqual({ done: false, frame: 9, ball: 2, reset: true, pinsLeft: 10 });
    expect(nextTurn([...pre, 9], 10)).toEqual({ done: false, frame: 9, ball: 1, reset: false, pinsLeft: 1 });
  });
  it('短いモードの境界：5フレーム目が最後のフレームで、6フレーム目は無い', () => {
    const four = [10, 10, 10, 10];
    expect(nextTurn(four, 5)).toEqual({ done: false, frame: 4, ball: 0, reset: true, pinsLeft: 10 });
    expect(nextTurn([...four, 10], 5)).toMatchObject({ frame: 4, ball: 1, reset: true });
    expect(nextTurn([...four, 3, 7], 5)).toMatchObject({ frame: 4, ball: 2, reset: true });
    expect(nextTurn([...four, 3, 6], 5).done).toBe(true);
    expect(scoreCard([...four, 3, 6], 5)).toMatchObject({ total: 30 + 30 + 23 + 19 + 9, complete: true });
    expect(() => scoreCard([...four, 3, 6, 1], 5)).toThrow(RangeError);
    // 同じ球でも、10フレームならまだ途中。
    expect(scoreCard([...four, 3, 6], 10).complete).toBe(false);
  });
});

describe('拒否と照合', () => {
  it.each([[[11]], [[-1]], [[6, 5]], [[0.5]], [[Number.NaN]], [[...Array(20).fill(0), 0]]])('規則に合わない球は RangeError: %j', (rolls) => {
    expect(() => scoreCard(rolls, 10)).toThrow(RangeError);
    expect(() => nextTurn(rolls, 10)).toThrow(RangeError);
  });
  it.each([0, 11, 2.5])('フレーム数 %s は受け付けない', (frames) => {
    expect(() => scoreCard([], frames)).toThrow(RangeError);
  });
  it('無作為な2000ゲーム（10・5フレーム）で、別の書き方の計算と同じ点になる', () => {
    const rand = rng(20261027);
    for (let n = 0; n < 2000; n++) {
      const frames = n % 2 === 0 ? 10 : 5;
      const rolls = randomGame(frames, rand);
      const card = scoreCard(rolls, frames);
      expect(card.complete).toBe(true);
      expect(card.total).toBe(reference(rolls, frames));
      expect(card.frames[frames - 1].cumulative).toBe(card.total);
      // 途中のどこで切っても、確定した累計は最終の累計と同じで、合計は増え続ける。
      let prev = 0;
      for (let k = 0; k <= rolls.length; k++) {
        const part = scoreCard(rolls.slice(0, k), frames);
        expect(part.total).toBeGreaterThanOrEqual(prev);
        prev = part.total;
        part.frames.forEach((f, i) => {
          if (f.cumulative !== null) expect(f.cumulative).toBe(card.frames[i].cumulative);
        });
      }
    }
  });
});
