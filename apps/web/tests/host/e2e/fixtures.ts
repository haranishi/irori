// ホストの画面の実ブラウザ試験の部品。
// - openHost：ホストの画面を開く（見張りつき：コンソールのエラー・警告、ページの例外、CSP違反、自分のオリジン以外への通信）。
// - PagePad：実際の /pad#CODE のページ（スマホの大きさの別の BrowserContext）。
// - ScriptPad：room-client を使う小さなスマホ役。届いた画面の指定を、そのまま調べたいときに使う。
// 待つのは、画面の data- 属性と、届いたフレームの照会だけ（出力の文字列は待たない）。
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { PadSpec, PlayerInfo, ToPadFrame } from '@irori/protocol';
import { RoomSocket, roomSocketUrl } from '@irori/room-client';

declare const process: { env: Record<string, string | undefined> };

export function env(name: 'IRORI_HOST_E2E_MAIN' | 'IRORI_HOST_E2E_CAPS' | 'IRORI_HOST_E2E_IDLE' | 'IRORI_HOST_E2E_PUBLIC' | 'IRORI_HOST_E2E_SHOTS' | 'IRORI_HOST_E2E_DEV'): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} がありません（前処理 global-setup.mjs が動いていない）`);
  return v;
}

/** global-setup.mjs の PUBLIC_URL と同じ値（public の Worker の部屋の案内に出るアドレス）。 */
export const PUBLIC_URL = 'https://irori.example';

export const freshIp = () => `10.${rand(256)}.${rand(256)}.${1 + rand(254)}`;
const rand = (n: number) => Math.floor(Math.random() * n);

export interface Watch {
  problems: string[];
  /** わざと回線を切る試験：WebSocket の失敗の知らせだけは許す。 */
  allowSocketErrors(): void;
}

/** ページを見張る。CSP違反は securitypolicyviolation で拾う（init script は CSP の外で動く）。 */
export async function watch(page: Page, origin: string, allowHosts: readonly string[] = []): Promise<Watch> {
  const w = { problems: [] as string[], socketOk: false, allowSocketErrors() {} } as Watch & { socketOk: boolean };
  w.allowSocketErrors = () => {
    w.socketOk = true;
  };
  // WebKit（Linux 版は特に）は、viewport の interactive-widget を知らず console.error に流す。無視するだけで、動作には影響しない。
  const allowed = (text: string) =>
    /^Viewport argument key "interactive-widget" not recognized and ignored\.?$/.test(text) || (w.socketOk && /WebSocket|ERR_INTERNET_DISCONNECTED|net::ERR_/i.test(text));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !allowed(m.text())) w.problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => w.problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    const o = new URL(u);
    const sameHost = o.host === new URL(origin).host || allowHosts.includes(o.host);
    if (!sameHost) w.problems.push(`request to another origin: ${u}`);
  });
  await page.addInitScript(() => {
    const list: string[] = [];
    (globalThis as { __csp?: string[] }).__csp = list;
    document.addEventListener('securitypolicyviolation', (e) => list.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return w;
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as { __csp?: string[] }).__csp ?? []);
}

export interface HostPage {
  page: Page;
  context: BrowserContext;
  base: string;
  watch: Watch;
  /** ホストの WebSocket が部屋から受け取ったフレーム（JSON の文字列）。スマホの入力が届いたかを確かめるのに使う。 */
  received: string[];
  code(): Promise<string>;
  state(): Promise<string | null>;
  expectState(s: string): Promise<void>;
  /** 見張りの結果。試験の終わりに呼ぶ（0件であること）。 */
  assertClean(): Promise<void>;
}

export async function openHost(
  browser: Browser,
  base: string,
  o: { viewport?: { width: number; height: number }; ip?: string; context?: BrowserContext; path?: string; allowHosts?: string[] } = {},
): Promise<HostPage> {
  const context = o.context ?? (await browser.newContext({ viewport: o.viewport ?? { width: 1280, height: 720 }, locale: 'ja-JP', permissions: ['clipboard-read', 'clipboard-write'] }));
  const page = await context.newPage();
  const w = await watch(page, base, o.allowHosts ?? []);
  const received: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') received.push(payload);
    });
  });
  const ip = o.ip ?? freshIp();
  // 部屋の作成の回数は、接続元ごとに数える。試験ごとに別の接続元にする（作成の要求にだけ見出しを足す）。
  // fallback にして、試験が文脈の側で足した経路（回線を止める等）にも渡す。
  await page.route('**/api/rooms', (route) => route.fallback({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }));
  await page.goto(`${base}${o.path ?? '/'}`);
  const root = page.locator('#app');
  const host: HostPage = {
    page,
    context,
    base,
    watch: w,
    received,
    async code() {
      await expect(root).toHaveAttribute('data-code', /^[A-Z0-9]{4}$/);
      return (await root.getAttribute('data-code')) ?? '';
    },
    state: () => root.getAttribute('data-state'),
    expectState: (s) => expect(root).toHaveAttribute('data-state', s),
    async assertClean() {
      expect(await cspViolations(page), 'CSP violations').toEqual([]);
      expect(w.problems, 'console / page errors / foreign requests').toEqual([]);
    },
  };
  return host;
}

/** 実際のスマホのページ（/pad#CODE）。参加の画面で「参加する」を1回押す。 */
export class PagePad {
  private constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    readonly watch: Watch,
  ) {}

  static async join(browser: Browser, base: string, code: string, name?: string): Promise<PagePad> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
    const page = await context.newPage();
    const w = await watch(page, base);
    await page.goto(`${base}/pad#${code}`);
    const join = page.locator('[data-act="join"]');
    await expect(join).toBeVisible();
    if (name) await page.locator('#pp-name').fill(name);
    await join.click();
    await expect(page.locator('[data-screen="play"]')).toBeVisible();
    return new PagePad(page, context, w);
  }

  kind(): Promise<string | null> {
    return this.page.locator('.irori-pad').getAttribute('data-kind');
  }

  async expectKind(kind: string): Promise<void> {
    await expect(this.page.locator('.irori-pad')).toHaveAttribute('data-kind', kind);
  }

  async press(id: string): Promise<void> {
    await this.page.locator(`.irori-pad__btn[data-id="${id}"]`).click();
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

/** room-client を使うスマホ役。届いた画面の指定（PadSpec）を、そのまま調べられる。 */
export class ScriptPad {
  readonly frames: ToPadFrame[] = [];
  spec: PadSpec | null = null;
  you: PlayerInfo | null = null;
  private resume: string | undefined;
  private readonly socket: RoomSocket<'pad'>;

  constructor(base: string, code: string, name?: string) {
    this.socket = new RoomSocket({ role: 'pad', url: roomSocketUrl(base, code), name: () => name, resume: () => this.resume });
    this.socket.on('frame', (f) => {
      try {
        this.frames.push(f);
        if (f.t === 'welcome') {
          this.you = f.you;
          this.resume = f.resume;
        } else if (f.t === 'pad') this.spec = f.spec;
      } catch {
        // 記録だけなので、ここで止めない
      }
    });
  }

  get state(): string {
    return this.socket.state;
  }

  async join(): Promise<PlayerInfo> {
    this.socket.connect();
    await expect.poll(() => this.you?.id ?? null, { timeout: 10_000 }).not.toBeNull();
    return this.you as PlayerInfo;
  }

  press(id: string): void {
    this.socket.send({ t: 'in', i: { k: 'btn', id, d: 1 } });
    this.socket.send({ t: 'in', i: { k: 'btn', id, d: 0 } });
  }

  menu(): void {
    this.socket.send({ t: 'in', i: { k: 'menu' } });
  }

  bye(): void {
    this.socket.send({ t: 'bye' });
  }

  close(): void {
    this.socket.close();
  }

  async expectSpec(match: (s: PadSpec | null) => boolean, what: string): Promise<void> {
    await expect.poll(() => (match(this.spec) ? 'ok' : JSON.stringify(this.spec)), { message: what, timeout: 10_000 }).toBe('ok');
  }
}

/** アニメーションの終わり（終わりのあるものだけ）を待つ。色の遷移の途中を撮らないため。 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      return t !== undefined && t.endTime !== Number.POSITIVE_INFINITY;
    });
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
