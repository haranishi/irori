import { describe, expect, it } from 'vitest';
import { createGame, publicView, updateGame } from './logic.js';

const environment = { connected: true, visible: true };
const players = (n, offline = []) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, name: `P${i + 1}`, online: !offline.includes(i + 1),
}));
const init = (overrides = {}) => ({
  players: players(2), leader: 1, environment, paused: false, nonce: 'party123', nowMs: 0, ...overrides,
});
const press = (state, p, id, nowMs, down = true) => updateGame(state, { t: 'press', p, id, nowMs, down });
const frame = (state, nowMs) => updateGame(state, { t: 'frame', nowMs });
const begin = (state, nowMs = 0) => press(state, state.control.p, state.control.id, nowMs);
const counting = (overrides = {}) => {
  const countdown = begin(createGame(init(overrides)).state).state;
  return frame(countdown, 3000).state;
};
const stop = (state, p, elapsedMs) => press(state, p, state.trial.stopId, state.trial.goAtMs + elapsedMs);
const stopped = (state, p) => state.trial.stops.find((row) => row.p === p)?.record;
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const keysOf = (value) => value && typeof value === 'object'
  ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : [];

// 入力を時刻順に運び、未回答があれば締切のframeまで進める。
const playRound = (before, elapsedBySeat, startedAtMs = 0) => {
  let state = frame(begin(before, startedAtMs).state, startedAtMs + 3000).state;
  const events = elapsedBySeat.map((elapsedMs, i) => ({ p: i + 1, elapsedMs }))
    .filter((event) => event.elapsedMs !== null).sort((a, b) => a.elapsedMs - b.elapsedMs);
  for (const event of events) state = stop(state, event.p, event.elapsedMs).state;
  if (state.phase === 'counting') state = frame(state, startedAtMs + 23000).state;
  return state;
};

describe('参加席と説明からの開始 (1.1–1.5)', () => {
  it.each([2, 8])('%i人の席をコピーし、進行役だけに「はじめる」を渡す', (n) => {
    const source = init({ players: players(n), leader: n });
    const { state, effects } = createGame(source);
    expect(state.phase).toBe('intro');
    expect(state.seats).toEqual(players(n).map((p) => ({ ...p, left: false })));
    expect(effects).toHaveLength(n);
    expect(effects.filter((effect) => effect.spec.k === 'pad')).toEqual([{
      t: 'pad', to: n,
      spec: { k: 'pad', stick: 'none', orient: 'portrait', buttons: [{ id: state.control.id, label: 'はじめる' }], hint: 'みんながそろったら、はじめよう' },
    }]);
    expect(publicView(state)).toMatchObject({
      phase: 'intro', canBegin: true, neededPlayers: 0,
      instruction: '10秒だと思ったら1回押す。3回の合計のズレで勝負',
    });
    source.players[0].name = '変更後';
    source.environment = { connected: false, visible: false };
    expect(state.seats[0].name).toBe('P1');
    expect(state.environment).toEqual(environment);
  });

  it.each([0, 1, 9])('%i人では開始を出さず、人数不足を公開モデルに示す', (n) => {
    const { state, effects } = createGame(init({ players: players(n) }));
    expect(state.control).toBeNull();
    expect(effects.every((effect) => effect.spec.k === 'wait')).toBe(true);
    expect(press(state, 1, 'begin', 0).state.phase).toBe('intro');
    expect(publicView(state)).toMatchObject({ canBegin: false, neededPlayers: Math.max(0, 2 - n), minimumPlayers: 2, maximumPlayers: 8 });
  });

  it('現在の進行役・現在のID・押下だけが1回の開始を消費する', () => {
    const { state } = createGame(init());
    for (const [p, id, down] of [[2, state.control.id, true], [99, state.control.id, true], [1, 'begin', true], [1, state.control.id, false]]) {
      expect(press(state, p, id, 0, down)).toEqual({ state, effects: [] });
    }
    const first = begin(state);
    expect(first.state).toMatchObject({ phase: 'countdown', roundIndex: 0, attemptSeq: 1, control: null });
    expect(press(first.state, 1, state.control.id, 10)).toEqual({ state: first.state, effects: [] });
  });

  it.each([
    { paused: true },
    { environment: { connected: false, visible: true } },
    { environment: { connected: true, visible: false } },
    { environment: null },
    { players: players(2, [2]) },
  ])('説明中の中断理由がある間は開始できない: %j', (overrides) => {
    const { state } = createGame(init(overrides));
    expect(state.control).toBeNull();
    expect(state.blockers.length).toBeGreaterThan(0);
    expect(press(state, 1, 'begin', 0).state.phase).toBe('intro');
  });

  it('中断理由の変化ごとに古い操作IDを失効させ、解除だけでは開始しない', () => {
    let state = createGame(init()).state;
    const first = state.control.id;
    const sequence = state.controlSeq;
    state = updateGame(state, { t: 'menu', nowMs: 10, paused: true }).state;
    expect(state).toMatchObject({ phase: 'intro', control: null, controlSeq: sequence + 1, blockers: ['menu'] });
    state = updateGame(state, { t: 'environment', nowMs: 20, value: { connected: false, visible: false } }).state;
    expect(state.controlSeq).toBe(sequence + 2);
    state = updateGame(state, { t: 'menu', nowMs: 30, paused: false }).state;
    expect(state.blockers).toEqual(['host-offline', 'hidden']);
    state = updateGame(state, { t: 'environment', nowMs: 40, value: environment }).state;
    expect(state.phase).toBe('intro');
    expect(state.control.id).not.toBe(first);
    expect(press(state, 1, first, 50).state.phase).toBe('intro');
    const repeated = updateGame(state, { t: 'environment', nowMs: 60, value: environment });
    expect(repeated.state.control).toEqual(state.control);
    expect(repeated.effects).toEqual([]);
    expect(begin(repeated.state, 70).state.phase).toBe('countdown');
  });

  it('役割変更で新しい操作IDを発行し、旧進行役も旧IDも開始できない', () => {
    const original = createGame(init()).state;
    const next = updateGame(original, { t: 'players', nowMs: 10, players: players(2), leader: 2 }).state;
    expect(next.control).toMatchObject({ p: 2, action: 'begin' });
    expect(next.control.id).not.toBe(original.control.id);
    expect(next.controlSeq).toBeGreaterThan(original.controlSeq);
    expect(press(next, 1, next.control.id, 20).state.phase).toBe('intro');
    expect(press(next, 2, original.control.id, 30).state.phase).toBe('intro');
    expect(begin(next, 40).state.phase).toBe('countdown');
    expect(updateGame(original, { t: 'players', nowMs: 10, players: players(2), leader: 99 }).state.control).toBeNull();
  });

  it('一時切断した席は開始を止め、同じ席の接続復帰後に新しいIDを出す', () => {
    const initial = createGame(init()).state;
    const offline = updateGame(initial, { t: 'players', nowMs: 10, players: players(2, [2]), leader: 1 }).state;
    expect(offline.seats[1]).toMatchObject({ id: 2, online: false, left: false });
    expect(offline.blockers).toEqual(['player-offline']);
    expect(offline.control).toBeNull();
    const online = updateGame(offline, { t: 'players', nowMs: 20, players: players(2), leader: 1 }).state;
    expect(online.seats[1]).toMatchObject({ id: 2, online: true, left: false });
    expect(online.control.id).not.toBe(initial.control.id);
    expect(online.phase).toBe('intro');
  });

  it('途中参加者は待機し、固定席にも停止対象にも追加されない', () => {
    const state = counting();
    const joined = updateGame(state, { t: 'players', nowMs: 4000, players: players(3), leader: 1 });
    expect(joined.state.seats.map((seat) => seat.id)).toEqual([1, 2]);
    expect(publicView(joined.state).waitingPlayers).toEqual([{ id: 3, name: 'P3' }]);
    expect(joined.effects).toEqual([{ t: 'pad', to: 3, spec: { k: 'wait', title: '次の勝負から参加できます', body: 'いまは大画面を見て待っていてね' } }]);
    expect(stop(joined.state, 3, 1000).state.trial.stops).toEqual([]);
  });

  it('消えた固定席は退出したままにし、同じ番号が戻っても最初の名前と記録対象を守る', () => {
    let state = createGame(init({ players: players(3) })).state;
    state = updateGame(state, { t: 'players', nowMs: 10, players: [players(3)[0], players(3)[2]], leader: 1 }).state;
    const reused = players(3);
    reused[1].name = '新しい人';
    state = updateGame(state, { t: 'players', nowMs: 20, players: reused, leader: 1 }).state;
    expect(state.seats[1]).toEqual({ id: 2, name: 'P2', online: false, left: true });
    expect(publicView(state).waitingPlayers).toEqual([{ id: 2, name: '新しい人' }]);
    state = frame(begin(state, 30).state, 3030).state;
    expect(stop(state, 2, 1000).state.trial.stops).toEqual([]);
    state = stop(state, 1, 9000).state;
    const revealed = stop(state, 3, 10000).state;
    expect(revealed.phase).toBe('reveal');
    expect(revealed.records[0].records.map((row) => row.p)).toEqual([1, 3]);
  });
});

describe('開始合図と試行のID (2.1, 2.2, 2.5)', () => {
  it('3・2・1を1秒ずつ表示し、GOを反映する最初のフレームから計測する', () => {
    let { state, effects } = begin(createGame(init()).state, 100);
    expect(publicView(state).cue).toBe('3');
    expect(effects).toHaveLength(2);
    const guideId = effects[0].spec.buttons[0].id;
    expect(guideId).not.toBe(state.trial.stopId);
    for (const [nowMs, cue] of [[100, '3'], [1099, '3'], [1100, '2'], [2099, '2'], [2100, '1'], [3099, '1']]) {
      const result = frame(state, nowMs);
      state = result.state;
      expect(publicView(state).cue).toBe(cue);
      expect(result.effects).toEqual([]);
    }
    const go = frame(state, 3100);
    expect(go.state.phase).toBe('counting');
    expect(go.state.trial.goAtMs).toBe(3100);
    expect(publicView(go.state).cue).toBe('せーの');
    expect(go.effects.every((effect) => effect.spec.buttons[0].id === go.state.trial.stopId)).toBe(true);
    expect(frame(go.state, 3100).effects).toEqual([]);
  });

  it('フレームが遅れても予定時刻へ遡らず、入力だけではGOにしない', () => {
    const state = begin(createGame(init()).state).state;
    const early = press(state, 1, state.trial.stopId, 5000);
    expect(early.state.phase).toBe('countdown');
    expect(early.effects).toEqual([]);
    const go = frame(early.state, 6000).state;
    expect(go.trial.goAtMs).toBe(6000);
    expect(stopped(stop(go, 1, 0).state, 1)).toMatchObject({ kind: 'stopped', elapsedMs: 0 });
  });

  it('試行連番を保持した次の試行では停止IDが変わり、24文字以内に収まる', () => {
    const intro = createGame(init({ nonce: '0123456789' })).state;
    const first = frame(begin(intro).state, 3000).state;
    const retry = frame(begin({ ...intro, attemptSeq: first.attemptSeq }).state, 3000).state;
    expect(retry.trial.stopId).not.toBe(first.trial.stopId);
    expect(retry.trial.stopId).toMatch(/^s_0123456789_[a-z0-9]+$/);
    expect(press(retry, 1, first.trial.stopId, 4000).state.trial.stops).toEqual([]);
    const last = begin({ ...intro, attemptSeq: Number.MAX_SAFE_INTEGER - 1 }).state;
    expect(last.trial.stopId.length).toBeLessThanOrEqual(24);
    expect(last.trial.stopId).toMatch(/^[a-z0-9_-]+$/);
  });

  it.each(['', 'UPPER', 'with/slash', '12345678901'])('無効な勝負nonceはIDに流さない: %j', (nonce) => {
    expect(() => createGame(init({ nonce }))).toThrow(RangeError);
  });
});

describe('1人1回の受付と一斉発表 (2.3–2.7)', () => {
  it('有効な停止では本人のpadだけを受け付け済みに替える', () => {
    const state = counting();
    const result = stop(state, 2, 10000);
    expect(result.state.phase).toBe('counting');
    expect(result.effects).toEqual([{ t: 'pad', to: 2, spec: { k: 'wait', title: '受け付けました', body: '大画面を見てね' } }]);
    expect(stopped(result.state, 2)).toEqual({ kind: 'stopped', elapsedMs: 10000, tenths: 100, deltaTenths: 0, errorTenths: 0 });
    expect(result.state.records).toEqual([]);
  });

  it('離し・案内・未知ID・過去ID・知らない席・負の経過時間を無視する', () => {
    const state = counting();
    const id = state.trial.stopId;
    for (const [p, inputId, nowMs, down] of [[1, id, 4000, false], [1, 'guide', 4000, true], [1, 'unknown', 4000, true], [1, 's_party123_0', 4000, true], [99, id, 4000, true], [1, id, 2999, true]]) {
      expect(press(state, p, inputId, nowMs, down)).toEqual({ state, effects: [] });
    }
  });

  it('回答済みの人の再入力は最初の時刻と試行を変えない', () => {
    const once = stop(counting(), 1, 9000).state;
    const duplicate = stop(once, 1, 11000);
    expect(duplicate).toEqual({ state: once, effects: [] });
    expect(stopped(duplicate.state, 1).elapsedMs).toBe(9000);
  });

  it('接続していない席・消えた席の停止を受け付けない', () => {
    const state = counting({ players: players(3) });
    const id = state.trial.stopId;
    const offline = updateGame(state, { t: 'players', nowMs: 4000, players: players(3, [2]), leader: 1 }).state;
    expect(press(offline, 2, id, 4000).effects).toEqual([]);
    expect(offline).toMatchObject({ phase: 'recover', trial: null, records: [] });
    const gone = updateGame(state, { t: 'players', nowMs: 4000, players: players(1), leader: 1 }).state;
    expect(press(gone, 2, id, 4000).effects).toEqual([]);
    expect(gone).toMatchObject({ phase: 'ended', outcome: 'incomplete', trial: null, records: [] });
  });

  it('全員の最初の停止がそろうまで伏せ、全員分を席順で1回だけ確定する', () => {
    let state = counting({ players: players(3) });
    state = stop(state, 3, 9000).state;
    state = stop(state, 1, 10000).state;
    expect(state.records).toEqual([]);
    expect(state.phase).toBe('counting');
    const last = stop(state, 2, 11000);
    expect(last.state).toMatchObject({ phase: 'reveal', trial: null });
    expect(last.state.records).toHaveLength(1);
    expect(last.state.records[0]).toMatchObject({ roundIndex: 0, attemptSeq: 1 });
    expect(last.state.records[0].records.map((row) => [row.p, row.record.elapsedMs])).toEqual([[1, 10000], [2, 11000], [3, 9000]]);
    expect(publicView(last.state).records).toEqual(last.state.records[0].records);
    expect(last.effects).toHaveLength(3);
    expect(frame(last.state, 50000)).toEqual({ state: last.state, effects: [] });
    expect(press(last.state, 1, state.trial.stopId, 50000)).toEqual({ state: last.state, effects: [] });
  });

  it.each([
    [0, 0, -100, 100],
    [9949, 99, -1, 1],
    [9950, 100, 0, 0],
    [10050, 101, 1, 1],
    [19999, 200, 100, 100],
  ])('%imsの停止をTrialRecordへ正しく記録する', (elapsedMs, tenths, deltaTenths, errorTenths) => {
    expect(stopped(stop(counting(), 1, elapsedMs).state, 1)).toEqual({ kind: 'stopped', elapsedMs, tenths, deltaTenths, errorTenths });
  });

  it.each([20000, 20001, 50000])('%imsでは押下より締切を優先し、未回答は実測値なしの時間切れ', (elapsedMs) => {
    const first = stop(counting(), 1, 9949).state;
    const result = stop(first, 2, elapsedMs);
    expect(result.state.phase).toBe('reveal');
    expect(result.state.records[0].records).toEqual([
      { p: 1, record: { kind: 'stopped', elapsedMs: 9949, tenths: 99, deltaTenths: -1, errorTenths: 1 } },
      { p: 2, record: { kind: 'timeout', errorTenths: 100 } },
    ]);
  });

  it('20秒のフレームで未回答者全員を時間切れにし、19,999msではまだ待つ', () => {
    const state = counting();
    expect(frame(state, 22999)).toEqual({ state, effects: [] });
    const deadline = frame(state, 23000);
    expect(deadline.state.records[0].records).toEqual([1, 2].map((p) => ({ p, record: { kind: 'timeout', errorTenths: 100 } })));
    expect(deadline.state.phase).toBe('reveal');
    expect(frame(deadline.state, 24000).effects).toEqual([]);
  });

  it('19,999msの停止が20.0秒へ丸まっても、未回答の時間切れと区別する', () => {
    const lastMoment = stop(counting(), 1, 19999).state;
    const revealed = frame(lastMoment, 23000).state;
    expect(revealed.records[0].records).toEqual([
      { p: 1, record: { kind: 'stopped', elapsedMs: 19999, tenths: 200, deltaTenths: 100, errorTenths: 100 } },
      { p: 2, record: { kind: 'timeout', errorTenths: 100 } },
    ]);
  });

  it('8人全員が止めた場合も、最後の停止で初めて発表する', () => {
    let state = counting({ players: players(8) });
    for (let p = 1; p < 8; p++) {
      state = stop(state, p, p * 1000).state;
      expect(state.phase).toBe('counting');
    }
    state = stop(state, 8, 10000).state;
    expect(state.phase).toBe('reveal');
    expect(state.records[0].records).toHaveLength(8);
  });

  it('1人の停止や経過時間で公開モデルは変わらず、属性や読み上げ用にも回答情報を含まない', () => {
    const state = {
      ...counting(),
      records: [{ roundIndex: 0, attemptSeq: 1, records: [{ p: 1, record: { kind: 'stopped', elapsedMs: 9950, tenths: 100, deltaTenths: 0, errorTenths: 0 } }] }],
    };
    const before = publicView(state);
    const once = stop(state, 1, 9949).state;
    expect(publicView(once)).toEqual(before);
    expect(publicView(frame(once, 22000).state)).toEqual(before);
    const keys = keysOf(before);
    for (const forbidden of ['nowMs', 'goAtMs', 'startedAtMs', 'elapsedMs', 'tenths', 'deltaTenths', 'errorTenths', 'records', 'stops', 'stopId', 'attemptSeq', 'answeredCount', 'stoppedCount', 'stoppedIds', 'ariaLabel', 'dataset']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(Object.keys(before).sort()).toEqual(['blockers', 'cue', 'instruction', 'leader', 'participants', 'phase', 'precisionNote', 'roundIndex', 'waitingPlayers'].sort());
  });

  it('席の内部情報が増えても、公開する席情報はidentityと接続状態だけに限定する', () => {
    const state = counting();
    const internal = { ...state, seats: state.seats.map((seat) => ({ ...seat, stoppedAtMs: 9999, totalTenths: 5 })) };
    expect(publicView(internal)).toEqual(publicView(state));
  });

  it('凍結した入力状態と過去記録を変更せず、公開した記録も非公開状態と共有しない', () => {
    const source = freeze(init());
    const intro = freeze(createGame(source).state);
    const countdown = freeze(begin(intro).state);
    const state = freeze(frame(countdown, 3000).state);
    const once = freeze(stop(state, 1, 10000).state);
    const revealed = stop(once, 2, 11000).state;
    expect(state.trial.stops).toEqual([]);
    expect(once.trial.stops).toHaveLength(1);
    expect(once.records).toEqual([]);
    const published = publicView(revealed);
    published.records[0].record.elapsedMs = 123;
    published.participants[0].name = '変更';
    expect(revealed.records[0].records[0].record.elapsedMs).toBe(10000);
    expect(revealed.seats[0].name).toBe('P1');
    const previous = freeze({ ...intro, records: revealed.records, attemptSeq: 1 });
    const later = stop(stop(frame(begin(previous).state, 3000).state, 1, 9000).state, 2, 10000).state;
    expect(previous.records).toHaveLength(1);
    expect(later.records).toHaveLength(2);
    expect(later.records[0]).toEqual(revealed.records[0]);
  });
});

describe('発表の採点と3回の進行 (3.1–3.5, 3.7, 4.1, 4.2, 4.5)', () => {
  it('記録秒数・早い遅い差・今回順位・整数累計を全席へ同時に公開し、同点を1・1・3とする', () => {
    const state = playRound(createGame(init({ players: players(4) })).state, [9949, 10050, 10300, null]);
    expect(publicView(state)).toMatchObject({
      phase: 'reveal', canContinue: true, action: 'next', actionLabel: '次へ',
      precisionNote: '通信の遅れを含む目安です',
      rows: [
        { p: 1, record: { kind: 'stopped', tenths: 99, deltaTenths: -1, errorTenths: 1 }, rank: 1, totalTenths: 1, roundsCompleted: 1, left: false },
        { p: 2, record: { kind: 'stopped', tenths: 101, deltaTenths: 1, errorTenths: 1 }, rank: 1, totalTenths: 1, roundsCompleted: 1, left: false },
        { p: 3, record: { kind: 'stopped', tenths: 103, deltaTenths: 3, errorTenths: 3 }, rank: 3, totalTenths: 3, roundsCompleted: 1, left: false },
        { p: 4, record: { kind: 'timeout', errorTenths: 100 }, rank: 4, totalTenths: 100, roundsCompleted: 1, left: false },
      ],
    });
    expect(publicView(state).rows[3].record).toEqual({ kind: 'timeout', errorTenths: 100 });
    expect(state.control.action).toBe('next');
  });

  it('第1/2回はleaderだけに次へを提示し、次の試行ではroundと停止IDを更新して履歴を伏せる', () => {
    const first = playRound(createGame(init()).state, [9949, 10050]);
    const firstStopId = `s_${first.nonce}_${first.attemptSeq.toString(36)}`;
    const next = begin(first, 18000);
    expect(next.state).toMatchObject({ phase: 'countdown', roundIndex: 1, attemptSeq: 2, control: null });
    expect(next.state.trial.stopId).not.toBe(firstStopId);
    expect(next.state.records).toHaveLength(1);
    const go = frame(next.state, 21000).state;
    expect(publicView(go)).not.toHaveProperty('rows');
    expect(publicView(go)).not.toHaveProperty('records');
    for (const key of ['totalTenths', 'roundsCompleted', 'rank', 'elapsedMs', 'tenths', 'deltaTenths', 'errorTenths']) {
      expect(keysOf(publicView(go))).not.toContain(key);
    }
    const second = stop(stop(go, 1, 10000).state, 2, 10200).state;
    expect(publicView(second).rows.map((row) => [row.p, row.rank, row.totalTenths, row.roundsCompleted])).toEqual([[1, 1, 1, 2], [2, 2, 3, 2]]);
    expect(second.control).toMatchObject({ p: 1, action: 'next' });
    expect(second.control.id).not.toBe(first.control.id);
    expect(second.controlSeq).toBeGreaterThan(first.controlSeq);
    expect(press(second, 1, first.control.id, 34000)).toEqual({ state: second, effects: [] });
  });

  it('次へは現在のleader・現在のID・押下だけを一度受け付け、再描画でIDを作り直さない', () => {
    const state = playRound(createGame(init()).state, [10000, 10000]);
    expect(state.control.action).toBe('next');
    expect(frame(state, 20000)).toEqual({ state, effects: [] });
    for (const [p, id, down] of [[2, state.control.id, true], [1, 'next', true], [1, state.control.id, false]]) {
      expect(press(state, p, id, 20000, down)).toEqual({ state, effects: [] });
    }
    const next = begin(state, 20000).state;
    expect(press(next, 1, state.control.id, 20001)).toEqual({ state: next, effects: [] });
  });

  it('leader交代で次へのIDを更新し、旧leaderと旧IDを失効させる', () => {
    const original = playRound(createGame(init()).state, [10000, 10000]);
    const next = updateGame(original, { t: 'players', nowMs: 20000, players: players(2), leader: 2 }).state;
    expect(next.control).toMatchObject({ p: 2, action: 'next' });
    expect(next.control.id).not.toBe(original.control.id);
    expect(press(next, 1, next.control.id, 20001)).toEqual({ state: next, effects: [] });
    expect(press(next, 2, original.control.id, 20002)).toEqual({ state: next, effects: [] });
    expect(begin(next, 20003).state.phase).toBe('countdown');
  });

  it('各回の発表で新しい進行IDをleaderのpadだけへ渡し、3回目は総合結果へを提示する', () => {
    let state = createGame(init()).state;
    const ids = [];
    for (const [round, label] of ['次へ', '次へ', '総合結果へ'].entries()) {
      state = frame(begin(state, round * 18000).state, round * 18000 + 3000).state;
      state = stop(state, 1, 10000).state;
      const reveal = stop(state, 2, 10000);
      state = reveal.state;
      expect(reveal.effects).toEqual([
        { t: 'pad', to: 1, spec: { k: 'pad', stick: 'none', orient: 'portrait', buttons: [{ id: state.control.id, label }], hint: 'みんなの記録を見たら、進めよう' } },
        { t: 'pad', to: 2, spec: { k: 'wait', title: '結果発表', body: 'みんなの記録を大画面で見よう' } },
      ]);
      ids.push(state.control.id);
    }
    expect(new Set(ids).size).toBe(3);
  });

  it.each([
    { t: 'menu', paused: true, nowMs: 20000 },
    { t: 'environment', value: { connected: false, visible: true }, nowMs: 20000 },
    { t: 'environment', value: { connected: true, visible: false }, nowMs: 20000 },
    { t: 'players', players: players(2, [2]), leader: 1, nowMs: 20000 },
  ])('発表中のblockerは確定済み記録を保ち、次へを止める: %j', (event) => {
    const original = playRound(createGame(init()).state, [10000, 10050]);
    const blocked = updateGame(original, event).state;
    expect(blocked.phase).toBe('reveal');
    expect(blocked.records).toEqual(original.records);
    expect(blocked.control).toBeNull();
    expect(publicView(blocked).canContinue).toBe(false);
    expect(press(blocked, 1, original.control.id, 20001)).toEqual({ state: blocked, effects: [] });
  });

  it('blocker解除だけでは次へ進まず、新しいIDを出して以前の次へを受け付けない', () => {
    const original = playRound(createGame(init()).state, [10000, 10050]);
    const paused = updateGame(original, { t: 'menu', paused: true, nowMs: 18000 }).state;
    const resumed = updateGame(paused, { t: 'menu', paused: false, nowMs: 19000 }).state;
    expect(resumed.phase).toBe('reveal');
    expect(resumed.control.action).toBe('next');
    expect(resumed.control.id).not.toBe(original.control.id);
    expect(press(resumed, 1, original.control.id, 20000)).toEqual({ state: resumed, effects: [] });
    const duplicate = updateGame(resumed, { t: 'menu', paused: false, nowMs: 20001 }).state;
    expect(duplicate.control).toEqual(resumed.control);
    expect(begin(duplicate, 20002).state.phase).toBe('countdown');
  });

  it('退出者の元の名前と部分記録を残し、今回も最終も順位から外す', () => {
    let state = playRound(createGame(init({ players: players(3) })).state, [10000, 10100, 10200]);
    state = updateGame(state, { t: 'players', nowMs: 17000, players: players(3).slice(1), leader: 2 }).state;
    expect(publicView(state).rows[0]).toMatchObject({ p: 1, rank: null, totalTenths: 0, roundsCompleted: 1, left: true });
    expect(publicView(state).rows.map((row) => row.rank)).toEqual([null, 1, 2]);
    state = playRound(state, [null, 10000, 10100], 18000);
    expect(publicView(state).rows[0]).toEqual({ p: 1, record: null, rank: null, totalTenths: 0, roundsCompleted: 1, left: true });
    state = playRound(state, [null, 10000, 10100], 36000);
    const ended = begin(state, 54000);
    expect(ended.effects.find((effect) => effect.t === 'end').results).toEqual([
      { p: 1, score: 0, label: '途中ズレ 0.0秒', ranked: false },
      { p: 2, score: -1, label: '合計ズレ 0.1秒', ranked: true },
      { p: 3, score: -4, label: '合計ズレ 0.4秒', ranked: true },
    ]);
    expect(ended.state.seats[0].name).toBe('P1');
  });

  it('最初の記録がない退出席も未計測として残し、優勝させない', () => {
    let state = createGame(init({ players: players(3) })).state;
    state = updateGame(state, { t: 'players', nowMs: 0, players: players(3).slice(1), leader: 2 }).state;
    for (const time of [0, 18000, 36000]) state = playRound(state, [null, 10000, 10000], time);
    expect(publicView(state).rows[0]).toEqual({ p: 1, record: null, rank: null, totalTenths: 0, roundsCompleted: 0, left: true });
    const result = begin(state, 54000).effects.find((effect) => effect.t === 'end');
    expect(result.results[0]).toEqual({ p: 1, score: 0, label: '未計測', ranked: false });
  });

  it('3回とも発表してから総合結果へ進み、累計は表示の整数ズレで採点する', () => {
    let state = createGame(init({ players: players(3) })).state;
    const samples = [[9949, 10050, 10100], [9950, 10000, 10100], [10050, 9949, 10100]];
    for (let i = 0; i < samples.length; i++) {
      state = playRound(state, samples[i], i * 18000);
      expect(state.phase).toBe('reveal');
      expect(state.roundIndex).toBe(i);
      expect(state.records).toHaveLength(i + 1);
    }
    expect(publicView(state)).toMatchObject({ phase: 'reveal', action: 'finish', actionLabel: '総合結果へ', canContinue: true });
    expect(publicView(state).rows.map((row) => row.totalTenths)).toEqual([2, 2, 3]);
    expect(state.control.action).toBe('finish');
    const ended = begin(state, 54000);
    expect(ended.state.phase).toBe('ended');
    expect(ended.effects.filter((effect) => effect.t === 'end')).toEqual([{
      t: 'end', results: [
        { p: 1, score: -2, label: '合計ズレ 0.2秒', ranked: true },
        { p: 2, score: -2, label: '合計ズレ 0.2秒', ranked: true },
        { p: 3, score: -3, label: '合計ズレ 0.3秒', ranked: true },
      ], options: { display: 'record', outcome: 'complete', note: '通信の遅れを含む目安です' },
    }]);
    expect(publicView(ended.state).phase).toBe('ended');
  });

  it('総合結果へも旧操作・非leader・離しを拒み、endedは全イベントに対しendを再発行しない終端になる', () => {
    let state = createGame(init()).state;
    let previousId;
    for (const time of [0, 18000, 36000]) {
      previousId = state.control.id;
      state = playRound(state, [10000, 10000], time);
    }
    for (const [p, id, down] of [[1, previousId, true], [2, state.control.id, true], [1, state.control.id, false]]) {
      expect(press(state, p, id, 54000, down)).toEqual({ state, effects: [] });
    }
    const ended = begin(state, 54000).state;
    for (const event of [
      { t: 'frame', nowMs: 55000 },
      { t: 'press', nowMs: 55000, p: 1, id: state.control.id, down: true },
      { t: 'menu', nowMs: 55000, paused: true },
      { t: 'environment', nowMs: 55000, value: null },
      { t: 'players', nowMs: 55000, players: [], leader: null },
    ]) expect(updateGame(ended, event)).toEqual({ state: ended, effects: [] });
  });

  it('全員時間切れを含む最長3回でも結果を各5秒見て100秒以内に完了できる', () => {
    let nowMs = 0;
    let state = createGame(init({ players: players(8) })).state;
    for (let round = 0; round < 3; round++) {
      state = playRound(state, Array(8).fill(null), nowMs);
      nowMs += 23000 + 5000;
      expect(state.phase).toBe('reveal');
      expect(state.roundIndex).toBe(round);
    }
    const ended = begin(state, nowMs);
    expect(nowMs).toBeLessThanOrEqual(100000);
    expect(ended.state.phase).toBe('ended');
    const result = ended.effects.find((effect) => effect.t === 'end');
    expect(result.results).toHaveLength(8);
    expect(result.results.every((row) => row.score === -300 && row.label === '合計ズレ 30.0秒' && row.ranked)).toBe(true);
    expect(result.results.every((row) => [...row.label].length <= 12)).toBe(true);
  });

  it('発表したrowsの変更は内部の確定記録や累計を変えず、凍結した状態で3回完了できる', () => {
    let state = freeze(createGame(freeze(init())).state);
    for (const time of [0, 18000, 36000]) state = freeze(playRound(state, [10000, 10050], time));
    const view = publicView(state);
    view.rows[0].record.errorTenths = 99;
    view.rows[0].totalTenths = 99;
    view.records[0].record.tenths = 0;
    expect(publicView(state).rows.map((row) => row.totalTenths)).toEqual([0, 3]);
    expect(begin(state, 54000).effects.find((effect) => effect.t === 'end').results.map((row) => row.score)).toEqual([0, -3]);
  });
});

const permutations = (values) => values.length === 0 ? [[]]
  : values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map((tail) => [value, ...tail]));

describe('中断した試行の破棄と明示的なやり直し (5.1–5.4, 5.7)', () => {
  const interruptions = [
    ['menu', { t: 'menu', paused: true, nowMs: 32000 }],
    ['host-offline', { t: 'environment', value: { connected: false, visible: true }, nowMs: 32000 }],
    ['hidden', { t: 'environment', value: { connected: true, visible: false }, nowMs: 32000 }],
    ['unknown-environment', { t: 'environment', value: null, nowMs: 32000 }],
    ['player-offline', { t: 'players', players: players(3, [2]), leader: 1, nowMs: 32000 }],
  ];
  it.each(['countdown', 'counting'].flatMap((phase) => interruptions.map(([reason, event]) => [phase, reason, event])))
  ('%s中の%sは全員の当該試行を捨て、以前の回と席のidentityを保持する', (phase, _, event) => {
    const first = playRound(createGame(init({ players: players(3) })).state, [9949, 10000, 10100]);
    let state = begin(first, 18000).state;
    if (phase === 'counting') state = stop(frame(state, 21000).state, 1, 10000).state;
    const before = freeze(state);
    const oldStopId = before.trial.stopId;
    const result = updateGame(before, event);
    expect(result.state).toMatchObject({ phase: 'recover', recoverTarget: 'trial', roundIndex: 1, attemptSeq: 2, trial: null, control: null });
    expect(result.state.records).toEqual(first.records);
    expect(result.state.seats.map(({ id, name, left }) => ({ id, name, left }))).toEqual(first.seats.map(({ id, name, left }) => ({ id, name, left })));
    expect(before.trial).not.toBeNull();
    expect(result.effects.every((effect) => effect.t === 'pad' && effect.spec.k === 'wait')).toBe(true);
    expect(press(result.state, 1, oldStopId, 100000)).toEqual({ state: result.state, effects: [] });
    expect(frame(result.state, 100000)).toEqual({ state: result.state, effects: [] });
    const view = publicView(result.state);
    expect(view).toMatchObject({ phase: 'recover', recoverTarget: 'trial', canRetry: false, action: 'retry', actionLabel: 'やり直す' });
    for (const key of ['trial', 'records', 'rows', 'stops', 'stopId', 'goAtMs', 'elapsedMs', 'tenths', 'totalTenths', 'attemptSeq']) {
      expect(keysOf(view)).not.toContain(key);
    }
  });

  it('20秒と同時に中断を検知した場合も、未確定の時間切れを採点しない', () => {
    const state = stop(counting(), 1, 10000).state;
    const result = updateGame(state, { t: 'environment', nowMs: 23000, value: { connected: false, visible: true } });
    expect(result.state).toMatchObject({ phase: 'recover', trial: null, records: [] });
    expect(result.effects.every((effect) => effect.t === 'pad')).toBe(true);
  });

  it.each(permutations(['menu', 'host-offline', 'hidden', 'player-offline']))
  ('解除順%s → %s → %s → %sでも全解除とleaderの操作まで計測を再開しない', (...order) => {
    const intro = createGame(init({ players: players(3) })).state;
    const beginId = intro.control.id;
    let state = frame(begin(intro).state, 3000).state;
    const oldStopId = state.trial.stopId;
    state = stop(state, 1, 10000).state;
    state = updateGame(state, { t: 'menu', paused: true, nowMs: 14000 }).state;
    state = updateGame(state, { t: 'environment', value: { connected: false, visible: false }, nowMs: 14001 }).state;
    state = updateGame(state, { t: 'players', players: players(3, [2]), leader: 1, nowMs: 14002 }).state;
    expect(state.blockers).toEqual(['menu', 'host-offline', 'hidden', 'player-offline']);
    let nowMs = 15000;
    for (const [index, reason] of order.entries()) {
      const event = reason === 'menu' ? { t: 'menu', paused: false, nowMs }
        : reason === 'player-offline' ? { t: 'players', players: players(3), leader: 1, nowMs }
          : { t: 'environment', value: { ...state.environment, [reason === 'hidden' ? 'visible' : 'connected']: true }, nowMs };
      state = updateGame(state, event).state;
      expect(state).toMatchObject({ phase: 'recover', trial: null, records: [], roundIndex: 0, attemptSeq: 1 });
      expect(state.blockers).toHaveLength(3 - index);
      expect(state.control !== null).toBe(index === 3);
      expect(frame(state, nowMs + 100000)).toEqual({ state, effects: [] });
      expect(press(state, 1, beginId, nowMs)).toEqual({ state, effects: [] });
      expect(press(state, 1, oldStopId, nowMs)).toEqual({ state, effects: [] });
      nowMs += 1;
    }
    expect(publicView(state)).toMatchObject({ phase: 'recover', canRetry: true });
    expect(state.control.action).toBe('retry');
    const retryId = state.control.id;
    expect(press(state, 2, retryId, nowMs)).toEqual({ state, effects: [] });
    expect(press(state, 1, retryId, nowMs, false)).toEqual({ state, effects: [] });
    const next = begin(state, nowMs).state;
    expect(next).toMatchObject({ phase: 'countdown', roundIndex: 0, attemptSeq: 2, trial: { startedAtMs: nowMs, cue: 3 } });
    expect(next.trial.stopId).not.toBe(oldStopId);
    expect(press(next, 1, retryId, nowMs + 1)).toEqual({ state: next, effects: [] });
    const go = frame(next, nowMs + 3000).state;
    expect(press(go, 1, oldStopId, nowMs + 13000)).toEqual({ state: go, effects: [] });
    expect(stopped(stop(go, 1, 10000).state, 1).elapsedMs).toBe(10000);
  });

  it('再開を待つ間のleader交代・再中断は古いretryを失効させ、現在のleaderだけが同じ回をやり直す', () => {
    let state = updateGame(counting(), { t: 'menu', paused: true, nowMs: 4000 }).state;
    state = updateGame(state, { t: 'menu', paused: false, nowMs: 5000 }).state;
    const formerRetry = state.control.id;
    state = updateGame(state, { t: 'players', players: players(2), leader: 2, nowMs: 5001 }).state;
    expect(state.control).toMatchObject({ p: 2, action: 'retry' });
    expect(state.control.id).not.toBe(formerRetry);
    expect(press(state, 1, state.control.id, 5002)).toEqual({ state, effects: [] });
    expect(press(state, 2, formerRetry, 5002)).toEqual({ state, effects: [] });
    const secondRetry = state.control.id;
    state = updateGame(state, { t: 'environment', value: { connected: true, visible: false }, nowMs: 5003 }).state;
    state = updateGame(state, { t: 'players', players: players(2), leader: null, nowMs: 5004 }).state;
    state = updateGame(state, { t: 'environment', value: environment, nowMs: 5005 }).state;
    expect(state.control).toBeNull();
    state = updateGame(state, { t: 'players', players: players(2), leader: 1, nowMs: 5006 }).state;
    const finalRetry = state.control;
    expect(finalRetry).toMatchObject({ p: 1, action: 'retry' });
    expect(finalRetry.id).not.toBe(formerRetry);
    expect(finalRetry.id).not.toBe(secondRetry);
    const duplicate = updateGame(state, { t: 'environment', value: environment, nowMs: 5007 });
    expect(duplicate.state.control).toEqual(finalRetry);
    expect(duplicate.effects).toEqual([]);
    expect(frame(state, 100000)).toEqual({ state, effects: [] });
    expect(begin(state, 100001).state).toMatchObject({ phase: 'countdown', roundIndex: 0, attemptSeq: 2 });
  });

  it('切断から60秒を超えても独自に席を消さず、名簿で消えた時だけ退出として残る2人で再開する', () => {
    const original = counting({ players: players(3) });
    const offline = updateGame(original, { t: 'players', players: players(3, [2]), leader: 1, nowMs: 4000 }).state;
    const waiting = frame(offline, 604000).state;
    expect(waiting).toMatchObject({ phase: 'recover', control: null, trial: null });
    expect(waiting.seats[1]).toEqual({ id: 2, name: 'P2', online: false, left: false });
    expect(publicView(waiting).message).toBe('つなぎ直しを待っています');
    const removed = updateGame(waiting, { t: 'players', players: players(3).filter((p) => p.id !== 2), leader: 1, nowMs: 604001 });
    expect(removed.state).toMatchObject({ phase: 'recover', blockers: [], records: [] });
    expect(removed.state.seats[1]).toEqual({ id: 2, name: 'P2', online: false, left: true });
    expect(removed.effects.find((effect) => effect.to === 1).spec.buttons[0].label).toBe('やり直す');
    const next = begin(removed.state, 604002).state;
    expect(next.trial.participants).toEqual([1, 3]);
  });

  it('直接退出・除外だけでも試行を破棄し、同番号の再利用と途中参加を元の席へ加えない', () => {
    const current = stop(counting({ players: players(3) }), 1, 10000).state;
    const gone = updateGame(current, { t: 'players', players: players(2), leader: 1, nowMs: 14000 }).state;
    expect(gone).toMatchObject({ phase: 'recover', trial: null, blockers: [], records: [] });
    expect(gone.control.action).toBe('retry');
    const reused = players(4, [3, 4]);
    reused[2].name = '別の人';
    const joined = updateGame(gone, { t: 'players', players: reused, leader: 1, nowMs: 15000 }).state;
    expect(joined.seats[2]).toEqual({ id: 3, name: 'P3', online: false, left: true });
    expect(joined.blockers).toEqual([]);
    expect(publicView(joined).waitingPlayers).toEqual([{ id: 3, name: '別の人' }, { id: 4, name: 'P4' }]);
    const next = begin(joined, 16000).state;
    expect(next.trial.participants).toEqual([1, 2]);
    const go = frame(next, 19000).state;
    expect(press(go, 3, go.trial.stopId, 20000)).toEqual({ state: go, effects: [] });
  });

  it('やり直した第2回から先へ進む際も、前のnextとretryの遅延入力で回数を飛ばさない', () => {
    const first = playRound(createGame(init()).state, [10000, 10050]);
    const nextId = first.control.id;
    let state = begin(first, 18000).state;
    state = updateGame(state, { t: 'menu', paused: true, nowMs: 19000 }).state;
    state = updateGame(state, { t: 'menu', paused: false, nowMs: 20000 }).state;
    expect(press(state, 1, nextId, 20001)).toEqual({ state, effects: [] });
    const retryId = state.control.id;
    state = frame(begin(state, 21000).state, 24000).state;
    state = stop(stop(state, 1, 10000).state, 2, 10100).state;
    expect(state).toMatchObject({ phase: 'reveal', roundIndex: 1, attemptSeq: 3 });
    expect(state.records).toHaveLength(2);
    for (const id of [nextId, retryId]) expect(press(state, 1, id, 40000)).toEqual({ state, effects: [] });
    expect(begin(state, 40001).state).toMatchObject({ phase: 'countdown', roundIndex: 2, attemptSeq: 4 });
  });

  it('中断中のpadは接続待ちを示し、全解除後はleaderだけにやり直すを提示する', () => {
    const original = counting();
    const offline = updateGame(original, { t: 'players', players: players(2, [2]), leader: 1, nowMs: 4000 });
    expect(offline.effects).toEqual([1, 2].map((to) => ({ t: 'pad', to, spec: { k: 'wait', title: 'つなぎ直しを待っています' } })));
    const recovered = updateGame(offline.state, { t: 'players', players: players(2), leader: 1, nowMs: 5000 });
    expect(recovered.effects).toEqual([
      { t: 'pad', to: 1, spec: { k: 'pad', stick: 'none', orient: 'portrait', buttons: [{ id: recovered.state.control.id, label: 'やり直す' }], hint: 'みんながそろったら、同じ回をやり直そう' } },
      { t: 'pad', to: 2, spec: { k: 'wait', title: '進行役の「やり直す」を待っています', body: '同じ回を、せーのからやり直そう' } },
    ]);
    expect(publicView(recovered.state).message).toBe('進行役の「やり直す」を待っています');
  });
});

describe('確定後の待機と人数不足による未成立 (5.5, 5.6, 7.2)', () => {
  it('発表中は複数理由を解除しても確定記録を維持し、改めて現在leaderの次へを待つ', () => {
    const original = playRound(createGame(init({ players: players(3) })).state, [9949, 10000, 10100]);
    const oldNext = original.control.id;
    let state = updateGame(original, { t: 'players', players: players(3, [2]), leader: 3, nowMs: 15000 }).state;
    expect(state).toMatchObject({ phase: 'reveal', control: null });
    expect(state.records).toEqual(original.records);
    const blockedRows = publicView(state).rows;
    state = updateGame(state, { t: 'menu', paused: true, nowMs: 15001 }).state;
    state = updateGame(state, { t: 'environment', value: { connected: false, visible: false }, nowMs: 15002 }).state;
    state = updateGame(state, { t: 'players', players: players(3), leader: 3, nowMs: 15003 }).state;
    state = updateGame(state, { t: 'environment', value: environment, nowMs: 15004 }).state;
    expect(publicView(state).canContinue).toBe(false);
    const result = updateGame(state, { t: 'menu', paused: false, nowMs: 15005 });
    state = result.state;
    expect(state.phase).toBe('reveal');
    expect(publicView(state).rows).toEqual(blockedRows);
    expect(state.control).toMatchObject({ p: 3, action: 'next' });
    expect(state.control.id).not.toBe(oldNext);
    expect(press(state, 1, state.control.id, 15006)).toEqual({ state, effects: [] });
    expect(press(state, 3, oldNext, 15006)).toEqual({ state, effects: [] });
    expect(begin(state, 15007).state).toMatchObject({ phase: 'countdown', roundIndex: 1 });
  });

  it.each(['countdown', 'counting', 'reveal', 'recover'])
  ('開始後%sで残る固定席が1人になったら、全員順位なし・理由つきで1回だけ終了する', (phase) => {
    let state = createGame(init({ players: players(3) })).state;
    state = updateGame(state, { t: 'players', players: players(2), leader: 1, nowMs: 0 }).state;
    state = playRound(state, [10000, 10100, null]);
    if (phase !== 'reveal') state = begin(state, 18000).state;
    if (phase === 'counting') state = stop(frame(state, 21000).state, 1, 10000).state;
    if (phase === 'recover') state = updateGame(state, { t: 'menu', paused: true, nowMs: 19000 }).state;
    const result = updateGame(freeze(state), { t: 'players', players: players(1), leader: 1, nowMs: 32000 });
    expect(result.state).toMatchObject({ phase: 'ended', outcome: 'incomplete', trial: null, control: null, records: state.records });
    const end = result.effects.find((effect) => effect.t === 'end');
    expect(end.results).toEqual([
      { p: 1, score: 0, label: '途中ズレ 0.0秒', ranked: false },
      { p: 2, score: -1, label: '途中ズレ 0.1秒', ranked: false },
      { p: 3, score: 0, label: '未計測', ranked: false },
    ]);
    expect(end.options).toMatchObject({ display: 'record', outcome: 'incomplete' });
    expect(end.options.note).toContain('人数が足りないため、今回は勝敗なし');
    expect(end.options.note).toContain('通信の遅れを含む目安です');
    expect([...end.options.note].length).toBeLessThanOrEqual(120);
    expect(end.options.note).not.toContain('P1');
    expect(publicView(result.state)).toMatchObject({ phase: 'ended', outcome: 'incomplete' });
    for (const event of [
      { t: 'frame', nowMs: 100000 },
      { t: 'players', players: players(3), leader: 1, nowMs: 100000 },
      { t: 'environment', value: environment, nowMs: 100000 },
      { t: 'menu', paused: false, nowMs: 100000 },
      { t: 'press', p: 1, id: 'old-id', down: true, nowMs: 100000 },
    ]) expect(updateGame(result.state, event)).toEqual({ state: result.state, effects: [] });
  });

  it('最初の計測前に全員が退出しても初期の全席を未計測として終了データに残す', () => {
    const state = begin(createGame(init({ players: players(3) })).state).state;
    const result = updateGame(state, { t: 'players', players: [], leader: null, nowMs: 1000 });
    expect(result.state.phase).toBe('ended');
    expect(result.state.seats.map((seat) => [seat.id, seat.name, seat.left])).toEqual([[1, 'P1', true], [2, 'P2', true], [3, 'P3', true]]);
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({ t: 'end', options: { outcome: 'incomplete' } });
    expect(result.effects[0].results).toEqual([1, 2, 3].map((p) => ({ p, score: 0, label: '未計測', ranked: false })));
  });

  it('過去の記録がある状態で全員退出しても、途中累計と元の席を捨てずに終了する', () => {
    const first = playRound(createGame(init({ players: players(3) })).state, [9949, 10000, 10100]);
    const current = begin(first, 18000).state;
    const result = updateGame(current, { t: 'players', players: [], leader: null, nowMs: 19000 });
    expect(result.state).toMatchObject({ phase: 'ended', outcome: 'incomplete', records: first.records });
    expect(result.effects[0].results.map((row) => [row.p, row.score, row.label, row.ranked])).toEqual([
      [1, -1, '途中ズレ 0.1秒', false], [2, 0, '途中ズレ 0.0秒', false], [3, -1, '途中ズレ 0.1秒', false],
    ]);
  });

  it('開始前の人数不足では未成立の終了を発行せず、説明画面で必要人数を示す', () => {
    const original = createGame(init()).state;
    const one = updateGame(original, { t: 'players', players: players(1), leader: 1, nowMs: 1000 });
    expect(one.state).toMatchObject({ phase: 'intro', control: null });
    expect(publicView(one.state)).toMatchObject({ phase: 'intro', canBegin: false, neededPlayers: 1 });
    expect(one.effects.some((effect) => effect.t === 'end')).toBe(false);
    const none = updateGame(one.state, { t: 'players', players: [], leader: null, nowMs: 2000 });
    expect(none.state.phase).toBe('intro');
    expect(publicView(none.state).neededPlayers).toBe(2);
    expect(none.effects).toEqual([]);
    expect(frame(none.state, 100000).state.phase).toBe('intro');
  });
});
