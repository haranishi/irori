// 本物のホストの画面（/）の操作と読み取り。待つのは #app の data- 属性（data-state・data-code・data-phase）と、
// ゲームの枠の中の document.documentElement.dataset.phase。文言には頼らない（画面の文言は別の担当が直している）。
// 時計：clock を差し替えた文脈では、advance(ms) でホストの時計（ゲームの枠の中も同じ時計）を進める。
// ホストの WebSocket が受け取ったフレーム（スマホの入力・席の出入り）も記録する（received）。
import { expect, type BrowserContext, type Frame, type Locator, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import type { Pad } from './pad';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ResultRow {
  seat: number;
  rank: number;
  name: string;
  label: string;
  score: number;
  gone: boolean;
}

export interface SeatChip {
  seat: number;
  name: string;
  online: boolean;
  leader: boolean;
}

/** ホストが受け取ったフレーム。at は Node の時刻（ms）。 */
export interface Received {
  at: number;
  f: { t: string; p?: number; i?: { k: string; id?: string; d?: number; x?: number; y?: number }; [k: string]: unknown };
}

const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

export class Host {
  readonly root: Locator;
  readonly received: Received[] = [];
  /** ホストの WebSocket の ping を送った・pong を受けた時刻（実時間）。時計を進めるときの待ち合わせに使う。 */
  private readonly beat = { ping: 0, pong: 0 };

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    readonly base: string,
    readonly clocked: boolean,
  ) {
    this.root = page.locator('#app');
    page.on('websocket', (ws) => {
      ws.on('framesent', ({ payload }) => {
        if (payload === PING) this.beat.ping = Date.now();
      });
      ws.on('framereceived', ({ payload }) => {
        if (payload === PONG) this.beat.pong = Date.now();
        if (typeof payload !== 'string' || !payload.startsWith('{')) return;
        try {
          this.received.push({ at: Date.now(), f: JSON.parse(payload) as Received['f'] });
        } catch {
          // 読めないものは記録しない
        }
      });
    });
  }

  async code(): Promise<string> {
    await expect(this.root).toHaveAttribute('data-code', /^[A-Z0-9]{4}$/);
    return (await this.root.getAttribute('data-code')) ?? '';
  }

  state(): Promise<string | null> {
    return this.root.getAttribute('data-state');
  }

  async expectState(s: string, timeout?: number): Promise<void> {
    await expect(this.root).toHaveAttribute('data-state', s, timeout === undefined ? {} : { timeout });
  }

  /** ホストのキー操作（矢印・Enter・Escape・m）。 */
  async key(k: string): Promise<void> {
    await this.page.keyboard.press(k);
  }

  async hero(): Promise<string | null> {
    return this.page.locator('.hero').getAttribute('data-game').catch(() => null);
  }

  /** 棚の並び（画面のカードの順）。 */
  async shelf(): Promise<string[]> {
    return this.page.locator('.card[data-game]').evaluateAll((els) => els.map((el) => el.getAttribute('data-game') ?? ''));
  }

  /**
   * 棚でゲームを選び、詳細 → はじめる まで進めて、遊ぶ画面（playing）になるのを待つ。
   * leader を渡せば、そのスマホのリモコン（右・左・決定）で操作する。渡さなければホストのキーボード。
   */
  async choose(id: string, leader?: Pad): Promise<void> {
    await this.expectState('home');
    const keys = { right: 'ArrowRight', left: 'ArrowLeft', down: 'ArrowDown', ok: 'Enter' } as const;
    const press = async (k: keyof typeof keys) => {
      if (leader) await leader.tap(k);
      else await this.key(keys[k]);
    };
    if (leader) await leader.expectKind('remote');
    const focused = () => this.root.locator('[data-focused]').first().getAttribute('data-nav').catch(() => null);
    // 選択の輪が棚のカードに無ければ（上の帯など）、下へ動かして棚に入る。
    for (let i = 0; i < 4 && !(await focused())?.startsWith('game:'); i++) {
      const was = await focused();
      await press('down');
      await expect.poll(focused).not.toBe(was);
    }
    const order = await this.shelf();
    const want = order.indexOf(id);
    if (want < 0) throw new Error(`棚に ${id} がない（${order.join(', ')}）`);
    for (let i = 0; i < order.length + 1; i++) {
      const now = await this.hero();
      if (now === id) break;
      const at = order.indexOf(now ?? '');
      await press(at < want ? 'right' : 'left');
      await expect.poll(() => this.hero()).not.toBe(now);
    }
    await expect(this.page.locator('.hero')).toHaveAttribute('data-game', id);
    await press('ok');
    await this.expectState('detail');
    await expect(this.root.locator('[data-focused]').first()).toHaveAttribute('data-nav', 'detail:start');
    await press('ok');
    await this.expectState('playing', 20_000);
  }

  async gameFrame(): Promise<Frame | null> {
    const el = await this.page.$('.stage iframe');
    return el ? el.contentFrame() : null;
  }

  /** ゲームの枠の中で関数を評価する。枠が無い・読み込み中なら null。 */
  async inGame<T>(fn: () => T): Promise<T | null> {
    try {
      const f = await this.gameFrame();
      return f ? ((await f.evaluate(fn)) as T) : null;
    } catch {
      return null;
    }
  }

  /** inGame の、引数を1つ渡す形。 */
  async inGameWith<A, T>(fn: (a: A) => T, arg: A): Promise<T | null> {
    try {
      const f = await this.gameFrame();
      return f ? ((await f.evaluate(fn as unknown as (a: unknown) => T, arg as unknown)) as T) : null;
    } catch {
      return null;
    }
  }

  phase(): Promise<string | null> {
    return this.inGame(() => document.documentElement.dataset.phase ?? null);
  }

  async expectPhase(p: string, timeout = 15_000): Promise<void> {
    await expect.poll(() => this.phase(), { timeout, message: `ゲームの data-phase が ${p} になる` }).toBe(p);
  }

  async results(): Promise<ResultRow[]> {
    await this.expectState('results');
    return this.page.locator('.results [data-rank][data-seat]').evaluateAll((els) =>
      els.map((el) => ({
        seat: Number(el.getAttribute('data-seat')),
        rank: Number(el.getAttribute('data-rank')),
        name: el.querySelector('.result__name')?.textContent ?? '',
        // ラベルはゲームが付けた記録。見出し（「記録」など）を添えた形なら、値の部分だけを読む。
        label: (el.querySelector('.result__value') ?? el.querySelector('.result__label'))?.textContent ?? '',
        score: Number((el.querySelector('.result__score')?.textContent ?? '').replace(/[^\d-]/g, '')),
        gone: el.querySelector('.result__gone') !== null,
      })),
    );
  }

  async seats(): Promise<SeatChip[]> {
    return this.page.locator('.seat[data-seat]').evaluateAll((els) =>
      els.map((el) => ({
        seat: Number(el.getAttribute('data-seat')),
        name: el.querySelector('.seat__name')?.textContent ?? '',
        online: el.getAttribute('data-online') === 'true',
        leader: el.hasAttribute('data-leader'),
      })),
    );
  }

  /** 画面のQRを、ページの中でキャンバスに描いて jsQR で読む（スマホのカメラの代わり）。 */
  async readQr(): Promise<string | null> {
    const px = await this.page.evaluate(async () => {
      const svg = document.querySelector('.join__qr svg');
      if (!svg) return null;
      const size = 600;
      const img = new Image(size, size);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, size, size);
      g.drawImage(img, 0, 0, size, size);
      return { w: size, h: size, data: Array.from(g.getImageData(0, 0, size, size).data) };
    });
    if (!px) return null;
    return jsQR(Uint8ClampedArray.from(px.data), px.w, px.h)?.data ?? null;
  }

  /**
   * ホストの時計を ms 進める（ゲームの枠の中も同じ時計）。4秒ずつ進め、合間に実時間を少し置く。
   * まとめて進めると、ping の返事（実時間で届く）より先に pong の期限（30秒）が来て、つながりを捨ててしまうため。
   */
  async advance(ms: number, o: { step?: number; pause?: number } = {}): Promise<void> {
    if (!this.clocked) throw new Error('時計を差し替えていない（rig.openHost の clock: true）');
    // 合間の実時間のあいだも時計は進む（止めていない）。締切の前後を狙う試験は、step を大きく pause を短くして、ずれを小さくする。
    const stepMs = Math.min(o.step ?? 4_000, 10_000);
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, stepMs);
      await this.page.clock.fastForward(step);
      left -= step;
      await this.pongArrived();
      await sleep(o.pause ?? 80);
    }
  }

  /**
   * 時計を進めて ping が出たら、その返事（実時間で届く）を受けるまで待つ（最大3秒）。
   * 返事を受ける前に時計だけを30秒進めると、ホストは「返事がない」としてつながりを捨ててしまう。
   */
  private async pongArrived(): Promise<void> {
    const until = Date.now() + 3_000;
    while (this.beat.ping > this.beat.pong && Date.now() < until) await sleep(10);
  }

  /** ホストが受け取った入力（t:'in'）。p を渡せばその席だけ。 */
  inputs(p?: number): Received[] {
    return this.received.filter((r) => r.f.t === 'in' && (p === undefined || r.f.p === p));
  }
}
