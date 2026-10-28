// 試遊サーバー（tools/playtest-server.mjs）を、評価者と同じく HTTP（curl と同じ要求）だけで動かす試験。
// 時計が止まっていること（実時間を待っても、カウントダウンが進まない）、/clock/advance で進むこと、
// 連打・選択・押し続け・スティック・回線の切断と復帰・メニューの退出・撮影・終わり方を、/state の読み取りで確かめる。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../../tools/lib/edge-server.mjs';
import { expect, test } from './fixtures';
import { ONLY_DC } from './lib/tags';

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
    /** 棚の選択の輪を、/state の focused を見ながら id のカードへ動かし、2回の決定で始める。 */
    const choose = async (id: string, order: string[]) => {
      for (let i = 0; i < order.length; i++) {
        const f = (await state()).host.focused ?? '';
        if (f === `game:${id}`) break;
        const at = order.indexOf(f.replace('game:', ''));
        await call('POST', '/pad/1/tap', { id: at < 0 ? 'down' : at < order.indexOf(id) ? 'right' : 'left' });
      }
      expect((await state()).host.focused).toBe(`game:${id}`);
      await call('POST', '/pad/1/tap', { id: 'ok' });
      expect((await state()).host.state).toBe('detail');
      await call('POST', '/pad/1/tap', { id: 'ok' });
      await expect.poll(async () => (await state()).host.state).toBe('playing');
    };
    const order = ['daifugo', 'moon-village', 'old-maid', 'strike-alley', 'blade-duel', 'lantern-market', 'ten-seconds', 'dot-grab', 'hello-pad', 'quiz-4', 'tap-race'];

    const started = await call('POST', '/start', {});
    expect(started).toMatchObject({ clock: 'paused', code: expect.stringMatching(/^[A-Z0-9]{4}$/) });
    expect(await call('POST', '/pad/1/join', { name: 'たろう' })).toMatchObject({ seat: 1 });
    expect(await call('POST', '/pad/2/join', { name: 'はなこ' })).toMatchObject({ seat: 2 });
    let s = await state();
    expect(s.clock.mode).toBe('paused');
    expect(s.host.state).toBe('home');
    expect(s.host.players).toBe(2);
    expect(s.pads.map((p) => [p.seat, p.kind])).toEqual([
      [1, 'remote'],
      [2, 'wait'],
    ]);
    expect(s.pads[0]!.buttons.map((b) => b.id)).toEqual(expect.arrayContaining(['up', 'down', 'left', 'right', 'ok', 'back']));

    // 連打レース：時計が止まっているので、実時間を待ってもカウントダウンは進まない。
    await choose('tap-race', order);
    s = await state();
    expect([s.host.gameId, s.host.game?.phase]).toEqual(['tap-race', 'count']);
    await sleep(3_500);
    expect((await state()).host.game?.phase).toBe('count');
    await call('POST', '/clock/advance', { ms: 3_500 });
    s = await state();
    expect(s.host.game?.phase).toBe('race');
    expect(s.pads.map((p) => p.kind)).toEqual(['buzzer', 'buzzer']);
    expect(await call('POST', '/pad/1/tap', { id: 'buzzer', count: 40, intervalMs: 20 })).toEqual({ tapped: 40 });
    await call('POST', '/pad/2/tap', { id: 'buzzer', count: 5 });
    expect((await pad(1)).text).toContain('完走');
    await call('POST', '/clock/advance', { ms: 31_000 });
    s = await state();
    expect(s.host.state).toBe('results');
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
    expect((await state()).host.state).toBe('home');
    await choose('quiz-4', order);
    await call('POST', '/clock/advance', { ms: 3_200 });
    s = await state();
    expect([s.host.game?.phase, s.host.game?.round]).toEqual(['question', '1']);
    expect(s.pads[0]!.choices).toHaveLength(4);
    const labels = s.pads[0]!.choices.map((c) => c.label);
    for (const l of labels) expect(s.host.game?.text).toContain(l);
    // 答える前に、スマホ2の回線を切って戻す。戻ったスマホには、同じ問題の選択肢が戻る。
    await call('POST', '/pad/2/disconnect');
    await expect.poll(async () => (await pad(2)).link).toBe('lost');
    await call('POST', '/pad/2/reconnect');
    await expect.poll(async () => (await pad(2)).link).toBe('open');
    s = await state();
    expect([s.pads[1]!.kind, s.host.game?.phase]).toEqual(['choices', 'question']);
    expect(s.pads[1]!.choices.map((c) => c.label)).toEqual(labels);
    await call('POST', '/pad/1/choose', { index: 0 });
    expect((await pad(1)).choices.every((c) => c.disabled)).toBe(true);
    await call('POST', '/pad/2/choose', { index: 1 });
    // 2人とも答えたので、締切を待たずに答え合わせ。
    expect((await state()).host.game?.phase).toBe('reveal');

    // メニューから戻ってハローパッド：押し続け・スティック・おわる。
    await call('POST', '/host/key', { key: 'Escape' });
    expect((await state()).host.state).toBe('paused');
    // メニューの並びは変わりうるので、/state の focused を見ながら、下へ「ホームへ」まで動かす。
    for (let i = 0; i < 8 && (await state()).host.focused !== 'menu:home'; i++) await call('POST', '/host/key', { key: 'ArrowDown' });
    expect((await state()).host.focused).toBe('menu:home');
    await call('POST', '/host/key', { key: 'Enter' });
    expect((await state()).host.state).toBe('home');
    await choose('hello-pad', order);
    expect(await call('POST', '/pad/2/hold', { id: 'hop', ms: 400 })).toEqual({ held: 400 });
    expect(await call('POST', '/pad/1/stick', { x: 1, y: 0, ms: 600 })).toMatchObject({ held: 600 });
    await call('POST', '/pad/2/tap', { id: 'hop' });
    await call('POST', '/pad/1/tap', { id: 'end' });
    s = await state();
    expect(s.host.state).toBe('results');
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
