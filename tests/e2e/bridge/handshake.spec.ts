// 正常系：同梱方式（オリジンが空の枠）と外部方式（別オリジン＋allow-same-origin）の両方で、
// 握手 → init → ready → players → input → setPad（検証つき）→ vibrate/store → pause/resume → end が通る。
import type { Page } from '@playwright/test';
import { expect, openHost, test } from './harness';

const events = (page: Page, id: string) => page.evaluate((i) => window.H.events(i), id);
const post = (page: Page, id: string, msg: unknown) => page.evaluate(([i, m]) => window.H.post(i as string, m), [id, msg] as const);
const gameMsgs = (page: Page) => page.evaluate(() => window.H.gameMsgs());
const dropped = (page: Page, id: string) => page.evaluate((i) => window.H.dropped(i), id);

async function start(page: Page, id: string, entry: unknown) {
  return page.evaluate(
    ([i, e]) =>
      window.H.start({
        id: i as string,
        entry: e,
        allowLocalhost: true,
        init: { players: [{ id: 1, name: 'いち', online: true }], leader: 1, locale: 'ja', paused: false },
        readyTimeoutMs: 8000,
      }),
    [id, entry] as const,
  );
}

async function runHappyPath(page: Page, id: string, entry: unknown, expectSandbox: string) {
  const started = await start(page, id, entry);
  expect(started.ok, started.reason).toBe(true);
  expect(started.source?.sandbox).toBe(expectSandbox);

  // 握手 → init → ready。
  await page.waitForFunction((i) => window.H.names(i).includes('ready'), id);
  await expect.poll(() => gameMsgs(page)).toContainEqual(expect.objectContaining({ kind: 'connected', origin: started.source?.origin }));

  // players 更新がゲームに届く。
  await post(page, id, { m: 'players', players: [{ id: 1, name: 'いち', online: true }, { id: 2, name: 'に', online: true }], leader: 1 });
  await expect.poll(async () => (await gameMsgs(page)).filter((m) => m.kind === 'players').at(-1)?.n).toBe(2);

  // 起動時にゲームは pad の画面を送っている（to:'*' の pad）。
  await expect.poll(async () => (await events(page, id)).find((e) => e.name === 'setPad')?.detail).toMatchObject({ to: '*', spec: { k: 'pad', stick: 'stick' } });

  // input（btn good）→ ゲームが setPad を返し、host-bridge が検証して setPad イベントにする。
  await post(page, id, { m: 'input', p: 2, i: { k: 'btn', id: 'good', d: 1 }, T: 111 });
  await expect.poll(async () => (await events(page, id)).filter((e) => e.name === 'setPad').at(-1)?.detail).toMatchObject({ to: 2, spec: { k: 'wait', title: 'got 2' } });

  // vibrate。
  await post(page, id, { m: 'input', p: 1, i: { k: 'btn', id: 'buzz', d: 1 }, T: 1 });
  await expect.poll(async () => (await events(page, id)).find((e) => e.name === 'vibrate')?.detail).toMatchObject({ to: 1, ms: [40, 20, 40] });

  // storage（set → get が往復する）。
  await post(page, id, { m: 'input', p: 1, i: { k: 'btn', id: 'save', d: 1 }, T: 2 });
  await expect.poll(async () => (await gameMsgs(page)).find((m) => m.kind === 'stored')?.value).toBe('7');

  // pause / resume。
  await post(page, id, { m: 'pause' });
  await post(page, id, { m: 'resume' });
  await expect.poll(async () => (await gameMsgs(page)).filter((m) => m.kind === 'pause' || m.kind === 'resume').map((m) => m.kind)).toEqual(['pause', 'resume']);

  // end。
  await post(page, id, { m: 'input', p: 1, i: { k: 'btn', id: 'end', d: 1 }, T: 3 });
  await expect.poll(async () => (await events(page, id)).find((e) => e.name === 'end')?.detail).toMatchObject({ results: [{ p: 1, score: 10, label: '10pt' }] });

  expect(await dropped(page, id)).toBe(0);
}

test('同梱方式：オリジンが空の枠（allow-same-origin なし）で、通しが通る', async ({ page, consoleServer }) => {
  await openHost(page, consoleServer);
  await runHappyPath(page, 'bundled', { bundled: 'games/hello/' }, 'allow-scripts');
});

test('外部方式：別オリジンの枠（allow-same-origin つき）で、通しが通る', async ({ page, consoleServer, externalServer }) => {
  await openHost(page, consoleServer);
  await runHappyPath(page, 'external', { url: `${externalServer.url}/games/hello/` }, 'allow-scripts allow-same-origin');
});

test('押下と差し替えの間隔を0〜500msで振っても、input→setPad の往復が毎回そろう', async ({ page, consoleServer }) => {
  await openHost(page, consoleServer);
  const started = await page.evaluate(() => window.H.start({ id: 'timing', entry: { bundled: 'games/hello/' }, readyTimeoutMs: 8000 }));
  expect(started.ok).toBe(true);
  await page.waitForFunction(() => window.H.names('timing').includes('ready'));

  const delays = [0, 7, 33, 80, 150, 300, 500, 450, 1, 250];
  for (let i = 0; i < delays.length; i += 1) {
    const before = (await events(page, 'timing')).filter((e) => e.name === 'setPad').length;
    await post(page, 'timing', { m: 'input', p: 1, i: { k: 'btn', id: 'good', d: 1 }, T: i });
    await page.waitForTimeout(delays[i] as number);
    await expect.poll(async () => (await events(page, 'timing')).filter((e) => e.name === 'setPad').length).toBe(before + 1);
  }
  expect(await dropped(page, 'timing')).toBe(0);
});
