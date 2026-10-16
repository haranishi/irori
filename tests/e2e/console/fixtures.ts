// tests/e2e/console の土台。rig が、ホストの画面と N 台のスマホ（それぞれ別の BrowserContext）を作り、
// 試験の終わりに、全部の文脈の通信の規律（lib/watch.ts）を確かめてから閉じる。規律の問題が1件でもあれば、その試験は落ちる。
// 端末の設定：phone-* の組ではスマホにその組の設定を、ホストに 1280×720 を使う。desktop-* の組ではホストにその組の設定を、
// スマホに同じエンジンの電話の画面（Chromium は 390×844・タッチ、WebKit は iPhone 13）を使う。
import { devices, expect, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type TestInfo } from '@playwright/test';
import { pickPorts } from '../../../tools/lib/edge-server.mjs';
import { Line } from '../../../apps/web/tests/pad/e2e/line.mjs';
import { env } from './lib/env.mjs';
import { fingerOn } from './lib/finger';
import { Host } from './lib/host';
import { Pad } from './lib/pad';
import { Watch } from './lib/watch';

export { expect };
export type { Host, Pad };
export type { ResultRow } from './lib/host';

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 720 }, locale: 'ja-JP' };
const CHROMIUM_PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ja-JP',
};
// iPhone 13 の設定から、エンジンの指定（defaultBrowserType）だけを外して、文脈の設定にする。
const { defaultBrowserType, ...WEBKIT_PHONE_BASE } = devices['iPhone 13'];
void defaultBrowserType;
const WEBKIT_PHONE: BrowserContextOptions = { ...WEBKIT_PHONE_BASE, locale: 'ja-JP' };

const byte = (lo = 0) => lo + Math.floor(Math.random() * (256 - lo));

/**
 * 部屋の作成の要求に、試験ごとに別の接続元（CF-Connecting-IP）を名乗らせる。部屋の作成は、同じ接続元から
 * 1時間に60回までという上書きできない栓があり、通しの試験は1回の実行でそれを超えるため（B1・B2 と同じやり方）。
 */
export async function freshIpForRooms(ctx: BrowserContext): Promise<void> {
  const ip = `10.${byte()}.${byte()}.${byte(1)}`;
  await ctx.route('**/api/rooms', (route) => route.fallback({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }));
}

function profiles(info: TestInfo): { engine: string; host: BrowserContextOptions; pad: BrowserContextOptions } {
  const use = info.project.use;
  const engine = use.browserName ?? use.defaultBrowserType ?? 'chromium';
  const pick = (keys: (keyof BrowserContextOptions)[]): BrowserContextOptions => {
    const o: Record<string, unknown> = {};
    for (const k of keys) if (use[k as keyof typeof use] !== undefined) o[k] = use[k as keyof typeof use];
    return o as BrowserContextOptions;
  };
  if (info.project.name.startsWith('phone')) {
    return { engine, host: DESKTOP, pad: { ...pick(['viewport', 'screen', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'userAgent']), locale: 'ja-JP' } };
  }
  return { engine, host: { ...DESKTOP, ...pick(['viewport']) }, pad: engine === 'webkit' ? WEBKIT_PHONE : CHROMIUM_PHONE };
}

export interface HostOptions {
  /** どの Worker を使うか（既定は main）。 */
  base?: string;
  /** ホストの時計を差し替える（Host.advance で進める）。ゲームの枠の中も同じ時計になる。 */
  clock?: boolean;
  path?: string;
  /** ほかに通信を許すホスト（外部のゲーム）。 */
  allowHosts?: string[];
  /** 文脈を作った直後、ページを開く前に呼ぶ（初期化のスクリプトなど）。 */
  init?: (ctx: BrowserContext) => Promise<void>;
}

export interface PadOptions {
  name?: string;
  /** 回線の模型（B2 の line.mjs）を通して開く。cut・freeze・restore が使える。 */
  line?: boolean;
  init?: (ctx: BrowserContext) => Promise<void>;
}

export class Rig {
  readonly engine: string;
  readonly watches: Watch[] = [];
  readonly pads: Pad[] = [];
  private readonly contexts: BrowserContext[] = [];
  private readonly lines: Line[] = [];
  private readonly prof: ReturnType<typeof profiles>;
  private socketErrorsOk = false;

  constructor(
    private readonly browser: Browser,
    readonly info: TestInfo,
  ) {
    this.prof = profiles(info);
    this.engine = this.prof.engine;
  }

  get main(): string {
    return env('main');
  }

  private async watched(label: string, origin: string, opts: BrowserContextOptions, allowHosts: string[] = []): Promise<{ ctx: BrowserContext; watch: Watch }> {
    const ctx = await this.browser.newContext(opts);
    this.contexts.push(ctx);
    const watch = new Watch({ label, origin, allowHosts });
    watch.socketErrorsOk = this.socketErrorsOk;
    await watch.attach(ctx);
    this.watches.push(watch);
    return { ctx, watch };
  }

  async openHost(o: HostOptions = {}): Promise<Host> {
    const baseUrl = o.base ?? this.main;
    const { ctx } = await this.watched('ホスト', baseUrl, { ...this.prof.host, permissions: this.engine === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] }, o.allowHosts);
    await freshIpForRooms(ctx);
    if (o.init) await o.init(ctx);
    if (o.clock) await ctx.clock.install();
    const page = await ctx.newPage();
    const host = new Host(page, ctx, baseUrl, o.clock === true);
    await page.goto(`${baseUrl}${o.path ?? '/'}`);
    await host.expectState('home', 20_000);
    return host;
  }

  /** スマホを1台、ページを開かずに用意する（join は Pad.join）。 */
  async openPad(baseUrl: string, o: PadOptions = {}): Promise<Pad> {
    let origin = baseUrl;
    let line: Line | null = null;
    if (o.line) {
      const [port] = await pickPorts(1, { from: 5260, to: 5289 });
      line = await Line.start(Number(new URL(baseUrl).port), port!);
      this.lines.push(line);
      origin = line.url;
    }
    const label = `スマホ${this.pads.length + 1}`;
    const { ctx } = await this.watched(label, origin, this.prof.pad);
    if (o.init) await o.init(ctx);
    const page = await ctx.newPage();
    const pad = new Pad({ page, context: ctx, origin, finger: await fingerOn(page, this.engine), line, engine: this.engine, label });
    this.pads.push(pad);
    return pad;
  }

  /** 名前の数だけスマホを参加させる（順に。空いた席の小さい順に入る）。 */
  async join(host: Host, names: (string | undefined)[], o: Omit<PadOptions, 'name'> = {}): Promise<Pad[]> {
    const code = await host.code();
    const out: Pad[] = [];
    for (const name of names) {
      const pad = await this.openPad(host.base, o);
      await pad.join(code, name);
      out.push(pad);
    }
    return out;
  }

  /** わざと回線を切る試験：ブラウザ自身が出す接続の失敗の知らせを、全部の文脈で許す（あとから作る文脈も）。 */
  allowSocketErrors(): void {
    this.socketErrorsOk = true;
    for (const w of this.watches) w.socketErrorsOk = true;
  }

  /** 終わり：通信の規律を確かめてから、文脈と回線を閉じる。 */
  async close(): Promise<void> {
    const problems: string[] = [];
    const total = { requests: 0, responses: 0, sockets: 0 };
    for (const w of this.watches) {
      problems.push(...(await w.report()));
      // 見張りが本当に記録していること（0件の見張りは、見張っていないのと同じ）。
      if (w.counts.requests === 0) problems.push(`見張りが1件も記録していない（ページを開いていない文脈がある）`);
      total.requests += w.counts.requests;
      total.responses += w.counts.responses;
      total.sockets += w.counts.sockets;
    }
    this.info.annotations.push({ type: '通信の記録', description: `文脈 ${this.watches.length}・リクエスト ${total.requests}・応答 ${total.responses}・WebSocket ${total.sockets}` });
    for (const p of this.pads) await p.finger.detach();
    await Promise.all(this.contexts.map((c) => c.close().catch(() => undefined)));
    await Promise.all(this.lines.map((l) => l.close().catch(() => undefined)));
    expect(problems, '通信の規律（ほかのオリジン・Set-Cookie・コンソールのエラーと警告・CSP違反・ページの例外）').toEqual([]);
  }
}

export const test = base.extend<{ rig: Rig }>({
  rig: async ({ browser }, use, info) => {
    const rig = new Rig(browser, info);
    await use(rig);
    await rig.close();
  },
});
