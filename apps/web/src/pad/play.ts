// 部屋の中の画面。縁は席の色、左上に席の形と名前（長押しでメニュー）、中央にコントローラー（pad-ui）。
// 重ねるもの：つなぎ直しの案内・ホスト待ち・向きの案内・メニュー・短い知らせ。どれもゲームからは消せない。
import { look, mountPad, shapeSvg, type PadHandle, type PadStrings } from '@irori/pad-ui';
import type { InputEvent, PadSpec, PlayerInfo } from '@irori/protocol';
import { h } from '../shared/dom';
import { t, type Locale } from '../shared/i18n';
import { icon } from './icons';
import { longPress, type Timers } from './long-press';
import { clauses, phrase } from './phrase';

export interface PlayOptions {
  you: PlayerInfo;
  spec: PadSpec;
  locale: Locale;
  strings: PadStrings;
  timers: Timers;
  /** 入力を送る。つながっていなければ false。 */
  send: (input: InputEvent) => boolean;
  onLeave: () => void;
  onReconnectNow: () => void;
  matchMedia?: ((query: string) => MediaQueryList) | undefined;
  /** 長押しで開いたときの短い手応え。振動のない端末では何もしない。 */
  vibrate?: ((pattern: number[]) => void) | undefined;
}

const TOAST_MS = 2_600;
/** 長押しで開いた直後、離した指が下の項目を押してしまわないように、この間は押されても無視する。 */
const MENU_ARM_MS = 350;

const sameSpec = (a: PadSpec, b: PadSpec): boolean => JSON.stringify(a) === JSON.stringify(b);

function shapeMask(path: string): string {
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svgText)}")`;
}

export class PlayView {
  readonly el: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly badge: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly badgeShape: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly lookEl: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly padHost: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerNow: HTMLButtonElement;
  private readonly hostCover: HTMLElement;
  private readonly orientCover: HTMLElement;
  private readonly orientTitle: HTMLElement;
  private readonly orientBody: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly menuSeat: HTMLElement;
  private readonly menuShape: HTMLElement;
  private readonly menuPause: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  private readonly pad: PadHandle;
  private readonly mq: MediaQueryList | null;
  private readonly onOrientChange = () => this.updateOrient();

  private you: PlayerInfo;
  private spec: PadSpec;
  private lost = false;
  private hostOn = true;
  private menuOpen = false;
  private menuArmed = false;
  private orientShown = false;
  private orientDismissedFor: string | null = null;
  private toastTimer: unknown = null;
  private fxTimer: unknown = null;
  private armTimer: unknown = null;
  private destroyed = false;

  constructor(private readonly o: PlayOptions) {
    this.you = o.you;
    this.spec = o.spec;

    this.badgeShape = h('span', { class: 'pp-badge__shape' });
    this.nameEl = h('span', { class: 'pp-badge__name' });
    this.lookEl = h('span', { class: 'pp-look' });
    this.badge = h(
      'button',
      { class: 'pp-badge', attrs: { type: 'button', 'aria-haspopup': 'dialog' }, data: { act: 'seat' } },
      this.badgeShape,
      h('span', { class: 'pp-badge__text' }, this.nameEl, this.lookEl),
    );
    // メニューの入口は右上の「…」（名前の長さで動かない）。札の長押しは近道として残す。
    this.menuBtn = h(
      'button',
      { class: 'pp-menubtn', attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('pad.menu.open') }, data: { act: 'menu' }, on: { click: () => this.openMenu() } },
      icon('dots', 26),
    );
    longPress(this.badge, {
      timers: o.timers,
      onLongPress: () => this.openMenu(),
      onShortTap: () => this.toast(t('pad.seat.hint')),
    });

    this.padHost = h('div', { class: 'pp-pad' });
    this.pad = mountPad(this.padHost, { send: (i) => void o.send(i), strings: o.strings });

    // つなぎ直しの案内は、枠の真ん中のカードに出す（操作は隠したまま、空の枠に見せない）。自動で入り直している間も、すぐ押せる。
    this.bannerNow = h(
      'button',
      { class: 'pp-btn pp-btn--primary', attrs: { type: 'button' }, data: { act: 'reconnect-now' }, on: { click: () => o.onReconnectNow() } },
      t('pad.banner.now'),
    );
    this.banner = h(
      'div',
      { class: 'pp-cover pp-banner', attrs: { hidden: true } },
      h(
        'div',
        { class: 'pp-card pp-card--cover', attrs: { role: 'status' } },
        h('div', { class: 'pp-state-icon pp-state-icon--lost', attrs: { 'aria-hidden': 'true' } }, icon('signal', 36)),
        h('h2', { class: 'pp-h2' }, ...phrase(t('pad.banner.title'))),
        h('p', { class: 'pp-lead' }, ...phrase(t('pad.banner.body'))),
        h('p', { class: 'pp-note' }, ...clauses(t('pad.banner.note'))),
        this.bannerNow,
      ),
    );

    this.hostCover = h(
      'div',
      { class: 'pp-cover', attrs: { hidden: true }, data: { cover: 'host' } },
      h(
        'div',
        { class: 'pp-card pp-card--cover', attrs: { role: 'status' } },
        h('div', { class: 'pp-state-icon', attrs: { 'aria-hidden': 'true' } }, icon('monitor', 36)),
        h('h2', { class: 'pp-h2' }, ...phrase(t('pad.host.title'))),
        h('p', { class: 'pp-lead' }, ...clauses(t('pad.host.body'))),
        h('p', { class: 'pp-note' }, ...clauses(t('pad.host.note'))),
      ),
    );

    this.orientTitle = h('h2', { class: 'pp-h2' });
    this.orientBody = h('p', { class: 'pp-lead' });
    this.orientCover = h(
      'div',
      { class: 'pp-cover', attrs: { hidden: true }, data: { cover: 'orient' } },
      h(
        'div',
        { class: 'pp-card pp-card--cover' },
        h('div', { class: 'pp-state-icon pp-state-icon--rotate', attrs: { 'aria-hidden': 'true' } }, icon('rotate', 40)),
        this.orientTitle,
        this.orientBody,
        h(
          'button',
          { class: 'pp-btn pp-btn--ghost', attrs: { type: 'button' }, data: { act: 'keep-orient' }, on: { click: () => this.dismissOrient() } },
          t('pad.orient.keep'),
        ),
      ),
    );

    this.stage = h('div', { class: 'pp-stage' }, this.padHost, this.hostCover, this.orientCover, this.banner);

    // ---- メニュー ----
    this.menuShape = h('span', { class: 'pp-menu__shape' });
    this.menuSeat = h('p', { class: 'pp-menu__seat' });
    this.menuPause = this.menuItem('pause', 'pause', t('pad.menu.pause'), t('pad.menu.pauseNote'), () => this.requestPause());
    const panel = h(
      'div',
      { class: 'pp-menu__panel' },
      h('div', { class: 'pp-menu__head' }, this.menuShape, h('div', null, h('h2', { class: 'pp-h2', id: 'pp-menu-title' }, t('pad.menu.title')), this.menuSeat)),
      h('div', { class: 'pp-menu__items' }, this.menuPause, this.menuItem('leave', 'door', t('pad.menu.leave'), t('pad.menu.leaveNote'), () => this.leave(), 'pp-menu__item--leave')),
      h(
        'button',
        { class: 'pp-btn pp-btn--ghost', attrs: { type: 'button' }, data: { act: 'close-menu' }, on: { click: (e) => this.armed(e) && this.closeMenu() } },
        icon('close', 22),
        t('pad.menu.close'),
      ),
      // いちばん下に、ライセンスとクレジット（日本語の折り返しに使う BudouX の帰属表示と全文）への控えめなリンク。新しいタブで開く。
      h(
        'a',
        {
          class: 'pp-menu__licenses',
          attrs: { href: '/licenses.txt', target: '_blank', rel: 'noopener noreferrer' },
          data: { act: 'licenses' },
          on: {
            click: (e) => {
              if (!this.armed(e)) e.preventDefault();
            },
          },
        },
        t('pad.menu.licenses'),
      ),
    );
    this.menu = h('div', { class: 'pp-menu', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pp-menu-title', hidden: true } }, panel);
    let downOnBackdrop = false;
    this.menu.addEventListener('pointerdown', (e) => {
      this.menuArmed = true;
      downOnBackdrop = e.target === this.menu;
    });
    this.menu.addEventListener('click', (e) => {
      if (e.target === this.menu && downOnBackdrop) this.closeMenu();
      downOnBackdrop = false;
    });
    this.menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeMenu();
    });

    this.toastEl = h('div', { class: 'pp-toast', attrs: { role: 'status', hidden: true } });

    this.frame = h(
      'div',
      { class: 'pp-frame' },
      h('header', { class: 'pp-top' }, this.badge, this.menuBtn),
      this.stage,
      this.menu,
      this.toastEl,
    );
    this.el = h('div', { class: 'pp-play', data: { screen: 'play' } }, this.frame);
    // 部屋の中では、引っ張って更新・拡大・選択のメニューを起こさない（入力欄はない）。
    this.el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    for (const type of ['contextmenu', 'dblclick', 'selectstart', 'dragstart']) this.el.addEventListener(type, (e) => e.preventDefault());

    this.mq = o.matchMedia ? o.matchMedia('(orientation: portrait)') : null;
    this.mq?.addEventListener('change', this.onOrientChange);

    this.setYou(o.you);
    this.pad.setSpec(o.spec);
    this.afterSpec();
  }

  /** 部品が描いた文を、語の塊（phrase）に組み直す。押せない部品には aria-disabled を付ける。 */
  private tidy(): void {
    for (const el of this.padHost.querySelectorAll<HTMLElement>('.irori-pad__hint, .irori-pad__title, .irori-pad__text')) {
      const text = el.textContent ?? '';
      if (el.childElementCount === 0 && text !== '') el.replaceChildren(...(el.classList.contains('irori-pad__title') ? phrase(text) : clauses(text)));
    }
    for (const b of this.padHost.querySelectorAll<HTMLButtonElement>('button:disabled')) b.setAttribute('aria-disabled', 'true');
    // 待ちの画面の大きな形は自分の印。「たろうが選んでいます」のような見出しの人の印と取り違えないよう、添え書きを付ける。
    // 形は絵だけ（読み上げない）なので、添え書きも読み上げから外す。
    const wait = this.padHost.querySelector<HTMLElement>('.irori-pad[data-kind="wait"] .irori-pad__wait');
    if (wait && !wait.querySelector('.pp-wait-you')) wait.prepend(h('p', { class: 'pp-wait-you', attrs: { 'aria-hidden': 'true' } }, t('pad.wait.you')));
    this.lockTiltButtons();
  }

  /**
   * 傾きの許可の前は、ほかのボタンを押せなくし（見た目は押せない部品と同じ）、ボタンのすぐ上に理由を1行添える。
   * 許可が済んで「許可する」が消えたら、元に戻す。許可を断ったときは、押せないまま残る。
   */
  private lockTiltButtons(): void {
    const body = this.padHost.querySelector<HTMLElement>('.irori-pad[data-kind="tilt"] .irori-pad__body');
    const allow = body?.querySelector<HTMLElement>('.irori-pad__allow');
    const btns = body?.querySelector<HTMLElement>(':scope > .irori-pad__btns');
    if (!body || !allow || !btns || btns.childElementCount === 0) return;
    const note = h('p', { class: 'pp-tilt-note' }, ...clauses(t('pad.tilt.locked')));
    const side = h('div', { class: 'pp-tilt-side' });
    btns.replaceWith(side);
    side.append(note, btns);
    btns.inert = true;
    const watch = new MutationObserver(() => {
      if (allow.isConnected) return;
      watch.disconnect();
      btns.inert = false;
      note.remove();
    });
    watch.observe(allow.parentElement ?? body, { childList: true });
  }

  private menuItem(act: string, name: 'pause' | 'door', title: string, note: string, run: () => void, extra = ''): HTMLButtonElement {
    return h(
      'button',
      { class: `pp-menu__item ${extra}`.trim(), attrs: { type: 'button' }, data: { act }, on: { click: (e) => this.armed(e) && run() } },
      h('span', { class: 'pp-menu__icon' }, icon(name, 26)),
      h('strong', null, ...phrase(title)),
      h('span', { class: 'pp-menu__note' }, ...clauses(note)),
    );
  }

  // ---- 外から ----

  get current(): PadSpec {
    return this.spec;
  }

  setYou(you: PlayerInfo): void {
    this.you = you;
    const l = look(you.id, this.o.locale);
    this.el.style.setProperty('--pp-seat', l.color);
    this.el.style.setProperty('--pp-shape', shapeMask(l.path));
    this.el.dataset.seat = String(you.id);
    this.badgeShape.replaceChildren(shapeSvg(l.shape, 28, l.color));
    this.menuShape.replaceChildren(shapeSvg(l.shape, 40, l.color));
    // 名前はスマホから来た文字列。必ず textContent で入れる。
    this.nameEl.textContent = you.name;
    this.lookEl.textContent = l.label;
    this.menuSeat.textContent = `${t('pad.menu.you', { look: l.label })}・${you.name}`;
    this.badge.setAttribute('aria-label', t('pad.seat.aria', { look: l.label, name: you.name }));
  }

  /** ホストから届いた画面を出す。同じ指定の再送は作り直さない（押している指を切らないため）。force は作り直す。 */
  applySpec(spec: PadSpec, force: boolean): boolean {
    if (!force && sameSpec(spec, this.spec)) return false;
    this.spec = spec;
    this.pad.setSpec(spec);
    this.afterSpec();
    return true;
  }

  /** 接続が切れた（true）・戻った（false）。切れている間は案内のカードを出し、操作を止める。 */
  setLost(lost: boolean): void {
    if (this.lost === lost) return;
    this.lost = lost;
    this.banner.hidden = !lost;
    this.el.dataset.link = lost ? 'lost' : 'open';
    this.menuPause.disabled = lost;
    this.updateInert();
  }

  setHost(on: boolean): void {
    if (this.hostOn === on) return;
    this.hostOn = on;
    this.hostCover.hidden = on;
    this.el.dataset.host = on ? 'on' : 'off';
    this.updateInert();
  }

  /** 振動の指示。振動のない端末（iOS など）でも分かるように、縁を一瞬光らせる。 */
  flash(): void {
    this.clearTimer('fxTimer');
    this.frame.dataset.fx = '';
    this.fxTimer = this.o.timers.setTimeout(() => {
      this.fxTimer = null;
      delete this.frame.dataset.fx;
    }, 360);
  }

  toast(text: string): void {
    this.clearTimer('toastTimer');
    this.toastEl.replaceChildren(...phrase(text));
    this.toastEl.hidden = false;
    this.toastTimer = this.o.timers.setTimeout(() => {
      this.toastTimer = null;
      this.toastEl.hidden = true;
    }, TOAST_MS);
  }

  releaseAll(): void {
    this.pad.releaseAll();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const k of ['toastTimer', 'fxTimer', 'armTimer'] as const) this.clearTimer(k);
    this.mq?.removeEventListener('change', this.onOrientChange);
    this.pad.destroy();
    this.el.remove();
  }

  // ---- 中身 ----

  private clearTimer(k: 'toastTimer' | 'fxTimer' | 'armTimer'): void {
    if (this[k] !== null) this.o.timers.clearTimeout(this[k]);
    this[k] = null;
  }

  private afterSpec(): void {
    this.el.dataset.kind = this.spec.k;
    this.tidy();
    this.updateOrient();
  }

  /** 向きの案内：pad の orient が横（縦）なのに、スマホが縦（横）のとき。iOS は向きを固定できないので、案内だけ。 */
  private updateOrient(): void {
    const need = this.spec.k === 'pad' ? (this.spec.orient ?? 'any') : 'any';
    const portrait = this.mq ? this.mq.matches : true;
    const mismatch = (need === 'landscape' && portrait) || (need === 'portrait' && !portrait);
    if (this.orientDismissedFor !== null && this.orientDismissedFor !== need) this.orientDismissedFor = null;
    const show = mismatch && this.orientDismissedFor !== need;
    if (need === 'landscape') {
      this.orientTitle.replaceChildren(...phrase(t('pad.orient.landscape')));
      this.orientBody.replaceChildren(...clauses(t('pad.orient.bodyLandscape')));
    } else if (need === 'portrait') {
      this.orientTitle.replaceChildren(...phrase(t('pad.orient.portrait')));
      this.orientBody.replaceChildren(...clauses(t('pad.orient.bodyPortrait')));
    }
    this.orientShown = show;
    this.orientCover.hidden = !show;
    this.el.dataset.orientNeed = need;
    this.updateInert();
  }

  private dismissOrient(): void {
    this.orientDismissedFor = this.spec.k === 'pad' ? (this.spec.orient ?? 'any') : 'any';
    this.updateOrient();
  }

  /** 操作を受けないとき（切れている・ホスト待ち・案内やメニューが前にある）は、押している指を離したことにして止める。 */
  private updateInert(): void {
    const blocked = this.lost || !this.hostOn || this.menuOpen || this.orientShown;
    if (blocked && !this.padHost.inert) this.pad.releaseAll();
    this.padHost.inert = blocked;
    if (blocked) this.padHost.dataset.dim = '';
    else delete this.padHost.dataset.dim;
  }

  private armed(e: MouseEvent): boolean {
    // キーボード・読み上げの決定（detail 0）は、いつでも通す。
    return e.detail === 0 || this.menuArmed;
  }

  private openMenu(): void {
    if (this.menuOpen || this.destroyed) return;
    this.menuOpen = true;
    this.menuArmed = false;
    this.clearTimer('armTimer');
    this.armTimer = this.o.timers.setTimeout(() => {
      this.armTimer = null;
      this.menuArmed = true;
    }, MENU_ARM_MS);
    this.menu.hidden = false;
    this.badge.setAttribute('aria-expanded', 'true');
    this.updateInert();
    this.o.vibrate?.([12]);
    this.menuPause.focus();
    if (document.activeElement !== this.menuPause) this.menu.querySelector<HTMLButtonElement>('[data-act="leave"]')?.focus();
  }

  private closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.clearTimer('armTimer');
    this.menu.hidden = true;
    this.badge.setAttribute('aria-expanded', 'false');
    this.updateInert();
    this.badge.focus();
  }

  private requestPause(): void {
    const ok = this.o.send({ k: 'menu' });
    this.closeMenu();
    this.toast(ok ? t('pad.menu.sent') : t('pad.menu.offline'));
  }

  private leave(): void {
    this.closeMenu();
    this.o.onLeave();
  }
}
