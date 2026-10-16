import type { InputEvent, PadSpec } from '@irori/protocol';
import { mountPad } from '../src/index';

export function setup(spec?: PadSpec) {
  const sent: InputEvent[] = [];
  /** 送った瞬間の時刻（sent と同じ順）。 */
  const at: number[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  const pad = mountPad(container, {
    send: (i) => {
      sent.push(i);
      at.push(performance.now());
    },
  });
  if (spec) pad.setSpec(spec);
  const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T;
  const qa = (sel: string) => [...container.querySelectorAll(sel)] as HTMLElement[];
  return { sent, at, container, pad, q, qa };
}

/** happy-dom は配置を計算しないので、要素の箱を決めて渡す。 */
export function box(el: Element, w = 200, h = 200, left = 0, top = 0): void {
  el.getBoundingClientRect = () =>
    ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}

export function pointer(el: Element, type: string, init: PointerEventInit = {}): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }));
}

/** 固定の種から作る乱数（試験を毎回同じにするため）。 */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
