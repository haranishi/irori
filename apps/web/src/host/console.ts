// ホストの画面の司令塔。状態の変化は signal → render の1本の道で画面へ流す（ADR 0005）。
// 状態遷移は machine.ts、名簿は roster.ts、スマホへの画面は padplan.ts（どれも純粋な関数）で決め、ここは配線だけを持つ。
import { createGameStorage, GameFrame, parseDevParam, READY_TIMEOUT_MS } from '@irori/host-bridge';
import type { GameEndOptions, GamePadSpec, GameResult, HostEnvironment, PadSpec, PlayerId, PlayerInfo, ToHostFrame } from '@irori/protocol';
import { RoomSocket } from '@irori/room-client';
import { h } from '../shared/dom';
import { getLocale, t } from '../shared/i18n';
import { Sounds, type SoundName } from './audio';
import { devEntry, loadCatalog, type GameEntry } from './catalog';
import { keyAction, padHeld, PadRepeater, pickNext, remoteAction, type Action, type Dir } from './input';
import { frameSource, hostToConfirm, loadTrusted, saveTrusted } from './launch';
import { reconcile, resultName, seatLeft, startLineup, type Lineup } from './lineup';
import { INITIAL, inGame, next, padOwner, stateName, type Machine, type Signal } from './machine';
import { canonicalHref, publicOrigin, type PublicOrigin } from './origin';
import { expandTarget, planPads, type PadTexts } from './padplan';
import { PadSender } from './pads';
import { rankResults, type ResultRow } from './results';
import { applyFrame, EMPTY_ROSTER, fit, nextLeader, withLocked, type Roster } from './roster';
import { RoomLink, type HostSocket, type Welcome } from './session';
import { canNativeShare, copyText, nativeShare, shareLinks } from './share';
import { fitText, HomeView, soundHintText, type SoundHint, type SoundState } from './view-home';
import { confirmLayer, coverLayer, detailLayer, kickLayer, launchOverlay, menuLayer, resultsScreen, shareLayer, statusScreen, type MenuView } from './view-panels';
import { WakeKeeper } from './wake';

export interface ConsoleDeps {
  root: HTMLElement;
  win: Window;
  doc: Document;
  fetch: typeof fetch;
  session: Storage | null;
  local: Storage | null;
  origin: string;
  makeSocket?: (url: string, key: () => string) => HostSocket;
}

interface Running {
  game: GameEntry;
  /** このゲームの参加者（lineup.ts）。抜けた席は外れ、同じ番号に入った別の人は参加者にならない。 */
  lineup: Lineup;
  specs: Map<PlayerId, GamePadSpec>;
  frame: GameFrame | null;
  sentPlayers: string;
}

type Modal = { kind: 'share' } | { kind: 'kick'; p: PlayerId } | { kind: 'confirm'; host: string; game: GameEntry };

interface Busy {
  reason: 'daily' | 'rate';
  retryAt: number;
}

const SLOW_BOOT_MS = 8_000;

export class Console {
  private m: Machine = INITIAL;
  private roster: Roster = EMPTY_ROSTER;
  private games: GameEntry[] = [];
  private catalog: 'loading' | 'ok' | 'error' = 'loading';
  private selected = 0;
  private modal: Modal | null = null;
  private menuView: MenuView = 'main';
  private running: Running | null = null;
  private lastGame: GameEntry | null = null;
  private resultRows: ResultRow[] = [];
  private resultOptions: GameEndOptions | undefined;
  private environment: HostEnvironment;
  private busy: Busy | null = null;
  private stale = false;
  private joining = false;
  private slowBoot = false;
  private plan = new Map<PlayerId, PadSpec>();
  private readonly trusted: Set<string>;
  /** 部屋の案内（QR・手入力・共有）に出すオリジン。通信は d.origin のまま。 */
  private readonly where: PublicOrigin;
  private readonly focusMemo = new Map<string, string>();
  /**
   * 選びたいもの（既定の選択）がまだ無くて、仮にほかの部品へ置いた選択の場面。棚の一覧が部屋より遅く届くと、
   * ホームの輪は上の帯のボタンに仮に乗る。人が動かす前に棚が出たら、選択中のゲームのカードへ移す。
   */
  private fallbackFocus: string | null = null;
  private readonly repeater = new PadRepeater();
  private raf: number | null = null;
  private busyTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** 「待つ」を選んだあと、まだ始まらなければ、もう一度「応答がありません」を出すための時計。 */
  private patienceTimer: ReturnType<typeof setTimeout> | null = null;
  private seenSeats = new Set<PlayerId>();

  private readonly link: RoomLink;
  private readonly pads: PadSender;
  private readonly sounds = new Sounds();
  private readonly wake: WakeKeeper;
  private readonly home: HomeView;

  private readonly screenEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly stageFrame: HTMLElement;
  private readonly layersEl: HTMLElement;
  private readonly hintsEl: HTMLElement;
  private readonly liveEl: HTMLElement;
  private screenKey = '';
  private stageKey = '';

  constructor(private readonly d: ConsoleDeps) {
    this.environment = { connected: false, visible: d.doc.visibilityState === 'visible' };
    this.trusted = loadTrusted(d.session);
    this.where = publicOrigin({ origin: d.origin, hostname: new URL(d.origin).hostname }, canonicalHref(d.doc));
    this.link = new RoomLink({
      origin: d.origin,
      fetch: d.fetch,
      storage: d.session,
      doc: d.doc,
      win: d.win,
      makeSocket: d.makeSocket ?? ((url, key) => new RoomSocket({ role: 'host', url, key })),
      events: {
        welcome: (f) => this.onWelcome(f),
        frame: (f) => this.onFrame(f),
        lost: () => this.onLost(),
        replaced: () => {
          this.updateEnvironment(false);
          this.joining = false;
          this.signal('replaced');
        },
        closed: () => this.onClosed(),
        busy: (b) => this.onBusy(b.reason, b.retryAfterSec),
        offline: () => this.onLost(),
        version: () => {
          this.stale = true;
          this.render();
        },
      },
    });
    this.pads = new PadSender({ send: (f) => this.link.send(f) });
    this.wake = new WakeKeeper(d.win.navigator as never, d.doc);
    this.home = new HomeView({
      select: (i) => {
        if (this.selected === i) return;
        this.selected = i;
        this.render();
      },
      open: (i) => {
        this.selected = i;
        this.play('decide');
        this.signal('open');
      },
      toggleSound: (from) => this.toggleSound(from),
      toggleLock: () => this.toggleLock(),
      share: () => this.openShare(),
      retryCatalog: () => void this.loadGames(),
      kick: (p) => {
        this.modal = { kind: 'kick', p };
        this.render();
      },
    });

    const root = d.root;
    root.classList.add('host');
    this.screenEl = h('div', { class: 'screen-host' });
    this.stageFrame = h('div', { class: 'stage__frame' });
    this.stageEl = h('div', { class: 'stage', attrs: { hidden: true } }, this.stageFrame);
    this.layersEl = h('div', { class: 'layers' });
    this.hintsEl = h('div', { class: 'hints', attrs: { 'aria-live': 'polite' } });
    this.liveEl = h('div', { class: 'sr-only', attrs: { 'aria-live': 'polite', role: 'status' } });
    root.replaceChildren(this.screenEl, this.stageEl, this.layersEl, this.hintsEl, this.liveEl);

    d.win.addEventListener('keydown', this.onKey);
    d.win.addEventListener('pointerdown', this.onGesture, { capture: true });
    d.win.addEventListener('gamepadconnected', this.startPads);
    d.win.addEventListener('offline', this.onOffline);
    d.doc.addEventListener('focusin', this.onFocusIn);
    d.doc.addEventListener('visibilitychange', this.onVisibility);
    this.sounds.onChange(() => this.render());
  }

  start(): void {
    this.signal('start');
    setTimeout(() => {
      this.slowBoot = true;
      if (this.m.phase === 'connecting') this.render();
    }, SLOW_BOOT_MS);
    void this.loadGames();
    void this.link.open();
  }

  // ---- 部屋 ----

  private onWelcome(f: Welcome): void {
    this.joining = false;
    const prevLeader = this.roster.leader ?? this.link.storedLeader;
    this.roster = applyFrame({ ...this.roster, leader: prevLeader }, f);
    // ゲームの途中でつなぎ直したとき、切れていたあいだに抜けた参加者を外す（left は届いていないため）。
    const run = this.running;
    if (run) run.lineup = reconcile(run.lineup, this.roster.players);
    this.seenSeats = new Set(this.roster.players.map((p) => p.id));
    this.pads.reset();
    this.busy = null;
    this.stopBusyTimer();
    this.link.rememberLeader(this.roster.leader);
    // 同じ名簿でも復帰の通知を先に渡す。接続が戻ったとき、ゲームが古い参加席で進まないため。
    this.syncGamePlayers(true);
    this.updateEnvironment(true);
    this.signal('welcome');
  }

  private onLost(): void {
    this.updateEnvironment(false);
    this.signal('lost');
  }

  private readonly onVisibility = (): void => this.updateEnvironment(this.environment.connected);
  private readonly onOffline = (): void => this.updateEnvironment(false);

  /** 描画を待たずに各変化を渡す。切断→復帰が続いても、途中のfalseを落とさない。 */
  private updateEnvironment(connected: boolean): void {
    const environment = { connected, visible: this.d.doc.visibilityState === 'visible' };
    if (environment.connected === this.environment.connected && environment.visible === this.environment.visible) return;
    this.environment = environment;
    this.running?.frame?.post({ m: 'environment', environment });
  }

  private onFrame(f: Exclude<ToHostFrame, { t: 'welcome' }>): void {
    switch (f.t) {
      case 'joined':
      case 'left':
      case 'online': {
        const before = this.roster;
        this.roster = applyFrame(this.roster, f);
        if (f.t === 'joined' && !this.seenSeats.has(f.p.id)) {
          this.seenSeats.add(f.p.id);
          this.play('join');
          this.announce(t('host.live.joined', { name: f.p.name }));
        }
        if (f.t === 'left') {
          this.seenSeats.delete(f.p);
          this.pads.forget(f.p);
          const gone = before.players.find((p) => p.id === f.p);
          if (gone) this.announce(t('host.live.left', { name: gone.name }));
          // ゲームの途中で空いた席は、このゲームの参加者から外す。同じ番号に次に入る人は、次のゲームから。
          const run = this.running;
          if (run) {
            run.lineup = seatLeft(run.lineup, f.p, gone?.name);
            run.specs.delete(f.p);
          }
          if (this.modal?.kind === 'kick' && this.modal.p === f.p) this.modal = null;
        }
        this.link.rememberLeader(this.roster.leader);
        this.render();
        return;
      }
      case 'pad?': {
        const spec = this.plan.get(f.p);
        if (spec) this.pads.resend(f.p, spec);
        return;
      }
      case 'in':
        this.onInput(f.p, f.i, f.T);
        return;
      case 'err':
        // 形式や速さの違反の知らせ（致命的なものは閉じるコードで来る）。画面には出さない。
        return;
    }
  }

  private onInput(p: PlayerId, i: Extract<ToHostFrame, { t: 'in' }>['i'], T: number): void {
    const run = this.running;
    if (i.k === 'menu') {
      if (this.m.phase === 'playing' && run?.lineup.seats.has(p) && this.m.cover === null) this.pause();
      return;
    }
    const owner = padOwner(this.m);
    if (owner === 'console') {
      if (p !== this.roster.leader) return;
      const a = remoteAction(i);
      if (a) this.act(a);
      return;
    }
    if (owner === 'game' && run?.frame && run.lineup.seats.has(p)) run.frame.post({ m: 'input', p, i, T });
  }

  private onClosed(): void {
    this.updateEnvironment(false);
    this.destroyFrame();
    this.running = null;
    this.roster = EMPTY_ROSTER;
    this.modal = null;
    this.signal('closed');
  }

  private onBusy(reason: 'daily' | 'rate', retryAfterSec: number): void {
    this.busy = { reason, retryAt: Date.now() + retryAfterSec * 1000 };
    this.signal('busy');
    this.waitAndRetry();
  }

  private retryRoom(): void {
    this.stopBusyTimer();
    this.busy = null;
    this.signal('retry');
    void this.link.create();
  }

  private stopBusyTimer(): void {
    if (this.busyTimer !== null) clearInterval(this.busyTimer);
    this.busyTimer = null;
  }

  /** 目安の時刻まで待ち、来たら自動で作り直す。待つあいだ、画面の目安を1秒ごとに更新する。 */
  private waitAndRetry(): void {
    const b = this.busy;
    if (!b) return;
    if (Date.now() >= b.retryAt) {
      this.retryRoom();
      return;
    }
    this.stopBusyTimer();
    this.busyTimer = setInterval(() => {
      if (!this.busy) return this.stopBusyTimer();
      if (Date.now() >= this.busy.retryAt) this.retryRoom();
      else this.render();
    }, 1000);
    this.render();
  }

  // ---- 棚 ----

  private async loadGames(): Promise<void> {
    this.catalog = 'loading';
    this.render();
    const dev = parseDevParam(this.d.win.location);
    try {
      const list = await loadCatalog(this.d.fetch, getLocale());
      this.games = dev ? [devEntry(dev), ...list.filter((g) => g.id !== 'dev')] : list;
      this.catalog = 'ok';
    } catch {
      this.games = dev ? [devEntry(dev)] : [];
      this.catalog = this.games.length > 0 ? 'ok' : 'error';
    }
    this.selected = Math.min(this.selected, Math.max(0, this.games.length - 1));
    this.render();
  }

  private get game(): GameEntry | undefined {
    return this.games[this.selected];
  }

  // ---- ゲーム ----

  private requestStart(): void {
    const g = this.game;
    if (!g || !fit(g.players, this.roster.players.length).ok) return;
    const src = frameSource(g, this.d.origin);
    const host = src.ok ? hostToConfirm(src.source, this.trusted) : null;
    if (host) {
      this.modal = { kind: 'confirm', host, game: g };
      this.render();
      return;
    }
    this.launch(g);
  }

  private launch(g: GameEntry): void {
    this.destroyFrame();
    this.modal = null;
    const players = this.roster.players;
    this.running = {
      game: g,
      lineup: startLineup(players),
      specs: new Map(),
      frame: null,
      sentPlayers: '',
    };
    this.lastGame = g;
    this.resultRows = [];
    this.resultOptions = undefined;
    this.signal('launch');
    const src = frameSource(g, this.d.origin);
    if (!src.ok) {
      this.signal('failed');
      return;
    }
    const init = { players: this.gamePlayers(), leader: this.gameLeader(), locale: getLocale(), paused: false, environment: this.environment };
    const storage = this.gameStorage(g.id);
    const frame = new GameFrame({ container: this.stageFrame, source: src.source, init, title: g.title, ...(storage ? { storage } : {}) });
    const run = this.running;
    run.frame = frame;
    run.sentPlayers = JSON.stringify([init.players, init.leader]);
    frame.on('ready', () => {
      if (this.running !== run) return;
      this.clearPatience();
      this.play('start');
      this.signal('ready');
    });
    frame.on('setPad', ({ to, spec }) => {
      if (this.running !== run) return;
      for (const p of expandTarget(to, run.lineup.seats)) run.specs.set(p, spec);
      this.render();
    });
    frame.on('vibrate', ({ to, ms }) => {
      if (this.running !== run) return;
      const online = new Set(this.roster.players.filter((p) => p.online).map((p) => p.id));
      this.pads.vibrate(
        expandTarget(to, run.lineup.seats).filter((p) => online.has(p)),
        ms,
      );
    });
    frame.on('end', ({ results, options }) => {
      if (this.running === run) this.endGame(results, options);
    });
    frame.on('timeout', () => {
      if (this.running === run) this.signal('slow');
    });
    frame.on('error', () => {
      if (this.running !== run) return;
      run.frame = null;
      this.signal('failed');
    });
    frame.start();
    frame.element?.setAttribute('tabindex', '-1');
  }

  private gameStorage(id: string) {
    try {
      return this.d.local ? createGameStorage(id, this.d.local) : undefined;
    } catch {
      return undefined;
    }
  }

  private gamePlayers(): PlayerInfo[] {
    const run = this.running;
    return run ? this.roster.players.filter((p) => run.lineup.seats.has(p.id)) : [];
  }

  /** ゲームに渡すリーダー。コンソールのリーダーが参加者でなければ、参加者の中で選び直す。 */
  private gameLeader(): PlayerId | null {
    const run = this.running;
    const l = this.roster.leader;
    if (run && l !== null && run.lineup.seats.has(l)) return l;
    return nextLeader(this.gamePlayers(), null);
  }

  private endGame(results: GameResult[], options?: GameEndOptions): void {
    const run = this.running;
    if (!run) return;
    // 元の参加者は、元の名前で載る。途中で空いた席に入った別の人の名前は使わない（lineup.ts）。
    this.resultRows = rankResults(results, (p) => resultName(run.lineup, this.roster.players, p, t('host.results.player', { n: p })), options);
    this.resultOptions = options;
    this.destroyFrame();
    this.running = null;
    this.play('result');
    this.signal('end');
  }

  /** 「待つ」：もう少し待つ。それでも始まらなければ、同じ時間のあとにまた選べるようにする（詰まらないため）。 */
  private wait(): void {
    this.signal('patience');
    this.clearPatience();
    const run = this.running;
    this.patienceTimer = setTimeout(() => {
      this.patienceTimer = null;
      if (this.running === run && this.m.phase === 'launching' && this.m.issue === 'none') this.signal('slow');
    }, READY_TIMEOUT_MS);
  }

  private clearPatience(): void {
    if (this.patienceTimer !== null) clearTimeout(this.patienceTimer);
    this.patienceTimer = null;
  }

  private pause(): void {
    if (this.m.phase !== 'playing') return;
    this.running?.frame?.post({ m: 'pause' });
    this.menuView = 'main';
    this.play('back');
    this.signal('pause');
  }

  private resume(): void {
    if (this.m.phase !== 'paused') return;
    this.running?.frame?.post({ m: 'resume' });
    this.modal = null;
    this.play('decide');
    this.signal('continue');
  }

  private goHome(): void {
    this.destroyFrame();
    this.running = null;
    this.resultOptions = undefined;
    this.modal = null;
    this.play('back');
    this.signal('home');
  }

  private again(): void {
    const g = this.lastGame;
    if (!g) return;
    const f = fit(g.players, this.roster.players.length);
    if (!f.ok) {
      this.toast(fitText(f) ?? '');
      return;
    }
    this.play('decide');
    this.launch(g);
  }

  private destroyFrame(): void {
    this.clearPatience();
    this.running?.frame?.destroy();
    if (this.running) this.running.frame = null;
    this.stageFrame.replaceChildren();
  }

  // ---- 設定・共有 ----

  /**
   * 音のオン・オフ。from＝押したときに見えていた状態。「音：クリックで開始」（locked）を押したときは、
   * 切り替えずに鳴らし始める（押す操作そのものが、ブラウザの求める最初の操作になる）。
   */
  private toggleSound(from?: SoundState): void {
    if (from === 'locked') this.sounds.setOn(true);
    else this.sounds.setOn(!this.sounds.on);
    if (this.sounds.on) {
      this.sounds.unlock();
      this.play('decide');
    }
    this.toast(this.sounds.on ? t('host.tool.soundOn') : t('host.tool.soundOff'));
    this.render();
  }

  private toggleLock(): void {
    const on = !this.roster.locked;
    if (!this.link.send({ t: 'lock', on })) return;
    this.roster = withLocked(this.roster, on);
    this.play('decide');
    this.render();
  }

  private kick(p: PlayerId): void {
    const who = this.roster.players.find((x) => x.id === p);
    this.modal = null;
    if (who && this.link.send({ t: 'kick', p })) this.toast(t('host.kick.done', { name: who.name }));
    this.render();
  }

  private openShare(): void {
    this.modal = { kind: 'share' };
    this.play('decide');
    this.render();
  }

  private async copyLink(): Promise<void> {
    const links = shareLinks(this.where.origin, t('host.share.text'));
    const nav = this.d.win.navigator as Navigator & { clipboard?: Clipboard };
    const ok = await copyText(links.url, { clipboard: nav.clipboard, document: this.d.doc });
    this.toast(ok ? t('host.share.copied') : t('host.share.copyFailed'));
  }

  // ---- 操作 ----

  private readonly onGesture = (): void => {
    this.sounds.unlock();
    void this.wake.acquire();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    this.onGesture();
    const a = keyAction(e);
    if (!a) return;
    e.preventDefault();
    if (e.repeat && (a === 'ok' || a === 'back' || a === 'mute')) return;
    this.act(a);
  };

  private readonly startPads = (): void => {
    if (this.raf === null) this.raf = this.d.win.requestAnimationFrame(this.pollPads);
  };

  private readonly pollPads = (now: number): void => {
    const list = this.d.win.navigator.getGamepads?.() ?? [];
    const held = new Set<Action>();
    let any = false;
    for (const g of list) {
      if (!g?.connected) continue;
      any = true;
      for (const a of padHeld(g)) held.add(a);
    }
    for (const a of this.repeater.step(held, now)) this.act(a);
    this.raf = any ? this.d.win.requestAnimationFrame(this.pollPads) : null;
  };

  /** 3つの入口（キー・パッド・リモコン）から来た操作を、いまの画面に当てる。 */
  private act(a: Action): void {
    if (a === 'mute') {
      this.toggleSound();
      return;
    }
    const covered = this.m.cover !== null || this.stale;
    if (!covered && this.m.phase === 'playing') {
      if (a === 'back') this.pause();
      return;
    }
    if (a === 'ok') this.pressFocused();
    else if (a === 'back') {
      if (!covered) this.back();
    } else this.move(a);
  }

  private back(): void {
    const m = this.modal;
    if (m) {
      this.modal = null;
      this.play('back');
      this.render();
      return;
    }
    switch (this.m.phase) {
      case 'detail':
        this.play('back');
        this.signal('back');
        return;
      case 'paused':
        if (this.menuView !== 'main') {
          this.menuView = 'main';
          this.play('back');
          this.render();
        } else this.resume();
        return;
      case 'launching':
        // 読み込みの最中でも、やめてホームへ戻れる（ゲームが応答しないときに詰まらないため）。
        this.goHome();
        return;
      case 'results':
        this.goHome();
        return;
      default:
        return;
    }
  }

  private activeScope(): { el: HTMLElement; key: string } {
    const layers = this.layersEl.querySelectorAll<HTMLElement>('[data-layer]');
    const top = layers[layers.length - 1];
    if (top) return { el: top, key: `layer:${top.dataset.layer ?? ''}` };
    if (!this.stageEl.hidden && this.stageEl.querySelector('[data-nav]')) return { el: this.stageEl, key: `stage:${this.m.issue}` };
    return { el: this.screenEl, key: `screen:${this.screenKey.split('|')[0] ?? ''}` };
  }

  private focusables(scope: HTMLElement): HTMLElement[] {
    return [...scope.querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
  }

  private move(dir: Dir): void {
    const scope = this.activeScope();
    const items = this.focusables(scope.el);
    const cur = items.find((el) => el.dataset.focused !== undefined);
    if (!cur) {
      const first = items[0];
      if (first) this.setFocus(scope.key, first);
      return;
    }
    const target = this.jump(scope.key, items, cur, dir) ?? this.nearest(items, cur, dir) ?? this.wrap(scope.key, items, dir);
    if (target) {
      this.setFocus(scope.key, target, true);
      this.play('move');
    }
  }

  /** 決まった道。ホームの上の並び（音・締め切り・共有…）から下へは、棚の選択中のゲームのカードへ（参加者の札へ飛ばさない）。 */
  private jump(scopeKey: string, items: HTMLElement[], cur: HTMLElement, dir: Dir): HTMLElement | undefined {
    if (scopeKey !== 'screen:home' || dir !== 'down' || !cur.closest('.home__top')) return undefined;
    const game = this.game;
    return game ? items.find((el) => el.dataset.nav === `game:${game.id}`) : undefined;
  }

  /** 画面の上で、その向きにいちばん近いもの。 */
  private nearest(items: HTMLElement[], cur: HTMLElement, dir: Dir): HTMLElement | undefined {
    const rect = (el: HTMLElement) => el.getBoundingClientRect();
    const id = pickNext(
      rect(cur),
      items.filter((el) => el !== cur).map((el) => ({ id: el.dataset.nav ?? '', box: rect(el) })),
      dir,
    );
    return id ? items.find((el) => el.dataset.nav === id) : undefined;
  }

  /** 一時停止のメニューは、上下で一周する（いちばん上で「上」なら、いちばん下へ）。 */
  private wrap(scopeKey: string, items: HTMLElement[], dir: Dir): HTMLElement | undefined {
    if (scopeKey !== 'layer:menu' || (dir !== 'up' && dir !== 'down')) return undefined;
    return dir === 'up' ? items.at(-1) : items[0];
  }

  private pressFocused(): void {
    const scope = this.activeScope();
    const el = this.focusables(scope.el).find((x) => x.dataset.focused !== undefined);
    el?.click();
  }

  /** scroll は、人が動かしたときだけ真にする（開いたときの自動の選択で、画面をずらさない）。 */
  private setFocus(scopeKey: string, el: HTMLElement, scroll = false): void {
    if (scroll) this.fallbackFocus = null;
    for (const old of this.d.root.querySelectorAll<HTMLElement>('[data-focused]')) if (old !== el) delete old.dataset.focused;
    el.dataset.focused = '';
    if (el.dataset.nav) this.focusMemo.set(scopeKey, el.dataset.nav);
    if (this.d.doc.activeElement !== el) el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  private readonly onFocusIn = (e: FocusEvent): void => {
    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-nav]') : null;
    if (!el || el.dataset.focused !== undefined || !this.d.root.contains(el)) return;
    const scope = this.activeScope();
    if (!scope.el.contains(el)) return;
    // マウスやTabで人が選んだもの。仮の選択ではない。
    this.fallbackFocus = null;
    this.setFocus(scope.key, el);
  };

  private defaultFocus(scopeKey: string): string | null {
    switch (scopeKey) {
      case 'screen:home':
        return this.game ? `game:${this.game.id}` : null;
      case 'screen:results':
        return 'results:again';
      case 'layer:detail':
        return 'detail:start';
      case 'layer:confirm':
        return 'confirm:cancel';
      case 'layer:kick':
        return 'kick:cancel';
      case 'layer:menu':
        return this.menuView === 'main' ? 'menu:continue' : null;
      case 'stage:slow':
        return 'launch:wait';
      case 'stage:failed':
        return 'launch:home';
      default:
        return null;
    }
  }

  private ensureFocus(): void {
    const scope = this.activeScope();
    const items = this.focusables(scope.el);
    if (items.length === 0) return;
    // 仮に置いた選択は、選びたいものが出てきたら、そちらへ移す（人が動かしたあとは動かさない）。
    if (this.fallbackFocus === scope.key) {
      const want = this.defaultFocus(scope.key);
      const el = want === null ? undefined : items.find((x) => x.dataset.nav === want);
      if (el) {
        this.fallbackFocus = null;
        this.setFocus(scope.key, el);
        return;
      }
    }
    // マウスで押したものは、そのまま選択にする（印の付いた古いほうへ戻さない）。
    const active = this.d.doc.activeElement;
    if (active instanceof HTMLElement && items.includes(active)) {
      if (active.dataset.focused === undefined) this.setFocus(scope.key, active);
      return;
    }
    const current = items.find((el) => el.dataset.focused !== undefined);
    if (current) {
      if (this.d.doc.activeElement !== current) current.focus({ preventScroll: true });
      return;
    }
    const want = this.focusMemo.get(scope.key) ?? this.defaultFocus(scope.key);
    const wanted = items.find((x) => x.dataset.nav === want);
    const el = wanted ?? items[0];
    if (!el) return;
    this.setFocus(scope.key, el);
    this.fallbackFocus = wanted ? null : scope.key;
  }

  // ---- 描画 ----

  private signal(s: Signal): void {
    const before = this.m;
    this.m = next(this.m, s);
    if (before.phase !== this.m.phase) {
      // 開いた画面は、毎回はじめの選択から。ホームの棚の位置だけは覚えておく。重ねた板は、画面が変われば閉じる。
      for (const k of [...this.focusMemo.keys()]) if (k !== 'screen:home') this.focusMemo.delete(k);
      this.modal = null;
    }
    this.render();
  }

  private padTexts(): PadTexts {
    return {
      remoteHint: t('host.pad.remoteHint'),
      choosing: (name) => t('host.pad.choosing', { name }),
      choosingBody: t('host.pad.choosingBody'),
      lateTitle: t('host.pad.lateTitle'),
      lateBody: t('host.pad.lateBody'),
      starting: t('host.pad.starting'),
      menu: t('host.pad.menu'),
      waiting: t('host.pad.waiting'),
    };
  }

  private render(): void {
    const root = this.d.root;
    const name = this.stale ? 'closed' : stateName(this.m);
    root.dataset.state = name;
    root.dataset.phase = this.m.phase;
    root.dataset.issue = this.m.issue;
    root.dataset.code = this.link.code ?? '';
    root.dataset.players = String(this.roster.players.length);
    root.dataset.leader = this.roster.leader === null ? '' : String(this.roster.leader);
    root.dataset.locked = String(this.roster.locked);
    root.dataset.sound = String(this.sounds.on);
    root.dataset.modal = this.modal?.kind ?? (this.m.phase === 'paused' ? 'menu' : '');
    root.dataset.catalog = this.catalog;

    this.renderScreen();
    this.renderStage();
    this.renderLayers();
    this.renderHints();
    this.ensureFocus();
    this.syncPads();
    this.syncGamePlayers();
    this.wake.want(this.link.code !== null && this.m.phase !== 'busy' && this.m.phase !== 'closed');
  }

  private renderScreen(): void {
    const p = this.m.phase;
    let key: string;
    let build: () => HTMLElement;
    if (p === 'boot' || p === 'connecting') {
      key = `connecting|${this.slowBoot}`;
      build = () => statusScreen('connecting', { slow: this.slowBoot }, this.statusHandlers());
    } else if (p === 'busy') {
      const b = this.busy;
      const busy = { reason: b?.reason ?? 'daily', eta: etaText(b ? b.retryAt - Date.now() : 0) } as const;
      key = `busy|${JSON.stringify(busy)}`;
      build = () => statusScreen('busy', { busy }, this.statusHandlers());
    } else if (p === 'closed') {
      key = 'closed';
      build = () => statusScreen('closed', {}, this.statusHandlers());
    } else if (p === 'home' || p === 'detail') {
      key = 'home';
      build = () => this.home.el;
    } else if (p === 'results') {
      key = `results|${JSON.stringify(this.resultRows)}|${JSON.stringify(this.resultOptions)}|${this.lastGame?.id ?? ''}`;
      build = () =>
        resultsScreen(this.lastGame, this.resultRows, {
          again: () => this.again(),
          home: () => this.goHome(),
          share: () => this.openShare(),
        }, this.resultOptions);
    } else {
      key = 'stage';
      build = () => h('div', { class: 'screen screen--empty' });
    }
    if (key !== this.screenKey) {
      this.screenKey = key;
      this.screenEl.replaceChildren(build());
    }
    if (key === 'home') {
      this.home.update({
        games: this.games,
        catalog: this.catalog,
        selected: this.selected,
        roster: this.roster,
        code: this.link.code,
        origin: this.where.origin,
        loopback: this.where.loopback,
        sound: this.soundState(),
        soundHint: this.soundHint(),
      });
    }
  }

  private statusHandlers() {
    return { now: () => this.retryRoom(), fresh: () => this.retryRoom() };
  }

  private renderStage(): void {
    const show = inGame(this.m);
    this.stageEl.hidden = !show;
    const g = this.running?.game ?? this.lastGame;
    const key = show && this.m.phase === 'launching' && g ? `${g.id}|${this.m.issue}` : '';
    if (key === this.stageKey) return;
    this.stageKey = key;
    this.stageEl.querySelector('.launch')?.remove();
    if (key && g) {
      this.stageEl.append(
        launchOverlay(g, this.m.issue, {
          hints: { menu: t('host.play.menuHint'), sound: this.soundHintNow() },
          wait: () => this.wait(),
          home: () => this.goHome(),
          retry: () => {
            const again = this.lastGame;
            if (again) this.launch(again);
          },
        }),
      );
    }
  }

  private renderLayers(): void {
    const want: { key: string; build: () => HTMLElement }[] = [];
    const g = this.game;
    const count = this.roster.players.length;
    if (this.m.phase === 'detail' && g) {
      const f = fit(g.players, count);
      want.push({
        key: `detail|${g.id}|${JSON.stringify(f)}`,
        build: () =>
          detailLayer(g, f, {
            start: () => {
              this.play('decide');
              this.requestStart();
            },
            back: () => {
              this.play('back');
              this.signal('back');
            },
          }),
      });
    }
    const modal = this.modal;
    if (modal?.kind === 'confirm' && this.m.phase === 'detail') {
      want.push({
        key: `confirm|${modal.host}`,
        build: () =>
          confirmLayer(modal.host, {
            ok: () => {
              this.trusted.add(modal.host);
              saveTrusted(this.d.session, this.trusted);
              this.launch(modal.game);
            },
            cancel: () => {
              this.modal = null;
              this.play('back');
              this.render();
            },
          }),
      });
    }
    if (this.m.phase === 'paused') {
      const view = this.menuView;
      want.push({
        key: `menu|${view}|${this.soundState()}|${this.roster.locked}|${JSON.stringify(this.roster.players)}|${this.link.code ?? ''}`,
        build: () =>
          menuLayer(
            {
              view,
              game: this.running?.game ?? null,
              sound: this.soundState(),
              locked: this.roster.locked,
              players: this.roster.players,
              code: this.link.code,
              origin: this.where.origin,
              loopback: this.where.loopback,
              full: this.roster.players.length >= this.roster.max ? { n: this.roster.players.length, max: this.roster.max } : null,
            },
            {
              resume: () => this.resume(),
              home: () => this.goHome(),
              sound: () => this.toggleSound(),
              lock: () => this.toggleLock(),
              view: (v) => {
                this.menuView = v;
                this.focusMemo.delete('layer:menu');
                this.play(v === 'main' ? 'back' : 'decide');
                this.render();
              },
              kick: (p) => {
                this.modal = { kind: 'kick', p };
                this.render();
              },
            },
          ),
      });
    }
    if (modal?.kind === 'share') {
      const links = shareLinks(this.where.origin, t('host.share.text'));
      const nav = this.d.win.navigator as Navigator;
      const native = canNativeShare(nav);
      want.push({
        key: `share|${native}`,
        build: () =>
          shareLayer(links, native, {
            native: () => void nativeShare(nav, { title: 'irori', text: t('host.share.text'), url: links.url }),
            copy: () => void this.copyLink(),
            close: () => {
              this.modal = null;
              this.play('back');
              this.render();
            },
          }),
      });
    }
    if (modal?.kind === 'kick') {
      const p = this.roster.players.find((x) => x.id === modal.p);
      if (p) {
        want.push({
          key: `kick|${p.id}|${p.name}`,
          build: () =>
            kickLayer(p, {
              ok: () => this.kick(p.id),
              cancel: () => {
                this.modal = null;
                this.play('back');
                this.render();
              },
            }),
        });
      }
    }
    const cover = this.stale ? 'version' : this.m.cover;
    if (cover) {
      want.push({
        key: `cover|${cover}|${this.joining}`,
        build: () =>
          coverLayer(
            cover,
            {
              act: () => {
                if (cover === 'version') this.d.win.location.reload();
                else {
                  if (cover === 'replaced') this.joining = true;
                  this.link.reconnect();
                  this.render();
                }
              },
            },
            cover === 'replaced' && this.joining,
          ),
      });
    }
    const have = [...this.layersEl.children] as HTMLElement[];
    let i = 0;
    while (i < want.length && i < have.length && have[i]?.dataset.key === want[i]?.key) i++;
    for (const el of have.slice(i)) el.remove();
    for (const w of want.slice(i)) {
      const el = w.build();
      el.dataset.key = w.key;
      this.layersEl.append(el);
    }
    this.d.root.dataset.layers = String(want.length);
  }

  private renderHints(): void {
    // ゲームの最中は、ゲームの画面に案内を重ねない（得点や回数の札、問題文を隠すため）。重ねてよいのは、短い知らせ（toast）と
    // 一時停止の覆いだけ。メニューの開き方と音の案内は、詳細の窓（操作）と、開始前の覆い（launching）に出す。
    const items: HTMLElement[] = [];
    const key = items.map((el) => `${el.dataset.hint}:${el.textContent}`).join(',');
    if (this.hintsEl.dataset.key === key) return;
    this.hintsEl.dataset.key = key;
    const toast = this.hintsEl.querySelector('.toast');
    this.hintsEl.replaceChildren(...items, ...(toast ? [toast] : []));
  }

  private toast(text: string): void {
    if (!text) return;
    this.hintsEl.querySelector('.toast')?.remove();
    const el = h('p', { class: 'hint toast', attrs: { role: 'status' } }, text);
    this.hintsEl.append(el);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.remove(), 2600);
  }

  private announce(text: string): void {
    this.liveEl.textContent = text;
  }

  private play(name: SoundName): void {
    this.sounds.play(name);
  }

  /** 音の状態。オンでも、ブラウザが最初の操作を待っているあいだは locked（上の帯で「クリックかキーで音が出る」と知らせる）。 */
  private soundState(): SoundState {
    if (!this.sounds.on) return 'off';
    return this.sounds.needsGesture ? 'locked' : 'on';
  }

  /** 開始前の覆いに出す音の案内（まだ鳴らないときだけ）。 */
  private soundHintNow(): string | null {
    const hint = this.soundHint();
    return hint ? soundHintText(hint) : null;
  }

  /** 音の案内が要るか。狭い画面・指で触る画面には「タップ」の文を出す。 */
  private soundHint(): SoundHint {
    if (!this.sounds.needsGesture) return null;
    const touch = this.d.win.matchMedia?.('(max-width: 700px), (pointer: coarse)').matches === true;
    return touch ? 'touch' : 'click';
  }

  private syncPads(): void {
    const owner = this.link.socketState === 'open' ? padOwner(this.m) : 'none';
    this.plan = planPads({
      owner,
      players: this.roster.players,
      leader: this.roster.leader,
      participants: this.running?.lineup.seats ?? null,
      gameSpecs: this.running?.specs ?? new Map(),
      text: this.padTexts(),
      paused: this.m.phase === 'paused',
    });
    this.pads.sync(this.plan, new Set(this.roster.players.filter((p) => p.online).map((p) => p.id)));
  }

  private syncGamePlayers(force = false): void {
    const run = this.running;
    if (!run?.frame) return;
    const players = this.gamePlayers();
    const leader = this.gameLeader();
    const json = JSON.stringify([players, leader]);
    if (!force && json === run.sentPlayers) return;
    run.sentPlayers = json;
    run.frame.post({ m: 'players', players, leader });
  }
}

/** 待ち時間の目安。2分未満は秒、90分未満は分、それより長ければ時間で出す（「約301分」と出さない）。 */
function etaText(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 120) return t('host.eta.sec', { n: sec });
  const min = Math.ceil(sec / 60);
  if (min < 90) return t('host.eta.min', { n: min });
  return t('host.eta.hour', { n: Math.round(min / 60) });
}
