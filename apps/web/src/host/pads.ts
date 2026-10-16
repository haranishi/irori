// スマホへの画面（pad）と振動（fx）の送り手。席ごとに最後に送った画面を覚え、同じものは送らない。
// 中継の pad? には、覚えている画面を送り直す。送る速さは中継の上限（毎秒40・瞬間80）より低く抑え、
// 追いつかないときは席ごとに最新の1つだけを残してまとめる（画面は最後の指定だけが意味を持つため）。
import { LIMITS, type PadSpec, type PlayerId } from '@irori/protocol';
import type { HostOut } from './session';

export interface SenderClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface PadSenderOptions {
  send(frame: HostOut): boolean;
  clock?: SenderClock;
  perSec?: number;
  burst?: number;
}

const systemClock: SenderClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class PadSender {
  private readonly sent = new Map<PlayerId, string>();
  private readonly specs = new Map<PlayerId, PadSpec>();
  private readonly queue = new Map<PlayerId, PadSpec>();
  private readonly clock: SenderClock;
  private readonly perSec: number;
  private readonly burst: number;
  private tokens: number;
  private refillAt: number;
  private timer: unknown = null;

  constructor(private readonly o: PadSenderOptions) {
    this.clock = o.clock ?? systemClock;
    // 中継の上限より低く。残りは lock・kick・fx に使う。
    this.perSec = o.perSec ?? Math.floor(LIMITS.RATE.host.perSec * 0.75);
    this.burst = o.burst ?? Math.floor(LIMITS.RATE.host.burst / 2);
    this.tokens = this.burst;
    this.refillAt = this.clock.now();
  }

  /** いまの計画に合わせる。つながっている席だけに、変わったものを送る。 */
  sync(plan: ReadonlyMap<PlayerId, PadSpec>, online: ReadonlySet<PlayerId>): void {
    for (const [p, spec] of plan) {
      if (!online.has(p)) {
        this.queue.delete(p);
        continue;
      }
      const json = JSON.stringify(spec);
      if (this.sent.get(p) === json) this.queue.delete(p);
      else this.queue.set(p, spec);
    }
    this.schedule();
  }

  /** pad?：その席の画面を、変わっていなくても送り直す。 */
  resend(p: PlayerId, spec: PadSpec): void {
    this.sent.delete(p);
    this.queue.set(p, spec);
    this.schedule();
  }

  forget(p: PlayerId): void {
    this.sent.delete(p);
    this.specs.delete(p);
    this.queue.delete(p);
  }

  /** つなぎ直したあと。中継が持っていた行き先は、もう当てにしない。 */
  reset(): void {
    this.sent.clear();
    this.queue.clear();
  }

  /** 最後に送った画面（試験と表示用）。 */
  last(p: PlayerId): PadSpec | undefined {
    return this.specs.get(p);
  }

  /** 振動。遅れて届いても意味がないので、枠が足りなければ捨てる。 */
  vibrate(to: readonly PlayerId[], ms: number[]): void {
    this.refill();
    for (const p of to) {
      if (this.tokens < 1) return;
      if (this.o.send({ t: 'fx', to: p, ms })) this.tokens -= 1;
    }
  }

  dispose(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.refillAt) * this.perSec) / 1000);
    this.refillAt = now;
  }

  private schedule(delay = 0): void {
    if (this.timer !== null || this.queue.size === 0) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  private flush(): void {
    this.refill();
    for (const [p, spec] of [...this.queue]) {
      if (this.tokens < 1) break;
      this.queue.delete(p);
      // つながっていない（welcome の前）なら送れない。覚えずにおき、つながったあとの同期と pad? に任せる。
      if (!this.o.send({ t: 'pad', to: p, spec })) continue;
      this.tokens -= 1;
      this.sent.set(p, JSON.stringify(spec));
      this.specs.set(p, spec);
    }
    if (this.queue.size > 0) this.schedule(Math.ceil(((1 - this.tokens) * 1000) / this.perSec));
  }
}
