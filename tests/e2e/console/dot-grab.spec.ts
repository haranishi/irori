// dot-grab（あつめて点）：スティックを倒し続けると動き続け（スマホが約1秒ごとに同じ向きを送り直す）、
// 取った点が結果に出る。終わり方は時間切れと全員退出（抜けた人も、抜けたときの数で結果に残る）。席が切れると、その席の入力では動き続けない。
// 位置はゲームのキャンバスから読む（lib/dotgrab.ts）。時間切れは、ホストの時計を進めて起こす。
import { AXIS_HOLD_MS, GAME_MS, INTRO_MS } from '../../../games/dot-grab/logic.js';
import { expect, test, type Rig } from './fixtures';
import { collect, moverAt } from './lib/dotgrab';
import { ALL, HOST, PHONE } from './lib/tags';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(rig: Rig, o: { line?: boolean } = {}) {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう'], o);
  await host.choose('dot-grab', pads[0]);
  await host.expectPhase('play', INTRO_MS + 10_000);
  for (const p of pads) await p.expectKind('pad');
  return { host, pads };
}

test('dot-grab：倒し続けると動き続ける（約1秒ごとの送り直し）。離すと止まる', ALL, async ({ rig }) => {
  const { host, pads } = await start(rig);
  const x0 = (await moverAt(host, 1)).x;
  await pads[0]!.stickDown(0.25, 0);
  const t0 = Date.now();
  const xs: number[] = [];
  for (const at of [1_000, 2_500, 4_000, 5_500]) {
    await sleep(Math.max(0, t0 + at - Date.now()));
    xs.push((await moverAt(host, 1)).x);
  }
  await pads[0]!.stickUp();
  // 倒している間ずっと右へ進む。送り直しがなければ、最後の入力から AXIS_HOLD_MS で止まる（4秒・5.5秒が同じになる）。
  expect(xs[0]! - x0, `位置 ${[x0, ...xs].map((x) => x.toFixed(0)).join(' → ')}`).toBeGreaterThan(20);
  for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!, `位置 ${[x0, ...xs].map((x) => x.toFixed(0)).join(' → ')}`).toBeGreaterThan(50);
  // ホストに届いた同じ向きの axis は、約1秒ごと。
  // 指の座標は画素に丸められることがあるので、0.25 の近く（向きは右）で見る。
  const held = host.inputs(1).filter((r) => r.f.i?.k === 'axis' && Math.abs((r.f.i.x ?? 0) - 0.25) < 0.04 && Math.abs(r.f.i.y ?? 0) < 0.04);
  expect(held.length).toBeGreaterThanOrEqual(5);
  const gaps = held.slice(1).map((r, i) => r.at - held[i]!.at);
  for (const g of gaps.slice(1)) {
    expect(g).toBeGreaterThan(600);
    expect(g).toBeLessThan(1_600);
  }
  // 離したら止まる。
  await sleep(300);
  const a = (await moverAt(host, 1)).x;
  await sleep(800);
  expect(Math.abs((await moverAt(host, 1)).x - a)).toBeLessThanOrEqual(1);
  // 時間切れで終える。
  await host.advance(GAME_MS);
  const rows = await host.results();
  expect(rows.map((r) => r.seat).sort()).toEqual([1, 2, 3]);
  for (const r of rows) expect(r.label).toBe(`${r.score}こ`);
});

test('dot-grab 時間切れ：スティックで点を取ると、取った数が結果に出る', HOST, async ({ rig }) => {
  const { host, pads } = await start(rig);
  const got1 = await collect(host, pads[0]!, 1, 2);
  const got2 = await collect(host, pads[1]!, 2, 1);
  expect(got1, '席1が点を取れた（振動の指示の数）').toBeGreaterThanOrEqual(1);
  await host.advance(GAME_MS);
  const rows = await host.results();
  const score = (seat: number) => rows.find((r) => r.seat === seat)?.score;
  expect(score(1)).toBe(pads[0]!.fx());
  expect(score(2)).toBe(pads[1]!.fx());
  expect(score(3)).toBe(0);
  expect(got1 + got2).toBe((score(1) ?? 0) + (score(2) ?? 0));
  for (const r of rows) expect(r.label).toBe(`${r.score}こ`);
  // 1位は、いちばん多く取った人。
  expect(rows[0]!.score).toBe(Math.max(...rows.map((r) => r.score)));
  await pads[0]!.tap('right');
  await pads[0]!.tap('ok');
  await host.expectState('home');
});

test('dot-grab 全員退出：1台が点を取ってから3台が bye。結果には3人とも、抜けたときの数で残る', HOST, async ({ rig }) => {
  const { host, pads } = await start(rig);
  const got = await collect(host, pads[0]!, 1, 1);
  expect(got, '席1が点を取れた（振動の指示の数）').toBeGreaterThanOrEqual(1);
  for (const p of pads) await p.leave();
  const rows = await host.results();
  const n = pads[0]!.fx();
  expect(rows.map((r) => [r.seat, r.score, r.label, r.gone])).toEqual([
    [1, n, `${n}こ`, true],
    [2, 0, '0こ', true],
    [3, 0, '0こ', true],
  ]);
  await host.key('Escape');
  await host.expectState('home');
});

test('dot-grab：倒している最中に席が切れたら、その場で止まり、つながり直しても勝手に動かない', PHONE, async ({ rig }) => {
  const { host, pads } = await start(rig, { line: true });
  rig.allowSocketErrors();
  await pads[0]!.stickDown(0.25, 0);
  await sleep(1_200);
  const moving = (await moverAt(host, 1)).x;
  pads[0]!.cut();
  await expect.poll(() => host.received.some((r) => r.f.t === 'online' && r.f.p === 1 && r.f.on === false)).toBe(true);
  await pads[0]!.expectLink('lost');
  await sleep(300);
  const a = await moverAt(host, 1);
  expect(a.faded, '切れた席の印は薄く描かれる').toBe(true);
  expect(a.x).toBeGreaterThan(moving);
  await sleep(1_500);
  expect(Math.abs((await moverAt(host, 1)).x - a.x)).toBeLessThanOrEqual(1);
  pads[0]!.restore();
  await pads[0]!.expectLink('open', 20_000);
  await expect.poll(() => host.received.some((r) => r.f.t === 'online' && r.f.p === 1 && r.f.on === true)).toBe(true);
  await expect.poll(async () => (await moverAt(host, 1)).faded).toBe(false);
  const b = (await moverAt(host, 1)).x;
  await sleep(1_500);
  expect(Math.abs((await moverAt(host, 1)).x - b), '戻っても、指を置き直すまで動かない').toBeLessThanOrEqual(1);
  await pads[0]!.stickUp();
  await host.advance(GAME_MS);
  await host.results();
});

test('dot-grab：倒している最中に回線が黙って死んでも、送り直しが届かなくなって数秒で止まる（暴走しない）', PHONE, async ({ rig }) => {
  const { host, pads } = await start(rig, { line: true });
  rig.allowSocketErrors();
  await pads[0]!.stickDown(0.25, 0);
  await sleep(1_200);
  pads[0]!.freeze();
  const t0 = Date.now();
  const x0 = (await moverAt(host, 1)).x;
  await sleep(AXIS_HOLD_MS + 1_000);
  const a = (await moverAt(host, 1)).x;
  await sleep(1_500);
  const b = (await moverAt(host, 1)).x;
  expect(Math.abs(b - a), `止まっている（${x0.toFixed(0)} → ${a.toFixed(0)} → ${b.toFixed(0)}、${Date.now() - t0}ms）`).toBeLessThanOrEqual(1);
  // 止まるまでに進んだのは、最後に届いた入力から AXIS_HOLD_MS ぶんまで（75px/秒）。
  expect(a - x0).toBeLessThan(((AXIS_HOLD_MS + 600) / 1000) * 75);
  // サーバーは気づいていない（席は切れていない）。画面に戻ると、確かめて入り直す。
  expect(host.received.some((r) => r.f.t === 'online' && r.f.p === 1 && r.f.on === false)).toBe(false);
  await pads[0]!.comeBack();
  await expect.poll(() => (pads[0]!.line?.wsOpened ?? 0) >= 2, { timeout: 15_000 }).toBe(true);
  await pads[0]!.expectLink('open', 20_000);
  await pads[0]!.stickUp();
  await host.advance(GAME_MS);
  await host.results();
});
