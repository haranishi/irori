import { describe, expect, it } from 'vitest';
import { ALL_STANDING, BODY, LANE, PIN_SPOTS, TUNING, ballPath, simulate, speedOf } from './physics.js';

// 調整の目標を測る組（設計 game-bowling.md）：startX −0.8〜0.8 を0.04刻み、hook −0.8〜0.8 を0.2刻み、power 0.7。
const STARTS = Array.from({ length: 41 }, (_, i) => (-80 + 4 * i) / 100);
const HOOKS = Array.from({ length: 9 }, (_, j) => (-8 + 2 * j) / 10);
const grid = HOOKS.map((hook) => STARTS.map((startX) => simulate({ startX, hook, power: 0.7 })));

/** 同じ hook で、ストライクが続く startX の最長の数。 */
function longestRun(row) {
  let run = 0;
  let best = 0;
  for (const r of row) {
    run = r.knocked === 10 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** 1本のピンの傾きの列。 */
function tilts(result, pin) {
  return result.frames.map((f) => f[2 + pin * 3 + 2]);
}

describe('調整の表（変えたら、調整の道具で全組を数え直して目標に入れる）', () => {
  it('数値の表を固定する', () => {
    expect(TUNING).toEqual({
      dt: 1 / 240, frameEvery: 4, maxSpeed: 10, minSpeed: 5, topSpeed: 9, hook: 0.5, oilEnd: 4, hookFull: 12,
      ballDrag: 0.15, pinDrag: 2, knock: 0.9, fallTime: 0.22, reachTime: 0.01, kickback: 0.5, deckBack: 0.6,
      dropTime: 0.25, tail: 0.4, maxTime: 5.9,
    });
    expect(BODY).toMatchObject({ ballR: 0.109, ballM: 6.35, pinR: 0.05, pinM: 1.5, fallenR: 0.09, restitution: 0.5 });
    expect(LANE).toMatchObject({ width: 1.05, gutterX: 0.51, headPinZ: 18.29, spacing: 0.305 });
  });
  it('ピン10本の三角形：1番がヘッド、間隔0.305', () => {
    expect(PIN_SPOTS[0]).toEqual({ x: 0, z: 18.29 });
    for (const [a, b] of [[0, 1], [0, 2], [1, 2], [1, 3], [1, 4], [2, 4], [2, 5], [3, 6], [3, 7], [4, 7], [4, 8], [5, 8], [5, 9], [6, 7], [8, 9]]) {
      const d = Math.hypot(PIN_SPOTS[a].x - PIN_SPOTS[b].x, PIN_SPOTS[a].z - PIN_SPOTS[b].z);
      expect(d).toBeCloseTo(0.305, 9);
    }
  });
});

describe('調整の目標（369組）', () => {
  const all = grid.flat();
  const strikes = all.filter((r) => r.knocked === 10).length;
  it('ストライクは全体の5〜30%（いまの表では50組・13.6%）', () => {
    expect(all).toHaveLength(369);
    expect(strikes / all.length).toBeGreaterThanOrEqual(0.05);
    expect(strikes / all.length).toBeLessThanOrEqual(0.3);
    expect(strikes).toBe(50);
  });
  it('ある hook で、startX が4刻み（0.12）以上つづけてストライクになる（狙えば出せる幅がある）', () => {
    const runs = grid.map(longestRun);
    expect(Math.max(...runs)).toBeGreaterThanOrEqual(4);
    expect(runs).toEqual([2, 6, 3, 2, 2, 2, 3, 6, 2]);
  });
  it('縁へ向かう曲がり（|startX|≥0.6 で、縁の向きに hook≥0.4）では0本で、ガターになる', () => {
    let checked = 0;
    HOOKS.forEach((hook, j) => STARTS.forEach((startX, i) => {
      if (Math.abs(startX) < 0.6 || hook * Math.sign(startX) < 0.4) return;
      const r = grid[j][i];
      checked += 1;
      expect(r.knocked, `startX ${startX} hook ${hook}`).toBe(0);
      expect(r.gutter).toBe(true);
      expect(r.hitMs).toBeNull();
    }));
    expect(checked).toBe(2 * 6 * 3);
  });
  it('まっすぐの球でもストライクは出るが、ど真ん中は割れて残る', () => {
    expect(grid[4].some((r) => r.knocked === 10)).toBe(true);
    expect(grid[4][20].knocked).toBeLessThan(10);
  });
});

describe('ピンは0〜10本で、一度倒れたものは立たない', () => {
  const rand = (() => {
    let a = 7;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const second = Array.from({ length: 120 }, () => {
    const standing = PIN_SPOTS.map(() => rand() < 0.5);
    const shot = { startX: rand() * 1.7 - 0.85, hook: rand() * 2 - 1, power: rand() };
    return { standing, r: simulate(shot, standing) };
  });
  const firsts = grid.flat().map((r) => ({ standing: ALL_STANDING, r }));
  it.each([['1投目の369組', firsts], ['残りのピンへの2投目120組', second]])('%s', (_, cases) => {
    for (const { standing, r } of cases) {
      const present = standing.filter(Boolean).length;
      expect(r.knocked).toBeGreaterThanOrEqual(0);
      expect(r.knocked).toBeLessThanOrEqual(present);
      expect(r.down.filter((d, i) => d && standing[i]).length).toBe(r.knocked);
      standing.forEach((up, i) => {
        if (!up) expect(r.down[i]).toBe(true);
        const t = tilts(r, i);
        if (!up) expect(t.every((v) => v === -1)).toBe(true);
        else {
          // 傾きは減らない（立ち直らない）。最後に倒れていなければ、ずっと0のまま。
          for (let k = 1; k < t.length; k++) expect(t[k]).toBeGreaterThanOrEqual(t[k - 1]);
          expect(r.down[i]).toBe(t[t.length - 1] > 0);
        }
      });
      expect(r.falls.map((f) => f.pin).sort((a, b) => a - b)).toEqual(r.down.map((d, i) => (d && standing[i] ? i : -1)).filter((i) => i >= 0));
    }
  });
});

describe('同じ入力は同じ出力', () => {
  it('2回走らせても、間に別の投球を挟んでも、結果と再生データが同じ', () => {
    const shot = { startX: -0.52, hook: 0.6, power: 0.7 };
    const a = simulate(shot);
    simulate({ startX: 0.3, hook: -0.4, power: 0.2 }, [true, false, true, true, false, true, true, true, false, true]);
    const b = simulate({ ...shot });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('入力を変えない', () => {
    const shot = Object.freeze({ startX: 0.1, hook: 0, power: 0.5 });
    const standing = Object.freeze([...ALL_STANDING]);
    expect(() => simulate(shot, standing)).not.toThrow();
  });
  it('範囲の外や壊れた値は切って扱い、再生データに NaN を出さない', () => {
    for (const shot of [{ startX: 5, hook: 9, power: -3 }, { startX: Number.NaN, hook: Number.NaN, power: Number.NaN }, { startX: -0.85, hook: -1, power: 1 }]) {
      const r = simulate(shot);
      expect(r.frames.flat().every(Number.isFinite)).toBe(true);
    }
    expect(simulate({ startX: 5, hook: 0, power: 2 })).toEqual(simulate({ startX: 0.85, hook: 0, power: 1 }));
  });
});

describe('再生データ（60Hz・6秒以内）とすり抜け防止', () => {
  it('刻みは1/240秒、再生は60Hz、刻みあたりの移動はピンの当たり半径より小さい', () => {
    expect(TUNING.dt * TUNING.frameEvery).toBeCloseTo(1 / 60, 12);
    expect(TUNING.maxSpeed * TUNING.dt).toBeLessThan(BODY.pinR);
    expect(speedOf(0)).toBe(5);
    expect(speedOf(1)).toBe(9);
  });
  it.each([0, 1])('強さ%sの全組で、再生は6秒以内、長さはコマ数と合う', (power) => {
    for (const hook of HOOKS) {
      for (const startX of STARTS) {
        const r = simulate({ startX, hook, power });
        expect(r.durationMs).toBeLessThanOrEqual(6000);
        expect(r.durationMs).toBe(Math.round(((r.frames.length - 1) * 1000) / 60));
        for (let k = 1; k < r.frames.length; k++) {
          const a = r.frames[k - 1];
          const b = r.frames[k];
          expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(TUNING.maxSpeed / 60 + 1e-3);
          // 台の上のピンも上限の速さを越えない。重なりを押し戻す分の余裕は1コマ0.004m（いまの表で最大0.1678m）。
          // 球に当たったピンの上限を外すと、強さ1の正面の当たりで1コマ0.1756mになり、ここで赤くなる。
          for (let p = 0; p < 10; p++) {
            const i = 2 + p * 3;
            if (a[i + 2] < 0 || a[i + 2] > 1 || b[i + 2] > 1) continue;
            expect(Math.hypot(b[i] - a[i], b[i + 1] - a[i + 1])).toBeLessThanOrEqual(TUNING.maxSpeed / 60 + 0.004);
          }
        }
      }
    }
  });
});

describe('ガターと狙いの予想線', () => {
  it('ガターの球は、それ以後は横に動かず、ピンに当たらない', () => {
    const r = simulate({ startX: 0.8, hook: 0.8, power: 0.7 });
    expect(r.gutter).toBe(true);
    expect(r.knocked).toBe(0);
    const after = r.frames.filter((_, k) => (k * 1000) / 60 > r.gutterMs + 20);
    expect(new Set(after.map((f) => f[0])).size).toBe(1);
    expect(Math.abs(after[0][0])).toBeGreaterThan(LANE.gutterX);
  });
  it('予想線は、ピンに当たるまで、投げた球と同じ道を通る（ガターの位置も同じ）', () => {
    let compared = 0;
    HOOKS.forEach((hook, j) => STARTS.forEach((startX, i) => {
      if (i % 4 !== 0) return;
      const r = grid[j][i];
      const path = ballPath({ startX, hook, power: 0.7 });
      // 予想線がピンより手前で溝に落ちるなら、投げた球もガター。投げた球がガターなら、予想線も同じ所で落ちる。
      if (path.gutterAt !== null && path.gutterAt < LANE.headPinZ - BODY.ballR - BODY.pinR) expect(r.gutter).toBe(true);
      if (r.gutter) {
        const frameZ = r.frames[Math.ceil((r.gutterMs * 60) / 1000)][1];
        expect(Math.abs(path.gutterAt - frameZ)).toBeLessThan(0.2);
        return;
      }
      // z=17 で、予想線の x と、再生データの x（どちらも直線で補う）が1mm以内。
      const at = (pts, z) => {
        const k = pts.findIndex((p) => p[1] >= z);
        const [xa, za] = pts[k - 1];
        const [xb, zb] = pts[k];
        return xa + ((xb - xa) * (z - za)) / (zb - za);
      };
      expect(Math.abs(at(path.points, 17) - at(r.frames, 17))).toBeLessThan(1e-3);
      compared += 1;
    }));
    expect(compared).toBeGreaterThan(40);
  });
});
