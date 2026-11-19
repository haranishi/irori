// 試遊サーバー（tools/playtest-server.mjs）を、評価者と同じく HTTP（curl と同じ要求）だけで動かす試験。
// 時計が止まっていること（実時間を待っても、カウントダウンが進まない）、/clock/advance で進むこと、
// 連打・選択・押し続け・スティック・回線の切断と復帰・メニューの退出・撮影・終わり方を、/state の読み取りで確かめる。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../../tools/lib/edge-server.mjs';
import { Playtest } from '../../../tools/playtest-server.mjs';
import { expect, test } from './fixtures';
import { ONLY_DC } from './lib/tags';
import { env } from './lib/env.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PadState {
  n: number;
  seat: number | null;
  kind: string | null;
  link: string | null;
  screen: string | null;
  state: string | null;
  text: string;
  buttons: { id: string; disabled: boolean }[];
  choices: { index: number; id: string; label: string; disabled: boolean }[];
}
interface State {
  clock: { mode: string; now: number };
  host: {
    state: string;
    focused: string | null;
    gameId: string | null;
    players: number;
    results: { seat: number; rank: number; label: string }[];
    game: { phase: string | null; round: string | null; text: string } | null;
    text: string;
  };
  pads: PadState[];
}

test('試遊サーバー：curl と同じ要求だけで、時計を止めたまま、選んで・遊んで・結果まで進められる', ONLY_DC, async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'irori-c1-playtest-'));
  const portFile = join(dir, 'url.txt');
  const child = spawn(process.execPath, [join(ROOT, 'tools/playtest-server.mjs'), '--port-file', portFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  try {
    await expect.poll(() => existsSync(portFile) && readFileSync(portFile, 'utf8').trim().length > 0, { timeout: 20_000, message: `試遊サーバーが起動しない\n${out}` }).toBe(true);
    const U = readFileSync(portFile, 'utf8').trim();
    expect(U).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const res = await fetch(`${U}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
      return json;
    };
    const state = async () => (await call('GET', '/state')) as unknown as State;
    const pad = async (n: number) => (await state()).pads.find((p) => p.n === n)!;
    /**
     * 止めた時計のままだと、ホストがスマホへ画面を送る予約（タイマー）が動かず、読み取りだけを繰り返しても、待ちが進まない。
     * そこで、2回目以降の読み取りの前に、時計を進める要求（1ミリ秒）を出して、予約を動かす。
     * サーバーの後処理（settle）も加わって、1回につき約120ミリ秒進む。最初の読み取りで条件が満たされれば、時計は動かさない。
     */
    const pollWithClock = <T>(read: () => Promise<T>) => {
      let n = 0;
      return expect.poll(async () => {
        if (n++ > 0) await call('POST', '/clock/advance', { ms: 1 });
        return read();
      });
    };
    const waitForPad2Input = async (kinds: [string, string]) => {
      const screens = async () => {
        const s = await state();
        return [s.host.state, ...s.pads.map((p) => p.kind)];
      };
      // スマホ2の入力と一時停止の要求は同じ接続を通る。
      // 一時停止画面が出たら、先に届いた入力と一時停止は、その順でゲームの枠に送られている。
      await call('POST', '/pad/2/menu', { item: 'pause' });
      await pollWithClock(screens).toEqual(['paused', 'remote', 'wait']);
      await call('POST', '/host/key', { key: 'Escape' });
      await pollWithClock(screens).toEqual(['playing', ...kinds]);
    };
    /** 棚の選択の輪を、/state の focused を見ながら id の箱へ動かし、1回の決定で始める。 */
    const choose = async (id: string, order: string[]) => {
      for (let i = 0; i < order.length; i++) {
        const f = (await state()).host.focused ?? '';
        if (f === `game:${id}`) break;
        const at = order.indexOf(f.replace('game:', ''));
        const row = Math.floor(at / 5), target = Math.floor(order.indexOf(id) / 5);
        await call('POST', '/pad/1/tap', { id: at < 0 || row < target ? 'down' : row > target ? 'up' : at < order.indexOf(id) ? 'right' : 'left' });
        await pollWithClock(async () => (await state()).host.focused ?? '').not.toBe(f);
      }
      expect((await state()).host.focused).toBe(`game:${id}`);
      await call('POST', '/pad/1/tap', { id: 'ok' });
      await pollWithClock(async () => (await state()).host.state).toBe('playing');
    };
    const order = JSON.parse(env('shelf')) as string[];

    const started = await call('POST', '/start', {});
    expect(started).toMatchObject({ clock: 'paused', code: expect.stringMatching(/^[A-Z0-9]{4}$/) });
    const initialClock = (await state()).clock.now;
    expect(await call('POST', '/clock/pause')).toEqual({ clock: 'paused' });
    expect((await state()).clock).toEqual({ mode: 'paused', now: initialClock });
    expect(await call('POST', '/clock/resume')).toEqual({ clock: 'running' });
    await sleep(50);
    const resumedClock = (await state()).clock;
    expect(resumedClock.mode).toBe('running');
    expect(resumedClock.now).toBeGreaterThan(initialClock);
    expect(await call('POST', '/clock/pause')).toEqual({ clock: 'paused' });
    const pausedClock = (await state()).clock;
    await sleep(50);
    expect((await state()).clock).toEqual(pausedClock);
    expect(await call('POST', '/pad/1/join', { name: 'たろう' })).toMatchObject({ seat: 1 });
    expect(await call('POST', '/pad/2/join', { name: 'はなこ' })).toMatchObject({ seat: 2 });
    let s = await state();
    expect(s.clock.mode).toBe('paused');
    await pollWithClock(state).toMatchObject({
      host: { state: 'home', players: 2 },
      pads: [{ seat: 1, kind: 'remote' }, { seat: 2, kind: 'wait' }],
    });
    expect((await pad(1)).buttons.map((b) => b.id)).toEqual(expect.arrayContaining(['up', 'down', 'left', 'right', 'ok', 'back']));

    // 連打レース：時計が止まっているので、実時間を待ってもカウントダウンは進まない。
    await choose('tap-race', order);
    await pollWithClock(async () => {
      s = await state();
      return [s.host.gameId, s.host.game?.phase];
    }).toEqual(['tap-race', 'count']);
    await sleep(3_500);
    expect((await state()).host.game?.phase).toBe('count');
    await call('POST', '/clock/advance', { ms: 3_500 });
    await pollWithClock(async () => (await state()).host.game?.phase).toBe('race');
    await pollWithClock(async () => (await state()).pads.map((p) => p.kind)).toEqual(['buzzer', 'buzzer']);
    expect(await call('POST', '/pad/1/tap', { id: 'buzzer', count: 40, intervalMs: 20 })).toEqual({ tapped: 40 });
    await call('POST', '/pad/2/tap', { id: 'buzzer', count: 5 });
    await pollWithClock(async () => (await pad(1)).text).toContain('完走');
    await waitForPad2Input(['wait', 'buzzer']);
    await call('POST', '/clock/advance', { ms: 31_000 });
    await pollWithClock(async () => (await state()).host.state).toBe('results');
    s = await state();
    expect(s.host.results.map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(s.host.results[0]!.label).toMatch(/^\d+\.\d\d秒$/);
    expect(s.host.results[1]!.label).toBe('5回');
    for (const target of ['host', 1] as const) {
      const shot = (await call('POST', '/shot', { target })) as { path: string };
      expect(statSync(shot.path).size).toBeGreaterThan(1_000);
      expect(readFileSync(shot.path).subarray(1, 4).toString()).toBe('PNG');
    }

    // ホームへ → クイズ：選ぶ・回線を切って戻す（選択肢が戻る）。
    await call('POST', '/pad/1/tap', { id: 'right' });
    await call('POST', '/pad/1/tap', { id: 'ok' });
    await pollWithClock(async () => (await state()).host.state).toBe('home');
    await choose('quiz-4', order);
    await call('POST', '/clock/advance', { ms: 3_200 });
    await pollWithClock(async () => {
      s = await state();
      return s.pads[0]!.choices.length;
    }).toBe(4);
    expect([s.host.game?.phase, s.host.game?.round]).toEqual(['question', '1']);
    const labels = s.pads[0]!.choices.map((c) => c.label);
    for (const l of labels) expect(s.host.game?.text).toContain(l);
    // 答える前に、スマホ2の回線を切って戻す。戻ったスマホには、同じ問題の選択肢が戻る。
    await call('POST', '/pad/2/disconnect');
    await expect.poll(async () => (await pad(2)).link).toBe('lost');
    await call('POST', '/pad/2/reconnect');
    await pollWithClock(async () => {
      const s = await state();
      const p = s.pads[1]!;
      return { link: p.link, kind: p.kind, phase: s.host.game?.phase, labels: p.choices.map((c) => c.label) };
    }).toEqual({ link: 'open', kind: 'choices', phase: 'question', labels });
    await call('POST', '/pad/1/choose', { index: 0 });
    await pollWithClock(async () => (await pad(1)).choices.map((c) => c.disabled)).toEqual(labels.map(() => true));
    await call('POST', '/pad/2/choose', { index: 1 });
    // スマホに答え合わせが届いてから、ホストの描画を進める（20ミリ秒）。答え合わせの表示が終わる（3.5秒）までは進めない。
    await pollWithClock(async () => (await pad(2)).text).toMatch(/正解！|ざんねん/);
    await call('POST', '/clock/advance', { ms: 20 });
    expect((await state()).host.game?.phase).toBe('reveal');

    // メニューから戻ってハローパッド：押し続け・スティック・おわる。
    await call('POST', '/host/key', { key: 'Escape' });
    await pollWithClock(async () => (await state()).host.state).toBe('paused');
    // メニューの並びは変わりうるので、/state の focused を見ながら、下へ「ホームへ」まで動かす。キーごとに、選択が動くのを待つ。
    for (let i = 0; i < 8; i++) {
      const f = (await state()).host.focused ?? '';
      if (f === 'menu:home') break;
      await call('POST', '/host/key', { key: 'ArrowDown' });
      await pollWithClock(async () => (await state()).host.focused ?? '').not.toBe(f);
    }
    expect((await state()).host.focused).toBe('menu:home');
    await call('POST', '/host/key', { key: 'Enter' });
    await pollWithClock(async () => (await state()).host.state).toBe('home');
    await choose('hello-pad', order);
    // ゲームが始まっても、スマホの画面は少し遅れて「ぴょん」のボタンに変わる。変わる前に押すと、サーバーが409を返す。
    await pollWithClock(async () => (await state()).pads.map((p) => p.kind)).toEqual(['pad', 'pad']);
    expect(await call('POST', '/pad/2/hold', { id: 'hop', ms: 400 })).toEqual({ held: 400 });
    expect(await call('POST', '/pad/1/stick', { x: 1, y: 0, ms: 600 })).toMatchObject({ held: 600 });
    await call('POST', '/pad/2/tap', { id: 'hop' });
    await waitForPad2Input(['pad', 'pad']);
    await call('POST', '/pad/1/tap', { id: 'end' });
    await pollWithClock(async () => (await state()).host.state).toBe('results');
    s = await state();
    expect(s.host.results.find((r) => r.seat === 2)?.label).toBe('ぴょん2回');

    // 退出と、知らない操作の返事。
    await call('POST', '/pad/2/menu', { item: 'leave' });
    expect((await pad(2)).state).toBe('left');
    await expect(call('POST', '/pad/7/tap', { id: 'ok' })).rejects.toThrow(/404/);
    await expect(call('POST', '/nope')).rejects.toThrow(/404/);
    // 時計を何度も進めても、ホストのつながりは一度も切れていない（入り直していない）。
    expect(((await state()).host as unknown as { sockets: number }).sockets).toBe(1);
    expect(await call('POST', '/stop')).toEqual({ stopped: true });
    expect(await exited).toBe(0);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

// Only transport is delayed; Clock, pages, existing/new iframes and interval callbacks are real Chromium.
for (const delayMs of [0, 50, 500]) {
  test(`試遊時計：sample→pause のRPC遅延${delayMs}msでも停止・再停止・再開と既存timerを保つ`, ONLY_DC, async ({ browser }) => {
    const ctx = await browser.newContext();
    const pt = new Playtest();
    try {
      await ctx.clock.install({ time: 1_700_000_000_000 });
      const page = await ctx.newPage();
      await page.setContent('<iframe srcdoc="<p>clock frame</p>"></iframe>');
      await expect.poll(() => page.frames().length).toBe(2);
      await ctx.clock.fastForward(300_000);
      const frames = page.frames();
      const arm = (frame: (typeof frames)[number]) => frame.evaluate(() => {
        const probe = { calls: 0, observedDate: Date.now(), observer: 0 };
        Reflect.set(window, 'clockProbe', probe);
        probe.observer = setInterval(() => { probe.observedDate = Math.max(probe.observedDate, Date.now()); }, 25);
        setTimeout(() => { probe.calls++; }, 60_000);
      });
      for (const frame of frames) await arm(frame);
      const snapshot = () => Promise.all(frames.map((frame) => frame.evaluate(() => ({
        date: Date.now(), ticks: performance.now(), calls: Reflect.get(window, 'clockProbe').calls as number,
      }))));
      let pauseCalls = 0;
      const delayedClock = new Proxy(page.clock, {
        get(target, key) {
          if (key === 'pauseAt') return async (time: number) => {
            if (++pauseCalls === 1) {
              const count = page.frames().length;
              await page.evaluate(() => { const frame = document.createElement('iframe'); frame.srcdoc = '<p>during pause</p>'; document.body.append(frame); });
              await expect.poll(() => page.frames().length).toBe(count + 1);
              const created = page.frames().find((frame) => !frames.includes(frame))!;
              await created.waitForLoadState();
              await arm(created);
              frames.push(created);
            }
            await sleep(delayMs);
            return target.pauseAt(time);
          };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const delayedPage = new Proxy(page, {
        get(target, key) {
          if (key === 'clock') return delayedClock;
          if (key === 'evaluate') return async (expression: () => number) => {
            const sampled = await target.evaluate(expression);
            await sleep(delayMs);
            return sampled;
          };
          return Reflect.get(target, key, target);
        },
      });
      pt.host = { ctx, page: delayedPage };
      pt.clockMode = 'running';
      await pt.pauseClock();
      expect(pt.clockMode).toBe('paused');
      const observed = await Promise.all(frames.map((frame) => frame.evaluate(() => {
        const probe = Reflect.get(window, 'clockProbe');
        clearInterval(probe.observer);
        return probe.observedDate as number;
      })));
      const paused = await snapshot();
      for (let i = 0; i < frames.length; i++) expect(paused[i]!.date).toBeGreaterThanOrEqual(observed[i]!);
      for (const value of paused) {
        expect(value.date).toBeGreaterThanOrEqual(1_700_000_300_000);
        expect(value.calls).toBe(0);
      }
      // Existing controllers may differ by a few ticks; each frame must retain its own monotonic time.
      await page.evaluate(() => { const frame = document.createElement('iframe'); frame.srcdoc = '<p>after pause</p>'; document.body.append(frame); });
      await expect.poll(() => page.frames().length).toBe(frames.length + 1);
      const future = page.frames().find((frame) => !frames.includes(frame))!;
      await future.waitForLoadState();
      expect(await future.evaluate(() => Date.now())).toBe(paused[0]!.date);
      await sleep(50);
      expect(await snapshot()).toEqual(paused);
      await ctx.clock.runFor(1_000);
      const advanced = await snapshot();
      expect(await future.evaluate(() => Date.now())).toBe(paused[0]!.date + 1_000);
      for (let i = 0; i < frames.length; i++) expect(advanced[i]).toEqual({ date: paused[i]!.date + 1_000, ticks: paused[i]!.ticks + 1_000, calls: 0 });
      await pt.pauseClock();
      expect(await snapshot()).toEqual(advanced);
      await ctx.clock.runFor(60_000);
      const fired = await snapshot();
      for (let i = 0; i < frames.length; i++) expect(fired[i]).toEqual({ date: advanced[i]!.date + 60_000, ticks: advanced[i]!.ticks + 60_000, calls: 1 });
      await ctx.clock.resume();
      pt.clockMode = 'running';
      await sleep(50);
      const running = await snapshot();
      for (let i = 0; i < frames.length; i++) {
        expect(running[i]!.date).toBeGreaterThan(fired[i]!.date);
        expect(running[i]!.ticks).toBeGreaterThan(fired[i]!.ticks);
        expect(running[i]!.calls).toBe(1);
      }
      await pt.pauseClock();
      const pausedAgain = await snapshot();
      await sleep(50);
      expect(await snapshot()).toEqual(pausedAgain);
    } finally {
      await pt.stop();
      await ctx.close();
      rmSync(pt.shots, { recursive: true, force: true });
    }
  });
}

test('試遊時計：想定外のpauseエラーを隠さず伝える', ONLY_DC, async ({ browser }) => {
  const ctx = await browser.newContext();
  const pt = new Playtest();
  try {
    await ctx.clock.install();
    const page = await ctx.newPage();
    const failure = new Error('clock transport unavailable');
    const failedClock = new Proxy(page.clock, {
      get(target, key) {
        if (key === 'pauseAt') return async () => { throw failure; };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    pt.host = { ctx, page: new Proxy(page, { get(target, key) { return key === 'clock' ? failedClock : Reflect.get(target, key, target); } }) };
    pt.clockMode = 'running';
    await expect(pt.pauseClock()).rejects.toBe(failure);
    expect(pt.clockMode).toBe('running');
  } finally {
    await pt.stop();
    await ctx.close();
    rmSync(pt.shots, { recursive: true, force: true });
  }
});
