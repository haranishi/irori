// dot-grab（あつめて点）の画面の読み取り。状態はキャンバスにしか描かれないので、枠の中でキャンバスの画素を読む。
//   動く印：席の色（look の色）で塗った形。席が切れていると薄く（不透明度0.35）描かれるので、薄い色でも探す。
//   光る点：芯の色（#ff8a3d）の画素のかたまり。
// 読むのはゲームのキャンバスの写し（willReadFrequently の別のキャンバス）。ゲームのキャンバスで直接 getImageData を
// 繰り返すと、ブラウザが警告をコンソールに出すため（試験が見張りを汚さない）。座標はゲームの論理座標（960×540）。
import { look } from '../../../../packages/pad-ui/src/look';
import type { Host } from './host';
import type { Pad } from './pad';

export interface Field {
  mover: { x: number; y: number; faded: boolean } | null;
  dots: { x: number; y: number }[];
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const FLOOR: [number, number, number] = [0x23, 0x1a, 0x15];

export async function readField(host: Host, seat: number): Promise<Field | null> {
  const color = hex(look(seat).color);
  const faded = color.map((c, i) => Math.round(0.35 * c + 0.65 * FLOOR[i]!)) as [number, number, number];
  return host.inGameWith(
    ({ color, faded }) => {
      const src = document.getElementById('view') as HTMLCanvasElement | null;
      if (!src || src.width === 0) return null;
      const k = src.width / 960;
      const copy = document.createElement('canvas');
      copy.width = src.width;
      copy.height = src.height;
      const g = copy.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
      g.drawImage(src, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, copy.width, copy.height);
      let sx = 0;
      let sy = 0;
      let n = 0;
      let fx = 0;
      let fy = 0;
      let fn = 0;
      const embers: [number, number][] = [];
      const top = Math.floor(70 * k);
      for (let y = top; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = data[i]!;
          const gg = data[i + 1]!;
          const b = data[i + 2]!;
          if (r === color[0] && gg === color[1] && b === color[2]) {
            sx += x;
            sy += y;
            n++;
          } else if (Math.abs(r - faded[0]) <= 3 && Math.abs(gg - faded[1]) <= 3 && Math.abs(b - faded[2]) <= 3) {
            fx += x;
            fy += y;
            fn++;
          } else if (r === 255 && gg === 138 && b === 61) embers.push([x, y]);
        }
      }
      // 光る点：芯の画素を、近いものどうしでまとめる。
      const groups: { x: number; y: number; n: number }[] = [];
      for (const [x, y] of embers) {
        const near = groups.find((c) => Math.hypot(c.x / c.n - x, c.y / c.n - y) < 16 * k);
        if (near) {
          near.x += x;
          near.y += y;
          near.n++;
        } else groups.push({ x, y, n: 1 });
      }
      const min = 20 * k * k;
      const mover = n > min ? { x: sx / n / k, y: sy / n / k, faded: false } : fn > min ? { x: fx / fn / k, y: fy / fn / k, faded: true } : null;
      return { mover, dots: groups.filter((c) => c.n > 10 * k * k).map((c) => ({ x: c.x / c.n / k, y: c.y / c.n / k })) };
    },
    { color, faded },
  );
}

export async function moverAt(host: Host, seat: number): Promise<{ x: number; y: number; faded: boolean }> {
  const f = await readField(host, seat);
  if (!f?.mover) throw new Error(`席${seat}の印がキャンバスに見つからない`);
  return f.mover;
}

/**
 * いちばん近い光る点へ、スティックを倒して向かう（本物のスマホのスティックで）。want 個取るか、moves 回動いたらやめる。
 * 取れたかは、そのスマホに届いた振動の指示（fx）で数える（dot-grab は点を取った人にだけ振動を送る）。
 */
export async function collect(host: Host, pad: Pad, seat: number, want: number, moves = 16): Promise<number> {
  const start = pad.fx();
  for (let i = 0; i < moves && pad.fx() - start < want; i++) {
    const f = await readField(host, seat);
    if (!f?.mover || f.dots.length === 0) {
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    const m = f.mover;
    const d = [...f.dots].sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0]!;
    const dist = Math.hypot(d.x - m.x, d.y - m.y);
    const ux = (d.x - m.x) / dist;
    const uy = (d.y - m.y) / dist;
    // 倒しきる手前（0.95）で、速さは約285px/秒。届くまでの時間だけ倒す（長くても0.9秒で見直す）。
    const ms = Math.min(900, Math.max(120, (dist / 285) * 1000 + 80));
    await pad.stick(ux * 0.95, uy * 0.95, ms);
    await new Promise((r) => setTimeout(r, 120));
  }
  return pad.fx() - start;
}
