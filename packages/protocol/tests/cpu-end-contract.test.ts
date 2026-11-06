// ゲームの本物の終了行を、mainと同じ変換でSDKの検証器へ渡す。
import { expect, it } from 'vitest';
import { validateGameEnd } from '../src/end';
const games = ['old-maid', 'daifugo', 'tap-race', 'ten-seconds', 'lantern-market', 'blade-duel', 'moon-village'];
const environment = { connected: true, visible: true };
for (const game of games) it(`${game}：人1＋CPUの終了は順位を重ねず契約を通る`, async () => {
  const logic: any = await import(`../../../games/${game}/logic.js`);
  const cpu: any = await import(`../../../games/${game}/cpu.js`);
  const cpus = cpu.fillSeats(1), cpuIds = new Set<number>(cpus.map((p: any) => p.id));
  const players = [{ id: 1, name: '参加者', online: true }, ...cpus];
  let rows: any[], options: any;
  if (game === 'tap-race') {
    const race = logic.createRace(players, 0);
    logic.begin(race, 0);
    let end: any;
    for (let step = 0; race.phase !== 'over' && step < 600; step++) {
      const now = step * 100;
      for (const p of players) {
        const effects = logic.tap(race, p.id, { k: 'btn', id: 'buzzer', d: 1 }, now, now);
        end = effects.find((e: any) => e.t === 'end') ?? end;
      }
      end = logic.tick(race, now).find((e: any) => e.t === 'end') ?? end;
    }
    expect(end).toBeTruthy();
    rows = logic.consoleResults(race, cpuIds);
    expect(rows[0].label).toBe(`${logic.standings(race).find((s: any) => s.p === 1).rank}位(CPUこみ)`);
  } else {
    let state = logic.createGame({ players, leader: 1, environment, paused: false, nonce: 'contract', seed: 42, nowMs: 0 }).state;
    let end: any, now = 0;
    const take = (next: any) => { state = next.state; end = next.effects.find((e: any) => e.t === 'end') ?? end; };
    const rng = cpu.makeRng?.(9753) ?? (() => .3);
    for (let step = 0; state.phase !== 'ended' && step < 5000; step++) {
      for (const p of players) {
        const view = logic.viewFor(state, p.id);
        let input = cpu.decide(view, p.id, rng);
        if (game === 'moon-village' && view.phase === 'day' && p.id === 1 && view.pad.k === 'tiles') input = { k: 'tiles', ids: [], t: view.pad.token };
        if (game === 'ten-seconds' && state.phase === 'counting' && now - state.trial.goAtMs < 10000 + players.indexOf(p) * 100) continue;
        if (!input) continue;
        take(logic.updateGame(state, game === 'ten-seconds' ? { t: 'press', p: p.id, id: input.id, down: true, nowMs: now } : { t: 'input', p: p.id, input }));
        if (state.phase === 'ended') break;
      }
      now += 1000;
      if (game === 'ten-seconds') take(logic.updateGame(state, { t: 'frame', nowMs: now }));
    }
    expect(state.phase).toBe('ended');
    expect(end).toBeTruthy();
    rows = logic.consoleResults(end.results, cpuIds); options = end.options;
    const raw = end.results.find((r: any) => r.p === 1);
    if (['old-maid', 'ten-seconds', 'lantern-market'].includes(game)) {
      expect(rows[0].label).toBe(`${1 + end.results.filter((r: any) => r.ranked !== false && r.score > raw.score).length}位(CPUこみ)`);
    } else expect(rows[0].label).toBe(raw.label);
    expect(logic.consoleResults(end.results, new Set())).toEqual(end.results);
  }
  expect(rows.map(r => r.p)).toEqual([1]);
  expect(Object.keys(rows[0]).sort()).toEqual(['label', 'p', 'ranked', 'score']);
  expect(rows[0].ranked).toBe(false);
  expect([...rows[0].label].length).toBeLessThanOrEqual(12);
  expect(validateGameEnd(rows, options)).toMatchObject({ ok: true, results: rows });
});
