// 画面の小さな絵。すべてここで描いた図形（24×24）。他社のロゴや記号は使わない（X・LINE も文字で示す）。
// 席の形（丸・四角・三角・ひし形・星・十字・六角形・輪）と紛らわしい形は、ここでは使わない。
import { svg } from '../shared/dom';

type Part = { d: string; stroke?: boolean; evenodd?: boolean; tone?: 'ember' | 'glow' | 'wood' };

const ICONS = {
  pad: [{ d: 'M6.5 7h3v3.5H13v3H9.5V17h-3v-3.5H3v-3h3.5Z M17 8a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z M19.5 12.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z' }],
  buzzer: [{ d: 'M4 16h16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z M6 15a6 6 0 0 1 12 0Z' }],
  choices: [{ d: 'M4 5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z M13 5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1Z M4 14a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z M13 14a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1Z' }],
  touch: [{ d: 'M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0-17Zm0 2.2a6.3 6.3 0 1 0 0 12.6a6.3 6.3 0 1 0 0-12.6Z M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z', evenodd: true }],
  tilt: [{ d: 'M5.85 6.79L13.36 4.05L18.15 17.21L10.64 19.95Z M7.59 8.07L11.15 17.84L16.41 15.93L12.85 6.16Z', evenodd: true }],
  wait: [{ d: 'M6 3h12v2.5c0 2.8-2.2 4.8-4.2 6.5c2 1.7 4.2 3.7 4.2 6.5V21H6v-2.5c0-2.8 2.2-4.8 4.2-6.5C8.2 10.3 6 8.3 6 5.5Z' }],
  soundOn: [{ d: 'M3 9h4l5-4v14l-5-4H3Z M15.6 8.4a5 5 0 0 1 0 7.2l-1.5-1.5a2.9 2.9 0 0 0 0-4.2Z M18.4 5.6a9 9 0 0 1 0 12.8l-1.5-1.5a6.9 6.9 0 0 0 0-9.8Z' }],
  soundOff: [{ d: 'M3 9h4l5-4v14l-5-4H3Z M15 9.4l1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1Z' }],
  lock: [{ d: 'M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z M9.4 10h5.2V8a2.6 2.6 0 0 0-5.2 0Z', evenodd: true }],
  unlock: [{ d: 'M5 11a1 1 0 0 1 1-1h8.6V8a2.6 2.6 0 0 0-5.1-.7L7.2 6.6A5 5 0 0 1 17 8v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z' }],
  share: [
    { d: 'M8.2 10.8l7.6-4.2 M8.2 13.2l7.6 4.2', stroke: true },
    { d: 'M18 2.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z M6 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z M18 15.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z' },
  ],
  people: [{ d: 'M9 11a4 4 0 1 1 0-8a4 4 0 1 1 0 8Z M2 20a7 7 0 0 1 14 0Z M17 10.5a3 3 0 1 1 0-6a3 3 0 1 1 0 6Z M17.8 12.6A6 6 0 0 1 23 18.5h-5.3a8.6 8.6 0 0 0-2.4-5.6a6 6 0 0 1 2.5-.3Z' }],
  crown: [{ d: 'M3.5 17.5L2 7.5l5.2 4.3L12 4.5l4.8 7.3L22 7.5l-1.5 10Z M3.5 19h17v2h-17Z' }],
  external: [{ d: 'M14 3h7v7h-2V6.4l-7.3 7.3-1.4-1.4L17.6 5H14Z M5 5h6v2H7v10h10v-4h2v6H5Z' }],
  post: [{ d: 'M4 17.2V20h2.8L17.6 9.2l-2.8-2.8Z M19.7 7.1a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.2 1.2 2.8 2.8Z' }],
  chat: [{ d: 'M12 3c5 0 9 3.3 9 7.4s-4 7.4-9 7.4c-.9 0-1.8-.1-2.6-.3L5 20l.9-4.1C4.1 14.6 3 12.6 3 10.4C3 6.3 7 3 12 3Z' }],
  copy: [{ d: 'M8 3h10a2 2 0 0 1 2 2v10h-2V5H8Z M4 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z' }],
  device: [{ d: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M7 4v14h10V4Z M11 19.2h2v1.3h-2Z', evenodd: true }],
  arrow: [{ d: 'M8.6 4.6L16 12l-7.4 7.4-1.6-1.6 5.8-5.8-5.8-5.8Z' }],
  info: [{ d: 'M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19Zm-1.2 8v7h2.4v-7Zm1.2-4.2a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3Z', evenodd: true }],
  plug: [{ d: 'M8 2h2v5H8Z M14 2h2v5h-2Z M6 8h12v3a6 6 0 0 1-5 5.9V22h-2v-5.1A6 6 0 0 1 6 11Z' }],
  door: [{ d: 'M6 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6Z M12.5 11a1 1 0 1 1 0 2a1 1 0 1 1 0-2Z M17 9h2l2 3-2 3h-2l1.6-2.2H17v-1.6h1.6Z', evenodd: true }],
  home: [{ d: 'M12 3.2l9 7.6-1.3 1.5-1.2-1V20a1 1 0 0 1-1 1h-4v-6h-3v6H6.5a1 1 0 0 1-1-1v-8.7l-1.2 1L3 10.8Z' }],
  qr: [{ d: 'M3 3h8v8H3Z M5 5v4h4V5Z M13 3h8v8h-8Z M15 5v4h4V5Z M3 13h8v8H3Z M5 15v4h4v-4Z M13 13h3v3h-3Z M18 13h3v3h-3Z M13 18h3v3h-3Z M18 18h3v3h-3Z M16 16h2v2h-2Z', evenodd: true }],
  // 注意の「!」。丸や三角は席の形と紛らわしいので、囲みを付けない。
  alert: [{ d: 'M10.4 3h3.2l-.5 12h-2.2Z M12 17.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z' }],
  // ライセンスとクレジット（文書の紙）。
  doc: [{ d: 'M6 2.8h8.4L19 7.4v13.8H6Z M14.2 3v4.6H19 M9 11.8h7 M9 15.2h7 M9 18.4h4.4', stroke: true }],
} satisfies Record<string, Part[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = 'icon'): SVGSVGElement {
  const el = svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', focusable: 'false', 'data-icon': name }) as SVGSVGElement;
  for (const p of ICONS[name] as Part[]) {
    el.append(
      p.stroke
        ? svg('path', { d: p.d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })
        : svg('path', { d: p.d, fill: 'currentColor', 'fill-rule': p.evenodd ? 'evenodd' : 'nonzero' }),
    );
  }
  return el;
}

let gradientSeq = 0;

/** 「irori」の火の印。炎（残り火の橙と光の色）と、その下の薪。 */
export function logoMark(cls = 'logo-mark'): SVGSVGElement {
  const id = `ember-${++gradientSeq}`;
  const el = svg('svg', { viewBox: '0 0 48 48', class: cls, 'aria-hidden': 'true', focusable: 'false' }) as SVGSVGElement;
  const grad = svg('linearGradient', { id, x1: 0, y1: 1, x2: 0, y2: 0 });
  grad.append(svg('stop', { offset: 0, 'stop-color': '#ff8a3d' }), svg('stop', { offset: 1, 'stop-color': '#ffb070' }));
  el.append(
    svg('defs', {}, grad),
    svg('path', { d: 'M24 4c3 7 11 11 11 21a11 11 0 0 1-22 0c0-5 3-8 5-11c.5 4 2.5 6 5 7c-2-6-1-12 1-17Z', fill: `url(#${id})` }),
    svg('path', { d: 'M24 20c2 4 5 6 5 10a5 5 0 0 1-10 0c0-3 2-5 3-7c.3 2 1 3 2 3.5c-.6-2.2-.4-4.3 0-6.5Z', fill: '#ffd9a0' }),
    svg('path', { d: 'M9 40.5l30-3.5a2.2 2.2 0 0 1 .5 4.4l-30 3.5a2.2 2.2 0 0 1-.5-4.4Z', fill: '#8a6448' }),
    svg('path', { d: 'M39 40.5l-30-3.5a2.2 2.2 0 0 0-.5 4.4l30 3.5a2.2 2.2 0 0 0 .5-4.4Z', fill: '#6e4f39' }),
  );
  return el;
}
