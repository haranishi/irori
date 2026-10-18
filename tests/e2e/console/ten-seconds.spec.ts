// 実ホスト・実 Worker・別々のスマホで、秘匿した計測から3回の発表、記録表示、再戦まで進める。
// ホストの時計だけを止め、操作・通信は本物を使う。時刻の厳密な境界は GameLogic の単体試験が担当する。
import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import { Line } from '../../../apps/web/tests/pad/e2e/line.mjs';
import { pickPorts } from '../../../tools/lib/edge-server.mjs';
import { expect, test, type Host, type Pad } from './fixtures';
import { HOST, ONLY_DC, PHONE } from './lib/tags';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const note = '通信の遅れを含む目安です';
const longNames = ['あいうえおかきくけこさし', 'たちつてとなにぬねのはひ', 'まみむめもやゆよらりるれ', 'アイウエオカキクケコサシ', 'タチツテトナニヌネノハヒ', 'マミムメモヤユヨラリルレ', '１２３４５６７８９０１２', 'ＡＢＣＤＥＦＧＨＩＪＫＬ'];

interface RoundRow { seat: number; rank: string; name: string; record: string; delta: string; total: string }

async function pause(host: Host): Promise<void> {
  const now = await host.page.evaluate(() => Date.now());
  await host.page.clock.pauseAt(now + 1);
}

// コンソールの PadSender は setTimeout(0) でまとめて送る。止めた時計でもその送信を動かす。
// 数msだけ進める。丸めの厳密な境界は単体試験に任せ、ここでは通信を通した表示を見る。
async function settle(host: Host): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await sleep(40);
    await host.page.clock.fastForward(1);
  }
}

async function buttonId(pad: Pad, prefix: 'c_' | 's_'): Promise<string> {
  const button = pad.page.locator(`.irori-pad__btn[data-id^="${prefix}"]`);
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();
  return (await button.getAttribute('data-id'))!;
}

async function action(host: Host, pad: Pad, label: string): Promise<string> {
  await settle(host);
  const id = await buttonId(pad, 'c_');
  await expect(pad.button(id)).toHaveText(label);
  await pad.tap(id);
  await settle(host);
  return id;
}

async function countdown(host: Host, pads: Pad[]): Promise<string> {
  await host.expectPhase('countdown');
  const frame = (await host.gameFrame())!;
  await expect(frame.locator('.cue')).toHaveText('3');
  for (const cue of ['2', '1']) {
    await host.advance(1_000);
    await expect(frame.locator('.cue')).toHaveText(cue);
  }
  await host.advance(1_000);
  await host.expectPhase('counting');
  await expect(frame.locator('.cue')).toHaveText('せーの');
  await settle(host);
  const ids = await Promise.all(pads.map((p) => buttonId(p, 's_')));
  expect(new Set(ids).size, '全員に同じ試行の停止操作を出す').toBe(1);
  return ids[0]!;
}

async function rows(host: Host): Promise<RoundRow[]> {
  await host.expectPhase('reveal');
  return (await host.inGame(() => [...document.querySelectorAll<HTMLElement>('.result-row')].map((el) => ({
    seat: Number(el.dataset.seat), rank: el.dataset.rank ?? '',
    name: el.querySelector('.name')?.textContent ?? '', record: el.querySelector('.record')?.textContent ?? '',
    delta: el.querySelector('.delta')?.textContent ?? '', total: el.querySelector('.total')?.textContent ?? '',
  }))))!;
}

async function stopAt(host: Host, pads: Pad[], times: number[]): Promise<RoundRow[]> {
  const stops = await Promise.all(pads.map((p) => buttonId(p, 's_')));
  let elapsed = 0;
  for (const { p, at } of times.map((at, p) => ({ p, at })).sort((a, b) => a.at - b.at)) {
    await host.advance(at - elapsed);
    elapsed = at;
    await pads[p]!.tap(stops[p]!);
    await settle(host);
    if (elapsed < Math.max(...times)) await pads[p]!.expectWait('受け付けました');
  }
  return rows(host);
}

async function recordResults(host: Host, expected: { seat: number; rank: number; label: string }[]): Promise<void> {
  const actual = await host.results();
  expect(actual.map(({ seat, rank, label }) => ({ seat, rank, label }))).toEqual(expected);
  await expect(host.page.locator('.results')).toHaveClass(/results--record/);
  await expect(host.page.locator('.results .result__score')).toHaveCount(0);
  const aria = await host.page.locator('.results').ariaSnapshot();
  expect(aria).not.toMatch(/ポイント|得点|[-−]\d|\d+点/);
  await expect(host.page.locator('.results')).toContainText(note);
  await expect(host.page.locator('[data-nav="results:again"]')).toBeVisible();
  await expect(host.page.locator('[data-nav="results:home"]')).toBeVisible();
  await expect(host.page.locator('[data-nav="results:share"]')).toBeVisible();
}

/** 実 Worker への接続を保つ中継。端末が実際に送った入力だけを保留・再送する。 */
class InputLine {
  held = false;
  readonly inputs: string[] = [];
  readonly pending: string[] = [];
  private server: WebSocketRoute | null = null;

  async install(ctx: BrowserContext): Promise<void> {
    await ctx.routeWebSocket(/\/ws(?:\?|$)/, (route) => {
      this.server = route.connectToServer();
      route.onMessage((message) => {
        if (typeof message === 'string' && message.startsWith('{') && JSON.parse(message).t === 'in') {
          this.inputs.push(message);
          if (this.held) { this.pending.push(message); return; }
        }
        this.server!.send(message);
      });
    });
  }

  send(message: string): void {
    if (!this.server) throw new Error('実 Worker へ接続されていない');
    this.server.send(message);
  }

  flush(): void {
    for (const message of this.pending.splice(0)) this.send(message);
  }
}

async function delivered(host: Host, line: InputLine, message: string): Promise<void> {
  const before = host.inputs().length;
  line.send(message);
  await expect.poll(() => host.inputs().length).toBeGreaterThan(before);
  await settle(host);
}

async function snapshot(host: Host): Promise<{ dom: string; aria: string }> {
  const frame = (await host.gameFrame())!;
  return { dom: await frame.locator('html').evaluate((el) => el.outerHTML), aria: await frame.locator('body').ariaSnapshot() };
}

/** ゲーム枠の実寸で、見出し・列名・各行・進行案内・注記が収まり、行内の文字も重ならない。 */
async function layout(host: Host, count: number): Promise<void> {
  const result = await host.inGame(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const blocks = [...document.querySelectorAll('.topbar, .result-labels, .result-row, .footer')].map(rect);
    const children = [...document.querySelectorAll('.result-row')].map((row) => [...row.children].map(rect));
    const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    return {
      width: innerWidth, height: innerHeight, rows: document.querySelectorAll('.result-row').length,
      outside: blocks.filter((r) => r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1),
      overlaps: blocks.filter((a, i) => blocks.slice(i + 1).some((b) => overlaps(a, b))).length,
      cellsOverlap: children.filter((cells) => cells.some((a, i) => cells.slice(i + 1).some((b) => overlaps(a, b)))).length,
      clipped: [...document.querySelectorAll<HTMLElement>('.result-row .name, .result-row .delta, .progress-guide, .precision-note')].filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1).map((el) => el.className),
    };
  });
  expect(result).toMatchObject({ rows: count, outside: [], overlaps: 0, cellsOverlap: 0, clipped: [] });
  expect(result!.height, '1280×720 の通常ホストでは上部バーを引いた枠で確認する').toBeLessThanOrEqual(720);
}

test('2人で3回の記録と累計を発表し、100秒以内に総合結果へ。再戦は記録と試行を初期化する', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう']);
  await host.page.locator('.card[data-game="ten-seconds"]').click();
  await host.expectState('detail');
  await expect(host.page.locator('[data-nav="detail:start"]')).toBeDisabled();
  await expect(host.page.locator('#detail-reason')).toHaveText('あと1人で遊べます');
  await host.key('Escape');
  pads.push(...await rig.join(host, ['はなこ']));
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  const frame = (await host.gameFrame())!;
  await expect(frame.locator('.rule')).toHaveText('10秒だと思ったら1回押す。3回の合計のズレで勝負');
  await expect(frame.locator('.people .name')).toHaveText(['たろう', 'はなこ']);
  await expect(frame.locator('.precision-note')).toHaveText(note);
  await pause(host);
  const start = (await host.page.evaluate(() => performance.now()));
  await action(host, pads[0]!, 'はじめる');
  const firstStop = await countdown(host, pads);
  let result = await stopAt(host, pads, [10_000, 10_200]);
  expect(result.map((r) => [r.seat, r.record, r.total])).toEqual([[1, '10.0秒', '0.0秒'], [2, '10.2秒', '0.2秒']]);
  await host.advance(5_000);
  await action(host, pads[0]!, '次へ');
  expect(await countdown(host, pads)).not.toBe(firstStop);
  result = await stopAt(host, pads, [9_900, 10_000]);
  expect(result.map((r) => [r.seat, r.record, r.total])).toEqual([[2, '10.0秒', '0.2秒'], [1, '9.9秒', '0.1秒']]);
  await host.advance(5_000);
  await action(host, pads[0]!, '次へ');
  await countdown(host, pads);
  result = await stopAt(host, pads, [10_000, 9_800]);
  expect(result.map((r) => [r.seat, r.record, r.total])).toEqual([[1, '10.0秒', '0.1秒'], [2, '9.8秒', '0.4秒']]);
  await expect(frame.locator('html')).toHaveAttribute('data-round', '3');
  await host.advance(5_000);
  await action(host, pads[0]!, '総合結果へ');
  await recordResults(host, [{ seat: 1, rank: 1, label: '合計ズレ 0.1秒' }, { seat: 2, rank: 2, label: '合計ズレ 0.4秒' }]);
  expect((await host.page.evaluate(() => performance.now())) - start).toBeLessThanOrEqual(100_000);
  await settle(host);
  await pads[0]!.tap('ok');
  await host.expectPhase('intro');
  await action(host, pads[0]!, 'はじめる');
  expect(await countdown(host, pads)).not.toBe(firstStop);
  result = await stopAt(host, pads, [10_000, 10_000]);
  expect(result.map((r) => [r.rank, r.total])).toEqual([['1', '0.0秒'], ['1', '0.0秒']]);
  expect(await host.inGame(() => document.documentElement.dataset.round)).toBe('1');
});

test('計測中は DOM と読み上げを変えず本人だけ受付済み。案内・離し・二重・旧試行・旧次へは採点や進行を変えない', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const line = new InputLine();
  const leaderLine = new InputLine();
  const pads: Pad[] = [];
  for (const [i, inputLine] of [leaderLine, line].entries()) {
    const pad = await rig.openPad(host.base, { init: (ctx) => inputLine.install(ctx) });
    await pad.join(await host.code(), ['たろう', 'はなこ'][i]);
    pads.push(pad);
  }
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await pads[1]!.tap('guide');
  const guide = line.inputs.find((message) => JSON.parse(message).i?.id === 'guide' && JSON.parse(message).i?.d === 1)!;
  expect(guide).toBeDefined();
  const stop = await countdown(host, pads);
  const before = await snapshot(host);
  expect(before.dom).not.toMatch(/経過|回答人数|回答済み|\d+\.\d秒/);
  const otherPad = await pads[0]!.pad.evaluate((el) => el.outerHTML);
  await delivered(host, line, guide);
  await host.advance(9_000);
  line.held = true;
  await pads[1]!.tap(stop);
  await expect.poll(() => line.pending.length).toBe(2);
  const down = line.pending.find((message) => JSON.parse(message).i.d === 1)!;
  const up = line.pending.find((message) => JSON.parse(message).i.d === 0)!;
  await delivered(host, line, up);
  expect(await pads[1]!.kind()).toBe('pad');
  expect(await snapshot(host)).toEqual(before);
  line.pending.length = 0;
  line.held = false;
  await delivered(host, line, down);
  await pads[1]!.expectWait('受け付けました');
  expect(await pads[1]!.waitText()).toEqual({ title: '受け付けました', body: '大画面を見てね' });
  await host.advance(500);
  await delivered(host, line, down);
  expect(await snapshot(host)).toEqual(before);
  expect(await pads[0]!.pad.evaluate((el) => el.outerHTML)).toBe(otherPad);
  expect(pads.map((p) => p.fx())).toEqual([0, 0]);
  await pads[0]!.tap(stop);
  expect((await rows(host)).map((r) => [r.seat, r.record])).toEqual([[1, '9.5秒'], [2, '9.0秒']]);
  const next = await action(host, pads[0]!, '次へ');
  const oldNext = leaderLine.inputs.find((message) => JSON.parse(message).i.id === next && JSON.parse(message).i.d === 1)!;
  const secondStop = await countdown(host, pads);
  expect(secondStop).not.toBe(stop);
  await delivered(host, line, down);
  expect(await pads[1]!.kind()).toBe('pad');
  await stopAt(host, pads, [10_000, 10_000]);
  const current = await snapshot(host);
  await delivered(host, leaderLine, oldNext);
  expect(await snapshot(host)).toEqual(current);
  expect(await host.phase()).toBe('reveal');
  expect(await host.inGame(() => document.documentElement.dataset.round)).toBe('2');
});

test('8人・12文字名で全員時間切れでも全8行と案内が重ならず、3回とも同率1位、総合の合計ズレは30.0秒', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, longNames);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  const frame = (await host.gameFrame())!;
  await expect(frame.locator('.people .name')).toHaveText(longNames);
  const looks = await frame.locator('.people .seat-mark svg').evaluateAll((els) => els.map((svg) => ({ label: svg.getAttribute('aria-label'), color: svg.querySelector('path')?.getAttribute('fill'), shape: svg.querySelector('path')?.getAttribute('d') })));
  expect(new Set(looks.map((look) => look.color)).size).toBe(8);
  expect(new Set(looks.map((look) => look.shape)).size).toBe(8);
  expect(looks.every((look) => Boolean(look.label))).toBe(true);
  await pause(host);
  for (let round = 1; round <= 3; round++) {
    await action(host, pads[0]!, round === 1 ? 'はじめる' : '次へ');
    await countdown(host, pads);
    await host.advance(19_900);
    expect(await host.phase()).toBe('counting');
    // 閾値の厳密な1msは単体試験で扱う。実画面は締切後の次の描画フレームで発表する。
    await host.advance(132);
    const result = await rows(host);
    expect(result.map((r) => [r.rank, r.record, r.delta, r.total])).toEqual(longNames.map(() => ['1', '時間切れ', '採点用のズレ10.0秒', `${(round * 10).toFixed(1)}秒`]));
    expect(result.some((r) => /20\.0/.test(r.record))).toBe(false);
    expect(result.map((r) => r.name)).toEqual(longNames);
    await layout(host, 8);
  }
  await action(host, pads[0]!, '総合結果へ');
  await recordResults(host, longNames.map((_, i) => ({ seat: i + 1, rank: 1, label: '合計ズレ 30.0秒' })));
  const positions = await host.page.locator('.results [data-rank][data-seat], .results__actions').evaluateAll((els) => els.map((el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
  expect(positions.every((r) => r.top >= 0 && r.bottom <= 720)).toBe(true);
});

test('実スマホの入力の転送を0〜500ms遅らせても秘匿したまま3回進み、遅れを含む記録と累計を表示する', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const lines = Array.from({ length: 4 }, () => new InputLine());
  const pads: Pad[] = [];
  for (const [i, line] of lines.entries()) {
    const pad = await rig.openPad(host.base, { init: (ctx) => line.install(ctx) });
    await pad.join(await host.code(), ['いち', 'に', 'さん', 'よん'][i]);
    pads.push(pad);
  }
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  const delays = [0, 50, 250, 500];
  for (let round = 1; round <= 3; round++) {
    await action(host, pads[0]!, round === 1 ? 'はじめる' : '次へ');
    const stop = await countdown(host, pads);
    await host.advance(10_000);
    const before = await snapshot(host);
    for (const line of lines) line.held = true;
    await Promise.all(pads.map((p) => p.tap(stop)));
    for (const line of lines) await expect.poll(() => line.pending.length).toBe(2);
    let advanced = 0;
    for (const [i, delay] of delays.entries()) {
      await host.advance(delay - advanced);
      advanced = delay;
      lines[i]!.held = false;
      lines[i]!.flush();
      await settle(host);
      if (i < delays.length - 1) {
        await pads[i]!.expectWait('受け付けました');
        expect(await snapshot(host)).toEqual(before);
      }
    }
    const result = await rows(host);
    expect(result.map((r) => r.record)).toEqual(['10.0秒', '10.1秒', '10.3秒', '10.5秒']);
    expect(result.map((r) => r.total)).toEqual([0, 1, 3, 5].map((tenths) => `${(tenths * round / 10).toFixed(1)}秒`));
    expect(pads.map((p) => p.fx())).toEqual([0, 0, 0, 0]);
  }
  await action(host, pads[0]!, '総合結果へ');
  await recordResults(host, [0, 1, 3, 5].map((tenths, i) => ({ seat: i + 1, rank: i + 1, label: `合計ズレ ${(tenths * 3 / 10).toFixed(1)}秒` })));
});

async function cpu(pages: Page[], rate: number): Promise<void> {
  for (const page of pages) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
}

test('ChromiumのCPUを6倍遅くしても、2人で3回の合図・一斉発表・総合結果まで操作できる', ONLY_DC, async ({ rig }) => {
  test.setTimeout(240_000);
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await cpu([host.page, ...pads.map((p) => p.page)], 6);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  for (let round = 1; round <= 3; round++) {
    await action(host, pads[0]!, round === 1 ? 'はじめる' : '次へ');
    await countdown(host, pads);
    const result = await stopAt(host, pads, [10_000, 10_000]);
    expect(result.map((r) => [r.rank, r.record, r.total])).toEqual([['1', '10.0秒', '0.0秒'], ['1', '10.0秒', '0.0秒']]);
  }
  await action(host, pads[0]!, '総合結果へ');
  await recordResults(host, [{ seat: 1, rank: 1, label: '合計ズレ 0.0秒' }, { seat: 2, rank: 1, label: '合計ズレ 0.0秒' }]);
});

test('390pxと768pxのスマホは48px以上の1ボタンをSpace/Enterで押せる。動きを減らしても1440pxの大画面で結果が読める', PHONE, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  await host.page.setViewportSize({ width: 1440, height: 900 });
  await host.page.emulateMedia({ reducedMotion: 'reduce' });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await pads[1]!.page.setViewportSize({ width: 768, height: 1024 });
  for (const p of pads) await p.page.emulateMedia({ reducedMotion: 'reduce' });
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  const begin = await buttonId(pads[0]!, 'c_');
  await pads[0]!.button(begin).focus();
  await pads[0]!.page.keyboard.press('Space');
  await settle(host);
  const stop = await countdown(host, pads);
  for (const p of pads) {
    await expect(p.page.locator('.irori-pad__btn')).toHaveCount(1);
    const size = await p.button(stop).boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(48);
    expect(size!.height).toBeGreaterThanOrEqual(48);
    expect(size!.x).toBeGreaterThanOrEqual(0);
    expect(size!.x + size!.width).toBeLessThanOrEqual(p.page.viewportSize()!.width);
  }
  await host.advance(10_000);
  await pads[0]!.button(stop).focus();
  await pads[0]!.page.keyboard.press('Enter');
  await settle(host);
  await pads[0]!.expectWait('受け付けました');
  await pads[1]!.button(stop).focus();
  await pads[1]!.page.keyboard.press('Space');
  expect((await rows(host)).map((r) => r.record)).toEqual(['10.0秒', '10.0秒']);
  const frame = (await host.gameFrame())!;
  expect(await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await frame.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(frame.locator('audio, video')).toHaveCount(0);
  expect(pads.map((p) => p.fx())).toEqual([0, 0]);
  const boxes = await frame.locator('.topbar, .result-labels, .result-row, .footer').evaluateAll((els) => els.map((el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
  expect(boxes.every((r) => r.top >= 0 && r.bottom <= 900)).toBe(true);
});

async function visibility(host: Host, value: DocumentVisibilityState): Promise<void> {
  await host.page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
  await settle(host);
}

async function menu(host: Host, open: boolean): Promise<void> {
  if (open) await host.key('Escape');
  else await host.page.locator('[data-nav="menu:continue"]').click();
  await settle(host);
  await host.expectState(open ? 'paused' : 'playing');
}

async function noControl(pad: Pad): Promise<void> {
  await expect(pad.page.locator('.irori-pad__btn[data-id^="c_"]')).toHaveCount(0);
}

async function finalRows(host: Host) {
  await host.expectState('results');
  return host.page.locator('.results [data-rank][data-seat]').evaluateAll((els) => els.map((el) => ({
    seat: Number(el.getAttribute('data-seat')), rank: el.getAttribute('data-rank'),
    name: el.querySelector('.result__name')?.textContent,
    label: el.querySelector('.result__value')?.textContent,
    gone: el.querySelector('.result__gone') !== null,
  })));
}

test('一時停止だけで開始予告を、非表示だけで受付済みのある計測を無効にし、手動で同じ回を新しく始める', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await host.expectPhase('countdown');
  await menu(host, true);
  await host.expectPhase('recover');
  await menu(host, false);
  await host.advance(2_000);
  await host.expectPhase('recover');
  await action(host, pads[0]!, 'やり直す');
  const interrupted = await countdown(host, pads);
  await host.advance(1_000);
  await pads[0]!.tap(interrupted);
  await settle(host);
  await pads[0]!.expectWait('受け付けました');
  await visibility(host, 'hidden');
  await host.expectPhase('recover');
  await noControl(pads[0]!);
  await visibility(host, 'visible');
  await host.advance(2_000);
  await host.expectPhase('recover');
  await action(host, pads[0]!, 'やり直す');
  expect(await countdown(host, pads)).not.toBe(interrupted);
  const result = await stopAt(host, pads, [10_000, 10_000]);
  expect(result.map((r) => [r.record, r.total])).toEqual([['10.0秒', '0.0秒'], ['10.0秒', '0.0秒']]);
  await expect((await host.gameFrame())!.locator('html')).toHaveAttribute('data-round', '1');
});

for (const first of ['phone', 'visible'] as const) {
  test(`複合中断：${first === 'phone' ? '再接続→メニュー→表示' : '表示→メニュー→再接続'}の順で戻しても第2回は手動でやり直し、確定した第1回は保持する`, HOST, async ({ rig }) => {
    const host = await rig.openHost({ clock: true });
    const input = new InputLine();
    const leader = await rig.openPad(host.base, { init: (ctx) => input.install(ctx) });
    await leader.join(await host.code(), 'たろう');
    const [other] = await rig.join(host, ['はなこ'], { line: true });
    const pads = [leader, other!];
    rig.allowSocketErrors();
    await host.choose('ten-seconds', leader);
    await host.expectPhase('intro');
    await pause(host);
    await action(host, leader, 'はじめる');
    const firstStop = await countdown(host, pads);
    await stopAt(host, pads, [10_000, 10_200]);
    await action(host, leader, '次へ');
    let interrupted = firstStop;
    if (first === 'phone') {
      interrupted = await countdown(host, pads);
      await host.advance(1_000);
      await leader.tap(interrupted);
      await settle(host);
      await leader.expectWait('受け付けました');
    } else await host.expectPhase('countdown');
    const stale = input.inputs.find((message) => JSON.parse(message).i.id === interrupted && JSON.parse(message).i.d === 1)!;
    expect(stale).toBeDefined();
    other!.cut();
    await host.expectPhase('recover');
    await visibility(host, 'hidden');
    await menu(host, true);
    if (first === 'phone') {
      other!.restore();
      await other!.expectLink('open', 20_000);
      await settle(host);
      await noControl(leader);
      await menu(host, false);
      await noControl(leader);
      await visibility(host, 'visible');
    } else {
      await visibility(host, 'visible');
      await noControl(leader);
      await menu(host, false);
      await noControl(leader);
      other!.restore();
      await other!.expectLink('open', 20_000);
      await settle(host);
    }
    await host.advance(2_000);
    await host.expectPhase('recover');
    const frame = (await host.gameFrame())!;
    await expect(frame.locator('html')).toHaveAttribute('data-round', '2');
    expect(await Promise.all(pads.map((pad) => pad.seat()))).toEqual([1, 2]);
    const retry = await buttonId(leader, 'c_');
    await expect(leader.button(retry)).toHaveText('やり直す');
    await delivered(host, input, stale);
    await host.expectPhase('recover');
    expect(await buttonId(leader, 'c_')).toBe(retry);
    await action(host, leader, 'やり直す');
    const restarted = await countdown(host, pads);
    expect(restarted).not.toBe(interrupted);
    const result = await stopAt(host, pads, [10_000, 10_000]);
    expect(result.map((r) => [r.seat, r.record, r.total])).toEqual([[1, '10.0秒', '0.0秒'], [2, '10.0秒', '0.2秒']]);
  });
}

test('実ホストの接続が切れている間にスマホも切れると、復帰した名簿の切断を待ち、同じ回を新しい試行でやり直す', HOST, async ({ rig }) => {
  const [port] = await pickPorts(1, { from: 5250, to: 5259 });
  const line = await Line.start(Number(new URL(rig.main).port), port!);
  rig.allowSocketErrors();
  try {
    const host = await rig.openHost({ base: line.url, clock: true });
    const pads: Pad[] = [];
    for (const name of ['たろう', 'はなこ']) {
      const pad = await rig.openPad(rig.main, { line: true });
      await pad.join(await host.code(), name);
      pads.push(pad);
    }
    await host.choose('ten-seconds', pads[0]);
    await host.expectPhase('intro');
    await pause(host);
    await action(host, pads[0]!, 'はじめる');
    await countdown(host, pads);
    await stopAt(host, pads, [10_000, 10_200]);
    await action(host, pads[0]!, '次へ');
    const interrupted = await countdown(host, pads);
    const welcomes = host.received.filter((r) => r.f.t === 'welcome').length;
    line.blockNew = true;
    expect(line.drop(), '実 Worker とホストの TCP 接続を切る').toBeGreaterThan(0);
    await host.expectPhase('recover');
    const frame = (await host.gameFrame())!;
    await expect(frame.locator('.reasons')).toContainText('大画面の接続を待っています');
    pads[1]!.cut();
    await pads[1]!.expectLink('lost');
    line.unblock();
    await expect.poll(async () => {
      await host.advance(300);
      return host.received.filter((r) => r.f.t === 'welcome').length;
    }, { timeout: 20_000 }).toBeGreaterThan(welcomes);
    await settle(host);
    await expect(frame.locator('.reasons')).toHaveText('つなぎ直しを待っています');
    await noControl(pads[0]!);
    await host.advance(2_000);
    await host.expectPhase('recover');
    pads[1]!.restore();
    await pads[1]!.expectLink('open', 20_000);
    await settle(host);
    await host.expectPhase('recover');
    await action(host, pads[0]!, 'やり直す');
    expect(await countdown(host, pads)).not.toBe(interrupted);
    const result = await stopAt(host, pads, [10_000, 10_000]);
    expect(result.map((r) => [r.seat, r.total])).toEqual([[1, '0.0秒'], [2, '0.2秒']]);
    await expect(frame.locator('html')).toHaveAttribute('data-round', '2');
    expect(await pads[1]!.seat()).toBe(2);
  } finally { await line.close(); }
});

test('発表中の切断は記録を保ち、復帰後も古い次へでは進まず現在の進行操作を待つ', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const input = new InputLine();
  const leader = await rig.openPad(host.base, { init: (ctx) => input.install(ctx) });
  await leader.join(await host.code(), 'たろう');
  const [other] = await rig.join(host, ['はなこ'], { line: true });
  const pads = [leader, other!];
  rig.allowSocketErrors();
  await host.choose('ten-seconds', leader);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, leader, 'はじめる');
  await countdown(host, pads);
  const result = await stopAt(host, pads, [10_000, 10_200]);
  const old = await buttonId(leader, 'c_');
  input.held = true;
  await leader.tap(old);
  await expect.poll(() => input.pending.length).toBe(2);
  const stale = input.pending.find((message) => JSON.parse(message).i.d === 1)!;
  input.pending.length = 0;
  input.held = false;
  other!.cut();
  await expect.poll(() => host.received.some((r) => r.f.t === 'online' && r.f.p === 2 && r.f.on === false)).toBe(true);
  await settle(host);
  await noControl(leader);
  expect(await rows(host)).toEqual(result);
  await host.advance(2_000);
  expect(await rows(host)).toEqual(result);
  other!.restore();
  await other!.expectLink('open', 20_000);
  await settle(host);
  const current = await buttonId(leader, 'c_');
  expect(current).not.toBe(old);
  await delivered(host, input, stale);
  expect(await rows(host)).toEqual(result);
  expect(await buttonId(leader, 'c_')).toBe(current);
  await action(host, leader, '次へ');
  await countdown(host, pads);
  await expect((await host.gameFrame())!.locator('html')).toHaveAttribute('data-round', '2');
});

test('進行役の退出で試行を破棄し、新進行役だけで続行する。再利用された席は元の名前と途中記録のまま順位を除外し、途中参加は再戦から', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const lines = [new InputLine(), new InputLine(), new InputLine()];
  const pads: Pad[] = [];
  for (const [i, line] of lines.entries()) {
    const pad = await rig.openPad(host.base, { init: (ctx) => line.install(ctx) });
    await pad.join(await host.code(), ['元の進行役', 'のこり二', 'のこり三'][i]);
    pads.push(pad);
  }
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await countdown(host, pads);
  await stopAt(host, pads, [10_000, 10_200, 10_200]);
  const next = await action(host, pads[0]!, '次へ');
  const stale = lines[0]!.inputs.find((message) => JSON.parse(message).i.id === next && JSON.parse(message).i.d === 1)!;
  const interrupted = await countdown(host, pads);
  await pads[0]!.leave();
  await host.expectPhase('recover');
  await settle(host);
  expect(await Promise.all(pads.slice(1).map((pad) => pad.seat()))).toEqual([2, 3]);
  const [late] = await rig.join(host, ['あとから']);
  expect(await late!.seat()).toBe(1);
  await settle(host);
  await late!.expectWait('次のゲームから参加できます');
  const retry = await buttonId(pads[1]!, 'c_');
  await noControl(pads[2]!);
  await noControl(late!);
  // 旧進行役の実際の入力を現進行役の接続へ再送しても、旧世代の操作は通らない。
  await delivered(host, lines[1]!, stale);
  await host.expectPhase('recover');
  expect(await buttonId(pads[1]!, 'c_')).toBe(retry);
  await action(host, pads[1]!, 'やり直す');
  const remaining = pads.slice(1);
  expect(await countdown(host, remaining)).not.toBe(interrupted);
  let result = await stopAt(host, remaining, [10_200, 10_200]);
  expect(result.find((r) => r.seat === 1)).toMatchObject({ name: '元の進行役', rank: '', record: '未計測', total: '0.0秒' });
  await late!.expectWait('次のゲームから参加できます');
  await action(host, pads[1]!, '次へ');
  await countdown(host, remaining);
  result = await stopAt(host, remaining, [10_200, 10_200]);
  expect(result.filter((r) => r.seat !== 1).map((r) => r.total)).toEqual(['0.6秒', '0.6秒']);
  await action(host, pads[1]!, '総合結果へ');
  expect(await finalRows(host)).toEqual([
    { seat: 2, rank: '1', name: 'のこり二', label: '合計ズレ 0.6秒', gone: false },
    { seat: 3, rank: '1', name: 'のこり三', label: '合計ズレ 0.6秒', gone: false },
    { seat: 1, rank: 'null', name: '元の進行役', label: '途中ズレ 0.0秒', gone: true },
  ]);
  await expect(host.page.locator('.result--top[data-seat="1"]')).toHaveCount(0);
  await host.page.locator('[data-nav="results:again"]').click();
  await host.expectPhase('intro');
  await expect((await host.gameFrame())!.locator('.people .name')).toHaveText(['あとから', 'のこり二', 'のこり三']);
  const current = [late!, ...remaining];
  await action(host, pads[1]!, 'はじめる');
  await countdown(host, current);
  result = await stopAt(host, current, [10_000, 10_000, 10_000]);
  expect(result.map((r) => [r.name, r.total])).toEqual([['あとから', '0.0秒'], ['のこり二', '0.0秒'], ['のこり三', '0.0秒']]);
  await expect((await host.gameFrame())!.locator('html')).toHaveAttribute('data-round', '1');
});

async function kick(host: Host, seat: number): Promise<void> {
  await menu(host, true);
  await host.page.locator('[data-nav="menu:kick"]').click();
  await host.page.locator(`[data-nav="menu:kick:${seat}"]`).click();
  await host.page.locator('[data-nav="kick:ok"]').click();
  await expect.poll(() => host.received.some((r) => r.f.t === 'left' && r.f.p === seat && r.f.why === 'kick')).toBe(true);
  await host.page.locator('[data-nav="menu:back"]').click();
  await menu(host, false);
}

async function incomplete(host: Host): Promise<void> {
  await host.expectState('results');
  await expect(host.page.locator('.results__outcome')).toHaveText('勝敗なし');
  await expect(host.page.locator('.results .result--top, .results .result__score')).toHaveCount(0);
  expect((await finalRows(host)).every((row) => row.rank === 'null')).toBe(true);
  await expect(host.page.locator('.results')).toContainText('人数が足りないため、今回は勝敗なし');
  for (const act of ['again', 'home', 'share']) await expect(host.page.locator(`[data-nav="results:${act}"]`)).toBeVisible();
}

test('除外された未計測と退出した途中累計を残し、2人未満では全員順位なし。参加者がそろえば新しい勝負を始められる', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ', 'じろう']);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await host.expectPhase('countdown');
  await kick(host, 3);
  await pads[2]!.expectEnded('kicked');
  await host.expectPhase('recover');
  await action(host, pads[0]!, 'やり直す');
  await countdown(host, pads.slice(0, 2));
  await stopAt(host, pads.slice(0, 2), [10_000, 10_200]);
  await action(host, pads[0]!, '次へ');
  await pads[1]!.leave();
  await settle(host);
  await incomplete(host);
  expect(await finalRows(host)).toEqual([
    { seat: 1, rank: 'null', name: 'たろう', label: '途中ズレ 0.0秒', gone: false },
    { seat: 2, rank: 'null', name: 'はなこ', label: '途中ズレ 0.2秒', gone: true },
    { seat: 3, rank: 'null', name: 'じろう', label: '未計測', gone: true },
  ]);
  const [newcomer] = await rig.join(host, ['あたらしい人']);
  await settle(host);
  await host.page.locator('[data-nav="results:again"]').click();
  await host.expectPhase('intro');
  await expect((await host.gameFrame())!.locator('.people .name')).toHaveText(['たろう', 'あたらしい人']);
  await action(host, pads[0]!, 'はじめる');
  await countdown(host, [pads[0]!, newcomer!]);
  expect((await stopAt(host, [pads[0]!, newcomer!], [10_000, 10_000])).map((r) => r.total)).toEqual(['0.0秒', '0.0秒']);
});

test('計測開始後に全員が退出しても元の席を勝敗なしで載せ、ホストからホームに戻れる', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await countdown(host, pads);
  await Promise.all(pads.map((p) => p.leave()));
  await settle(host);
  await incomplete(host);
  expect((await finalRows(host)).map((r) => [r.name, r.label])).toEqual([['たろう', '未計測'], ['はなこ', '未計測']]);
  await expect(host.page.locator('.seat[data-seat]')).toHaveCount(0);
  await host.page.locator('[data-nav="results:home"]').click();
  await settle(host);
  await host.expectState('home');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
});

test('記録のある勝負中でもホスト再読込は同じ部屋のホームへ戻り、古いゲームを再開しない', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const code = await host.code();
  const pads = await rig.join(host, ['たろう', 'はなこ']);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await countdown(host, pads);
  await stopAt(host, pads, [10_200, 10_400]);
  await action(host, pads[0]!, '次へ');
  await countdown(host, pads);
  await host.page.clock.resume();
  await host.page.reload();
  await host.expectState('home', 20_000);
  expect(await host.code()).toBe(code);
  await expect(host.page.locator('.stage iframe, .results')).toHaveCount(0);
  expect((await host.seats()).map((s) => [s.name, s.online])).toEqual([['たろう', true], ['はなこ', true]]);
  await pads[0]!.expectKind('remote');
  await pads[1]!.expectKind('wait');
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  await action(host, pads[0]!, 'はじめる');
  await countdown(host, pads);
  expect((await stopAt(host, pads, [10_000, 10_000])).map((r) => r.total)).toEqual(['0.0秒', '0.0秒']);
  await expect((await host.gameFrame())!.locator('html')).toHaveAttribute('data-round', '1');
});

test('新ゲームの共有4入口は固定の公開ホーム案内だけを渡し、部屋・他人の名前・記録を含めない', HOST, async ({ rig }) => {
  const shared: unknown[] = [];
  const copied: string[] = [];
  const host = await rig.openHost({ clock: true, init: async (ctx) => {
    await ctx.exposeFunction('__tenShared', (data: unknown) => void shared.push(data));
    await ctx.exposeFunction('__tenCopied', (data: string) => void copied.push(data));
    await ctx.addInitScript(() => {
      const callbacks = globalThis as unknown as { __tenShared(data: unknown): Promise<void>; __tenCopied(data: string): Promise<void> };
      Object.defineProperty(navigator, 'share', { configurable: true, value: (data: unknown) => callbacks.__tenShared(data) });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (data: string) => callbacks.__tenCopied(data) } });
    });
  } });
  const code = await host.code();
  const names = ['共有しない太郎', '共有しない花子'];
  const pads = await rig.join(host, names);
  await host.choose('ten-seconds', pads[0]);
  await host.expectPhase('intro');
  await pause(host);
  for (let round = 0; round < 3; round++) {
    await action(host, pads[0]!, round === 0 ? 'はじめる' : '次へ');
    await countdown(host, pads);
    await stopAt(host, pads, [10_000, 10_200]);
  }
  await action(host, pads[0]!, '総合結果へ');
  await host.expectState('results');
  await host.page.locator('[data-nav="results:share"]').click();
  const layer = host.page.locator('[data-layer="share"]');
  await expect(layer).toBeVisible();
  const site = `${host.base}/`;
  await expect(layer.locator('.share__url')).toHaveText(site);
  for (const entry of ['native', 'x', 'line', 'copy']) await expect(layer.locator(`[data-nav="share:${entry}"]`)).toBeVisible();
  const x = new URL((await layer.locator('[data-nav="share:x"]').getAttribute('href'))!);
  const line = new URL((await layer.locator('[data-nav="share:line"]').getAttribute('href'))!);
  expect(`${x.origin}${x.pathname}`).toBe('https://x.com/intent/post');
  expect([...x.searchParams.keys()].sort()).toEqual(['text', 'url']);
  expect(x.searchParams.get('url')).toBe(site);
  expect(`${line.origin}${line.pathname}`).toBe('https://social-plugins.line.me/lineit/share');
  expect([...line.searchParams]).toEqual([['url', site]]);
  await layer.locator('[data-nav="share:native"]').click();
  await expect.poll(() => shared.length).toBe(1);
  expect(shared[0]).toEqual({ title: 'irori', text: 'スマホがコントローラーになる、みんなで囲むゲーム機「irori」', url: site });
  expect(x.searchParams.get('text')).toBe('スマホがコントローラーになる、みんなで囲むゲーム機「irori」');
  await layer.locator('[data-nav="share:copy"]').click();
  await expect.poll(() => copied).toEqual([site]);
  const payload = JSON.stringify({ x: decodeURIComponent(x.href), line: decodeURIComponent(line.href), shared, copied });
  for (const secret of [code, ...names, '合計ズレ', '0.6秒', note, '/pad']) expect(payload).not.toContain(secret);
  for (const entry of ['x', 'line']) {
    await expect(layer.locator(`[data-nav="share:${entry}"]`)).toHaveAttribute('target', '_blank');
    await expect(layer.locator(`[data-nav="share:${entry}"]`)).toHaveAttribute('rel', /noopener/);
  }
  await layer.locator('[data-nav="share:close"]').click();
  await host.expectState('results');
});
