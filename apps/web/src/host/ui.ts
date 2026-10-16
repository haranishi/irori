// 画面の部品の小さな組み立て。文字は必ず Text ノードとして入れる（innerHTML は使わない）。
// スマホやゲームから来た文字列（名前・ラベル）は nameEl を通して描く。
import { look, shapeSvg } from '@irori/pad-ui';
import type { PlayerId } from '@irori/protocol';
import { h, type Child } from '../shared/dom';
import { getLocale, t } from '../shared/i18n';
import { phrase } from '../shared/phrase';
import { icon, type IconName } from './icons';

/** 名前を描く。スマホから来た文字列なので、HTMLとして解釈させない。 */
export function nameEl(name: string, cls = 'name'): HTMLElement {
  return h('span', { class: cls }, name);
}

/** この画面が持つ文言を、文節のあいだでだけ折り返す形にする（shared/phrase.ts）。 */
export function tx(text: string): Node[] {
  return phrase(text);
}

/**
 * 2文以上の短い説明（窓・エラー・詳細の本文）。文ごとに1つの塊にして、行は文の切れ目で替わるようにする。
 * 1文が1行に収まらないときだけ、その文の中で文節の切れ目で折る（「入れたくない／ときは」のような折れ方を避ける）。
 */
export function sentences(text: string): Node[] {
  const parts = text.match(/[^。！？]+[。！？]?/gu) ?? [text];
  const out: Node[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(document.createElement('wbr'));
    const span = document.createElement('span');
    span.className = 'sentence';
    span.append(...phrase(part));
    out.push(span);
  });
  return out;
}

/**
 * 名前（スマホから来た文字列）を挟む文言。名前は文節に分けず、折らずに textContent で入れ、前後の文言だけを文節で折る。
 * 文言の {name} の位置に名前を置く。
 */
export function withName(key: string, name: string): Node[] {
  const marker = '\u0000';
  const [before = '', after = ''] = t(key, { name: marker }).split(marker);
  return [...phrase(before), nameEl(name, 'name pp-nw'), ...phrase(after)];
}

/** 席の印（色と形）。色だけに頼らないよう、形と、読み上げの名前を必ず付ける。 */
export function seatMark(id: PlayerId, size = 24, cls = 'seat-mark'): HTMLElement {
  const l = look(id, getLocale());
  const el = h('span', { class: cls, attrs: { role: 'img', 'aria-label': l.label }, data: { seat: String(id), shape: l.shape } });
  el.append(shapeSvg(l.shape, size, l.color));
  return el;
}

export function seatLabel(id: PlayerId): string {
  return look(id, getLocale()).label;
}

export interface ButtonOptions {
  nav: string;
  kind?: 'primary' | 'quiet' | 'ghost';
  iconName?: IconName;
  disabled?: boolean;
  action?: string;
  onPress: () => void;
  describedBy?: string;
  extraClass?: string;
}

/** 押せる部品。data-nav が、キーボード・ゲームパッド・リモコンで動かせる印。 */
export function button(label: Child, o: ButtonOptions): HTMLButtonElement {
  const cls = ['btn', `btn--${o.kind ?? 'quiet'}`, o.extraClass].filter(Boolean).join(' ');
  const el = h(
    'button',
    {
      class: cls,
      attrs: { type: 'button', disabled: o.disabled === true, 'aria-describedby': o.describedBy },
      data: { nav: o.nav, ...(o.action ? { action: o.action } : {}) },
      on: { click: () => o.onPress() },
    },
    o.iconName ? icon(o.iconName) : null,
    typeof label === 'string' ? h('span', { class: 'btn__label' }, label) : label,
  );
  return el;
}

/** 新しいタブで開くリンク。外へ出る道なので、参照元を渡さない。 */
export function link(label: string, href: string, nav: string, cls = 'link'): HTMLAnchorElement {
  return h(
    'a',
    { class: cls, attrs: { href, target: '_blank', rel: 'noopener noreferrer' }, data: { nav } },
    h('span', { class: 'link__label' }, label),
    icon('external', 'icon icon--small'),
  );
}

let idSeq = 0;
export function uid(prefix: string): string {
  return `${prefix}-${++idSeq}`;
}

/** 前面に出す板（ダイアログ）。読み上げに見出しを渡す。見出しは文節で折る（名前を挟むときは withName の結果を渡す）。 */
export function dialog(layer: string, title: string | Node[], body: Child[], cls = '', lead: Child = null): HTMLElement {
  const titleId = uid('dlg');
  return h(
    'div',
    { class: `layer layer--${layer}`, data: { layer } },
    h(
      'section',
      { class: `dialog ${cls}`.trim(), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
      lead,
      h('h2', { class: 'dialog__title', id: titleId }, ...(typeof title === 'string' ? tx(title) : title)),
      ...body,
    ),
  );
}
