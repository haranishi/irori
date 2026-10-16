// 通信の規律の見張り。BrowserContext ごとに1つ付け、試験の終わりに問題の一覧を返す。
//   ・その画面のオリジン（と、明示して許したホスト）以外への通信：経路で止めて（外へは出さない）、問題として記録する
//   ・WebSocket は、画面と同じホストの ws: / wss: だけ
//   ・Set-Cookie を返した応答（allHeaders で見る。headers() には Cookie の見出しが出ないため）
//   ・コンソールのエラーと警告（枠の中のゲームの分も含む）、ページの例外、CSP 違反、ダイアログ、勝手に開いたページ
// CSP 違反は、初期化のスクリプトが securitypolicyviolation を console.error に流すことで拾う（枠の中でも動く）。
import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test';

export interface WatchOptions {
  label: string;
  /** この文脈の画面のオリジン（例 http://127.0.0.1:8899）。 */
  origin: string;
  /** ほかに通信を許すホスト（host:port）。外部のゲームの配信だけ。 */
  allowHosts?: readonly string[];
}

export class Watch {
  readonly problems: string[] = [];
  readonly counts = { requests: 0, responses: 0, sockets: 0 };
  /** わざと回線を切る試験：ブラウザ自身が出す WebSocket や読み込みの失敗の知らせだけを許す。 */
  socketErrorsOk = false;
  /** 悪意のあるゲームの試験：枠の中のゲームの知らせ（sandbox に止められた記録）を許す判定。 */
  frameConsoleOk: ((m: ConsoleMessage) => boolean) | null = null;
  /** 同じく、WebKit が枠の中の止められた試みを「ページの例外」として知らせるものを許す判定。 */
  pageErrorOk: ((e: Error) => boolean) | null = null;
  /** axe の試験：@axe-core/playwright が結果をまとめるために開く about:blank のページを許す。 */
  blankPagesOk = false;
  readonly sockets: string[] = [];
  private readonly pending: Promise<unknown>[] = [];
  private readonly own: string;
  private readonly ok: Set<string>;
  private pages = 0;

  constructor(private readonly o: WatchOptions) {
    this.own = new URL(o.origin).host;
    this.ok = new Set([this.own, ...(o.allowHosts ?? [])]);
  }

  private allowed(u: URL): boolean {
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
    return (u.protocol === 'http:' || u.protocol === 'https:') && this.ok.has(u.host);
  }

  async attach(ctx: BrowserContext): Promise<void> {
    await ctx.route(
      (u) => !this.allowed(u),
      (route) => {
        this.problems.push(`${this.o.label}: ほかのオリジンへの通信（止めた）: ${route.request().url()}`);
        return route.abort('blockedbyclient');
      },
    );
    ctx.on('request', () => {
      this.counts.requests++;
    });
    ctx.on('response', (r) => {
      this.counts.responses++;
      this.pending.push(
        r.allHeaders().then(
          (h) => {
            if (h['set-cookie'] !== undefined) this.problems.push(`${this.o.label}: Set-Cookie が返った: ${r.url()} → ${h['set-cookie']}`);
          },
          () => undefined,
        ),
      );
    });
    await ctx.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.error(`[c1] CSP違反: ${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    ctx.on('page', (p) => this.page(p));
  }

  private page(p: Page): void {
    this.pages++;
    if (this.pages > 1 && !(this.blankPagesOk && p.url() === 'about:blank')) this.problems.push(`${this.o.label}: 新しいページが開いた: ${p.url()}`);
    p.on('console', (m) => {
      const type = m.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = m.text();
      // WebKit（Linux 版は特に）は、viewport の interactive-widget（Chrome の Android がキーボードで画面の大きさを変える指定）を
      // 知らず、知らない鍵として console.error に流す。WebKit が無視するだけで、動作には影響しない。この1種類だけを許す。
      if (/^Viewport argument key "interactive-widget" not recognized and ignored\.?$/.test(text)) return;
      if (this.socketErrorsOk && /WebSocket|net::ERR_|Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION/i.test(text)) return;
      if (this.frameConsoleOk?.(m)) return;
      this.problems.push(`${this.o.label}: console.${type} [${m.location().url}]: ${text}`);
    });
    p.on('pageerror', (e) => {
      if (this.pageErrorOk?.(e)) return;
      this.problems.push(`${this.o.label}: pageerror: ${e.message}`);
    });
    p.on('dialog', (d) => {
      this.problems.push(`${this.o.label}: ダイアログが出た（${d.type()}）: ${d.message()}`);
      void d.dismiss().catch(() => undefined);
    });
    p.on('websocket', (ws) => {
      this.counts.sockets++;
      this.sockets.push(ws.url());
      const u = new URL(ws.url());
      if ((u.protocol !== 'ws:' && u.protocol !== 'wss:') || u.host !== this.own) this.problems.push(`${this.o.label}: ほかのホストへの WebSocket: ${ws.url()}`);
    });
  }

  /** 試験の終わり：未処理の応答の見出しを確かめ終えてから、問題の一覧を返す。 */
  async report(): Promise<string[]> {
    await Promise.allSettled(this.pending);
    return [...this.problems];
  }
}
