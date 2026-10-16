// 部屋に入る前と、出たあとの画面。どれも1つの見出しと、次の行動のボタンを持つ。
// 文字は Text ノードとして入れる（phrase も同じ）。ゲームやスマホから来た文字列を HTML として解釈しない。
import { LIMITS } from '@irori/protocol';
import { h, type Child } from '../shared/dom';
import { t } from '../shared/i18n';
import { codeInput, type CodeInput } from './code-input';
import { flameMark, icon, type IconName } from './icons';
import type { Timers } from './long-press';
import { clauses, phrase } from './phrase';
import { clipName } from './room';

export interface Screen {
  el: HTMLElement;
  /** 画面を出したあとに、最初に触る場所へ移る。 */
  focus(): void;
  /** ソフトキーボードが出ても見える範囲に残すもの（入力欄から主ボタンまで）。入力のない画面は持たない。 */
  keep?: { first: HTMLElement; last: HTMLElement };
}

export interface Action {
  label: string;
  kind: 'primary' | 'ghost';
  act: string;
  onClick: () => void;
  /** この秒数のあいだ押せない。残りの秒数をボタンに出し、0 になったら押せるようにする。 */
  waitSec?: number;
}

function brand(): HTMLElement {
  return h('div', { class: 'pp-brand' }, flameMark(30), h('span', { class: 'pp-brand__word' }, t('pad.brand')));
}

function heading(text: string): HTMLHeadingElement {
  return h('h1', { class: 'pp-h1', attrs: { tabindex: -1 } }, ...phrase(text));
}

function para(cls: string, text: string, attrs?: Record<string, string>): HTMLParagraphElement {
  return h('p', { class: cls, ...(attrs ? { attrs } : {}) }, ...clauses(text));
}

function button(a: Action, timers?: Timers): HTMLButtonElement {
  const el = h(
    'button',
    { class: `pp-btn pp-btn--${a.kind}`, attrs: { type: 'button' }, data: { act: a.act }, on: { click: () => a.onClick() } },
    a.label,
  );
  if (a.waitSec && a.waitSec > 0 && timers) countdown(el, a, a.waitSec, timers);
  return el;
}

/** 待つあいだは押せない見た目にし、「あと◯秒」を1秒ずつ減らす。画面が替わったら止まる。 */
function countdown(el: HTMLButtonElement, a: Action, sec: number, timers: Timers): void {
  let left = Math.ceil(sec);
  const show = () => {
    if (left > 0) {
      el.disabled = true;
      el.textContent = t('pad.act.retryIn', { sec: left });
    } else {
      el.disabled = false;
      el.textContent = a.label;
    }
  };
  const tick = () => {
    if (!el.isConnected) return; // 画面が替わった
    left--;
    show();
    if (left > 0) timers.setTimeout(tick, 1_000);
  };
  show();
  timers.setTimeout(tick, 1_000);
}

function shell(kind: string, ...children: Child[]): HTMLElement {
  return h('main', { class: `pp-screen pp-screen--${kind}`, data: { screen: kind } }, h('div', { class: 'pp-wrap' }, ...children));
}

// ---- コードの入力 ----

export function entryScreen(o: { error: string | null; prefill: string; onSubmit: (code: string) => void }): Screen {
  const title = heading(t('pad.entry.title'));
  // 枠の下の場所：ふだんはコードの在りかの一文、誤りのときは知らせ。高さは知らせのぶんを先に取る（出ても画面が跳ばない）。
  const hint = para('pp-hint', t('pad.entry.lead'));
  const msg = h('p', { class: 'pp-msg', attrs: { role: 'alert' } });
  const say = (text: string | null) => {
    msg.replaceChildren(...(text ? [icon('alert', 22), h('span', null, ...clauses(text))] : []));
    hint.hidden = text !== null;
    if (text) delete msg.dataset.empty;
    else msg.dataset.empty = '';
  };
  const submit = h('button', { class: 'pp-btn pp-btn--primary', attrs: { type: 'button' }, data: { act: 'find' } }, t('pad.entry.submit'));
  // 出したときのコードから打ち直したら、前の誤りの知らせは消す。
  let ready = false;
  let shownFor = '';
  const input: CodeInput = codeInput({
    prefill: o.prefill,
    onComplete: (code) => o.onSubmit(code),
    onBadChar: () => say(t('pad.entry.badChar')),
    onChange: (v) => {
      submit.disabled = v.length !== LIMITS.CODE_LENGTH;
      if (ready && v !== shownFor) {
        shownFor = v;
        say(null);
        input.setError(null);
      }
    },
  });
  shownFor = input.value();
  ready = true;
  submit.addEventListener('click', () => {
    const v = input.value();
    if (v.length === LIMITS.CODE_LENGTH) o.onSubmit(v);
  });
  say(o.error);
  input.setError(o.error);
  const el = shell(
    'entry',
    h('div', { class: 'pp-intro' }, brand(), title),
    h('div', { class: 'pp-panel' }, input.el, h('div', { class: 'pp-slot' }, hint, msg), submit),
  );
  // 誤りがあるときは、先に知らせを読ませる（枠に入ると、キーボードが知らせを隠す端末がある）。
  return { el, focus: () => (o.error ? title.focus() : input.focus()), keep: { first: input.el, last: submit } };
}

export function checkingScreen(code: string, onCancel: () => void): Screen {
  const title = heading(t('pad.checking'));
  const el = shell(
    'checking',
    h('div', { class: 'pp-intro pp-intro--center' }, h('div', { class: 'pp-ember', attrs: { 'aria-hidden': 'true' } }, flameMark(56)), title, roomChip(code)),
    h('div', { class: 'pp-actions' }, button({ label: t('pad.connecting.cancel'), kind: 'ghost', act: 'cancel', onClick: onCancel })),
  );
  return { el, focus: () => title.focus() };
}

function roomChip(code: string, change?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'pp-room' },
    h('span', { class: 'pp-room__label' }, t('pad.join.room')),
    h('span', { class: 'pp-room__code', attrs: { translate: 'no' } }, code),
    change ? h('button', { class: 'pp-link', attrs: { type: 'button' }, data: { act: 'change' }, on: { click: () => change() } }, t('pad.join.change')) : null,
  );
}

// ---- 参加 ----

export function joinScreen(o: { code: string; name: string; onJoin: (name: string) => void; onChangeCode: () => void }): Screen {
  const title = heading(t('pad.join.title'));
  const field = h('input', {
    class: 'pp-input',
    id: 'pp-name',
    attrs: {
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      // 見本の文字は、キーボードが出て欄の上の見出しを隠したときだけ見せる（CSS）。
      placeholder: t('pad.join.nameLabel'),
      'aria-describedby': 'pp-name-empty pp-privacy',
    },
  });
  field.value = clipName(o.name);
  // 名前の欄のすぐ下の一文：空なら「空のままなら…」、入れたら「大きな画面には、この名前で出ます。」。場所は残す（右の列が動かない）。
  const empty = para('pp-note pp-note--field', t('pad.join.empty'), { id: 'pp-name-empty' });
  let named: boolean | null = null;
  const sync = () => {
    const clipped = clipName(field.value);
    if (clipped !== field.value) field.value = clipped;
    const now = field.value.trim() !== '';
    if (now === named) return;
    named = now;
    empty.replaceChildren(...clauses(t(now ? 'pad.join.named' : 'pad.join.empty')));
    if (now) empty.dataset.named = '';
    else delete empty.dataset.named;
  };
  field.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) sync();
  });
  field.addEventListener('compositionend', sync);
  sync();
  const join = h('button', { class: 'pp-btn pp-btn--primary pp-btn--join', attrs: { type: 'button' }, data: { act: 'join' } }, t('pad.join.submit'));
  let sent = false;
  const go = () => {
    // 連打しても、参加は1回だけ。
    if (sent) return;
    sent = true;
    join.disabled = true;
    o.onJoin(field.value);
  };
  join.addEventListener('click', go);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      go();
    }
  });
  const el = shell(
    'join',
    h('div', { class: 'pp-intro' }, brand(), title, roomChip(o.code, o.onChangeCode)),
    h(
      'div',
      { class: 'pp-panel' },
      h('label', { class: 'pp-field', attrs: { for: 'pp-name' } }, h('span', { class: 'pp-label' }, t('pad.join.nameLabel'))),
      field,
      empty,
      h('p', { class: 'pp-privacy', id: 'pp-privacy' }, icon('shield', 22), h('span', null, ...clauses(t('pad.join.privacy')))),
      join,
    ),
  );
  return { el, focus: () => title.focus(), keep: { first: field, last: join } };
}

// ---- つないでいる ----

export function connectingScreen(o: { code: string; slow: boolean; onRetry: () => void; onCancel: () => void }): Screen {
  const title = heading(t('pad.connecting.title'));
  const actions: Action[] = [];
  if (o.slow) actions.push({ label: t('pad.connecting.retry'), kind: 'primary', act: 'retry', onClick: o.onRetry });
  actions.push({ label: t('pad.connecting.cancel'), kind: 'ghost', act: 'cancel', onClick: o.onCancel });
  const el = shell(
    'connecting',
    h(
      'div',
      { class: 'pp-intro pp-intro--center' },
      h('div', { class: 'pp-ember', attrs: { 'aria-hidden': 'true' } }, flameMark(64)),
      title,
      // 部屋は、確かめている間と同じ札で見せる（見出しの「つないでいます」を本文で繰り返さない）。
      roomChip(o.code),
      o.slow ? para('pp-note', t('pad.connecting.slow'), { role: 'status' }) : null,
    ),
    h('div', { class: 'pp-actions' }, ...actions.map((a) => button(a))),
  );
  return { el, focus: () => title.focus() };
}

// ---- 結果（断られた・外された・閉じた・出た・取って代わられた） ----

export function stateScreen(o: { kind: string; icon: IconName; title: string; body: string; actions: Action[]; timers?: Timers }): Screen {
  const title = heading(o.title);
  const el = shell(
    'state',
    h(
      'div',
      { class: 'pp-intro pp-intro--center' },
      h('div', { class: 'pp-state-icon', attrs: { 'aria-hidden': 'true' } }, icon(o.icon, 40)),
      title,
      para('pp-lead', o.body),
    ),
    h('div', { class: 'pp-actions' }, ...o.actions.map((a) => button(a, o.timers))),
  );
  el.dataset.state = o.kind;
  return { el, focus: () => title.focus() };
}
