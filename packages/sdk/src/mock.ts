// 単体で開いたときの仮想プレイヤー（docs/sdk.md「動かしながら作る」）。通信なしで、1台で複数人を操作する。
// 画面脇のパネルに席ごとの pad-ui を出し、1人目は WASD・Space・E、2人目は矢印・Enter・Shift でも動かせる。
import { HELD_REPEAT_MS, LIMITS, STORAGE_LIMITS, utf8Length } from '@irori/protocol';
import type { GamePadSpec, GameResult, GameToHost, HostToGame, InputEvent, PlayerId, PlayerInfo } from '@irori/protocol';
import { look, mountPad, PAD_STRINGS_EN, PAD_STRINGS_JA, shapeSvg } from '@irori/pad-ui';
import type { PadHandle } from '@irori/pad-ui';
import padCss from '@irori/pad-ui/pad.css?inline';
import { IroriCore } from './core';
import mockCss from './mock.css?inline';

const TEXT = {
  ja: {
    banner: '開発モード（仮想プレイヤー）',
    close: '閉じる',
    title: '仮想プレイヤー',
    fold: 'たたむ',
    unfold: 'ひらく',
    pause: '一時停止',
    resume: '再開',
    drop: '切断する',
    join: 'つなぐ',
    keys: '1人目: WASD・Space・E　2人目: 矢印・Enter・Shift',
    results: '結果',
    again: 'もう一度',
    player: (n: number) => `プレイヤー${n}`,
  },
  en: {
    banner: 'Development mode (virtual players)',
    close: 'Close',
    title: 'Virtual players',
    fold: 'Fold',
    unfold: 'Open',
    pause: 'Pause',
    resume: 'Resume',
    drop: 'Disconnect',
    join: 'Connect',
    keys: 'P1: WASD, Space, E — P2: arrows, Enter, Shift',
    results: 'Results',
    again: 'Play again',
    player: (n: number) => `Player ${n}`,
  },
};

type Dir = 'up' | 'down' | 'left' | 'right';
type Btn = 'a' | 'b';
const KEYS: Record<string, [number, Dir | Btn]> = {
  KeyW: [0, 'up'],
  KeyS: [0, 'down'],
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  Space: [0, 'a'],
  KeyE: [0, 'b'],
  ArrowUp: [1, 'up'],
  ArrowDown: [1, 'down'],
  ArrowLeft: [1, 'left'],
  ArrowRight: [1, 'right'],
  Enter: [1, 'a'],
  NumpadEnter: [1, 'a'],
  ShiftLeft: [1, 'b'],
  ShiftRight: [1, 'b'],
};
/** 傾きを矢印キーで真似るときの角度。 */
const TILT_DEG = 30;

interface Seat {
  info: PlayerInfo;
  spec: GamePadSpec;
  pad: PadHandle;
  card: HTMLElement;
  box: HTMLElement;
  dirs: Set<Dir>;
  held: Map<Btn, string>;
  /** キーで最後に送った向き（axis か tilt）。中立なら null。 */
  aim: { k: 'axis' | 'tilt'; id: string; x: number; y: number } | null;
  /** 方向キーを押したままのあいだの送り直し（実機の pad-ui と同じ規則。tilt には使わない）。 */
  repeat: ReturnType<typeof setTimeout> | undefined;
  cursor: number;
  picked: boolean;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> | null, ...kids: (Node | string | null)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
  for (const c of kids) if (c !== null) el.append(c);
  return el;
}

export function mockPlayerCount(search: string, fallback?: number): number {
  const q = new URLSearchParams(search).get('mock');
  const n = q === null ? Number.NaN : Number.parseInt(q, 10);
  const v = Number.isFinite(n) ? n : (fallback ?? 2);
  return Math.min(LIMITS.MAX_PLAYERS, Math.max(1, Math.trunc(v) || 1));
}

export function createMock(win: Window, opts: { mockPlayers?: number | undefined } = {}): IroriCore {
  const doc = win.document;
  const locale = (win.navigator?.language ?? 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  const tx = TEXT[locale];
  const count = mockPlayerCount(win.location.search, opts.mockPlayers);
  const seats: Seat[] = [];
  const infos: PlayerInfo[] = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: tx.player(i + 1), online: true }));

  const input = (p: PlayerId, i: InputEvent) => core.receive({ m: 'input', p, i, T: Date.now() });
  const leader = () => seats.find((s) => s.info.online)?.info.id ?? null;
  const targets = (to: PlayerId | '*') => seats.filter((s) => to === '*' || s.info.id === to);

  const style = doc.createElement('style');
  style.textContent = padCss + mockCss;
  (doc.head ?? doc.documentElement).append(style);

  const root = h('div', { class: 'irori-mock', lang: locale });
  const close = h('button', { type: 'button', class: 'irori-mock__btn', 'aria-label': tx.close }, '×');
  const banner = h('div', { class: 'irori-mock__banner', role: 'status' }, h('span', null, tx.banner), close);
  close.addEventListener('click', () => banner.remove());
  const pause = h('button', { type: 'button', class: 'irori-mock__btn irori-mock__pause' }, tx.pause);
  const fold = h('button', { type: 'button', class: 'irori-mock__btn irori-mock__fold', 'aria-expanded': 'true' }, tx.fold);
  const panel = h(
    'aside',
    { class: 'irori-mock__panel', 'aria-label': tx.title },
    h('div', { class: 'irori-mock__head' }, h('h2', null, tx.title), pause, fold),
    h('p', { class: 'irori-mock__keys' }, tx.keys),
  );
  fold.addEventListener('click', () => {
    const folded = panel.toggleAttribute('data-folded');
    fold.textContent = folded ? tx.unfold : tx.fold;
    fold.setAttribute('aria-expanded', String(!folded));
  });
  pause.addEventListener('click', () => {
    core.receive({ m: core.paused ? 'resume' : 'pause' });
    pause.textContent = core.paused ? tx.resume : tx.pause;
  });
  root.append(banner, panel);

  /** 送ったばかりの向きを起点に、送り直しを数え直す。中立や tilt なら止める。 */
  const holdRepeat = (s: Seat) => {
    if (s.repeat !== undefined) clearTimeout(s.repeat);
    s.repeat = undefined;
    const a = s.aim;
    if (!a || a.k !== 'axis' || (a.x === 0 && a.y === 0)) return;
    s.repeat = setTimeout(() => {
      s.repeat = undefined;
      if (s.aim !== a) return;
      input(s.info.id, { k: 'axis', id: a.id, x: a.x, y: a.y });
      holdRepeat(s);
    }, HELD_REPEAT_MS);
  };

  const releaseKeys = (s: Seat) => {
    for (const id of s.held.values()) input(s.info.id, { k: 'btn', id, d: 0 });
    s.held.clear();
    if (s.aim && (s.aim.x !== 0 || s.aim.y !== 0)) {
      input(s.info.id, s.aim.k === 'axis' ? { k: 'axis', id: s.aim.id, x: 0, y: 0 } : { k: 'tilt', a: 0, b: 0, g: 0 });
    }
    s.aim = null;
    holdRepeat(s);
    s.dirs.clear();
  };

  const steer = (s: Seat) => {
    const x = (s.dirs.has('right') ? 1 : 0) - (s.dirs.has('left') ? 1 : 0);
    const y = (s.dirs.has('down') ? 1 : 0) - (s.dirs.has('up') ? 1 : 0);
    const spec = s.spec;
    let next: Seat['aim'] = null;
    if (spec.k === 'pad' && spec.stick !== 'none') {
      const id = spec.stick === 'stick' ? 'stick' : 'dpad';
      // スティックの斜めは、円の中に収める。
      const n = id === 'stick' && x !== 0 && y !== 0 ? Math.round(Math.SQRT1_2 * 100) / 100 : 1;
      next = { k: 'axis', id, x: x * n || 0, y: y * n || 0 };
    } else if (spec.k === 'tilt') {
      next = { k: 'tilt', id: 'tilt', x: x * TILT_DEG, y: y * TILT_DEG };
    } else {
      return;
    }
    const prev = s.aim ?? { x: 0, y: 0 };
    if (prev.x === next.x && prev.y === next.y) return;
    s.aim = next;
    input(s.info.id, next.k === 'axis' ? { k: 'axis', id: next.id, x: next.x, y: next.y } : { k: 'tilt', a: 0, b: next.y, g: next.x });
    holdRepeat(s);
  };

  const markCursor = (s: Seat) => {
    for (const el of s.box.querySelectorAll('[data-cursor]')) el.removeAttribute('data-cursor');
    if (s.spec.k !== 'choices') return;
    // id は検査で英小文字・数字・_- に限っているので、そのままセレクタに使える。
    const id = s.spec.options[s.cursor]?.id;
    if (id) s.box.querySelector(`[data-id="${id}"]`)?.setAttribute('data-cursor', '');
  };

  const press = (s: Seat, key: Btn) => {
    const spec = s.spec;
    if (spec.k === 'choices') {
      const o = spec.options[s.cursor];
      if (key === 'a' && o && !spec.disabled && !s.picked) {
        s.picked = true;
        input(s.info.id, { k: 'pick', id: o.id });
      }
      return;
    }
    let id: string | undefined;
    if (spec.k === 'pad' || spec.k === 'tilt') id = spec.buttons?.[key === 'a' ? 0 : 1]?.id;
    else if (spec.k === 'buzzer' && !spec.disabled) id = 'buzzer';
    if (!id || s.held.has(key)) return;
    s.held.set(key, id);
    input(s.info.id, { k: 'btn', id, d: 1 });
  };

  const release = (s: Seat, key: Btn) => {
    const id = s.held.get(key);
    if (id === undefined) return;
    s.held.delete(key);
    input(s.info.id, { k: 'btn', id, d: 0 });
  };

  const onKey = (e: KeyboardEvent) => {
    const hit = KEYS[e.code];
    if (!hit) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const s = seats[hit[0]];
    if (!s || !s.info.online) return;
    // 押したキーで、パネルのボタンが押されたりページが流れたりしないように。
    e.preventDefault();
    const key = hit[1];
    const down = e.type === 'keydown';
    if (key === 'a' || key === 'b') {
      if (!down) release(s, key);
      else if (!e.repeat) press(s, key);
      return;
    }
    if (down) {
      if (e.repeat) return;
      s.dirs.add(key);
      if (s.spec.k === 'choices') {
        const n = s.spec.options.length;
        s.cursor = (s.cursor + (key === 'up' || key === 'left' ? n - 1 : 1)) % n;
        markCursor(s);
      }
    } else {
      s.dirs.delete(key);
    }
    steer(s);
  };
  win.addEventListener('keydown', onKey);
  win.addEventListener('keyup', onKey);
  win.addEventListener('blur', () => seats.forEach(releaseKeys));

  const buzz = (s: Seat, ms: number[]) => {
    s.card.dataset.buzz = '';
    setTimeout(() => delete s.card.dataset.buzz, Math.min(1000, ms.reduce((a, b) => a + b, 0)));
  };

  const prefix = `irori-mock:${win.location.pathname}:`;
  const store = (msg: Extract<GameToHost, { m: 'store.get' | 'store.set' }>): HostToGame => {
    const res = (value: string | null, error?: string): HostToGame =>
      error ? { m: 'store.res', id: msg.id, value, error } : { m: 'store.res', id: msg.id, value };
    try {
      const ls = win.localStorage;
      if (msg.m === 'store.get') return res(ls.getItem(prefix + msg.key));
      let total = 0;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k?.startsWith(prefix)) total += utf8Length(k.slice(prefix.length)) + utf8Length(ls.getItem(k) ?? '');
      }
      const old = ls.getItem(prefix + msg.key);
      const before = old === null ? 0 : utf8Length(msg.key) + utf8Length(old);
      if (total - before + utf8Length(msg.key) + utf8Length(msg.value) > STORAGE_LIMITS.TOTAL_MAX_BYTES) return res(null, 'quota');
      ls.setItem(prefix + msg.key, msg.value);
      return res(null);
    } catch {
      return res(null, 'unavailable');
    }
  };

  const showResults = (results: GameResult[]) => {
    root.querySelector('.irori-mock__results')?.remove();
    const sorted = [...results].sort((a, b) => b.score - a.score);
    const list = h('ol', null);
    sorted.forEach((r) => {
      // 同点は同じ順位にする。
      const rank = sorted.findIndex((o) => o.score === r.score) + 1;
      const l = look(r.p, locale);
      const name = seats.find((s) => s.info.id === r.p)?.info.name ?? tx.player(r.p);
      list.append(
        h(
          'li',
          { 'data-p': String(r.p), 'data-rank': String(rank) },
          h('span', { class: 'irori-mock__rank' }, String(rank)),
          shapeSvg(l.shape, 20, l.color),
          h('span', null, name),
          h('span', { class: 'irori-mock__score' }, r.label ? `${r.score}（${r.label}）` : String(r.score)),
        ),
      );
    });
    const again = h('button', { type: 'button', class: 'irori-mock__btn irori-mock__again' }, tx.again);
    again.addEventListener('click', () => win.location.reload());
    root.append(
      h(
        'div',
        { class: 'irori-mock__results', role: 'dialog', 'aria-modal': 'true', 'aria-label': tx.results },
        h('div', { class: 'irori-mock__card' }, h('h2', null, tx.results), list, again),
      ),
    );
    again.focus();
  };

  const core: IroriCore = new IroriCore(
    'mock',
    { players: infos, leader: 1, paused: false, locale },
    {
      send(msg) {
        switch (msg.m) {
          case 'setPad':
            for (const s of targets(msg.to)) {
              releaseKeys(s);
              s.spec = msg.spec;
              s.cursor = 0;
              s.picked = false;
              s.pad.setSpec(msg.spec);
              markCursor(s);
            }
            return;
          case 'vibrate':
            for (const s of targets(msg.to)) buzz(s, msg.ms);
            return;
          case 'end':
            showResults(msg.results ?? []);
            return;
          case 'ready':
            root.dataset.ready = '';
            return;
          default: {
            // 本物のホストと同じく、保存の答えは非同期で返す。
            const answer = store(msg);
            queueMicrotask(() => core.receive(answer));
          }
        }
      },
    },
  );

  for (const info of infos) {
    const l = look(info.id, locale);
    const box = h('div', { class: 'irori-mock__pad' });
    const toggle = h('button', { type: 'button', class: 'irori-mock__btn irori-mock__online' }, tx.drop);
    const card = h(
      'section',
      { class: 'irori-mock__seat', 'data-p': String(info.id), 'aria-label': `${info.name}（${l.label}）` },
      h('div', { class: 'irori-mock__who' }, shapeSvg(l.shape, 20, l.color), h('span', { class: 'irori-mock__name' }, info.name), toggle),
      box,
    );
    card.style.setProperty('--seat', l.color);
    const pad = mountPad(box, { send: (i) => input(info.id, i), strings: locale === 'ja' ? PAD_STRINGS_JA : PAD_STRINGS_EN });
    const seat: Seat = { info, spec: { k: 'wait' }, pad, card, box, dirs: new Set(), held: new Map(), aim: null, repeat: undefined, cursor: 0, picked: false };
    toggle.addEventListener('click', () => {
      releaseKeys(seat);
      seat.pad.releaseAll();
      seat.info = { ...seat.info, online: !seat.info.online };
      card.toggleAttribute('data-offline', !seat.info.online);
      toggle.textContent = seat.info.online ? tx.drop : tx.join;
      core.receive({ m: 'players', players: seats.map((s) => s.info), leader: leader() });
    });
    seats.push(seat);
    panel.append(card);
  }
  (doc.body ?? doc.documentElement).append(root);
  return core;
}
