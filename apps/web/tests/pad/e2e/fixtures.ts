// スマホの画面の実ブラウザ試験の土台。
// - line：ブラウザと実 Worker のあいだの回線の模型（B2 のポート 5240〜5259 から選ぶ）。ページはここを通して開く。
// - makeHost：Node のホスト役（部屋を作ってつなぐ）。試験の終わりに閉じる。
// - 見張り（自動）：コンソールのエラー・警告と CSP 違反は、0件でなければ落とす。回線をわざと切る試験だけ、
//   ブラウザが出す WebSocket の失敗の知らせを許す（allowNetworkErrors）。
import { expect, test as base, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { PlayerInfo } from '@irori/protocol';
import { pickPorts } from '../../../../../tools/lib/edge-server.mjs';
import { edgeUrl } from './env.mjs';
import { TestHost } from './host';
import { Line } from './line.mjs';

export { expect };

export interface Watch {
  /** 回線をわざと切る試験：ブラウザが出す WebSocket の失敗の知らせを許す。resources も真なら、取得の失敗（わざと止めた応答）も許す。 */
  allowNetworkErrors(opts?: { resources?: boolean }): void;
  readonly list: string[];
}

interface Fixtures {
  edge: string;
  line: Line;
  makeHost: () => Promise<TestHost>;
  watch: Watch;
}

export const test = base.extend<Fixtures, { lineW: Line }>({
  lineW: [
    async ({}, use) => {
      const [port] = await pickPorts(1, { from: 5240, to: 5259 });
      const line = await Line.start(Number(new URL(edgeUrl()).port), port!);
      await use(line);
      await line.close();
    },
    { scope: 'worker' },
  ],
  line: async ({ lineW }, use) => {
    lineW.blockNew = false;
    await use(lineW);
    lineW.unblock();
  },
  edge: async ({}, use) => {
    await use(edgeUrl());
  },
  makeHost: async ({ edge }, use) => {
    const hosts: TestHost[] = [];
    await use(async () => {
      const h = await TestHost.create(edge);
      hosts.push(h);
      return h;
    });
    for (const h of hosts) h.close();
  },
  watch: [
    async ({ context }, use) => {
      const list: string[] = [];
      let allowNet = false;
      let allowResources = false;
      const watchPage = (page: Page) => {
        page.on('console', (m) => {
          if (m.type() === 'error' || m.type() === 'warning') list.push(`${m.type()}: ${m.text()}`);
        });
        page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`));
      };
      for (const p of context.pages()) watchPage(p);
      context.on('page', watchPage);
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.error(`CSP違反: ${e.violatedDirective} ${e.blockedURI}`);
        });
      });
      await use({
        allowNetworkErrors: (opts) => {
          allowNet = true;
          if (opts?.resources) allowResources = true;
        },
        list,
      });
      const bad = list.filter(
        (s) =>
          !(allowNet && /^error: WebSocket connection to .* failed/.test(s)) &&
          !(allowResources && /^error: Failed to load resource: /.test(s)),
      );
      expect(bad, 'コンソールのエラー・警告と CSP 違反').toEqual([]);
    },
    { auto: true },
  ],
});

// ---- 画面の操作 ----

export const screen = (page: Page, name: string): Locator => page.locator(`[data-screen="${name}"]`);
export const act = (page: Page, name: string): Locator => page.locator(`[data-act="${name}"]`);

export async function openPad(page: Page, line: Line, hash = ''): Promise<void> {
  await page.goto(`${line.url}/pad${hash ? `#${hash}` : ''}`);
}

/** QR のURLで開き、参加するを1回押す。ホストに届いた席を返す。 */
export async function joinRoom(page: Page, line: Line, host: TestHost, name?: string): Promise<PlayerInfo> {
  const n = host.joined().length;
  await openPad(page, line, host.code);
  await expect(screen(page, 'join')).toBeVisible();
  if (name !== undefined) await page.locator('#pp-name').fill(name);
  await act(page, 'join').tap();
  const you = await host.joinedNth(n + 1);
  await expect(screen(page, 'play')).toBeVisible();
  return you;
}

/** 画面ロックやタブの切替から戻ったことにする（hidden → visible の visibilitychange）。 */
export async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const set = (v: DocumentVisibilityState) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/**
 * 「起きないこと」を確かめる：ms のあいだ状態を照会し続け、ずっと expected のままであること。
 * 自動の入り直しは最大でも約0.6秒（最初の待ち時間）で起きるので、窓は1.5秒あれば足りる。
 */
export async function stays<T>(read: () => T | Promise<T>, expected: T, ms = 1_500, what = '状態'): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (JSON.stringify(v) !== JSON.stringify(expected)) throw new Error(`${what} が変わった: ${JSON.stringify(v)}（期待 ${JSON.stringify(expected)}）`);
    if (Date.now() >= until) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** 画面ロックの解除・回線の復帰に当たる知らせを、まとめて出す（visibilitychange・pageshow・online）。 */
export async function comeBackAll(page: Page): Promise<void> {
  await comeBack(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('online'));
  });
}

export async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('要素の位置が取れない（見えていない）');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** 指（Chromium の CDP のタッチ）。押したまま・なぞる・離すを、時間を指定して行う。 */
export class Finger {
  private constructor(private readonly cdp: CDPSession) {}

  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }

  async down(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  }

  async move(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }

  async up(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** ms のあいだ押し続けてから離す。 */
  async hold(locator: Locator, ms: number): Promise<void> {
    const c = await centerOf(locator);
    await this.down(c.x, c.y);
    await new Promise((r) => setTimeout(r, ms));
    await this.up();
  }

  /** 点の列をなぞる。 */
  async drag(points: { x: number; y: number }[], stepMs = 30): Promise<void> {
    const [first, ...rest] = points;
    if (!first) return;
    await this.down(first.x, first.y);
    for (const p of rest) {
      await new Promise((r) => setTimeout(r, stepMs));
      await this.move(p.x, p.y);
    }
    await new Promise((r) => setTimeout(r, stepMs));
    await this.up();
  }

  async detach(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}
