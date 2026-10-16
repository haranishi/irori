// DOMを組む小さな補助（ADR 0005）。文字列は必ず textContent として入れ、HTMLとして解釈しない。

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  data?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

function apply(el: Element, props: Props | null | undefined): void {
  if (!props) return;
  if (props.class) el.setAttribute('class', props.class);
  if (props.id) el.id = props.id;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, v] of Object.entries(props.data ?? {})) (el as HTMLElement).dataset[k] = v;
  if (props.style) Object.assign((el as HTMLElement).style, props.style);
  for (const [k, fn] of Object.entries(props.on ?? {})) {
    el.addEventListener(k, fn as EventListener);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 席の形やアイコンをSVGで描くための補助。属性の値は文字列として入れる。 */
export function svg(tag: string, attrs?: Record<string, string | number>, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}
