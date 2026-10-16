// DOMを組む小さな補助。apps/web の dom.ts と同じ考えの、この部品だけの版（部品は apps を読まない）。
// 文字は必ず Text ノードとして入れ、HTMLとして解釈しない。style 属性も書かない（CSPで止まるため、CSSOMを使う）。

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | undefined> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, String(v));
  return el;
}
