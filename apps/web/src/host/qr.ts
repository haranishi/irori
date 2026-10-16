// 参加用のQR。qrcode-generator で行列を作り、SVGの path 1本で描く（innerHTML を使わない）。
// 読み取り機が迷わないよう、明るい地に暗いモジュール、まわりに4モジュールの静かな余白を取る。
import qrcode from 'qrcode-generator';
import { svg } from '../shared/dom';

export const QR_QUIET = 4;

/** 参加のURL。コードは # の後ろに置く（サーバーへ送られないので、ログにも残らない）。 */
export function padUrl(origin: string, code: string): string {
  return `${new URL('/pad', origin).href}#${code}`;
}

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** 暗いモジュールを、行ごとの横の連なりにまとめた path。座標は余白を含む。 */
export function qrPath(matrix: readonly (readonly boolean[])[], quiet = QR_QUIET): string {
  let d = '';
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      d += `M${start + quiet} ${r + quiet}h${c - start}v1h-${c - start}z`;
    }
  });
  return d;
}

export interface QrOptions {
  dark: string;
  light: string;
  label: string;
}

export function qrSvg(text: string, opts: QrOptions): SVGSVGElement {
  const m = qrMatrix(text);
  const size = m.length + QR_QUIET * 2;
  const el = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'qr',
    role: 'img',
    'aria-label': opts.label,
    'shape-rendering': 'crispEdges',
    'data-modules': m.length,
  }) as SVGSVGElement;
  el.append(svg('rect', { x: 0, y: 0, width: size, height: size, fill: opts.light }), svg('path', { d: qrPath(m), fill: opts.dark }));
  return el;
}
