// スマホの画面の進み方：コード → 参加 → つなぐ → 遊ぶ → 出る。QRから来た人は、「参加する」を1回押すだけで入れる。
// 切れたら RoomSocket が自動で入り直す。自動で入り直さないのは、外された・閉じた・満員・ロック・取って代わられたとき。
// 画面に戻ったとき（visibilitychange・pageshow・online）は、生きているかを確かめる（probe）。
import { LIMITS, type InputEvent, type PadSpec, type PlayerInfo, type ToPadFrame } from '@irori/protocol';
import { RoomSocket, roomSocketUrl, type Clock, type RoomSocketError, type SocketState, type WebSocketConstructor } from '@irori/room-client';
import { getLocale, t } from '../shared/i18n';
import type { Timers } from './long-press';
import { padUiStrings } from './messages';
import { PlayView } from './play';
import {
  NAME_KEY,
  codeFromHash,
  fitName,
  lookupRoom,
  openStorage,
  readItem,
  removeItem,
  resumeKey,
  writeItem,
  type KeyValue,
  type Lookup,
} from './room';
import { checkingScreen, connectingScreen, entryScreen, joinScreen, stateScreen, type Action, type Screen } from './screens';
import { WakeKeeper, type WakeApi } from './wake';

export interface PadDeps {
  win: Window;
  doc: Document;
  fetch: typeof fetch;
  /** 時計とタイマー。RoomSocket と画面の両方が使う（試験で実時間を待たないため）。 */
  clock: Clock;
  session: KeyValue | null;
  local: KeyValue | null;
  WebSocket?: WebSocketConstructor;
  wakeLock?: WakeApi;
  vibrate?: (pattern: number[]) => boolean;
  /** 試験用：RoomSocket の待ち時間。 */
  socket?: { pingIntervalMs?: number; pongTimeoutMs?: number; backoffMinMs?: number; backoffMaxMs?: number };
}

type Refusal = 'full' | 'locked' | 'network' | 'rate' | 'busy';
type Ending = 'kicked' | 'closed' | 'left' | 'version';

type Phase =
  | { k: 'entry'; error: string | null; prefill: string }
  | { k: 'checking'; code: string }
  | { k: 'join'; code: string }
  | { k: 'refused'; code: string; why: Refusal; max: number; sec: number; afterJoin: boolean }
  | { k: 'connecting'; code: string; slow: boolean }
  | { k: 'play'; code: string }
  | { k: 'replaced'; code: string }
  | { k: 'ended'; code: string; why: Ending };

/** 最初の接続が、これより長くかかったら「もう一度試す」を出す。 */
const SLOW_CONNECT_MS = 6_000;

export function browserDeps(): PadDeps {
  const nav = navigator as Navigator & { wakeLock?: WakeApi };
  const deps: PadDeps = {
    win: window,
    doc: document,
    fetch: (input, init) => fetch(input, init),
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
    session: openStorage(() => window.sessionStorage),
    local: openStorage(() => window.localStorage),
  };
  if (nav.wakeLock && typeof nav.wakeLock.request === 'function') deps.wakeLock = nav.wakeLock;
  if (typeof nav.vibrate === 'function') deps.vibrate = (pattern) => nav.vibrate(pattern);
  return deps;
}

export class PadApp {
  private phase: Phase = { k: 'entry', error: null, prefill: '' };
  private socket: RoomSocket<'pad'> | null = null;
  private play: PlayView | null = null;
  private you: PlayerInfo | null = null;
  private hostOn = true;
  /** ホストから最後に届いた画面。取って代わられたあとに戻るときにも使う。 */
  private spec: PadSpec | null = null;
  /** 次に届く画面は、同じ指定でも当て直す。つなぎ直したあと、ホストの画面（正）に合わせ直すため。 */
  private fresh = true;
  private name = '';
  private slowTimer: unknown = null;
  private lookupSeq = 0;
  private ownHash = '';
  private stopped = false;
  /** いま出している画面（部屋の中は PlayView が持つので null）。 */
  private current: Screen | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly wake: WakeKeeper;
  private readonly timers: Timers;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: PadDeps,
  ) {
    this.timers = { setTimeout: (fn, ms) => deps.clock.setTimeout(fn, ms), clearTimeout: (h) => deps.clock.clearTimeout(h) };
    this.wake = new WakeKeeper(deps.wakeLock, () => deps.doc.visibilityState === 'visible');
  }

  start(): void {
    const { doc, win } = this.deps;
    doc.documentElement.lang = getLocale();
    doc.title = t('pad.title');
    this.name = readItem(this.deps.local, NAME_KEY) ?? '';
    this.listen(doc, 'visibilitychange', () => {
      if (doc.visibilityState === 'visible') this.comeBack();
    });
    this.listen(win, 'pageshow', () => this.comeBack());
    this.listen(win, 'online', () => this.comeBack());
    this.listen(win, 'hashchange', () => this.onHashChange());
    // 操作のたびに、消灯の防止を取り直す（自動で入り直したときは、タップがないと取れない端末がある）。
    this.listen(doc, 'pointerdown', () => this.wake.refresh(), { capture: true, passive: true });
    // ソフトキーボード：入力欄に入ったとき・見える高さが変わったときに、入力欄と主ボタンを見える範囲へ寄せる。
    this.listen(doc, 'focusin', () => this.reveal());
    const vv = win.visualViewport;
    if (vv) {
      const onViewport = () => {
        this.syncViewport();
        this.reveal();
      };
      vv.addEventListener('resize', onViewport);
      vv.addEventListener('scroll', onViewport);
      this.offs.push(() => {
        vv.removeEventListener('resize', onViewport);
        vv.removeEventListener('scroll', onViewport);
      });
      this.syncViewport();
    }
    this.listen(win, 'resize', () => this.reveal());
    this.route();
  }

  /** 止める（試験と、ページを捨てるとき）。聞いているイベントを外し、つながりを閉じる。 */
  stop(): void {
    this.stopped = true;
    this.lookupSeq++; // 返事待ちの照会の結果を捨てる
    for (const off of this.offs.splice(0)) off();
    this.closeSocket();
    this.wake.release();
    this.play?.destroy();
    this.play = null;
  }

  private listen(target: EventTarget, type: string, fn: () => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.offs.push(() => target.removeEventListener(type, fn, opts));
  }

  /** いまの段階（試験と画面の確認用）。 */
  get state(): string {
    return this.phase.k;
  }

  // ---- 入口 ----

  private route(): void {
    const { code, raw } = codeFromHash(this.deps.win.location.hash);
    if (!code) {
      this.go({ k: 'entry', error: raw ? t('pad.entry.badCode') : null, prefill: raw });
      return;
    }
    // 再読み込み・タブの復帰：札があれば、参加の画面を飛ばして同じ席に戻る（ホストが直前の画面を送り直す）。
    if (readItem(this.deps.session, resumeKey(code)) !== null) {
      this.wake.hold();
      this.connect(code);
      return;
    }
    void this.check(code, false);
  }

  private onHashChange(): void {
    if (this.socket) return; // 部屋の中・つないでいる最中は、URL の書き換えで出ない
    // 自分で書き換えた URL には反応しない（replaceState で hashchange を出す実装もあるため）。
    if (this.deps.win.location.hash === this.ownHash) return;
    const { code } = codeFromHash(this.deps.win.location.hash);
    if (code && 'code' in this.phase && this.phase.code === code) return;
    this.route();
  }

  private setHash(code: string): void {
    const { win } = this.deps;
    this.ownHash = code ? `#${code}` : '';
    try {
      win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}${this.ownHash}`);
    } catch {
      // 書き換えられなくても進める
    }
  }

  private async check(code: string, afterJoin: boolean): Promise<void> {
    const seq = ++this.lookupSeq;
    this.setHash(code);
    this.go({ k: 'checking', code });
    const r: Lookup = await lookupRoom(code, this.deps.fetch);
    if (seq !== this.lookupSeq || this.phase.k !== 'checking') return;
    switch (r.kind) {
      case 'open':
        if (afterJoin) this.join(code, this.name);
        else this.go({ k: 'join', code });
        return;
      case 'missing':
        this.toEntry(code, t('pad.entry.noRoom', { code }));
        return;
      case 'full':
        this.go({ k: 'refused', code, why: 'full', max: r.max, sec: 0, afterJoin });
        return;
      case 'locked':
        this.go({ k: 'refused', code, why: 'locked', max: 0, sec: 0, afterJoin });
        return;
      case 'rate':
      case 'busy':
        this.go({ k: 'refused', code, why: r.kind, max: 0, sec: r.retryAfterSec, afterJoin });
        return;
      case 'network':
        this.go({ k: 'refused', code, why: 'network', max: 0, sec: 0, afterJoin });
        return;
    }
  }

  private toEntry(prefill: string, error: string | null): void {
    this.closeSocket();
    this.setHash('');
    this.go({ k: 'entry', error, prefill });
  }

  // ---- 参加 ----

  /** 参加のタップ。ここを、消灯の防止と、傾きの許可の準備の起点にする（許可の要求は tilt の画面のボタン）。 */
  private join(code: string, rawName: string): void {
    if (this.socket) return; // 連打・二重の呼び出し
    this.name = fitName(rawName);
    if (this.name) writeItem(this.deps.local, NAME_KEY, this.name);
    else removeItem(this.deps.local, NAME_KEY);
    this.wake.hold();
    this.connect(code);
  }

  private connect(code: string): void {
    this.closeSocket();
    this.setHash(code);
    this.fresh = true;
    const deps = this.deps;
    const socket = new RoomSocket<'pad'>({
      role: 'pad',
      url: () => roomSocketUrl(deps.win.location.origin, code),
      clock: deps.clock,
      name: () => (this.name === '' ? undefined : this.name),
      resume: () => readItem(deps.session, resumeKey(code)) ?? undefined,
      ...(deps.WebSocket ? { WebSocket: deps.WebSocket } : {}),
      ...deps.socket,
    });
    // 購読の関数が例外を投げると、ほかの購読者に届かない。ここで守る。
    socket.on('frame', (f) => this.guard(() => this.onFrame(code, socket, f)));
    socket.on('state', (s) => this.guard(() => this.onState(code, socket, s)));
    socket.on('error', (e) => this.guard(() => this.onError(code, socket, e)));
    this.socket = socket;
    this.go({ k: 'connecting', code, slow: false });
    this.slowTimer = deps.clock.setTimeout(() => {
      this.slowTimer = null;
      if (this.phase.k === 'connecting' && this.socket === socket) this.go({ ...this.phase, slow: true });
    }, SLOW_CONNECT_MS);
    socket.connect();
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      // 1つの誤りで、つながりごと止めない。
      console.error(e);
    }
  }

  private closeSocket(): void {
    if (this.slowTimer !== null) this.deps.clock.clearTimeout(this.slowTimer);
    this.slowTimer = null;
    const s = this.socket;
    this.socket = null;
    s?.close();
  }

  // ---- つながりから ----

  private onFrame(code: string, socket: RoomSocket<'pad'>, f: ToPadFrame): void {
    if (socket !== this.socket) return;
    switch (f.t) {
      case 'welcome': {
        // 再開の札は、このタブにだけ置く。切れたら、同じ札で同じ席に戻る。
        writeItem(this.deps.session, resumeKey(code), f.resume);
        const seatChanged = this.you !== null && this.you.id !== f.you.id;
        this.you = f.you;
        this.hostOn = f.host;
        if (seatChanged) this.spec = null; // 前の席の画面は、新しい席のものではない
        if (this.phase.k !== 'play' || !this.play) {
          this.enterPlay(code, f.you);
        } else {
          this.play.setYou(f.you);
          if (seatChanged) this.play.applySpec(this.joinedSpec(), true);
        }
        this.play?.setLost(false);
        this.play?.setHost(f.host);
        if (seatChanged) this.play?.toast(t('pad.seat.changed'));
        this.wake.refresh();
        return;
      }
      case 'pad':
        this.spec = f.spec;
        this.play?.applySpec(f.spec, this.fresh);
        this.fresh = false;
        return;
      case 'fx':
        this.vibrate(f.ms);
        this.play?.flash();
        return;
      case 'host':
        this.hostOn = f.on;
        this.play?.setHost(f.on);
        return;
      case 'kicked':
      case 'closed':
        // 閉じるコードより先に届く知らせ。閉じるコードが途中で失われても、ここで止まる。
        this.fatal(code, f.t);
        return;
      case 'err':
        // 理由は、続けて届く閉じるコード（error イベント）で扱う。
        return;
    }
  }

  private onState(_code: string, socket: RoomSocket<'pad'>, s: SocketState): void {
    if (socket !== this.socket) return;
    if (s === 'reconnecting' || s === 'connecting' || s === 'replaced') {
      // 切れた。次に届く画面は、同じ指定でも当て直す。
      this.fresh = true;
      if (s !== 'replaced' && this.phase.k === 'play') this.play?.setLost(true);
    }
  }

  private onError(code: string, socket: RoomSocket<'pad'>, e: RoomSocketError): void {
    if (socket !== this.socket || !e.fatal) return;
    this.fatal(code, e.code);
  }

  /** 自動では入り直さない終わり方。次の行動は、人が画面のボタンで選ぶ。 */
  private fatal(code: string, why: RoomSocketError['code']): void {
    switch (why) {
      case 'replaced':
        // 同じ札の別の接続に席を取られた。ここで入り直すと、複製したタブどうしが追い出し合い続ける。
        this.go({ k: 'replaced', code });
        return;
      case 'kicked':
        this.end(code, 'kicked');
        return;
      case 'closed':
        this.end(code, 'closed');
        return;
      case 'no-room':
        removeItem(this.deps.session, resumeKey(code));
        this.wake.release();
        this.toEntry(code, t('pad.entry.noRoom', { code }));
        return;
      case 'full':
      case 'locked':
        this.closeSocket();
        this.go({ k: 'refused', code, why, max: 0, sec: 0, afterJoin: true });
        return;
      case 'version':
        this.end(code, 'version');
        return;
      default:
        this.end(code, 'closed');
    }
  }

  private enterPlay(code: string, you: PlayerInfo): void {
    const spec = this.spec ?? this.joinedSpec();
    const play = new PlayView({
      you,
      spec,
      locale: getLocale(),
      strings: padUiStrings(),
      timers: this.timers,
      send: (i) => this.sendInput(i),
      onLeave: () => this.leave(code),
      onReconnectNow: () => this.socket?.reconnect(),
      matchMedia: this.deps.win.matchMedia ? (q) => this.deps.win.matchMedia(q) : undefined,
      vibrate: (pattern) => this.vibrate(pattern),
    });
    this.go({ k: 'play', code }, play);
  }

  /** 入ってすぐの画面（ホストが何も送っていない間）。 */
  private joinedSpec(): PadSpec {
    return { k: 'wait', title: t('pad.joined.title'), body: t('pad.joined.body') };
  }

  private sendInput(i: InputEvent): boolean {
    return this.socket?.send({ t: 'in', i }) ?? false;
  }

  private vibrate(ms: number[]): void {
    try {
      this.deps.vibrate?.(ms);
    } catch {
      // 振動できない端末
    }
  }

  // ---- 画面に戻ったとき ----

  private comeBack(): void {
    if (this.deps.doc.visibilityState !== 'visible') return;
    this.wake.refresh();
    const s = this.socket;
    if (!s) return;
    if (s.state === 'open') s.probe();
    // 入り直しの待ち時間の途中なら、待たずにすぐ入り直す。外された・閉じた・取って代わられたあとは、押されるまで何もしない。
    else if (s.state === 'reconnecting') s.reconnect();
  }

  // ---- 出る ----

  private leave(code: string): void {
    const s = this.socket;
    if (s && s.state === 'open') s.send({ t: 'bye' });
    this.end(code, 'left');
  }

  private end(code: string, why: Ending): void {
    this.closeSocket();
    if (why !== 'version') removeItem(this.deps.session, resumeKey(code));
    this.wake.release();
    this.spec = null;
    this.you = null;
    this.go({ k: 'ended', code, why });
  }

  // ---- 描く ----

  private go(phase: Phase, play?: PlayView): void {
    if (this.stopped) {
      play?.destroy();
      return;
    }
    this.phase = phase;
    if (phase.k !== 'connecting' && this.slowTimer !== null) {
      this.deps.clock.clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
    if (this.play && this.play !== play) {
      this.play.destroy();
      this.play = null;
    }
    if (play) {
      this.play = play;
      this.current = null;
      this.root.replaceChildren(play.el);
      return;
    }
    const screen = this.screen(phase);
    this.current = screen;
    this.root.replaceChildren(screen.el);
    screen.focus();
  }

  /**
   * ソフトキーボード：入力欄にいるあいだ、入力欄から主ボタンまでを見える範囲に残す。見える高さ（visualViewport）が
   * 変わったとき（キーボードが出た・閉じた）と、入力欄に入ったときに呼ぶ。入りきらないときは、入力欄を優先する。
   */
  private reveal(): void {
    const s = this.current;
    const doc = this.deps.doc;
    if (!s?.keep || !s.el.isConnected) return;
    const active = doc.activeElement;
    if (!(active instanceof HTMLInputElement) || !s.el.contains(active)) return;
    const box = s.el.getBoundingClientRect();
    const pad = 12;
    const last = s.keep.last.getBoundingClientRect();
    if (last.bottom > box.bottom - pad) s.el.scrollTop += last.bottom - (box.bottom - pad);
    const first = s.keep.first.getBoundingClientRect();
    if (first.top < box.top + pad) s.el.scrollTop -= box.top + pad - first.top;
  }

  /** 見えている高さと位置を CSS へ渡す（iOS はキーボードが出ても画面の高さを変えないため）。 */
  private syncViewport(): void {
    const vv = this.deps.win.visualViewport;
    const root = this.deps.doc.documentElement;
    if (!vv) return;
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
  }

  private screen(phase: Exclude<Phase, { k: 'play' }> | { k: 'play'; code: string }): Screen {
    switch (phase.k) {
      case 'entry':
        return entryScreen({ error: phase.error, prefill: phase.prefill, onSubmit: (code) => void this.check(code, false) });
      case 'checking':
        return checkingScreen(phase.code, () => this.toEntry('', null));
      case 'join':
        return joinScreen({
          code: phase.code,
          name: this.name,
          onJoin: (name) => this.join(phase.code, name),
          onChangeCode: () => this.toEntry('', null),
        });
      case 'connecting':
        return connectingScreen({
          code: phase.code,
          slow: phase.slow,
          onRetry: () => this.socket?.reconnect(),
          onCancel: () => {
            this.closeSocket();
            this.wake.release();
            this.go({ k: 'join', code: phase.code });
          },
        });
      case 'refused':
        return this.refusedScreen(phase);
      case 'replaced':
        return stateScreen({
          kind: 'replaced',
          icon: 'screens',
          title: t('pad.replaced.title'),
          body: t('pad.replaced.body'),
          actions: [
            { label: t('pad.act.continue'), kind: 'primary', act: 'continue', onClick: () => this.continueHere(phase.code) },
            { label: t('pad.act.reenter'), kind: 'ghost', act: 'reenter', onClick: () => this.toEntry('', null) },
          ],
        });
      case 'ended':
        return this.endedScreen(phase);
      case 'play':
        // 部屋の中の画面は PlayView が持つ。ここには来ない。
        return checkingScreen(phase.code, () => this.toEntry('', null));
    }
  }

  /** 取って代わられたあと、人が押したときだけ入り直す（向こうの画面が replaced になる）。 */
  private continueHere(code: string): void {
    const s = this.socket;
    if (!s) {
      this.connect(code);
      return;
    }
    this.go({ k: 'connecting', code, slow: false });
    this.wake.hold();
    s.reconnect();
  }

  private refusedScreen(p: Extract<Phase, { k: 'refused' }>): Screen {
    const wait = p.why === 'rate' || p.why === 'busy' ? p.sec : 0;
    const retry: Action = { label: t('pad.act.retry'), kind: 'primary', act: 'retry', onClick: () => void this.check(p.code, p.afterJoin), waitSec: wait };
    const reenter: Action = { label: t('pad.act.reenter'), kind: 'ghost', act: 'reenter', onClick: () => this.toEntry('', null) };
    const text = {
      full: { icon: 'people', title: t('pad.full.title'), body: t('pad.full.body', { max: p.max || LIMITS.MAX_PLAYERS }) },
      locked: { icon: 'lock', title: t('pad.locked.title'), body: t('pad.locked.body') },
      network: { icon: 'signal', title: t('pad.network.title'), body: t('pad.network.body') },
      rate: { icon: 'hourglass', title: t('pad.rate.title'), body: t('pad.rate.body', { sec: p.sec }) },
      busy: { icon: 'hourglass', title: t('pad.busy.title'), body: t('pad.busy.body', { sec: p.sec }) },
    } as const;
    const x = text[p.why];
    return stateScreen({ kind: p.why, icon: x.icon, title: x.title, body: x.body, actions: [retry, reenter], timers: this.timers });
  }

  private endedScreen(p: Extract<Phase, { k: 'ended' }>): Screen {
    const reenter: Action = { label: t('pad.act.reenter'), kind: 'ghost', act: 'reenter', onClick: () => this.toEntry('', null) };
    switch (p.why) {
      case 'kicked':
        // 外された人がすぐ戻れるボタンは置かない。大きな画面の人に声をかけてから、コードを入れ直す。
        return stateScreen({ kind: 'kicked', icon: 'userMinus', title: t('pad.kicked.title'), body: t('pad.kicked.body'), actions: [{ ...reenter, kind: 'primary' }] });
      case 'closed':
        return stateScreen({ kind: 'closed', icon: 'closed', title: t('pad.closed.title'), body: t('pad.closed.body'), actions: [{ ...reenter, kind: 'primary' }] });
      case 'left':
        // 自分で出たときは、行き先をボタンに書く（主＝同じ部屋、副＝別の部屋）。
        return stateScreen({
          kind: 'left',
          icon: 'door',
          title: t('pad.left.title'),
          body: t('pad.left.body'),
          actions: [
            { label: t('pad.left.rejoin'), kind: 'primary', act: 'rejoin', onClick: () => void this.check(p.code, true) },
            { ...reenter, label: t('pad.left.reenter') },
          ],
        });
      case 'version':
        return stateScreen({
          kind: 'version',
          icon: 'refresh',
          title: t('pad.version.title'),
          body: t('pad.version.body'),
          actions: [{ label: t('pad.act.reload'), kind: 'primary', act: 'reload', onClick: () => this.deps.win.location.reload() }],
        });
    }
  }
}
