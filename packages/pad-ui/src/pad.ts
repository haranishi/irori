// コントローラー画面（docs/pad.md）。指定の7種を描き、指の動きを InputEvent にして send に渡す。
// 指は pointerId ごとに追い、捕まえて（setPointerCapture）、枠の外へ出ても離すまで同じ部品が受け取る。
import { HELD_REPEAT_MS, LIMITS, SEND_RATE_HZ } from '@irori/protocol';
import type { ButtonSpec, ChoiceSpec, ColorName, InputEvent, PadSpec } from '@irori/protocol';
import { h } from './dom';
import { clip } from './text';
import { Throttle } from './throttle';
import type { HeldRepeat } from './throttle';

export interface PadStrings {
  waiting: string;
  dpad: string;
  stick: string;
  touch: string;
  up: string;
  down: string;
  left: string;
  right: string;
  ok: string;
  back: string;
  tiltAsk: string;
  tiltAllow: string;
  tiltDenied: string;
  tiltInsecure: string;
  tiltOn: string;
  tilesLimit: string;
  tilesSent: string;
}

export const PAD_STRINGS_JA: PadStrings = {
  tilesLimit: 'これ以上選べません',
  tilesSent: '送りました',
  waiting: '待っています',
  dpad: '十字キー',
  stick: 'スティック',
  touch: 'なぞる場所',
  up: '上',
  down: '下',
  left: '左',
  right: '右',
  ok: '決定',
  back: '戻る',
  tiltAsk: 'スマホを傾けて操作します。センサーの使用を許可してください。',
  tiltAllow: '許可する',
  tiltDenied: 'センサーが許可されませんでした。端末の設定を確かめてください。',
  tiltInsecure: '傾きのセンサーは、HTTPS の接続でだけ使えます。',
  tiltOn: 'スマホを傾けて操作します',
};

export const PAD_STRINGS_EN: PadStrings = {
  tilesLimit: 'You cannot select any more',
  tilesSent: 'Sent',
  waiting: 'Waiting',
  dpad: 'D-pad',
  stick: 'Stick',
  touch: 'Touch area',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  ok: 'OK',
  back: 'Back',
  tiltAsk: 'Tilt your phone to play. Please allow the motion sensor.',
  tiltAllow: 'Allow',
  tiltDenied: 'The motion sensor was not allowed. Check your device settings.',
  tiltInsecure: 'The motion sensor works only over HTTPS.',
  tiltOn: 'Tilt your phone to play',
};

export interface PadOptions {
  send: (input: InputEvent) => void;
  strings?: Partial<PadStrings>;
}

export interface PadHandle {
  setSpec(spec: PadSpec): void;
  releaseAll(): void;
  destroy(): void;
}

type Out = (input: InputEvent) => void;
type XY = { x: number; y: number };

interface Control {
  /** 押したままの入力を終わらせる（btn は d:0、axis は 0,0、ptr は e）。 */
  release(): void;
  /** 以後のイベントを無視する。何も送らない。 */
  dispose(): void;
}

const AXIS_MS = 1000 / SEND_RATE_HZ.axis;
const PTR_MS = 1000 / SEND_RATE_HZ.ptr;
const TILT_MS = 1000 / SEND_RATE_HZ.tilt;
/** 倒している（中立でない）あいだ、同じ向きを送り直す。十字もスティックも axis なので同じ。 */
const AXIS_REPEAT: HeldRepeat<{ x: number; y: number }> = {
  ms: HELD_REPEAT_MS,
  value: (v) => (v.x !== 0 || v.y !== 0 ? v : null),
};
/** 触れているあいだ、最後の位置を m（移動）として送り直す。触れた直後で m がまだ無ければ、触れた位置を使う。 */
const PTR_REPEAT: HeldRepeat<{ x: number; y: number; ph: 's' | 'm' | 'e' }> = {
  ms: HELD_REPEAT_MS,
  value: (v) => (v.ph === 'e' ? null : { x: v.x, y: v.y, ph: 'm' }),
};
/** スティックの不感帯（半径に対する割合）。 */
const STICK_DEAD = 0.1;
/** 十字の中心の遊び。親指を置いただけで動かないように。 */
const DPAD_DEAD = 0.3;
const ID_RE = new RegExp(`^[a-z0-9_-]{1,${LIMITS.ID_MAX_LENGTH}}$`);
const COLORS: readonly ColorName[] = ['red', 'blue', 'green', 'yellow', 'gray'];
const ENDS = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;
const NEUTRAL: XY = { x: 0, y: 0 };

// -0 を 0 にそろえる（JSONでは同じだが、比べるときに紛れる）。
const r1 = (n: number) => Math.round(n * 10) / 10 || 0;
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sameXY = (a: XY, b: XY) => a.x === b.x && a.y === b.y;

function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 合成のイベントなど、捕まえられない指もある。その指は捕まえずに扱う。
  }
}

function colorOf(c: unknown): string | undefined {
  return COLORS.includes(c as ColorName) ? (c as string) : undefined;
}

function hint(text: unknown): HTMLElement | null {
  const s = clip(text, LIMITS.HINT_MAX_GRAPHEMES);
  return s ? h('p', { class: 'irori-pad__hint' }, s) : null;
}

/** 押している指（と読み上げの押下）を数え、0→1で d:1、1→0で d:0 を出すボタン。 */
class Btn implements Control {
  readonly el: HTMLButtonElement;
  private readonly held = new Set<number>();
  private dead = false;

  constructor(
    private readonly id: string,
    label: string,
    private readonly out: Out,
    opt: { color?: string | undefined; disabled?: boolean | undefined; cls?: string; aria?: string } = {},
  ) {
    this.el = h(
      'button',
      {
        type: 'button',
        class: `irori-pad__btn${opt.cls ? ` ${opt.cls}` : ''}`,
        'data-id': id,
        'data-color': opt.color,
        'aria-label': opt.aria ?? label,
      },
      label,
    );
    if (opt.disabled) this.el.disabled = true;
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    for (const t of ENDS) this.el.addEventListener(t, (e) => this.up(e));
    // ポインタを伴わないクリック（キーボード・読み上げ）は、押してすぐ離したとして扱う。
    this.el.addEventListener('click', (e) => {
      if (e.detail !== 0 || this.dead || this.el.disabled || this.held.size > 0) return;
      this.out({ k: 'btn', id: this.id, d: 1 });
      this.out({ k: 'btn', id: this.id, d: 0 });
    });
  }

  private down(e: PointerEvent): void {
    if (this.dead || this.el.disabled) return;
    capture(this.el, e.pointerId);
    if (this.held.has(e.pointerId)) return;
    this.held.add(e.pointerId);
    if (this.held.size === 1) {
      this.el.dataset.pressed = '';
      this.out({ k: 'btn', id: this.id, d: 1 });
    }
  }

  private up(e: PointerEvent): void {
    if (!this.held.delete(e.pointerId)) return;
    if (this.held.size === 0) this.finish();
  }

  private finish(): void {
    delete this.el.dataset.pressed;
    this.out({ k: 'btn', id: this.id, d: 0 });
  }

  release(): void {
    if (this.held.size === 0) return;
    this.held.clear();
    this.finish();
  }

  dispose(): void {
    this.dead = true;
    this.held.clear();
  }
}

/** 選択肢。押した瞬間に1回だけ pick を出す。差し替えまで、2回目は無視する。 */
class Choices implements Control {
  readonly el: HTMLDivElement;
  private picked = false;
  private dead = false;

  constructor(options: ChoiceSpec[], private readonly disabled: boolean, private readonly out: Out) {
    this.el = h('div', { class: 'irori-pad__choices', 'data-count': String(options.length) });
    for (const o of options) {
      const label = clip(o.label, LIMITS.LABEL_MAX_GRAPHEMES);
      const el = h('button', { type: 'button', class: 'irori-pad__btn irori-pad__choice', 'data-id': o.id, 'data-color': colorOf(o.color), 'aria-label': label }, label);
      if (disabled) el.disabled = true;
      el.addEventListener('pointerdown', () => this.pick(o.id, el));
      el.addEventListener('click', (e) => {
        if (e.detail === 0) this.pick(o.id, el);
      });
      this.el.append(el);
    }
  }

  private pick(id: string, el: HTMLButtonElement): void {
    if (this.dead || this.disabled || this.picked) return;
    this.picked = true;
    el.dataset.picked = '';
    el.setAttribute('aria-pressed', 'true');
    this.el.dataset.picked = '';
    this.out({ k: 'pick', id });
  }

  release(): void {}

  dispose(): void {
    this.dead = true;
  }
}

/** 1本の指で操作する面（十字・スティック・なぞる面）の共通部分。 */
abstract class Surface implements Control {
  protected active: number | null = null;
  protected dead = false;

  constructor(readonly el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (this.dead || this.active !== null) return;
      this.active = e.pointerId;
      capture(el, e.pointerId);
      this.start(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dead && e.pointerId === this.active) this.move(e);
    });
    for (const t of ENDS) {
      el.addEventListener(t, (e) => {
        if (this.dead || e.pointerId !== this.active) return;
        this.active = null;
        this.end(e);
      });
    }
  }

  /** 要素の中心を0、縁を ±1 とした位置。 */
  protected rel(e: PointerEvent): XY {
    const r = this.el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - r.width / 2) / (r.width / 2 || 1),
      y: (e.clientY - r.top - r.height / 2) / (r.height / 2 || 1),
    };
  }

  protected start(e: PointerEvent): void {
    this.move(e);
  }

  protected abstract move(e: PointerEvent): void;
  protected abstract end(e: PointerEvent): void;
  abstract release(): void;

  dispose(): void {
    this.dead = true;
    this.active = null;
  }
}

class DirPad extends Surface {
  private readonly arrows: Record<'up' | 'down' | 'left' | 'right', HTMLButtonElement>;
  private readonly t: Throttle<XY>;

  constructor(out: Out, s: PadStrings) {
    const arrow = (dir: 'up' | 'down' | 'left' | 'right') =>
      h('button', { type: 'button', class: `irori-pad__arrow irori-pad__arrow--${dir}`, 'aria-label': s[dir], tabindex: '-1' });
    const arrows = { up: arrow('up'), down: arrow('down'), left: arrow('left'), right: arrow('right') };
    super(h('div', { class: 'irori-pad__dpad', role: 'group', 'aria-label': s.dpad }, arrows.up, arrows.left, arrows.right, arrows.down));
    this.arrows = arrows;
    this.t = new Throttle<XY>(AXIS_MS, (v) => out({ k: 'axis', id: 'dpad', x: v.x, y: v.y }), sameXY, NEUTRAL, AXIS_REPEAT);
  }

  protected move(e: PointerEvent): void {
    const { x: dx, y: dy } = this.rel(e);
    let v = NEUTRAL;
    if (Math.hypot(dx, dy) >= DPAD_DEAD) {
      // 8方向に丸める。45度ずつの扇で、斜めも -1・0・1 の組になる。
      const a = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      v = { x: Math.round(Math.cos(a)) || 0, y: Math.round(Math.sin(a)) || 0 };
    }
    this.show(v);
    this.t.push(v);
  }

  protected end(): void {
    this.show(NEUTRAL);
    this.t.push(NEUTRAL);
  }

  private show(v: XY): void {
    const on = { up: v.y < 0, down: v.y > 0, left: v.x < 0, right: v.x > 0 };
    for (const k of ['up', 'down', 'left', 'right'] as const) {
      if (on[k]) this.arrows[k].dataset.pressed = '';
      else delete this.arrows[k].dataset.pressed;
    }
  }

  release(): void {
    this.active = null;
    this.show(NEUTRAL);
    this.t.settle(NEUTRAL);
  }

  override dispose(): void {
    super.dispose();
    this.t.cancel();
  }
}

class Stick extends Surface {
  private readonly knob: HTMLElement;
  private readonly t: Throttle<XY>;

  constructor(out: Out, s: PadStrings) {
    const knob = h('div', { class: 'irori-pad__knob' });
    super(h('div', { class: 'irori-pad__stick', role: 'group', 'aria-label': s.stick }, knob));
    this.knob = knob;
    this.t = new Throttle<XY>(AXIS_MS, (v) => out({ k: 'axis', id: 'stick', x: v.x, y: v.y }), sameXY, NEUTRAL, AXIS_REPEAT);
  }

  protected move(e: PointerEvent): void {
    let { x, y } = this.rel(e);
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    // つまみは土台の44%の大きさ。土台の縁まで動かすと、つまみの幅の64%ずれる。
    this.knob.style.transform = `translate(${r2(x * 64)}%, ${r2(y * 64)}%)`;
    this.t.push(m < STICK_DEAD ? NEUTRAL : { x: r2(x), y: r2(y) });
  }

  protected end(): void {
    this.knob.style.transform = '';
    this.t.push(NEUTRAL);
  }

  release(): void {
    this.active = null;
    this.knob.style.transform = '';
    this.t.settle(NEUTRAL);
  }

  override dispose(): void {
    super.dispose();
    this.t.cancel();
  }
}

type Ptr = { x: number; y: number; ph: 's' | 'm' | 'e' };

/** なぞる面。座標は面の内側を0〜1にした値。面の外へ出た指は、そこで終わりとして扱う。 */
class TouchArea extends Surface {
  private readonly dot: HTMLElement;
  private readonly t: Throttle<Ptr>;
  private last: XY;

  constructor(out: Out, s: PadStrings, mode: 'area' | 'swipe') {
    const dot = h('div', { class: 'irori-pad__dot' });
    super(h('div', { class: 'irori-pad__touch', role: 'group', 'aria-label': s.touch, 'data-mode': mode }, dot));
    this.dot = dot;
    this.last = { x: 0.5, y: 0.5 };
    this.t = new Throttle<Ptr>(
      PTR_MS,
      (v) => out({ k: 'ptr', id: 'touch', x: v.x, y: v.y, ph: v.ph }),
      (a, b) => a.ph === b.ph && a.x === b.x && a.y === b.y,
      undefined,
      PTR_REPEAT,
    );
  }

  private pos(e: PointerEvent): XY {
    const { x, y } = this.rel(e);
    return { x: (x + 1) / 2, y: (y + 1) / 2 };
  }

  protected override start(e: PointerEvent): void {
    const p = this.pos(e);
    this.last = { x: r3(clamp(p.x, 0, 1)), y: r3(clamp(p.y, 0, 1)) };
    this.showDot(this.last);
    this.t.now({ ...this.last, ph: 's' });
  }

  protected move(e: PointerEvent): void {
    const p = this.pos(e);
    const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    this.last = { x: r3(clamp(p.x, 0, 1)), y: r3(clamp(p.y, 0, 1)) };
    if (!inside) {
      this.active = null;
      this.finish();
      return;
    }
    this.showDot(this.last);
    this.t.push({ ...this.last, ph: 'm' });
  }

  protected end(e: PointerEvent): void {
    const p = this.pos(e);
    if (e.type === 'pointerup') this.last = { x: r3(clamp(p.x, 0, 1)), y: r3(clamp(p.y, 0, 1)) };
    this.finish();
  }

  private finish(): void {
    delete this.dot.dataset.on;
    this.t.now({ ...this.last, ph: 'e' });
  }

  private showDot(p: XY): void {
    this.dot.dataset.on = '';
    this.dot.style.left = `${p.x * 100}%`;
    this.dot.style.top = `${p.y * 100}%`;
  }

  release(): void {
    if (this.active === null) return;
    this.active = null;
    this.finish();
  }

  override dispose(): void {
    super.dispose();
    this.t.cancel();
  }
}

/** 選択はこの画面だけで保持し、決定時にだけ送る。クリックはスクロール終了後に発火する。 */
class Tiles implements Control {
  readonly el: HTMLDivElement;
  private dead = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(spec: Extract<PadSpec, { k: 'tiles' }>, out: Out, s: PadStrings) {
    const selected = new Set<string>();
    const max = spec.max ?? Math.min(1, spec.tiles.filter((t) => !t.off).length);
    const min = spec.min ?? Math.min(1, max);
    let sent = false;
    const status = h('p', { class: 'irori-pad__status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const grid = h('div', { class: 'irori-pad__tiles-grid' });
    const ok = h('button', { type: 'button', class: 'irori-pad__btn', 'data-action': 'ok' }, spec.ok);
    const pass = h('button', { type: 'button', class: 'irori-pad__btn', 'data-action': 'pass' }, spec.pass ?? '');
    const actions = h('div', { class: 'irori-pad__tiles-actions' }, ok, spec.pass === undefined ? null : pass);
    const update = () => {
      ok.disabled = sent || selected.size < min || selected.size > max;
      ok.setAttribute('aria-disabled', String(ok.disabled));
      for (const b of grid.querySelectorAll<HTMLButtonElement>('button')) {
        const on = selected.has(b.dataset.id!);
        b.setAttribute('aria-pressed', String(on));
        if (sent) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      }
    };
    const submit = (passing: boolean) => {
      if (this.dead || sent || spec.disabled || (!passing && ok.disabled)) return;
      sent = true;
      this.el.dataset.sent = '';
      pass.disabled = true;
      pass.setAttribute('aria-disabled', 'true');
      status.textContent = s.tilesSent;
      update();
      out(passing ? { k: 'tiles', ids: [], pass: true } : { k: 'tiles', ids: [...selected] });
    };
    for (const tile of spec.tiles) {
      const b = h('button', { type: 'button', class: 'irori-pad__btn irori-pad__tile', 'data-id': tile.id,
        'aria-pressed': 'false', 'aria-disabled': String(!!spec.disabled || !!tile.off) },
        h('span', { class: 'irori-pad__tile-label' }, tile.label),
        tile.sub === undefined ? null : h('small', {}, tile.sub),
        h('span', { class: 'irori-pad__tile-check', 'aria-hidden': 'true' }, '✓'));
      if (tile.color) b.dataset.color = tile.color;
      b.disabled = !!spec.disabled || !!tile.off;
      b.addEventListener('click', () => {
        if (this.dead || sent || b.disabled) return;
        delete b.dataset.limit;
        if (selected.has(tile.id)) selected.delete(tile.id);
        else if (max === 1) { selected.clear(); selected.add(tile.id); }
        else if (selected.size >= max) {
          status.textContent = '';
          status.append(document.createTextNode(s.tilesLimit));
          b.dataset.limit = '';
          const timer = setTimeout(() => { delete b.dataset.limit; this.timers.delete(timer); }, 300);
          this.timers.add(timer);
          return;
        } else selected.add(tile.id);
        status.textContent = '';
        update();
      });
      b.addEventListener('animationend', () => delete b.dataset.limit);
      grid.append(b);
    }
    ok.addEventListener('click', () => submit(false));
    pass.addEventListener('click', () => submit(true));
    this.el = h('div', { class: 'irori-pad__tiles' },
      spec.note === undefined ? null : h('p', { class: 'irori-pad__text' }, spec.note),
      grid, status, spec.disabled ? null : actions);
    update();
  }

  release(): void {}
  dispose(): void { this.dead = true; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
}

type PermissionApi = { requestPermission?: () => Promise<string> };
/** 一度許可されたら、同じページの次の tilt では聞き直さない。 */
let tiltGranted = false;

class Tilt implements Control {
  readonly el: HTMLDivElement;
  private readonly status: HTMLElement;
  private readonly t: Throttle<{ a: number; b: number; g: number }>;
  private listening = false;
  private dead = false;

  constructor(out: Out, private readonly s: PadStrings) {
    this.status = h('p', { class: 'irori-pad__status', role: 'status' });
    this.el = h('div', { class: 'irori-pad__tilt' }, this.status);
    this.t = new Throttle(TILT_MS, (v) => out({ k: 'tilt', a: v.a, b: v.b, g: v.g }), (p, q) => p.a === q.a && p.b === q.b && p.g === q.g);
    const api = (globalThis as { DeviceOrientationEvent?: PermissionApi }).DeviceOrientationEvent;
    if (globalThis.isSecureContext === false) {
      // HTTPS でないと、多くの端末で通知が来ない。案内を出し、来たときのために購読だけはしておく。
      this.listen();
      this.status.textContent = s.tiltInsecure;
    } else if (api && typeof api.requestPermission === 'function' && !tiltGranted) {
      // iOS は、利用者の操作の中で requestPermission を呼ぶ必要がある。
      const ask = api.requestPermission.bind(api);
      const allow = h('button', { type: 'button', class: 'irori-pad__btn irori-pad__allow' }, s.tiltAllow);
      allow.addEventListener('click', () => {
        ask().then(
          (state) => {
            if (state !== 'granted') {
              this.status.textContent = s.tiltDenied;
              return;
            }
            tiltGranted = true;
            allow.remove();
            this.listen();
          },
          () => {
            this.status.textContent = s.tiltDenied;
          },
        );
      });
      this.status.textContent = s.tiltAsk;
      this.el.append(allow);
    } else {
      this.listen();
    }
  }

  private readonly onOrient = (e: Event) => {
    const { alpha, beta, gamma } = e as DeviceOrientationEvent;
    if (alpha == null || beta == null || gamma == null) return;
    this.t.push({ a: r1(clamp(alpha, 0, 360)), b: r1(clamp(beta, -180, 180)), g: r1(clamp(gamma, -90, 90)) });
  };

  private listen(): void {
    if (this.dead || this.listening) return;
    this.listening = true;
    this.status.textContent = this.s.tiltOn;
    this.el.dataset.on = '';
    globalThis.addEventListener('deviceorientation', this.onOrient);
  }

  release(): void {}

  dispose(): void {
    this.dead = true;
    this.t.cancel();
    if (this.listening) globalThis.removeEventListener('deviceorientation', this.onOrient);
  }
}

/** 種類の指定に合うボタンだけを、上限までの数で作る。id の形が違うものは描かない。 */
function buttons(list: unknown, out: Out, controls: Control[]): HTMLElement {
  const box = h('div', { class: 'irori-pad__btns' });
  const seen = new Set<string>();
  for (const b of (Array.isArray(list) ? list : []) as ButtonSpec[]) {
    if (seen.size >= LIMITS.BUTTONS_MAX) break;
    if (!b || typeof b.id !== 'string' || !ID_RE.test(b.id) || seen.has(b.id)) continue;
    seen.add(b.id);
    const btn = new Btn(b.id, clip(b.label, LIMITS.LABEL_MAX_GRAPHEMES), out, { color: colorOf(b.color) });
    controls.push(btn);
    box.append(btn.el);
  }
  box.dataset.count = String(seen.size);
  return box;
}

function choices(list: unknown): ChoiceSpec[] {
  const out: ChoiceSpec[] = [];
  const seen = new Set<string>();
  for (const o of (Array.isArray(list) ? list : []) as ChoiceSpec[]) {
    if (out.length >= LIMITS.CHOICES_MAX) break;
    if (!o || typeof o.id !== 'string' || !ID_RE.test(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

interface View {
  kind: string;
  nodes: (HTMLElement | null)[];
  controls: Control[];
}

function build(spec: PadSpec, out: Out, s: PadStrings): View {
  const controls: Control[] = [];
  const view = (kind: string, ...nodes: (HTMLElement | null)[]): View => ({ kind, nodes, controls });
  const body = (...nodes: (HTMLElement | null)[]) => h('div', { class: 'irori-pad__body' }, ...nodes);
  switch (spec?.k) {
    case 'pad': {
      let dir: HTMLElement | null = null;
      if (spec.stick !== 'none') {
        const c = spec.stick === 'stick' ? new Stick(out, s) : new DirPad(out, s);
        controls.push(c);
        dir = c.el;
      }
      const v = view('pad', hint(spec.hint), body(dir, buttons(spec.buttons, out, controls)));
      return v;
    }
    case 'buzzer': {
      const label = clip(spec.label, LIMITS.LABEL_MAX_GRAPHEMES);
      const b = new Btn('buzzer', label, out, { color: colorOf(spec.color), disabled: spec.disabled === true, cls: 'irori-pad__buzzer' });
      controls.push(b);
      return view('buzzer', hint(spec.hint), body(b.el));
    }
    case 'choices': {
      const c = new Choices(choices(spec.options), spec.disabled === true, out);
      controls.push(c);
      return view('choices', hint(spec.hint), body(c.el));
    }
    case 'tiles': {
      const tiles = new Tiles(spec, out, s);
      controls.push(tiles);
      return view('tiles', hint(spec.hint), tiles.el);
    }
    case 'touch': {
      const t = new TouchArea(out, s, spec.mode === 'swipe' ? 'swipe' : 'area');
      controls.push(t);
      return view('touch', hint(spec.hint), body(t.el));
    }
    case 'tilt': {
      const t = new Tilt(out, s);
      controls.push(t);
      return view('tilt', hint(spec.hint), body(t.el, buttons(spec.buttons, out, controls)));
    }
    case 'remote': {
      const mk = (id: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back', cls: string) => {
        const b = new Btn(id, id === 'ok' || id === 'back' ? s[id] : '', out, { cls, aria: s[id] });
        controls.push(b);
        return b.el;
      };
      const cross = h(
        'div',
        { class: 'irori-pad__cross', role: 'group', 'aria-label': s.dpad },
        mk('up', 'irori-pad__arrow irori-pad__arrow--up'),
        mk('left', 'irori-pad__arrow irori-pad__arrow--left'),
        mk('right', 'irori-pad__arrow irori-pad__arrow--right'),
        mk('down', 'irori-pad__arrow irori-pad__arrow--down'),
      );
      const keys = h('div', { class: 'irori-pad__btns irori-pad__keys' }, mk('ok', 'irori-pad__ok'), mk('back', 'irori-pad__back'));
      return view('remote', hint(spec.hint), body(cross, keys));
    }
    case 'wait':
      return view('wait', waiting(spec.title, spec.body, s));
    default:
      // 知らない種類は描かずに、待ちの画面にする（検証を通った指定しか来ない前提でも、壊れない側に倒す）。
      return view('wait', waiting(undefined, undefined, s));
  }
}

function waiting(titleRaw: unknown, bodyRaw: unknown, s: PadStrings): HTMLElement {
  const text = clip(bodyRaw, LIMITS.BODY_MAX_GRAPHEMES);
  const title = clip(titleRaw, LIMITS.TITLE_MAX_GRAPHEMES) || (text ? '' : s.waiting);
  return h(
    'div',
    { class: 'irori-pad__wait', role: 'status' },
    title ? h('p', { class: 'irori-pad__title' }, title) : null,
    text ? h('p', { class: 'irori-pad__text' }, text) : null,
  );
}

const ORIENTS = ['any', 'landscape', 'portrait'];

export function mountPad(container: HTMLElement, options: PadOptions): PadHandle {
  const strings: PadStrings = { ...PAD_STRINGS_JA, ...options.strings };
  const root = h('div', { class: 'irori-pad', 'data-kind': 'wait' });
  // 長押しのメニュー・文字の選択・ダブルタップの拡大・ドラッグを止める（touch-action は CSS）。
  for (const t of ['contextmenu', 'selectstart', 'dblclick', 'dragstart']) root.addEventListener(t, (e) => e.preventDefault());
  container.append(root);

  let controls: Control[] = [];
  let destroyed = false;
  const out: Out = (input) => options.send(input);

  const releaseHeld = (_why: 'setSpec' | 'releaseAll' | 'destroy') => {
    for (const c of controls) c.release();
  };

  const setSpec = (spec: PadSpec) => {
    if (destroyed) return;
    releaseHeld('setSpec');
    for (const c of controls) c.dispose();
    const v = build(spec, out, strings);
    controls = v.controls;
    root.dataset.kind = v.kind;
    const orient = (spec as { orient?: unknown }).orient;
    if (v.kind === 'pad') root.dataset.orient = ORIENTS.includes(orient as string) ? (orient as string) : 'any';
    else delete root.dataset.orient;
    root.replaceChildren(...v.nodes.filter((n): n is HTMLElement => n !== null));
  };

  setSpec({ k: 'wait' });

  return {
    setSpec,
    releaseAll: () => {
      if (!destroyed) releaseHeld('releaseAll');
    },
    destroy: () => {
      if (destroyed) return;
      releaseHeld('destroy');
      for (const c of controls) c.dispose();
      controls = [];
      destroyed = true;
      root.remove();
    },
  };
}
