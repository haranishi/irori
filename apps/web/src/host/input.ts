// 操作の入口をそろえる：キーボード（矢印・Enter・Esc・M）、ゲームパッド（十字・左スティック・A・B）、
// リーダーのスマホ（remote の btn：up down left right ok back）。どれも同じ Action になる（docs/ux.md の3）。
import type { InputEvent } from '@irori/protocol';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Action = Dir | 'ok' | 'back' | 'mute';

export function keyAction(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): Action | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    // スペースは、フォーカスしたボタンが自分で押される（ブラウザの既定）。二重に押さないよう、ここでは拾わない。
    case 'Enter':
      return 'ok';
    case 'Escape':
    case 'Backspace':
      return 'back';
    case 'm':
    case 'M':
      return 'mute';
    default:
      return null;
  }
}

const REMOTE: Record<string, Action> = { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'ok', back: 'back' };

/** リモコンの押した瞬間（d:1）だけを操作にする。離し（d:0）は使わない。 */
export function remoteAction(i: InputEvent): Action | null {
  if (i.k !== 'btn' || i.d !== 1) return null;
  return REMOTE[i.id] ?? null;
}

export interface PadState {
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

const STICK = 0.55;
const REPEAT_DELAY_MS = 420;
const REPEAT_MS = 140;

/** いまのゲームパッドが押している向きとボタン（標準の配置：12〜15が十字、0がA、1がB、9がスタート）。 */
export function padHeld(g: PadState): Set<Action> {
  const held = new Set<Action>();
  const b = (i: number) => g.buttons[i]?.pressed === true;
  const x = g.axes[0] ?? 0;
  const y = g.axes[1] ?? 0;
  if (b(12) || y < -STICK) held.add('up');
  if (b(13) || y > STICK) held.add('down');
  if (b(14) || x < -STICK) held.add('left');
  if (b(15) || x > STICK) held.add('right');
  if (b(0)) held.add('ok');
  if (b(1) || b(9)) held.add('back');
  return held;
}

/** 押した瞬間に1回、向きは押し続けると繰り返す。ボタンは繰り返さない。 */
export class PadRepeater {
  private readonly since = new Map<Action, number>();
  private readonly lastFire = new Map<Action, number>();

  step(held: ReadonlySet<Action>, now: number): Action[] {
    const out: Action[] = [];
    for (const a of [...this.since.keys()]) {
      if (!held.has(a)) {
        this.since.delete(a);
        this.lastFire.delete(a);
      }
    }
    for (const a of held) {
      const start = this.since.get(a);
      if (start === undefined) {
        this.since.set(a, now);
        this.lastFire.set(a, now);
        out.push(a);
        continue;
      }
      const isDir = a === 'up' || a === 'down' || a === 'left' || a === 'right';
      const last = this.lastFire.get(a) ?? now;
      if (isDir && now - start >= REPEAT_DELAY_MS && now - last >= REPEAT_MS) {
        this.lastFire.set(a, now);
        out.push(a);
      }
    }
    return out;
  }
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 空間の上で、いまの場所から dir の向きにある、いちばん近い候補を選ぶ。
 * 向きの軸の距離に、横ずれ（縦ずれ）を重く足す。同じ行・同じ列の中を先に動くようにするため。
 */
export function pickNext(from: Box, items: readonly { id: string; box: Box }[], dir: Dir): string | null {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const it of items) {
    const b = it.box;
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    let main: number;
    let cross: number;
    switch (dir) {
      case 'right':
        main = b.left - (from.left + from.width) >= -from.width / 2 ? cx - fx : -1;
        cross = Math.abs(cy - fy);
        break;
      case 'left':
        main = from.left - (b.left + b.width) >= -from.width / 2 ? fx - cx : -1;
        cross = Math.abs(cy - fy);
        break;
      case 'down':
        main = b.top - (from.top + from.height) >= -from.height / 2 ? cy - fy : -1;
        cross = Math.abs(cx - fx);
        break;
      case 'up':
        main = from.top - (b.top + b.height) >= -from.height / 2 ? fy - cy : -1;
        cross = Math.abs(cx - fx);
        break;
    }
    if (main <= 0.5) continue;
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = it.id;
    }
  }
  return best;
}
