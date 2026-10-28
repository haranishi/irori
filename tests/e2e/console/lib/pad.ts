// 本物のスマホの画面（/pad#CODE）の操作。1台が1つの BrowserContext。
// 待つのは画面の data- 属性（.irori-pad の data-kind、.pp-play の data-seat・data-link、[data-screen]）。文言には頼らない。
// 回線の模型（B2 の line.mjs）を通して開いた台は、drop・freeze・切れたままにする、ができる。
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { Line } from '../../../../apps/web/tests/pad/e2e/line.mjs';
import type { Finger } from './finger';
import type { PadSpec } from '../../../../packages/protocol/src/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PadInit {
  page: Page;
  context: BrowserContext;
  origin: string;
  finger: Finger;
  line: Line | null;
  engine: string;
  label: string;
}

export class Pad {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly origin: string;
  readonly finger: Finger;
  readonly line: Line | null;
  readonly engine: string;
  readonly label: string;
  readonly pad: Locator;
  readonly play: Locator;
  /** このスマホの WebSocket が受け取ったフレーム（画面の指定・振動など）。 */
  readonly received: { at: number; f: { t: string; [k: string]: unknown } }[] = [];

  constructor(o: PadInit) {
    this.page = o.page;
    this.context = o.context;
    this.origin = o.origin;
    this.finger = o.finger;
    this.line = o.line;
    this.engine = o.engine;
    this.label = o.label;
    this.pad = o.page.locator('.irori-pad');
    this.play = o.page.locator('[data-screen="play"]');
    o.page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string' || !payload.startsWith('{')) return;
        try {
          this.received.push({ at: Date.now(), f: JSON.parse(payload) as { t: string } });
        } catch {
          // 読めないものは記録しない
        }
      });
    });
  }

  /** 受け取った振動の指示（fx）の数。 */
  fx(): number {
    return this.received.filter((r) => r.f.t === 'fx').length;
  }

  /** 再接続前も含む全pad指定。呼ぶたびに新しい配列を返す。 */
  receivedFrames(): PadSpec[] {
    return this.received.filter((r) => r.f.t === 'pad').map((r) => r.f.spec as PadSpec);
  }

  /** 現在選べる札から選び、決定する。空配列は札なし画面の決定。 */
  async tiles(selection: string[] | 'first' | { pass: true }): Promise<void> {
    await this.expectKind('tiles');
    const root = this.page.locator('.irori-pad[data-kind="tiles"]');
    const short = { timeout: 2_000 };
    // 段階が替わった直後は、前の画面（送信済み）が残っていたり、画面が差し替わる途中だったりする。
    // 画面が替わって操作が空振りしたら、最初からやり直す（決定を押すのは最後の1回だけなので、二重には送らない）。
    await expect(async () => {
      await expect(root.locator('.irori-pad__tiles')).not.toHaveAttribute('data-sent', '', short);
      if (typeof selection === 'object' && !Array.isArray(selection)) {
        const pass = root.locator('[data-action="pass"]');
        await expect(pass).toBeEnabled(short);
        await pass.tap();
        return;
      }
      const available = root.locator('.irori-pad__tile:not(:disabled)');
      if (selection === 'first') await expect(available.first()).toBeEnabled(short);
      const ids = selection === 'first' ? [(await available.first().getAttribute('data-id', short))!] : selection;
      const selectable = await available.evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
      if (new Set(ids).size !== ids.length || ids.some((id) => !/^[a-z0-9_-]{1,24}$/.test(id) || !selectable.includes(id))) {
        throw new Error(`${this.label}: 選べない札または重複した札`);
      }
      for (const tile of await root.locator('.irori-pad__tile[aria-pressed="true"]').all()) await tile.tap(short);
      for (const id of ids) await root.locator(`.irori-pad__tile[data-id="${id}"]`).tap(short);
      await expect(root.locator('.irori-pad__tile[aria-pressed="true"]')).toHaveCount(ids.length, short);
      const ok = root.locator('[data-action="ok"]');
      await expect(ok).toBeEnabled(short);
      await ok.tap(short);
    }).toPass({ timeout: 15_000, intervals: [100, 250, 500] });
  }

  /** 枠内の座標で実際のpointer経路を通す。Chromiumはタッチ、WebKitは既存Fingerのマウス。 */
  async swipe(x0: number, y0: number, x1: number, y1: number, ms: number): Promise<void> {
    if ([x0, y0, x1, y1].some((n) => !Number.isFinite(n) || n < 0 || n > 1) || !Number.isFinite(ms) || ms < 0 || ms > 5_000) {
      throw new Error(`${this.label}: swipeの座標か時間が範囲外`);
    }
    await this.expectKind('touch');
    const touch = this.page.locator('.irori-pad__touch');
    await expect(touch).toBeVisible();
    const b = await touch.boundingBox();
    if (!b) throw new Error(`${this.label}: なぞる枠の位置が取れない`);
    await this.finger.down(b.x + b.width * x0, b.y + b.height * y0);
    try {
      for (let i = 1; i <= 8; i++) {
        await this.finger.move(b.x + b.width * (x0 + (x1 - x0) * i / 8), b.y + b.height * (y0 + (y1 - y0) * i / 8));
        // 固定待ちは状態待ちには使わず、指を動かす実時間だけに使う。
        if (ms) await sleep(ms / 8);
      }
    } finally {
      await this.finger.up();
    }
  }

  /** QR の URL（/pad#CODE）で開き、「参加する」を1回押す。席に入って遊ぶ画面が出るまで待つ。 */
  async join(code: string, name?: string): Promise<number> {
    await this.page.goto(`${this.origin}/pad#${code}`);
    const join = this.page.locator('[data-act="join"]');
    await expect(join).toBeVisible();
    if (name !== undefined) await this.page.locator('#pp-name').fill(name);
    await join.tap();
    await expect(this.play).toBeVisible();
    return this.seat();
  }

  async seat(): Promise<number> {
    await expect(this.play).toHaveAttribute('data-seat', /^[1-8]$/);
    return Number(await this.play.getAttribute('data-seat'));
  }

  kind(): Promise<string | null> {
    return this.pad.getAttribute('data-kind').catch(() => null);
  }

  async expectKind(kind: string, timeout?: number): Promise<void> {
    await expect(this.pad).toHaveAttribute('data-kind', kind, timeout === undefined ? {} : { timeout });
  }

  /** 待機の画面の見出しと本文（ゲームやコンソールが送った文字。<wbr> は文字に入らない）。 */
  async waitText(): Promise<{ title: string; body: string }> {
    const title = (await this.page.locator('.irori-pad__title').textContent().catch(() => null)) ?? '';
    const body = (await this.page.locator('.irori-pad__text').textContent().catch(() => null)) ?? '';
    return { title, body };
  }

  async expectWait(title: string, timeout?: number): Promise<void> {
    await this.expectKind('wait', timeout);
    await expect(this.page.locator('.irori-pad__title')).toHaveText(title, timeout === undefined ? {} : { timeout });
  }

  button(id: string): Locator {
    return this.page.locator(`.irori-pad__btn[data-id="${id}"]`);
  }

  async centerOf(l: Locator): Promise<{ x: number; y: number }> {
    await expect(l).toBeVisible();
    const b = await l.boundingBox();
    if (!b) throw new Error(`${this.label}: 要素の位置が取れない`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /** ボタンを1回タップする（押せるようになるまで待つ）。 */
  async tap(id: string): Promise<void> {
    const b = this.button(id);
    await expect(b).toBeEnabled();
    await b.tap();
  }

  /** 同じボタンを count 回、intervalMs おきにタップする。位置は最初に1回だけ測る（速く押すため）。 */
  async tapMany(id: string, count: number, intervalMs = 0): Promise<void> {
    const c = await this.centerOf(this.button(id));
    for (let i = 0; i < count; i++) {
      await this.page.touchscreen.tap(c.x, c.y);
      if (intervalMs > 0 && i < count - 1) await sleep(intervalMs);
    }
  }

  /** ボタンを ms のあいだ押し続けて離す。 */
  async hold(id: string, ms: number): Promise<void> {
    const c = await this.centerOf(this.button(id));
    await this.finger.down(c.x, c.y);
    await sleep(ms);
    await this.finger.up();
  }

  /** スティックを (x, y)（-1〜1、半径に対する割合）へ倒したまま。離すのは stickUp。 */
  async stickDown(x: number, y: number): Promise<void> {
    const stick = this.page.locator('.irori-pad__stick');
    await expect(stick).toBeVisible();
    const b = await stick.boundingBox();
    if (!b) throw new Error(`${this.label}: スティックの位置が取れない`);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await this.finger.down(cx, cy);
    // 少しずつ倒す（指が動いたことを、ふつうの pointermove として届ける）。
    for (const k of [0.35, 0.7, 1]) await this.finger.move(cx + (x * k * b.width) / 2, cy + (y * k * b.height) / 2);
  }

  async stickUp(): Promise<void> {
    await this.finger.up();
  }

  async stick(x: number, y: number, ms: number): Promise<void> {
    await this.stickDown(x, y);
    await sleep(ms);
    await this.stickUp();
  }

  async choose(id: string): Promise<void> {
    const c = this.page.locator(`.irori-pad__choice[data-id="${id}"]`);
    await expect(c).toBeEnabled();
    await c.tap();
  }

  /** 左上の札を長押しして、メニューを開く。 */
  async openMenu(): Promise<void> {
    const badge = this.page.locator('[data-act="seat"]');
    const c = await this.centerOf(badge);
    await this.finger.down(c.x, c.y);
    await expect(this.page.locator('.pp-menu')).toBeVisible();
    await sleep(80);
    await this.finger.up();
    // 開いた直後の誤タップよけ（350ms）が過ぎるまで待つ。
    await sleep(400);
  }

  /** メニューの「退出」：bye を送って席を空ける。 */
  async leave(): Promise<void> {
    await this.openMenu();
    await this.page.locator('[data-act="leave"]').tap();
    await this.expectEnded('left');
  }

  /** 部屋の外の画面（left・kicked・closed・replaced・full・locked など）。 */
  async expectEnded(state: string, timeout?: number): Promise<void> {
    await expect(this.page.locator(`[data-screen="state"][data-state="${state}"]`)).toBeVisible(timeout === undefined ? {} : { timeout });
  }

  /** メニューの「一時停止を頼む」。 */
  async requestPause(): Promise<void> {
    await this.openMenu();
    await this.page.locator('[data-act="pause"]').tap();
    await expect(this.page.locator('.pp-menu')).toBeHidden();
  }

  /** 画面ロックやタブの切替から戻った知らせ（visibilitychange・pageshow・online）。 */
  async comeBack(): Promise<void> {
    await this.page.evaluate(() => {
      const set = (v: DocumentVisibilityState) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      set('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      set('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new Event('online'));
    });
  }

  private needLine(): Line {
    if (!this.line) throw new Error(`${this.label}: 回線の模型を通さずに開いた台は、回線を切れない（rig.pad の line: true）`);
    return this.line;
  }

  /** 両側を切り、入り直しも止める（切れたまま）。戻すのは restore。 */
  cut(): void {
    const l = this.needLine();
    l.blockNew = true;
    l.drop();
  }

  /** 黙って死んだ接続（どちらも気づかない）。 */
  freeze(): void {
    this.needLine().freeze();
  }

  restore(): void {
    this.needLine().unblock();
  }

  /** つながっているか（帯が出ていない）。 */
  async expectLink(state: 'open' | 'lost', timeout?: number): Promise<void> {
    if (state === 'lost') await expect(this.play).toHaveAttribute('data-link', 'lost', timeout === undefined ? {} : { timeout });
    else await expect(this.play).not.toHaveAttribute('data-link', 'lost', timeout === undefined ? {} : { timeout });
  }
}
