import { describe, expect, it } from 'vitest';
import { MAX_ROUNDS, MOVES, choiceId, controlId, createGame, isFinished, publicView, updateGame } from './logic.js';

const players = [{ id: 1, name: 'あお', online: true }, { id: 2, name: 'あか', online: true }];
const create = (overrides = {}) => createGame({ players, leader: 1, environment: { connected: true, visible: true }, paused: false, nonce: 'abc123', ...overrides });
const control = (s, p = 1, id = controlId(s), d = 1) => updateGame(s, { t: 'input', p, input: { k: 'btn', id, d } });
const choose = (s, p, move, id = choiceId(s, move)) => updateGame(s, { t: 'input', p, input: { k: 'pick', id } });
const start = () => control(create().state).state;
const play = (s, a, b) => choose(choose(s, 1, a).state, 2, b);
const expectNoEffect = (before, after) => {
  expect(after.state).toEqual(before);
  expect(after.effects).toEqual([]);
};

describe('火花の間合い：開始と個人向けの入力', () => {
  it('2人に体力4・気力1、進行役だけに開始ボタンを出す', () => {
    const { state, effects } = create();
    expect(state.seats.map((s) => [s.hp, s.energy])).toEqual([[4, 1], [4, 1]]);
    expect(effects).toHaveLength(2);
    expect(effects.find((e) => e.to === 1).spec.k).toBe('pad');
    expect(effects.find((e) => e.to === 2).spec.k).toBe('wait');
    expect(effects.every((e) => typeof e.to === 'number')).toBe(true);
  });
  it.each([{ people: [] }, { people: players.slice(0, 1) }, { people: [...players, { id: 3, name: 'みどり', online: true }] }])('人数が2人以外なら開始できない %#', ({ people }) => {
    const s = create({ players: people }).state;
    expectNoEffect(s, control(s));
  });
  it('進行役以外・ボタンを離した入力・古いIDでは始まらない', () => {
    const s = create().state;
    expectNoEffect(s, control(s, 2));
    expectNoEffect(s, control(s, 1, controlId(s), 0));
    expectNoEffect(s, control(s, 1, 'old'));
  });
  it('選べる技だけを本人に送り、選んだ本人だけ待機へ変える', () => {
    const opening = control(create().state);
    expect(opening.effects.every((e) => e.t === 'pad' && e.spec.k === 'choices')).toBe(true);
    expect(opening.effects[0].spec.options.map((o) => o.label)).toEqual(['斬る 気1', '受ける', '溜める']);
    const first = choose(opening.state, 1, 'slash');
    expect(first.effects).toHaveLength(1);
    expect(first.effects[0]).toMatchObject({ t: 'pad', to: 1, spec: { k: 'wait', title: '構えを決めました' } });
    expect(first.state.seats.map((s) => s.energy)).toEqual([1, 1]);
    expect(first.state.phase).toBe('choose');
  });
  it('一度確定した手・存在しない席・未対応入力を無視する', () => {
    const s = choose(start(), 1, 'slash').state;
    expectNoEffect(s, choose(s, 1, 'focus'));
    expectNoEffect(s, choose(s, 8, 'slash'));
    expectNoEffect(s, updateGame(s, { t: 'input', p: 2, input: { k: 'axis', id: 'dpad', x: 1, y: 0 } }));
  });
  it('古い勝負ID・前の手のID・気力不足の大技を無視する', () => {
    const s = start();
    expectNoEffect(s, choose(s, 1, 'burst'));
    expectNoEffect(s, choose(s, 1, 'slash', choiceId({ ...s, nonce: 'other' }, 'slash')));
    const next = control(play(s, 'guard', 'guard').state).state;
    expectNoEffect(next, choose(next, 1, 'slash', choiceId(s, 'slash')));
  });
  it('公開モデルは未確定の手・入力ID・確定状況を含めない', () => {
    const a = start();
    const b = choose(a, 1, 'slash').state;
    expect(publicView(a)).toEqual(publicView(b));
    expect(JSON.stringify(publicView(b))).not.toContain(choiceId(b, 'slash'));
    expect(publicView(b)).not.toHaveProperty('picks');
    expect(publicView(b).reveal).toEqual([]);
  });
  it('同じ環境通知では選択パッドを再発行せず確定を解除しない', () => {
    const s = choose(start(), 1, 'slash').state;
    expectNoEffect(s, updateGame(s, { t: 'environment', value: { connected: true, visible: true } }));
  });
  it('説明・選択・確定・公開・復帰のパッドがIDと文字数の上限を守る', () => {
    const initial = create();
    const selecting = control(initial.state);
    const picked = choose(selecting.state, 1, 'slash');
    const reveal = choose(picked.state, 2, 'focus');
    const recovery = updateGame(selecting.state, { t: 'menu', paused: true });
    const ready = updateGame(recovery.state, { t: 'menu', paused: false });
    const next = control(reveal.state);
    for (const change of [initial, selecting, picked, reveal, recovery, ready, next]) {
      for (const effect of change.effects.filter((e) => e.t === 'pad')) {
        const spec = effect.spec;
        if (spec.hint) expect([...spec.hint].length).toBeLessThanOrEqual(40);
        if (spec.title) expect([...spec.title].length).toBeLessThanOrEqual(24);
        if (spec.body) expect([...spec.body].length).toBeLessThanOrEqual(120);
        for (const item of [...(spec.options ?? []), ...(spec.buttons ?? [])]) {
          expect(item.id).toMatch(/^[a-z0-9_-]{1,24}$/);
          expect([...item.label].length).toBeLessThanOrEqual(12);
        }
      }
    }
  });
});

describe('同時解決：すべての手の組合せ', () => {
  const order = ['slash', 'guard', 'focus', 'burst'];
  const hits = { slash: [1, 0, 1, 1], guard: [0, 0, 0, 0], focus: [0, 0, 0, 0], burst: [2, 2, 2, 2] };
  for (const a of order) for (const b of order) {
    it(`${a} / ${b} の損害と消費を同時に計算する`, () => {
      const initial = start();
      const s = { ...initial, seats: initial.seats.map((p) => ({ ...p, energy: 3 })) };
      const snapshot = structuredClone(s);
      const resolved = play(s, a, b).state;
      expect(s).toEqual(snapshot);
      expect(resolved.phase).toBe('reveal');
      expect(resolved.seats.map((p) => p.hp)).toEqual([4 - hits[b][order.indexOf(a)], 4 - hits[a][order.indexOf(b)]]);
      expect(resolved.seats.map((p) => p.energy)).toEqual([3 - MOVES[a].cost, 3 - MOVES[b].cost]);
      expect(resolved.picks).toEqual({});
      const reversed = choose(choose(s, 2, b).state, 1, a).state;
      expect(reversed).toEqual(resolved);
    });
  }
  it('溜めるで1だけ回復し、気力3を超えない', () => {
    let s = start();
    for (let i = 0; i < 5; i++) {
      s = play(s, 'focus', 'focus').state;
      expect(s.seats.map((p) => p.energy)).toEqual([Math.min(3, 2 + i), Math.min(3, 2 + i)]);
      if (i < 4) s = control(s).state;
    }
  });
  it('気力0では受けると溜めるの2択を提示する', () => {
    const s = play(start(), 'slash', 'slash').state;
    const next = control(s);
    expect(next.effects[0].spec.options.map((o) => o.label)).toEqual(['受ける', '溜める']);
    expectNoEffect(next.state, choose(next.state, 1, 'slash'));
  });
  it('大技の2ダメージは残り体力1を0で止める', () => {
    const s = start();
    s.seats = s.seats.map((p) => ({ ...p, hp: 1, energy: 3 }));
    const result = play(s, 'burst', 'burst').state;
    expect(result.seats.map((p) => p.hp)).toEqual([0, 0]);
    expect(isFinished(result)).toBe(true);
  });
});

describe('終了、同点、10手', () => {
  it('10手で終了し、同じ体力は同じ点。終了は一度だけ', () => {
    let s = start();
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      expect(s.round).toBe(round);
      s = play(s, 'guard', round === MAX_ROUNDS ? 'focus' : 'guard').state;
      expect(isFinished(s)).toBe(round === MAX_ROUNDS);
      if (round < MAX_ROUNDS) s = control(s).state;
    }
    const finished = control(s);
    expect(finished.effects).toHaveLength(1);
    expect(finished.effects[0]).toMatchObject({ t: 'end', options: { outcome: 'complete', display: 'record' } });
    expect(finished.effects[0].results.map((r) => r.score)).toEqual([4, 4]);
    expect(finished.state.seats.map((p) => p.energy)).toEqual([1, 2]);
    expectNoEffect(finished.state, control(finished.state));
  });
  it('体力0で10手を待たずに決着し、結果は残り体力', () => {
    const s = start();
    s.seats = [{ ...s.seats[0], hp: 1 }, { ...s.seats[1], hp: 3 }];
    const reveal = play(s, 'focus', 'slash').state;
    expect(isFinished(reveal)).toBe(true);
    expect(reveal.round).toBe(1);
    expect(control(reveal).effects[0].results).toEqual([
      { p: 1, score: 0, label: '体力0', ranked: true },
      { p: 2, score: 3, label: '体力3', ranked: true },
    ]);
  });
  it('開始から再戦の初期状態まで、前の体力・気力・入力を持ち越さない', () => {
    const s = play(start(), 'slash', 'slash').state;
    const replay = create({ nonce: 'next' });
    expect(replay.state.seats.map((p) => [p.hp, p.energy])).toEqual([[4, 1], [4, 1]]);
    const next = control(replay.state).state;
    expectNoEffect(next, choose(next, 1, 'slash', choiceId(s, 'slash')));
  });
});

describe('中断・復帰・退出', () => {
  const interruptions = [
    { t: 'menu', paused: true },
    { t: 'environment', value: { connected: false, visible: true } },
    { t: 'environment', value: { connected: true, visible: false } },
    { t: 'players', players: [{ ...players[0], online: false }, players[1]], leader: 1 },
  ];
  it.each(interruptions)('選択中に中断すると未確定の手だけを捨てる %#', (event) => {
    const before = choose(start(), 1, 'slash').state;
    const recovered = updateGame(before, event).state;
    expect(recovered.phase).toBe('recover');
    expect(recovered.picks).toEqual({});
    expect(recovered.seats.map((p) => [p.hp, p.energy])).toEqual([[4, 1], [4, 1]]);
    expectNoEffect(recovered, control(recovered));
    expectNoEffect(recovered, choose(recovered, 2, 'slash'));
  });
  it('復帰しても自動再開せず、明示操作と新しいIDで同じ手を再開する', () => {
    const initial = start();
    let s = updateGame(choose(initial, 1, 'slash').state, { t: 'menu', paused: true }).state;
    const oldControl = controlId(s);
    s = updateGame(s, { t: 'menu', paused: false }).state;
    expect(s.phase).toBe('recover');
    expectNoEffect(s, control(s, 1, oldControl));
    const retry = control(s).state;
    expect(retry.phase).toBe('choose');
    expect(retry.round).toBe(1);
    expectNoEffect(retry, choose(retry, 2, 'slash', choiceId(initial, 'slash')));
  });
  it('複数の中断原因がすべて解消するまで再開できない', () => {
    let s = updateGame(start(), { t: 'menu', paused: true }).state;
    s = updateGame(s, { t: 'environment', value: { connected: false, visible: false } }).state;
    s = updateGame(s, { t: 'menu', paused: false }).state;
    expectNoEffect(s, control(s));
    s = updateGame(s, { t: 'environment', value: { connected: true, visible: false } }).state;
    expectNoEffect(s, control(s));
    s = updateGame(s, { t: 'environment', value: { connected: true, visible: true } }).state;
    expect(control(s).state.phase).toBe('choose');
  });
  it('公開後の中断は確定結果を戻さず、復帰後に次の手へ進む', () => {
    const reveal = play(start(), 'slash', 'focus').state;
    const old = controlId(reveal);
    let s = updateGame(reveal, { t: 'menu', paused: true }).state;
    expect(s.phase).toBe('reveal');
    expect(s.seats).toEqual(reveal.seats);
    expectNoEffect(s, control(s));
    s = updateGame(s, { t: 'menu', paused: false }).state;
    expectNoEffect(s, control(s, 1, old));
    s = control(s).state;
    expect(s.round).toBe(2);
    expect(s.seats).toEqual(reveal.seats);
  });
  it('進行役の変更で旧操作を無効にし、新しい進行役だけに操作を渡す', () => {
    const s = play(start(), 'guard', 'guard').state;
    const old = controlId(s);
    const next = updateGame(s, { t: 'players', players, leader: 2 });
    expectNoEffect(next.state, control(next.state, 1, old));
    expect(control(next.state, 2).state.round).toBe(2);
  });
  it('途中参加は名簿・手の確定条件に加えない', () => {
    const s = start();
    const next = updateGame(s, { t: 'players', players: [...players, { id: 3, name: '新しい人', online: true }], leader: 1 });
    expect(next.state.seats).toHaveLength(2);
    expectNoEffect(next.state, choose(next.state, 3, 'guard'));
    expect(play(next.state, 'guard', 'guard').state.phase).toBe('reveal');
  });
  it.each(['choose', 'reveal', 'recover'])('席の消失は全員の記録を残して勝敗なしにする：%s', (phase) => {
    let s = start();
    if (phase === 'reveal') s = play(s, 'slash', 'focus').state;
    if (phase === 'recover') s = updateGame(s, { t: 'menu', paused: true }).state;
    const result = updateGame(s, { t: 'players', players: [players[0]], leader: 1 });
    expect(result.state.phase).toBe('ended');
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].options.outcome).toBe('incomplete');
    expect(result.effects[0].results.map((r) => [r.p, r.ranked])).toEqual([[1, false], [2, false]]);
    expect(result.effects[0].results.map((r) => r.score)).toEqual(s.seats.map((p) => p.hp));
    expectNoEffect(result.state, updateGame(result.state, { t: 'players', players: [], leader: null }));
  });
  it('初期切断・非表示・一時停止では開始できない', () => {
    for (const values of [
      { paused: true }, { environment: null },
      { environment: { connected: false, visible: true } },
      { environment: { connected: true, visible: false } },
      { players: [{ ...players[0], online: false }, players[1]] },
    ]) {
      const s = create(values).state;
      expectNoEffect(s, control(s));
    }
  });
});

it('100通りの決定的な対戦で体力・気力・手数・入力順の保存則を守る', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let x = seed;
    const rng = () => ((x = Math.imul(x, 1664525) + 1013904223 >>> 0) / 2 ** 32);
    let s = start();
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const moves = s.seats.map((p) => Object.keys(MOVES).filter((m) => MOVES[m].cost <= p.energy));
      const [a, b] = moves.map((list) => list[Math.floor(rng() * list.length)]);
      const next = play(s, a, b).state;
      const reverse = choose(choose(s, 2, b).state, 1, a).state;
      expect(next).toEqual(reverse);
      expect(next.round).toBe(round);
      expect(next.seats.every((p) => p.hp >= 0 && p.hp <= 4 && p.energy >= 0 && p.energy <= 3)).toBe(true);
      expect(next.seats.every((p, i) => p.hp <= s.seats[i].hp)).toBe(true);
      if (isFinished(next)) {
        const end = control(next);
        expect(end.state.phase).toBe('ended');
        expect(end.effects[0].results.every((r, i) => r.score === next.seats[i].hp)).toBe(true);
        break;
      }
      s = control(next).state;
    }
  }
});
