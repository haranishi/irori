// 試遊サーバー：評価者が curl だけで、本物のホストの画面と本物のスマホの画面（それぞれ別の BrowserContext）を操作して遊ぶための道具。
// 実 Worker（wrangler dev --local）を自分専用のビルドとポートで起動し、Playwright の Chromium でホスト（1280×720）と
// スマホ（390×844・タッチ）を実物のまま開く。ホストの時計（ゲームの枠の中も同じ時計）は既定で止めておき、
// 操作のたびに少しだけ進める。だから1手に何秒かけても、時間切れにならない。時間を進めるのは /clock/advance。
//
//   node tools/playtest-server.mjs [--port N] [--port-file FILE] [--headed]
//     起動すると1行目に {"playtest":"http://127.0.0.1:PORT"} を出す（--port-file にも同じ URL を書く）。
//   curl -s -X POST localhost:PORT/start -d '{}'                     … Worker を起動してホストを開く（clock: "paused"|"running"）
//   curl -s -X POST localhost:PORT/pad/1/join -d '{"name":"たろう"}'  … スマホ1が参加（n は1〜8）
//   curl -s -X POST localhost:PORT/pad/1/tap -d '{"id":"right"}'      … ボタンを押す（count・intervalMs で連打）
//        id はリモコンの up/down/left/right/ok/back、ゲームのボタンの id（buzzer・hop・end など）
//   curl -s -X POST localhost:PORT/pad/1/hold -d '{"id":"hop","ms":800}'      … 押し続ける
//   curl -s -X POST localhost:PORT/pad/1/stick -d '{"x":1,"y":0,"ms":1500}'   … スティックを倒し続ける（-1〜1）
//   curl -s -X POST localhost:PORT/pad/1/choose -d '{"index":0}'               … 選択肢を選ぶ（0から数える）
//   POST /pad/:n/tiles {"ids":["a"]} または {"pass":true} … 札の選択をそろえて決定・パス
//   POST /pad/:n/swipe {"x0":0.5,"y0":0.3,"x1":0.5,"y1":0.8,"ms":400} … touch の枠で、指を置いて動かして離す（座標は枠の中の0〜1。ボウリングは下へ引いてはなす）
//   curl -s -X POST localhost:PORT/pad/1/menu -d '{"item":"leave"}'            … 長押しのメニュー（pause か leave）
//   curl -s -X POST localhost:PORT/pad/1/disconnect   /   .../reconnect           … 回線を切る・戻す
//   curl -s -X POST localhost:PORT/host/key -d '{"key":"Escape"}'              … ホストのキー（ArrowRight・Enter・Escape・m）
//   curl -s -X POST localhost:PORT/clock/advance -d '{"ms":30000}'             … ホストの時計を進める
//   curl -s localhost:PORT/state                                                … いま見えている文字・状態（JSON）
//   curl -s -X POST localhost:PORT/shot -d '{"target":"host"}'                  … 撮ってパスを返す（target は host か 1〜8）
//   curl -s -X POST localhost:PORT/stop                                         … 全部止めて終わる
// 操作の順に1つずつ処理する。待つのは画面の data- 属性だけ。操作は 127.0.0.1 からだけ受ける。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { Line } from '../apps/web/tests/pad/e2e/line.mjs';
import { stageGames } from '../tests/e2e/console/lib/stage.mjs';
import { buildWeb, pickPorts, startEdge } from './lib/edge-server.mjs';
import { isDirectRun } from './lib/files.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VARS = { ALLOW_TEST_OVERRIDES: '1', CREATE_PER_IP_PER_MINUTE: '1000', LOOKUP_PER_IP_PER_MINUTE: '1000', MAX_ROOMS_PER_DAY: '100000' };
const HOST_VIEW = { viewport: { width: 1280, height: 720 }, locale: 'ja-JP' };
const PAD_VIEW = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Playtest {
  constructor({ headed = false } = {}) {
    this.headed = headed;
    this.browser = null;
    this.web = null;
    this.edge = null;
    this.host = null;
    /** @type {Map<number, { ctx: any, page: any, line: any, cdp: any, name: string }>} */
    this.pads = new Map();
    this.clockMode = 'paused';
    this.shots = mkdtempSync(join(tmpdir(), 'irori-playtest-'));
    this.shotSeq = 0;
  }

  // ---- 起動と終わり ----

  async start({ clock = 'paused' } = {}) {
    if (this.host) throw new HttpError(409, 'もう始めています（やり直すときは /stop してから起動し直す）');
    this.web = buildWeb();
    stageGames(this.web.outDir);
    const [port, inspectorPort] = await pickPorts(2, { from: 8860, to: 8899 });
    this.edge = await startEdge({ name: 'playtest', assetsDir: this.web.outDir, port, inspectorPort, vars: VARS });
    this.browser = await chromium.launch({ headless: !this.headed });
    const ctx = await this.browser.newContext(HOST_VIEW);
    await ctx.clock.install();
    const page = await ctx.newPage();
    this.host = { ctx, page };
    // ホストの ping と pong の時刻（実時間）。時計を進めるとき、返事を受けてから先へ進むために使う。
    this.beat = { ping: 0, pong: 0, sockets: 0 };
    page.on('websocket', (ws) => {
      this.beat.sockets++;
      ws.on('framesent', ({ payload }) => {
        if (payload === '{"t":"ping"}') this.beat.ping = Date.now();
      });
      ws.on('framereceived', ({ payload }) => {
        if (payload === '{"t":"pong"}') this.beat.pong = Date.now();
      });
    });
    await page.goto(`${this.edge.url}/`);
    await this.waitAttr(page.locator('#app'), 'data-code', /^[A-Z0-9]{4}$/, 20_000);
    this.clockMode = clock === 'running' ? 'running' : 'paused';
    if (this.clockMode === 'paused') await this.pauseClock();
    return { url: this.edge.url, code: await page.locator('#app').getAttribute('data-code'), clock: this.clockMode, shots: this.shots };
  }

  async stop() {
    for (const p of this.pads.values()) {
      await p.ctx.close().catch(() => undefined);
      await p.line?.close().catch(() => undefined);
    }
    this.pads.clear();
    await this.browser?.close().catch(() => undefined);
    await this.edge?.stop();
    this.web?.cleanup();
    this.host = null;
  }

  // ---- 時計 ----

  async pauseClock() {
    const now = await this.host.page.evaluate(() => Date.now());
    await this.host.page.clock.pauseAt(now + 1);
    this.clockMode = 'paused';
  }

  /** 操作のあと：届いたフレームを処理させるため、止めた時計を少しだけ進める（約120ms）。 */
  async settle() {
    if (this.clockMode !== 'paused') {
      await sleep(200);
      return;
    }
    for (let i = 0; i < 3; i++) {
      await sleep(60);
      await this.host.page.clock.runFor(40);
    }
  }

  /** 時計を ms 進める。止めていれば、1秒ずつ（合間に実時間を少し置いて、ping の返事を受けられるように）。 */
  async advance(ms) {
    const total = Math.max(0, Math.min(Number(ms) || 0, 10 * 60_000));
    if (this.clockMode !== 'paused') {
      await this.host.page.clock.fastForward(total);
      await sleep(100);
      return { advanced: total };
    }
    let left = total;
    while (left > 0) {
      const step = Math.min(left, 1_000);
      await this.host.page.clock.runFor(step);
      left -= step;
      await this.pongArrived();
      await sleep(30);
    }
    await this.settle();
    return { advanced: total };
  }

  /** 時計を進めて ping が出たら、返事を受けるまで待つ（最大3秒）。返事の前に時計だけ30秒進むと、つながりを捨ててしまう。 */
  async pongArrived() {
    const until = Date.now() + 3_000;
    while (this.beat.ping > this.beat.pong && Date.now() < until) await sleep(10);
  }

  /** 実時間 ms のあいだ、止めた時計も同じだけ進める（押し続ける・倒し続けるとき）。 */
  async during(ms, fn) {
    const until = Date.now() + ms;
    const work = fn();
    if (this.clockMode === 'paused') {
      while (Date.now() < until) {
        await sleep(50);
        await this.host.page.clock.runFor(50);
        await this.pongArrived();
      }
    }
    await work;
  }

  // ---- スマホ ----

  pad(n) {
    const p = this.pads.get(n);
    if (!p) throw new HttpError(404, `スマホ${n}は、まだ参加していません（/pad/${n}/join）`);
    return p;
  }

  async join(n, { name } = {}) {
    if (!this.host) throw new HttpError(409, '先に /start');
    if (!(n >= 1 && n <= 8)) throw new HttpError(400, 'スマホの番号は1〜8');
    if (this.pads.has(n)) throw new HttpError(409, `スマホ${n}は参加済みです`);
    const code = await this.host.page.locator('#app').getAttribute('data-code');
    const [linePort] = await pickPorts(1, { from: 5260, to: 5289 });
    const line = await Line.start(Number(new URL(this.edge.url).port), linePort);
    const ctx = await this.browser.newContext(PAD_VIEW);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const entry = { ctx, page, line, cdp, name: name ?? '' };
    this.pads.set(n, entry);
    await page.goto(`${line.url}/pad#${code}`);
    const join = page.locator('[data-act="join"]');
    await join.waitFor({ state: 'visible', timeout: 15_000 });
    if (name) await page.locator('#pp-name').fill(String(name));
    await join.tap();
    await page.locator('[data-screen="play"]').waitFor({ state: 'visible', timeout: 15_000 });
    await this.settle();
    return { pad: n, seat: Number(await page.locator('[data-screen="play"]').getAttribute('data-seat')) };
  }

  async center(page, selector) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {
      throw new HttpError(409, `いまの画面に ${selector} がありません（/state の buttons を見る）`);
    });
    const b = await el.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  }

  async tap(n, { id, count = 1, intervalMs = 80 } = {}) {
    if (!id) throw new HttpError(400, 'id がありません');
    const { page } = this.pad(n);
    const c = await this.center(page, `.irori-pad__btn[data-id="${id}"]`);
    const times = Math.max(1, Math.min(Number(count) || 1, 200));
    for (let i = 0; i < times; i++) {
      await page.touchscreen.tap(c.x, c.y);
      if (i < times - 1) await this.during(Math.max(0, Number(intervalMs) || 0), async () => undefined);
    }
    await this.settle();
    return { tapped: times };
  }

  async touch(n, type, x, y) {
    await this.pad(n).cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  }

  async hold(n, { id, ms = 500 } = {}) {
    if (!id) throw new HttpError(400, 'id がありません');
    const c = await this.center(this.pad(n).page, `.irori-pad__btn[data-id="${id}"]`);
    await this.touch(n, 'touchStart', c.x, c.y);
    await this.during(Math.min(Number(ms) || 0, 60_000), async () => undefined);
    await this.touch(n, 'touchEnd');
    await this.settle();
    return { held: Number(ms) };
  }

  async stick(n, { x = 0, y = 0, ms = 500 } = {}) {
    const c = await this.center(this.pad(n).page, '.irori-pad__stick, .irori-pad__dpad');
    const clamp = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
    await this.touch(n, 'touchStart', c.x, c.y);
    for (const k of [0.4, 0.8, 1]) await this.touch(n, 'touchMove', c.x + (clamp(x) * k * c.w) / 2, c.y + (clamp(y) * k * c.h) / 2);
    await this.during(Math.min(Number(ms) || 0, 60_000), async () => undefined);
    await this.touch(n, 'touchEnd');
    await this.settle();
    return { held: Number(ms), x: clamp(x), y: clamp(y) };
  }

  /** touch の枠で、(x0,y0) に指を置き、(x1,y1) まで動かして離す。座標は枠の中を0〜1にした値。 */
  async swipe(n, { x0 = 0.5, y0 = 0.3, x1 = 0.5, y1 = 0.8, ms = 400 } = {}) {
    const unit = (v, d) => { const f = Number(v); return Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : d; };
    const [ax, ay, bx, by] = [unit(x0, 0.5), unit(y0, 0.3), unit(x1, 0.5), unit(y1, 0.8)];
    const c = await this.center(this.pad(n).page, '.irori-pad__touch');
    const at = (px, py) => [c.x - c.w / 2 + px * c.w, c.y - c.h / 2 + py * c.h];
    const steps = 8;
    const wait = Math.max(0, Math.min(Number(ms) || 0, 5_000)) / steps;
    await this.touch(n, 'touchStart', ...at(ax, ay));
    for (let i = 1; i <= steps; i++) {
      await this.touch(n, 'touchMove', ...at(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps));
      if (wait) await sleep(wait);
    }
    await this.touch(n, 'touchEnd');
    await this.settle();
    return { from: [ax, ay], to: [bx, by], ms: Number(ms) || 0 };
  }

  async choose(n, { index, id } = {}) {
    const { page } = this.pad(n);
    const sel = id !== undefined ? `.irori-pad__choice[data-id="${id}"]` : `.irori-pad__choice >> nth=${Number(index) || 0}`;
    const c = await this.center(page, sel);
    await page.touchscreen.tap(c.x, c.y);
    await this.settle();
    return { chosen: id ?? (Number(index) || 0) };
  }

  async tiles(n, { ids = [], pass = false } = {}) {
    if (!Array.isArray(ids) || ids.length > 8 || ids.some((id) => typeof id !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(id)) || new Set(ids).size !== ids.length || typeof pass !== 'boolean' || (pass && ids.length)) {
      throw new HttpError(400, 'ids は重複しない8個まで。pass は選択なしのときだけ');
    }
    const { page } = this.pad(n);
    const pad = page.locator('.irori-pad[data-kind="tiles"]');
    await pad.waitFor({ state: 'visible', timeout: 5_000 });
    if (!pass) {
      const available = await pad.locator('.irori-pad__tile:not(:disabled)').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
      if (ids.some((id) => !available.includes(id))) throw new HttpError(400, '選べない札です');
      for (const el of await pad.locator('.irori-pad__tile[aria-pressed="true"]').all()) await el.tap();
      for (const id of ids) await pad.locator(`.irori-pad__tile[data-id="${id}"]`).tap();
      const selected = await pad.locator('.irori-pad__tile[aria-pressed="true"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
      if (selected.length !== ids.length || ids.some((id) => !selected.includes(id))) throw new HttpError(400, '選択数が上限を超えています');
    }
    const action = pad.locator(`[data-action="${pass ? 'pass' : 'ok'}"]`);
    if (await action.count() !== 1 || !await action.isEnabled()) throw new HttpError(400, 'いまは決定できません');
    await action.tap();
    await this.settle();
    return { ids: pass ? [] : ids, pass };
  }

  /** 左上の札の長押しで開くメニュー。item は pause（一時停止を頼む）か leave（退出）。 */
  async menu(n, { item = 'pause' } = {}) {
    if (item !== 'pause' && item !== 'leave') throw new HttpError(400, 'item は pause か leave');
    const { page } = this.pad(n);
    const c = await this.center(page, '[data-act="seat"]');
    await this.touch(n, 'touchStart', c.x, c.y);
    await page.locator('.pp-menu').waitFor({ state: 'visible', timeout: 5_000 });
    await this.touch(n, 'touchEnd');
    await sleep(420);
    await page.locator(`[data-act="${item}"]`).tap();
    await this.settle();
    return { menu: item };
  }

  async disconnect(n) {
    const { line } = this.pad(n);
    line.blockNew = true;
    line.drop();
    await sleep(300);
    await this.settle();
    return { disconnected: n };
  }

  async reconnect(n) {
    this.pad(n).line.unblock();
    await this.pad(n).page.locator('[data-screen="play"]:not([data-link="lost"])').waitFor({ timeout: 20_000 }).catch(() => undefined);
    await this.settle();
    return { reconnected: n };
  }

  // ---- ホスト ----

  async key(k) {
    if (!this.host) throw new HttpError(409, '先に /start');
    if (typeof k !== 'string' || !/^[A-Za-z0-9+]{1,24}$/.test(k)) throw new HttpError(400, 'key は ArrowRight・Enter・Escape・m など');
    await this.host.page.keyboard.press(k);
    await this.settle();
    return { key: k };
  }

  async shot(target) {
    const page = target === 'host' || target === undefined ? this.host?.page : this.pad(Number(target)).page;
    if (!page) throw new HttpError(409, '先に /start');
    if (this.clockMode === 'paused') await this.host.page.clock.runFor(20);
    mkdirSync(this.shots, { recursive: true });
    const path = join(this.shots, `${String(++this.shotSeq).padStart(3, '0')}-${target === 'host' || target === undefined ? 'host' : `pad${target}`}.png`);
    await page.screenshot({ path });
    return { path };
  }

  // ---- 状態 ----

  async state() {
    if (!this.host) return { started: false };
    const host = await this.host.page.evaluate(() => {
      const app = document.getElementById('app');
      const d = app?.dataset ?? {};
      const txt = (el) => (el?.innerText ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
      const iframe = document.querySelector('.stage iframe');
      const src = iframe?.getAttribute('src') ?? '';
      return {
        state: d.state ?? null,
        phase: d.phase ?? null,
        issue: d.issue ?? null,
        code: d.code ?? null,
        players: Number(d.players ?? 0),
        leader: d.leader ? Number(d.leader) : null,
        locked: d.locked === 'true',
        focused: app?.querySelector('[data-focused]')?.getAttribute('data-nav') ?? null,
        gameId: src ? (/\/games\/([^/]+)\//.exec(src)?.[1] ?? 'dev') : null,
        seats: [...document.querySelectorAll('.seat[data-seat]')].map((el) => ({
          seat: Number(el.getAttribute('data-seat')),
          name: el.querySelector('.seat__name')?.textContent ?? '',
          online: el.getAttribute('data-online') === 'true',
          leader: el.hasAttribute('data-leader'),
        })),
        results: [...document.querySelectorAll('.results [data-rank][data-seat]')].map((el) => ({
          seat: Number(el.getAttribute('data-seat')),
          rank: Number(el.getAttribute('data-rank')),
          name: el.querySelector('.result__name')?.textContent ?? '',
          label: (el.querySelector('.result__value') ?? el.querySelector('.result__label'))?.textContent ?? '',
          score: el.querySelector('.result__score')?.textContent ?? '',
        })),
        text: txt(app),
      };
    });
    let game = null;
    const frameEl = await this.host.page.$('.stage iframe');
    const frame = frameEl ? await frameEl.contentFrame() : null;
    if (frame) {
      game = await frame
        .evaluate(() => ({
          phase: document.documentElement.dataset.phase ?? null,
          round: document.documentElement.dataset.round ?? null,
          text: (document.body?.innerText ?? '').replace(/\n{2,}/g, '\n').trim(),
        }))
        .catch(() => null);
    }
    const pads = [];
    for (const [n, p] of [...this.pads.entries()].sort((a, b) => a[0] - b[0])) {
      pads.push({
        n,
        ...(await p.page
          .evaluate(() => {
            const play = document.querySelector('[data-screen="play"]');
            const pad = document.querySelector('.irori-pad');
            const screen = document.querySelector('[data-screen]');
            return {
              screen: screen?.getAttribute('data-screen') ?? null,
              state: screen?.getAttribute('data-state') ?? null,
              seat: play ? Number(play.getAttribute('data-seat')) : null,
              link: play?.getAttribute('data-link') ?? null,
              kind: pad?.getAttribute('data-kind') ?? null,
              buttons: [...document.querySelectorAll('.irori-pad__btn[data-id]:not(.irori-pad__choice):not(.irori-pad__tile)')].map((b) => ({ id: b.getAttribute('data-id'), label: b.getAttribute('aria-label') ?? b.textContent, disabled: b.disabled })),
              choices: [...document.querySelectorAll('.irori-pad__choice')].map((b, index) => ({ index, id: b.getAttribute('data-id'), label: b.textContent, disabled: b.disabled })),
              tiles: [...document.querySelectorAll('.irori-pad__tile')].map((b) => ({ id: b.getAttribute('data-id'), label: b.textContent, selected: b.getAttribute('aria-pressed') === 'true', disabled: b.disabled })),
              stick: document.querySelector('.irori-pad__stick') ? 'stick' : document.querySelector('.irori-pad__dpad') ? 'dpad' : null,
              text: (document.body?.innerText ?? '').replace(/\n{2,}/g, '\n').trim(),
            };
          })
          .catch((e) => ({ error: String(e) }))),
      });
    }
    const now = await this.host.page.evaluate(() => Date.now());
    return { started: true, url: this.edge.url, clock: { mode: this.clockMode, now }, host: { ...host, sockets: this.beat.sockets, game }, pads };
  }

  async waitAttr(locator, name, re, timeout) {
    const until = Date.now() + timeout;
    for (;;) {
      const v = await locator.getAttribute(name).catch(() => null);
      if (v !== null && re.test(v)) return v;
      if (Date.now() > until) throw new HttpError(504, `${name} が ${re} になりません`);
      await sleep(100);
    }
  }
}

// ---- HTTP ----

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) reject(new HttpError(413, '本文が大きすぎます'));
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, '本文が JSON ではありません'));
      }
    });
  });
}

export function serve(pt, { port = 0 } = {}) {
  let chain = Promise.resolve();
  const queue = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  let onStop = () => undefined;
  const stopped = new Promise((r) => {
    onStop = r;
  });
  const server = createServer(async (req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`${JSON.stringify(obj, null, 2)}\n`);
    };
    try {
      // 別のウェブページ（ブラウザ）から、単純な POST で操作されたり、DNS の付け替えで /state を読まれたりしないよう、
      // Host は 127.0.0.1 か localhost だけ、Origin 付き（ブラウザ経由）の要求は断る。curl は Origin を付けない。
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host ?? ''))) throw new HttpError(403, 'Host が 127.0.0.1 ではありません');
      if (req.headers.origin !== undefined) throw new HttpError(403, 'ブラウザからの要求（Origin つき）は受けません。curl で操作してください');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const body = req.method === 'POST' ? await readJson(req) : {};
      const m = /^\/pad\/(\d+)\/(join|tap|hold|stick|choose|tiles|swipe|menu|disconnect|reconnect)$/.exec(url.pathname);
      const route = `${req.method} ${m ? `/pad/:n/${m[2]}` : url.pathname}`;
      const n = m ? Number(m[1]) : 0;
      const handlers = {
        'GET /state': () => pt.state(),
        'POST /start': () => pt.start(body),
        'POST /pad/:n/join': () => pt.join(n, body),
        'POST /pad/:n/tap': () => pt.tap(n, body),
        'POST /pad/:n/hold': () => pt.hold(n, body),
        'POST /pad/:n/stick': () => pt.stick(n, body),
        'POST /pad/:n/choose': () => pt.choose(n, body),
        'POST /pad/:n/tiles': () => pt.tiles(n, body),
        'POST /pad/:n/swipe': () => pt.swipe(n, body),
        'POST /pad/:n/menu': () => pt.menu(n, body),
        'POST /pad/:n/disconnect': () => pt.disconnect(n),
        'POST /pad/:n/reconnect': () => pt.reconnect(n),
        'POST /host/key': () => pt.key(body.key),
        'POST /clock/advance': () => pt.advance(body.ms),
        'POST /clock/pause': async () => (await pt.pauseClock(), { clock: 'paused' }),
        'POST /clock/resume': async () => (await pt.host?.page.clock.resume(), (pt.clockMode = 'running'), { clock: 'running' }),
        'POST /shot': () => pt.shot(body.target),
        'POST /stop': async () => (await pt.stop(), setTimeout(onStop, 50), { stopped: true }),
      };
      const h = handlers[route];
      if (!h) throw new HttpError(404, `知らない操作: ${req.method} ${url.pathname}（使い方は tools/playtest-README.md）`);
      send(200, await queue(h));
    } catch (e) {
      send(e instanceof HttpError ? e.status : 500, { error: e instanceof Error ? e.message.split('\n')[0] : String(e) });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`, server, stopped });
    });
  });
}

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const pt = new Playtest({ headed: args.includes('--headed') });
  const { url, server, stopped } = await serve(pt, { port: Number(opt('--port') ?? 0) });
  console.log(JSON.stringify({ playtest: url }));
  const file = opt('--port-file');
  if (file) writeFileSync(file, `${url}\n`);
  const bye = async () => {
    await pt.stop().catch(() => undefined);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  await stopped;
  server.close();
  process.exit(0);
}
