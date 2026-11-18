import { afterEach, expect, it, vi } from 'vitest';
import { HELD_REPEAT_MS } from '@irori/protocol';
import { setup } from './helpers';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it.each(['stick', 'dpad'] as const)('%s はキーボードだけで方向入力・保持・停止ができる', (stick) => {
  vi.useFakeTimers();
  const { q, sent, pad } = setup({ k: 'pad', stick });
  const surface = q<HTMLElement>(`.irori-pad__${stick}`);
  console.info('keyboard surface:', { stick, tabIndex: surface.tabIndex });
  expect(surface.tabIndex).toBe(0);
  surface.focus();
  surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(sent.at(-1)).toMatchObject({ k: 'axis', id: stick, x: 1, y: 0 });
  vi.advanceTimersByTime(HELD_REPEAT_MS + 1);
  expect(sent.filter(i => i.k === 'axis' && i.x === 1).length).toBeGreaterThan(1);
  surface.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  vi.advanceTimersByTime(100);
  expect(sent.at(-1)).toMatchObject({ k: 'axis', id: stick, x: 0, y: 0 });
  surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  vi.advanceTimersByTime(100);
  surface.dispatchEvent(new FocusEvent('blur'));
  vi.advanceTimersByTime(100);
  expect(sent.at(-1)).toMatchObject({ k: 'axis', id: stick, x: 0, y: 0 });
  pad.destroy();
});

it.each(['stick', 'dpad'] as const)('%s は、押したままウィンドウを離れても、画面が隠れても、中立に戻る', (stick) => {
  vi.useFakeTimers();
  const { q, sent, pad } = setup({ k: 'pad', stick });
  const surface = q<HTMLElement>(`.irori-pad__${stick}`);
  const neutral = () => sent.at(-1) as { x: number; y: number };
  const pressLeft = () => {
    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(100);
    expect(neutral()).toMatchObject({ x: -1, y: 0 });
  };

  // ウィンドウだけがフォーカスを失う（要素の blur は届かない）
  pressLeft();
  window.dispatchEvent(new FocusEvent('blur'));
  vi.advanceTimersByTime(100);
  expect(neutral()).toMatchObject({ x: 0, y: 0 });
  const afterBlur = sent.length;
  vi.advanceTimersByTime(HELD_REPEAT_MS * 3);
  expect(sent.length).toBe(afterBlur);

  // 画面が隠れる
  pressLeft();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(100);
  expect(neutral()).toMatchObject({ x: 0, y: 0 });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });

  // 破棄したあとは、ウィンドウの動きに反応しない
  pressLeft();
  pad.destroy();
  const before = sent.length;
  window.dispatchEvent(new FocusEvent('blur'));
  vi.advanceTimersByTime(100);
  expect(sent.length).toBe(before);
});
