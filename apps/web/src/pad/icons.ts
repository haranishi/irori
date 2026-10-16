// 画面の小さな絵。すべてこの場で描いた線の形で、外部の素材は使わない。読み上げからは外す（意味は文字で伝える）。
import { svg } from '../shared/dom';

const LINES = {
  door: ['M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 16l-4-4 4-4', 'M6 12h9'],
  closed: ['M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17', 'M3.5 21h17', 'M14.5 12.5h.01'],
  lock: ['M7 11h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3', 'M12 15v2'],
  people: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3.5 19.5a5.5 5.5 0 0 1 11 0', 'M16 5.3a3 3 0 0 1 0 5.4', 'M17.6 13.7a5.5 5.5 0 0 1 2.9 5.8'],
  unlink: ['M9 7H7a5 5 0 0 0 0 10h2', 'M15 7h2a5 5 0 0 1 2.4 9.4', 'M8 12h2', 'M3 3l18 18'],
  screens: ['M5 3.5h7a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z', 'M16.5 6.5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4', 'M8.5 17.5h.01'],
  signal: ['M4.5 12.5a10.5 10.5 0 0 1 15 0', 'M8 16a5.6 5.6 0 0 1 8 0', 'M12 19.5h.01', 'M3 3l18 18'],
  refresh: ['M20 11.5A8 8 0 1 1 17.7 6', 'M20.5 3.5V9h-5.5'],
  userMinus: ['M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M3 20.5a7 7 0 0 1 14 0', 'M16.5 10.5h5'],
  monitor: ['M4 4.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z', 'M9 20.5h6', 'M12 16.5v4'],
  rotate: ['M6.5 3.5h5a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z', 'M15.5 5.5a6.5 6.5 0 0 1 4.5 6', 'M20.5 9.2l-.5 2.6-2.4-1.1'],
  hourglass: ['M7 3.5h10', 'M7 20.5h10', 'M8 3.5c0 4 8 5 8 8.5s-8 4.5-8 8.5', 'M16 3.5c0 4-8 5-8 8.5s8 4.5 8 8.5'],
  dots: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  pause: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M10 9v6', 'M14 9v6'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  shield: ['M12 3l7 3v5.5c0 4.3-3 7.8-7 9-4-1.2-7-4.7-7-9V6z', 'M12 9v4', 'M12 16h.01'],
  alert: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5v6', 'M12 16.5h.01'],
} as const;

export type IconName = keyof typeof LINES;

export function icon(name: IconName, size = 24): SVGSVGElement {
  const el = svg('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': name === 'dots' ? 3.2 : 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'pp-icon',
    'aria-hidden': 'true',
    focusable: 'false',
  }) as SVGSVGElement;
  for (const d of LINES[name]) el.append(svg('path', { d }));
  return el;
}

/** 囲炉裏の火の印。外の炎は火の色、内は光の色で塗る。 */
export function flameMark(size = 28): SVGSVGElement {
  const el = svg('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    class: 'pp-flame',
    'aria-hidden': 'true',
    focusable: 'false',
  }) as SVGSVGElement;
  el.append(
    svg('path', { class: 'pp-flame__outer', d: 'M12 2.2c.6 3.1 2.7 4.7 4.4 6.6 1.6 1.8 2.6 3.8 2.6 6.2A7 7 0 0 1 5 15c0-2.6 1.3-4.6 2.9-6.1.3 1.4 1 2.5 2.1 3.1-.4-3.6.4-6.9 2-9.8z' }),
    svg('path', { class: 'pp-flame__inner', d: 'M12 12.2c.9 1.5 2.9 2.4 2.9 4.5a2.9 2.9 0 0 1-5.8 0c0-1.3.8-2.3 1.5-3 .2.6.6 1 1.1 1.2-.3-1-.2-1.8.3-2.7z' }),
  );
  return el;
}
