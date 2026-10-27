import { describe, expect, it } from 'vitest';
import { BUZZ, MODES, createGame, modeId, padFor, publicView, updateGame } from './logic.js';
import { simulate } from './physics.js';
import { scoreCard } from './scoring.js';

const players = (n = 3, offline = []) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, online: !offline.includes(i + 1) }));
const ENV = { connected: true, visible: true };
const init = (o = {}) => ({ players: players(), leader: 1, environment: ENV, paused: false, nonce: 'lane42', ...o });
const send = (s, p, input) => updateGame(s, { t: 'input', p, input });
const ptr = (s, p, ph, x, y) => send(s, p, { k: 'ptr', id: 'touch', x, y, ph });
const ev = (s, e) => updateGame(s, e).state;
/** リーダーが長さを選んで始める。 */
const start = (o = {}, frames = MODES.long) => {
  const s = createGame(init(o)).state;
  return send(s, s.leader, { k: 'pick', id: modeId(s, frames) }).state;
};
/** 番の席が、置いて・引いて・はなす。 */
const swipe = (s, from, to, p = s.turn.p) => {
  let t = ptr(s, p, 's', from[0], from[1]).state;
  t = ptr(t, p, 'm', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2).state;
  return ptr(t, p, 'e', to[0], to[1]);
};
// 画面が出す「再生が終わった」「字幕を見せ終えた」。
const settle = (s) => updateGame(s, { t: 'settled', id: s.roll.id });
const next = (s) => updateGame(s, { t: 'next', id: s.roll.id });
const throwAndFinish = (s, from, to) => next(settle(swipe(s, from, to).state).state).state;
// 物理の表から選んだ決まった投げ方：まっすぐ真ん中（割れて残る）と、ガター。
const CENTER = [[0.5, 0.15], [0.5, 0.711]]; // startX 0, power 0.7, hook 0（8本。割れて残る）
const GUTTER = [[0.86, 0.15], [1, 0.711]]; // startX 0.612、縁へ hook 0.4（ガター）
const POCKET = [[0.1, 0.15], [0.31, 0.711]]; // startX −0.68、hook 0.6（ストライクが続く幅の中ほど）
const freeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
};

describe('開始', () => {
  it.each([1, 3, 6])('%i人：リーダーにだけ長さの選択肢、ほかは wait', (n) => {
    const { state, effects } = createGame(init({ players: players(n) }));
    expect(state.phase).toBe('intro');
    const pads = effects.filter((e) => e.t === 'pad');
    expect(pads.map((e) => e.to)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(pads[0].spec).toMatchObject({ k: 'choices', options: [{ id: modeId(state, 10) }, { id: modeId(state, 5) }] });
    pads.slice(1).forEach((e) => expect(e.spec.k).toBe('wait'));
    expect(pads[0].spec.options.every((o) => /^[a-z0-9_-]{1,24}$/.test(o.id) && [...o.label].length <= 12)).toBe(true);
  });
  it('ふつうは10フレーム、みじかめは5フレームで、最初の席から投げる', () => {
    const long = start();
    expect(long).toMatchObject({ phase: 'aim', frames: 10, startCount: 3, turn: { p: 1, frame: 0, ball: 0 } });
    expect(start({}, 5).frames).toBe(5);
    const pad = padFor(long, long.seats[0]);
    expect(pad).toMatchObject({ k: 'touch', mode: 'swipe' });
    expect(pad.hint).toContain('指をおいて、下に引いて、はなす');
    expect([...pad.hint].length).toBeLessThanOrEqual(40);
    // 番でない人には、誰の番かと自分の合計。
    expect(padFor(long, long.seats[1])).toEqual({ k: 'wait', title: 'P1さんの番', body: '第1フレーム・1投目。あなたの合計 0点' });
  });
  it.each([[0], [7]])('%i人では始めない', (n) => {
    const { state } = createGame(init({ players: players(n), leader: n ? 1 : null }));
    expect(state.chooser).toBeNull();
    expect(send(state, 1, { k: 'pick', id: modeId(state, 10) }).state).toBe(state);
  });
  it('リーダー以外・古い id・知らない id では始まらない', () => {
    const s = createGame(init()).state;
    expect(send(s, 2, { k: 'pick', id: modeId(s, 10) }).effects).toEqual([]);
    expect(send(s, 1, { k: 'pick', id: 'm_lane42_0_10' }).effects).toEqual([]);
    expect(send(s, 1, { k: 'pick', id: `${modeId(s, 10)}x` }).effects).toEqual([]);
    // 一時停止して戻ると id が新しくなり、前の選択肢は受け付けない。
    const old = modeId(s, 10);
    let t = ev(s, { t: 'menu', paused: true });
    expect(send(t, 1, { k: 'pick', id: old }).effects).toEqual([]);
    t = ev(t, { t: 'menu', paused: false });
    expect(modeId(t, 10)).not.toBe(old);
    expect(send(t, 1, { k: 'pick', id: old }).effects).toEqual([]);
    expect(send(t, 1, { k: 'pick', id: modeId(t, 10) }).state.phase).toBe('aim');
  });
  it('リーダーが替わったら、新しいリーダーにだけ選択肢を出し直す', () => {
    const s = createGame(init()).state;
    const { state, effects } = updateGame(s, { t: 'players', players: players(), leader: 2 });
    expect(state.chooser).toBe(2);
    expect(effects.find((e) => e.to === 2).spec.k).toBe('choices');
    expect(effects.find((e) => e.to === 1).spec.k).toBe('wait');
    expect(send(state, 1, { k: 'pick', id: modeId(s, 10) }).effects).toEqual([]);
    expect(send(state, 2, { k: 'pick', id: modeId(state, 5) }).state.frames).toBe(5);
  });
  it('始める前に抜けた席は、名簿から外して始める', () => {
    let s = createGame(init()).state;
    s = ev(s, { t: 'players', players: players(3).filter((p) => p.id !== 2), leader: 1 });
    s = send(s, 1, { k: 'pick', id: modeId(s, 10) }).state;
    expect(s.seats.map((x) => x.id)).toEqual([1, 3]);
    expect(s.startCount).toBe(2);
  });
});

describe('投げる', () => {
  it('置いて引いてはなすと、物理を1回だけ走らせて rolling へ。結果は同じ投げ方の物理と同じ', () => {
    const s = start();
    const { state, effects } = swipe(s, ...POCKET);
    expect(state.phase).toBe('rolling');
    expect(state.roll).toMatchObject({ id: 1, p: 1, frame: 0, ball: 0, kind: 'strike' });
    expect(state.roll.result).toEqual(simulate(state.roll.shot, s.standing));
    expect(effects).toContainEqual({ t: 'cue', name: 'roll', v: 0.75 });
    expect(effects).toContainEqual({ t: 'vibrate', to: 1, ms: BUZZ.release });
    expect(effects.find((e) => e.t === 'pad' && e.to === 1).spec.k).toBe('wait');
    // 得点表は、再生が終わるまで変えない。
    expect(publicView(state).participants[0].total).toBe(0);
  });
  it('再生が終わると記録して字幕の段階へ。ストライクなら効果音と長い振動', () => {
    const rolled = swipe(start(), ...POCKET).state;
    const { state, effects } = settle(rolled);
    expect(state.phase).toBe('settled');
    expect(state.seats[0].rolls).toEqual([10]);
    expect(effects).toContainEqual({ t: 'cue', name: 'strike', v: 1 });
    expect(effects).toContainEqual({ t: 'vibrate', to: 1, ms: BUZZ.strike });
    expect(publicView(state).participants[0].card[0].marks).toEqual(['', 'X']);
  });
  it('1投目でピンが残れば同じ席がもう一度（残ったピンだけ）、倒し切れば次の席', () => {
    let s = start();
    const first = swipe(s, ...CENTER).state;
    expect(first.roll.kind).toBe('pins');
    s = settle(first).state;
    const left = first.roll.result.down.map((d) => !d);
    s = next(s).state;
    expect(s).toMatchObject({ phase: 'aim', turn: { p: 1, frame: 0, ball: 1 } });
    expect(s.standing).toEqual(left);
    // 2投目のピンは、1投目で残ったものだけ。
    const second = swipe(s, ...CENTER).state;
    expect(second.roll.standing).toEqual(left);
    expect(second.roll.result.present).toEqual(left);
    s = next(settle(second).state).state;
    expect(s).toMatchObject({ phase: 'aim', turn: { p: 2, frame: 0, ball: 0 } });
    expect(s.standing.every(Boolean)).toBe(true);
    // ストライクなら、同じ席の2投目は無い。
    let t = throwAndFinish(s, ...POCKET);
    expect(t.turn).toEqual({ p: 3, frame: 0, ball: 0 });
    t = throwAndFinish(throwAndFinish(t, ...GUTTER), ...GUTTER);
    expect(t.turn).toEqual({ p: 1, frame: 1, ball: 0 });
  });
  it('ガターは0本で、ガターとして記録する', () => {
    const rolled = swipe(start(), ...GUTTER).state;
    expect(rolled.roll.kind).toBe('gutter');
    const { state, effects } = settle(rolled);
    expect(state.seats[0].rolls).toEqual([0]);
    expect(effects.some((e) => e.t === 'cue' && (e.name === 'strike' || e.name === 'spare'))).toBe(false);
    expect(effects).toContainEqual({ t: 'vibrate', to: 1, ms: BUZZ.miss });
  });
  it('1人・5フレームを最後まで投げ切ると、結果を1回だけ送る（全ガター0点）', () => {
    let s = start({ players: players(1) }, 5);
    let ends = 0;
    for (let k = 0; k < 10; k++) {
      s = swipe(s, ...GUTTER).state;
      s = settle(s).state;
      const r = next(s);
      ends += r.effects.filter((e) => e.t === 'end').length;
      s = r.state;
    }
    expect(s.phase).toBe('ended');
    expect(ends).toBe(1);
    expect(s.seats[0].rolls).toEqual(Array(10).fill(0));
    expect(updateGame(s, { t: 'next', id: s.roll.id }).effects).toEqual([]);
  });
  it('最終フレームのストライクは、同じ席が3投目まで投げる', () => {
    let s = start({ players: players(1) }, 5);
    for (let f = 0; f < 4; f++) s = throwAndFinish(throwAndFinish(s, ...GUTTER), ...GUTTER);
    expect(s.turn).toEqual({ p: 1, frame: 4, ball: 0 });
    s = throwAndFinish(s, ...POCKET);
    expect(s.turn).toEqual({ p: 1, frame: 4, ball: 1 });
    expect(s.standing.every(Boolean)).toBe(true);
    s = throwAndFinish(s, ...POCKET);
    expect(s.turn).toEqual({ p: 1, frame: 4, ball: 2 });
    const end = next(settle(swipe(s, ...POCKET).state).state);
    expect(end.state.phase).toBe('ended');
    expect(end.effects).toEqual([{ t: 'end', results: [{ p: 1, score: 30, ranked: true }], options: { display: 'points', outcome: 'complete', note: '5フレームの合計点です。同点は同じ順位です。' } }]);
  });
});

describe('受け付けない入力（状態を変えない）', () => {
  it('他の席・番の外・s のない m と e・違う種類の入力', () => {
    const s = freeze(start());
    for (const [p, input] of [
      [2, { k: 'ptr', id: 'touch', x: 0.5, y: 0.1, ph: 's' }],
      [1, { k: 'ptr', id: 'touch', x: 0.5, y: 0.9, ph: 'm' }],
      [1, { k: 'ptr', id: 'touch', x: 0.5, y: 0.9, ph: 'e' }],
      [1, { k: 'ptr', id: 'other', x: 0.5, y: 0.1, ph: 's' }],
      [1, { k: 'btn', id: 'go', d: 1 }],
      [1, { k: 'pick', id: modeId(s, 10) }],
      [1, { k: 'ptr', id: 'touch', x: Number.NaN, y: 0.1, ph: 's' }],
    ]) expect(send(s, p, input)).toEqual({ state: s, effects: [] });
  });
  it('ほかの席の指は、番の席の指の途中に混ざらない', () => {
    let s = ptr(start(), 1, 's', 0.5, 0.15).state;
    s = ptr(s, 2, 'e', 0.9, 0.95).state;
    expect(s.phase).toBe('aim');
    s = ptr(s, 1, 'e', 0.5, 0.711).state;
    expect(s.roll.shot).toEqual({ startX: 0, hook: 0, power: expect.closeTo(0.7, 9) });
  });
  it('引きが足りない（投げない）指は、得点・番・ピンを変えず、もう一度引ける', () => {
    const s = start();
    const { state, effects } = swipe(s, [0.5, 0.3], [0.5, 0.35]);
    expect(state).toMatchObject({ phase: 'aim', turn: s.turn, throws: 0, gesture: null, retry: true });
    expect(state.seats).toEqual(s.seats);
    expect(state.standing).toEqual(s.standing);
    expect(effects.find((e) => e.to === 1).spec.hint).toContain('もう少し長く');
    expect(swipe(state, ...CENTER).state.phase).toBe('rolling');
  });
  it('投げたあとに届いた指（rolling・settled 中）と、古い再生の知らせは無視する', () => {
    const rolled = freeze(swipe(start(), ...CENTER).state);
    for (const ph of ['s', 'm', 'e']) expect(ptr(rolled, 1, ph, 0.5, 0.9)).toEqual({ state: rolled, effects: [] });
    expect(updateGame(rolled, { t: 'settled', id: 99 })).toEqual({ state: rolled, effects: [] });
    expect(updateGame(rolled, { t: 'next', id: rolled.roll.id })).toEqual({ state: rolled, effects: [] });
    const settled = freeze(settle(rolled).state);
    expect(updateGame(settled, { t: 'settled', id: settled.roll.id })).toEqual({ state: settled, effects: [] });
    expect(ptr(settled, 1, 's', 0.5, 0.1)).toEqual({ state: settled, effects: [] });
  });
  it('同じ位置の送り直し（1秒ごとの m）は状態を変えない', () => {
    const s = ptr(start(), 1, 's', 0.5, 0.2).state;
    const moved = ptr(s, 1, 'm', 0.5, 0.6).state;
    expect(ptr(moved, 1, 'm', 0.5, 0.6)).toEqual({ state: moved, effects: [] });
  });
});

describe('同じ入力で同じ結果', () => {
  it('同じ指の列からは、同じ状態と効果になる（呼び出し元の状態を変えない）', () => {
    const play = () => {
      let s = freeze(start({ players: players(2) }));
      const out = [];
      for (const shot of [POCKET, CENTER, CENTER, GUTTER, CENTER]) {
        const r = swipe(s, ...shot);
        out.push(r.effects);
        s = r.state;
        s = settle(s).state;
        s = next(s).state;
      }
      return { s, out };
    };
    expect(play()).toEqual(play());
  });
  it('指の途中（m）の数や中身は、はなしたあとの結果を変えない', () => {
    const s = start();
    const a = ptr(ptr(s, 1, 's', ...POCKET[0]).state, 1, 'e', ...POCKET[1]).state;
    let b = ptr(s, 1, 's', ...POCKET[0]).state;
    for (const [x, y] of [[0.9, 0.2], [0.1, 0.9], [0.3, 0.5]]) b = ptr(b, 1, 'm', x, y).state;
    b = ptr(b, 1, 'e', ...POCKET[1]).state;
    expect(b.roll).toEqual(a.roll);
  });
});

describe('一時停止・接続切れ', () => {
  it('止まったら指の途中経過を捨て、再開後は同じ番から置き直す', () => {
    let s = ptr(start(), 1, 's', 0.5, 0.15).state;
    s = ptr(s, 1, 'm', 0.5, 0.6).state;
    const { state, effects } = updateGame(s, { t: 'menu', paused: true });
    expect(state.gesture).toBeNull();
    expect(effects.find((e) => e.to === 1).spec).toMatchObject({ k: 'wait', title: 'ひと休み中' });
    // 止まっている間の指は受け付けない。再開しても、止まる前の指の続き（e）では投げない。
    expect(ptr(state, 1, 's', 0.5, 0.1).effects).toEqual([]);
    const resumed = updateGame(state, { t: 'menu', paused: false });
    expect(resumed.effects.find((e) => e.to === 1).spec.k).toBe('touch');
    expect(ptr(resumed.state, 1, 'e', 0.5, 0.95).state).toBe(resumed.state);
    expect(resumed.state).toMatchObject({ phase: 'aim', turn: s.turn });
  });
  it('再生中に止まったら、再生の終わりを受け付けず、再開後に同じ投球を記録する', () => {
    const rolled = swipe(start(), ...POCKET).state;
    const paused = ev(rolled, { t: 'environment', value: { connected: true, visible: false } });
    expect(updateGame(paused, { t: 'settled', id: rolled.roll.id }).effects).toEqual([]);
    const back = ev(paused, { t: 'environment', value: ENV });
    expect(back.roll).toEqual(rolled.roll);
    const done = settle(back).state;
    expect(done.seats[0].rolls).toEqual([10]);
  });
  it('番の席の接続が切れたら、点を保って戻るまで待つ。ほかの席の指は受け付けない', () => {
    let s = ptr(start(), 1, 's', 0.5, 0.15).state;
    s = ev(s, { t: 'players', players: players(3, [1]), leader: 2 });
    expect(s).toMatchObject({ waiting: true, gesture: null, phase: 'aim', turn: { p: 1 } });
    expect(publicView(s).waiting).toBe(true);
    expect(ptr(s, 2, 's', 0.5, 0.1).effects).toEqual([]);
    s = ev(s, { t: 'players', players: players(3), leader: 2 });
    expect(s.waiting).toBe(false);
    expect(swipe(s, ...CENTER).state.phase).toBe('rolling');
  });
  it('番でない席の接続切れでは止まらない', () => {
    const s = ev(start(), { t: 'players', players: players(3, [3]), leader: 1 });
    expect(s.waiting).toBe(false);
    expect(swipe(s, ...CENTER).state.phase).toBe('rolling');
  });
});

describe('退出', () => {
  it('番の席が消えたら、その席の残りを飛ばして次の席から続け、結果では順位の外にする', () => {
    let s = start();
    s = ev(s, { t: 'players', players: players(3).filter((p) => p.id !== 1), leader: 2 });
    expect(s).toMatchObject({ phase: 'aim', turn: { p: 2, frame: 0, ball: 0 } });
    expect(s.seats.find((x) => x.id === 1).left).toBe(true);
    // 残りの2人で最後まで（5フレーム・全ガター）。
    s = start({}, 5);
    s = throwAndFinish(throwAndFinish(s, ...GUTTER), ...GUTTER);
    s = ev(s, { t: 'players', players: players(3).filter((p) => p.id !== 1), leader: 2 });
    let end = null;
    for (let k = 0; k < 40 && s.phase !== 'ended'; k++) {
      s = swipe(s, ...CENTER).state;
      s = settle(s).state;
      const r = next(s);
      end = r.effects.find((e) => e.t === 'end') ?? end;
      s = r.state;
    }
    expect(s.phase).toBe('ended');
    expect(end.options.outcome).toBe('complete');
    expect(end.results.map((r) => [r.p, r.ranked])).toEqual([[1, false], [2, true], [3, true]]);
    expect(end.results[0].score).toBe(0);
    expect(end.results[1].score).toBe(scoreCard(s.seats[1].rolls, 5).total);
  });
  it('2人以上で始めて、順位を付けられる席が1人になったら、全員の記録を残して未成立で終える', () => {
    let s = throwAndFinish(start({ players: players(2) }), ...POCKET);
    const r = updateGame(s, { t: 'players', players: players(2).filter((p) => p.id !== 2), leader: 1 });
    expect(r.state.phase).toBe('ended');
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0]).toMatchObject({ t: 'end', options: { display: 'points', outcome: 'incomplete' } });
    expect(r.effects[0].results).toEqual([{ p: 1, score: 10, ranked: false }, { p: 2, score: 0, ranked: false }]);
    expect(updateGame(r.state, { t: 'players', players: [], leader: null }).effects).toEqual([]);
  });
  it('1人で始めた勝負は、そのまま続ける。その1人が消えたら未成立で終える', () => {
    let s = start({ players: players(1) });
    s = ev(s, { t: 'players', players: players(1, [1]), leader: 1 });
    expect(s.phase).toBe('aim');
    const r = updateGame(s, { t: 'players', players: [], leader: null });
    expect(r.state.phase).toBe('ended');
    expect(r.effects[0].options.outcome).toBe('incomplete');
  });
  it('再生中に投げた人が消えても、再生を終えて次の席へ進む', () => {
    let s = swipe(start(), ...CENTER).state;
    s = ev(s, { t: 'players', players: players(3).filter((p) => p.id !== 1), leader: 2 });
    expect(s.phase).toBe('rolling');
    const settled = settle(s);
    expect(settled.effects.some((e) => e.t === 'vibrate')).toBe(false);
    s = next(settled.state).state;
    expect(s.turn).toEqual({ p: 2, frame: 0, ball: 0 });
  });
  it('途中から来た人は参加者にせず、次の勝負からと伝える', () => {
    const s = start();
    const { state, effects } = updateGame(s, { t: 'players', players: players(4), leader: 1 });
    expect(state.seats).toEqual(s.seats);
    expect(effects).toEqual([{ t: 'pad', to: 4, spec: { k: 'wait', title: '次の勝負から参加できます' } }]);
    expect(ptr(state, 4, 's', 0.5, 0.1).effects).toEqual([]);
  });
});

describe('共用画面の形', () => {
  it('指の途中は予想（位置・強さ・曲がり）だけ。再生中は結果と再生データを渡す', () => {
    let s = ptr(start(), 1, 's', 0.2, 0.2).state;
    s = ptr(s, 1, 'm', 0.3, 0.6).state;
    const v = publicView(s);
    expect(v.aim).toMatchObject({ ok: true, startX: expect.closeTo(-0.51, 9), hook: expect.closeTo(0.1 / 0.35, 9) });
    expect(v.roll).toBeNull();
    const rolled = publicView(swipe(start(), ...POCKET).state);
    expect(rolled.roll).toMatchObject({ kind: 'strike', knocked: 10, pinsBefore: 10 });
    expect(rolled.roll.result.frames.length).toBeGreaterThan(60);
  });
});
