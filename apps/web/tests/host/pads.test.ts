import type { PadSpec } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { PadSender, type SenderClock } from '../../src/host/pads';

/** 時刻を手で進める時計。setTimeout は、進めた時刻を過ぎたものから呼ぶ。 */
class Clock implements SenderClock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = end;
  }
}

const remote: PadSpec = { k: 'remote' };
const wait = (title: string): PadSpec => ({ k: 'wait', title });

function setup(opts: { open?: () => boolean; perSec?: number; burst?: number } = {}) {
  const clock = new Clock();
  const sent: unknown[] = [];
  const s = new PadSender({
    send: (f) => {
      if (opts.open && !opts.open()) return false;
      sent.push(f);
      return true;
    },
    clock,
    perSec: opts.perSec ?? 30,
    burst: opts.burst ?? 40,
  });
  return { s, clock, sent };
}

describe('スマホへの画面の送り手', () => {
  it('つながっている席にだけ、変わったものを送る。同じものは送り直さない', () => {
    const { s, clock, sent } = setup();
    const plan = new Map([
      [1, remote],
      [2, wait('a')],
      [3, wait('a')],
    ]);
    s.sync(plan, new Set([1, 2]));
    clock.advance(1);
    expect(sent).toEqual([
      { t: 'pad', to: 1, spec: remote },
      { t: 'pad', to: 2, spec: wait('a') },
    ]);
    s.sync(plan, new Set([1, 2]));
    clock.advance(1);
    expect(sent).toHaveLength(2);
    expect(s.last(1)).toEqual(remote);
  });

  it('pad? には、変わっていなくても送り直す', () => {
    const { s, clock, sent } = setup();
    s.sync(new Map([[1, remote]]), new Set([1]));
    clock.advance(1);
    s.resend(1, remote);
    clock.advance(1);
    expect(sent).toHaveLength(2);
  });

  it('同じ瞬間の指定はまとめ、最後のものだけを送る', () => {
    const { s, clock, sent } = setup();
    for (const title of ['1', '2', '3']) s.sync(new Map([[1, wait(title)]]), new Set([1]));
    clock.advance(1);
    expect(sent).toEqual([{ t: 'pad', to: 1, spec: wait('3') }]);
  });

  it('速さの上限を超える分は待たせて、席ごとに最新の1つだけを後で送る', () => {
    const { s, clock, sent } = setup({ perSec: 10, burst: 2 });
    const all = new Set([1, 2, 3, 4]);
    s.sync(new Map([1, 2, 3, 4].map((p) => [p, wait('x')])), all);
    clock.advance(1);
    expect(sent).toHaveLength(2);
    // 待っているあいだに3番の指定が変わった。古い指定は送らない。
    s.sync(new Map([[3, wait('y')]]), all);
    clock.advance(1000);
    expect(sent).toHaveLength(4);
    expect(sent.slice(2)).toEqual([
      { t: 'pad', to: 3, spec: wait('y') },
      { t: 'pad', to: 4, spec: wait('x') },
    ]);
  });

  it('送れなかったもの（つながる前）は覚えず、次の同期で送る', () => {
    let open = false;
    const { s, clock, sent } = setup({ open: () => open });
    s.sync(new Map([[1, remote]]), new Set([1]));
    clock.advance(1);
    expect(sent).toHaveLength(0);
    open = true;
    s.sync(new Map([[1, remote]]), new Set([1]));
    clock.advance(1);
    expect(sent).toHaveLength(1);
  });

  it('つなぎ直したあと（reset）は、全部を送り直す', () => {
    const { s, clock, sent } = setup();
    const plan = new Map([[1, remote]]);
    s.sync(plan, new Set([1]));
    clock.advance(1);
    s.reset();
    s.sync(plan, new Set([1]));
    clock.advance(1);
    expect(sent).toHaveLength(2);
  });

  it('振動は、枠が足りないときは捨てる（遅れて届いても意味がない）', () => {
    const { s, sent } = setup({ perSec: 1, burst: 2 });
    s.vibrate([1, 2, 3], [100]);
    expect(sent).toEqual([
      { t: 'fx', to: 1, ms: [100] },
      { t: 'fx', to: 2, ms: [100] },
    ]);
  });
});
