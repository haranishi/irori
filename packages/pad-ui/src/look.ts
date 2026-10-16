// 席の色と形（docs/identity.md）。色だけで区別させないため、色と形は必ず対で返す。
// ホストの画面・スマホの縁・SDKの仮想プレイヤーが、同じ値を使う。
import { LIMITS } from '@irori/protocol';
import { svg } from './dom';

export type ShapeName = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross' | 'hexagon' | 'ring';

export interface Look {
  /** 色（#RRGGBB）。 */
  color: string;
  shape: ShapeName;
  /** 読み上げや凡例に使う名前（例「橙の丸」）。 */
  label: string;
  /** 24×24 の枠に収まる形の SVG パス。canvas では `new Path2D(path)` で塗れる。 */
  path: string;
}

export const SHAPES: readonly ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hexagon', 'ring'];
const COLORS = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#EDEDED'];

const NAMES = {
  ja: {
    colors: ['橙', '空色', '緑', '黄色', '青', '朱色', '桃色', '白'],
    shapes: ['丸', '四角', '三角', 'ひし形', '星', '十字', '六角形', '輪'],
    join: (c: string, s: string) => `${c}の${s}`,
  },
  en: {
    colors: ['orange', 'sky blue', 'green', 'yellow', 'blue', 'vermilion', 'pink', 'white'],
    shapes: ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hexagon', 'ring'],
    join: (c: string, s: string) => `${c} ${s}`,
  },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function polygon(points: [number, number][]): string {
  return `M${points.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;
}

/** 中心 (cx, cy) のまわりに、半径を交互に変えながら頂点を置く（星は外と内、多角形は同じ半径）。 */
function around(cx: number, cy: number, radii: number[], count: number, startDeg: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = ((startDeg + (360 / count) * i) * Math.PI) / 180;
    const r = radii[i % radii.length] ?? 0;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// 輪は、外の円を時計回り・内の円を反時計回りに描く。塗りの規則が nonzero でも穴があく。
const PATHS: Record<ShapeName, string> = {
  circle: 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z',
  square: 'M3 3h18v18H3Z',
  triangle: 'M12 1L22.4 19H1.6Z',
  diamond: 'M12 1L23 12L12 23L1 12Z',
  star: polygon(around(12, 12.6, [11.5, 4.6], 10, -90)),
  cross: 'M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z',
  hexagon: polygon(around(12, 12, [11], 6, 0)),
  ring: 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z',
};

export function look(id: number, locale: 'ja' | 'en' = 'ja'): Look {
  if (!Number.isInteger(id) || id < 1 || id > LIMITS.MAX_PLAYERS) {
    throw new RangeError(`席番号は1〜${LIMITS.MAX_PLAYERS}の整数です（受け取った値: ${String(id)}）`);
  }
  const i = id - 1;
  const names = NAMES[locale] ?? NAMES.ja;
  const shape = SHAPES[i] as ShapeName;
  return {
    color: COLORS[i] as string,
    shape,
    label: names.join(names.colors[i] as string, names.shapes[i] as string),
    path: PATHS[shape],
  };
}

/** 形のSVG。読み上げは呼び出し側が名前と一緒に付けるので、この絵自体は読み上げから外す。 */
export function shapeSvg(shape: ShapeName, size: number, color: string): SVGSVGElement {
  const d = PATHS[shape];
  if (!d) throw new RangeError(`知らない形です: ${String(shape)}`);
  const el = svg('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    class: 'irori-shape',
    'data-shape': shape,
    'aria-hidden': 'true',
    focusable: 'false',
  }) as SVGSVGElement;
  // 薄い暗色の縁は、黄色や白の形が明るい地に置かれたときに輪郭を残すため。
  el.append(svg('path', { d, fill: color, stroke: 'rgba(0,0,0,0.45)', 'stroke-width': 0.75, 'stroke-linejoin': 'round' }));
  return el;
}
