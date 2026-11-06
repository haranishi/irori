// 同梱ゲームの「終了の合図」が、コンソールの検証器（validateGameEnd）を通る契約の試験。
// ゲームは自分のフォルダの外を読めない（tools/check-deps.mjs）ので、この試験はゲームの外に置く。
// 2026-11-06：「ふところの鈴」が、結果の行に余分な項目（rank・cpu）を載せ、SDK の end() が例外を投げて、
// コンソールへ終了が届かず、「もう一度」が出なくなった。ゲーム単体の画面の試験（?mock）は、end() の検証を通らないので見逃した。
import { describe, expect, it } from 'vitest';
import { validateGameEnd } from '../src/end';
// @ts-ignore 同梱ゲームは型の宣言を持たない素の JavaScript
import { createGame, updateGame, viewFor } from '../../../games/bell-in-sleeve/logic.js';
// @ts-ignore
import { fillSeats, decide } from '../../../games/bell-in-sleeve/cpu.js';
// @ts-ignore
import { makeRng } from '../../../games/bell-in-sleeve/cards.js';

type Seat = { id: number | string; name: string; online: boolean };
const human = (id: number): Seat => ({ id, name: `席${id}`, online: true });
const env = { connected: true, visible: true };

/** 全席を decide で自動操作して終わらせ、終了の効果を返す。leave なら、途中で最後の人が抜ける。 */
function play(humans: number[], seed: number, leave = false) {
  const seats: Seat[] = [...humans.map(human), ...(fillSeats(humans.length) as Seat[])];
  let s: any = createGame({ players: seats, leader: seats[0]!.id, seed, nonce: 'contract', environment: env }).state;
  const rngs = new Map(seats.map((p, i) => [p.id, makeRng(seed * 31 + i + 1)]));
  let end: any = null;
  let steps = 0;
  let left = false;
  const take = (r: any) => {
    s = r.state;
    const e = r.effects.find((x: any) => x.t === 'end');
    if (e) end = e;
  };
  while (!s.ended && steps++ < 20000) {
    if (leave && !left && s.phase === 'turn' && s.turn !== null) {
      left = true;
      take(updateGame(s, { t: 'players', players: seats.filter((p) => p.id !== humans[humans.length - 1]), leader: seats[0]!.id }));
      continue;
    }
    let acted = false;
    for (const seat of s.seats) {
      const v = viewFor(s, seat.id);
      if (v.pad.k !== 'tiles' || v.pad.disabled) continue;
      const input = decide(v, seat.id, rngs.get(seat.id))
        ?? (s.phase === 'intro' && seat.id === s.leader ? { k: 'tiles', ids: [v.pad.tiles[0].id], t: v.pad.token } : null);
      if (!input) continue;
      take(updateGame(s, { t: 'input', p: seat.id, input }));
      acted = true;
      if (s.ended) break;
    }
    if (!acted) take(updateGame(s, { t: 'tick', ms: 1000 }));
  }
  return { s, end };
}

describe('ふところの鈴：終了の合図は、コンソールの検証器を通る', () => {
  for (const n of [0, 1, 2, 3, 5]) {
    it(`人${n}人＋CPUの通常終了`, () => {
      for (let seed = 0; seed < 5; seed++) {
        const humans = Array.from({ length: n }, (_, i) => i + 1);
        const { s, end } = play(humans, seed);
        expect(s.ended).toBe(true);
        expect(end).not.toBeNull();
        const v = validateGameEnd(end.results, end.options);
        expect(v.ok, `seed=${seed} reason=${v.ok ? '' : v.reason}`).toBe(true);
        expect(end.results.map((r: any) => r.p).sort()).toEqual(humans);
        expect(end.options).toEqual({ display: 'points', outcome: 'complete' });
      }
    });
  }
  it('途中で人が抜けた局（勝負なし）も通る', () => {
    for (let seed = 0; seed < 5; seed++) {
      const { s, end } = play([1, 2], seed, true);
      expect(s.ended).toBe(true);
      const v = validateGameEnd(end.results, end.options);
      expect(v.ok, `seed=${seed} reason=${v.ok ? '' : v.reason}`).toBe(true);
      expect(end.options.outcome).toBe('incomplete');
      expect(end.results.every((r: any) => r.ranked === false && r.label === '勝負なし')).toBe(true);
    }
  });
  it('余分な項目（rank・cpu）を持つ行は、検証器が拒む（この試験の力の確認）', () => {
    expect(validateGameEnd([{ p: 1, score: 3, rank: 1, cpu: false, ranked: true, label: '1位' }], { display: 'points', outcome: 'complete' }))
      .toEqual({ ok: false, reason: 'result-shape' });
  });
});
