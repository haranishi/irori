// 長押し（600ms）でだけ反応するボタン。誤タップでメニューが開かないようにする（docs/ux.md の9）。
// 指を置いたら数え始め、離す・ずらす・取り消されると止める。短いタップは onShortTap（案内を出すため）。

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const LONG_PRESS_MS = 600;
/** これより大きく指が動いたら、長押しではなくスクロールや迷いとみなす。 */
const SLOP_PX = 14;

export interface LongPressOptions {
  onLongPress: () => void;
  onShortTap?: () => void;
  timers: Timers;
  ms?: number;
}

export function longPress(el: HTMLElement, opts: LongPressOptions): void {
  const ms = opts.ms ?? LONG_PRESS_MS;
  let timer: unknown = null;
  let start: { x: number; y: number; id: number } | null = null;

  const stop = (shortTap: boolean): void => {
    if (timer === null) return;
    opts.timers.clearTimeout(timer);
    timer = null;
    start = null;
    delete el.dataset.holding;
    if (shortTap) opts.onShortTap?.();
  };

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    stop(false);
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 合成のイベントなど、捕まえられない指もある
    }
    el.dataset.holding = '';
    timer = opts.timers.setTimeout(() => {
      timer = null;
      start = null;
      delete el.dataset.holding;
      opts.onLongPress();
    }, ms);
  });

  el.addEventListener('pointermove', (e) => {
    if (start === null || e.pointerId !== start.id) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) stop(false);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    el.addEventListener(type, (e) => {
      if (start !== null && e.pointerId === start.id) stop(type === 'pointerup');
    });
  }

  // 指を伴わない押下（キーボード・読み上げの決定）は長押しができないので、そのまま開く。
  // 指のタップの click は detail が1以上になる。そちらでは開かない。
  el.addEventListener('click', (e) => {
    if (e.detail === 0) opts.onLongPress();
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
