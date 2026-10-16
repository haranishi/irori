import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { padUrl, QR_QUIET, qrMatrix, qrPath, qrSvg } from '../../src/host/qr';

/** 行列を、明るい地に暗いモジュールの画素にして jsQR で読む（スマホのカメラの代わり）。 */
function decode(matrix: boolean[][], { invert = false, quiet = QR_QUIET } = {}): string | null {
  const scale = 6;
  const n = matrix.length + quiet * 2;
  const w = n * scale;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.floor(y / scale) - quiet;
      const c = Math.floor(x / scale) - quiet;
      const dark = matrix[r]?.[c] === true;
      const v = dark !== invert ? 26 : 250;
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return jsQR(data, w, w, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

describe('参加用のQR', () => {
  it('URL は origin/pad#CODE（コードは # の後ろ）', () => {
    expect(padUrl('https://irori.example', 'BCDF')).toBe('https://irori.example/pad#BCDF');
    expect(padUrl('http://192.168.1.5:8787', 'ZZ29')).toBe('http://192.168.1.5:8787/pad#ZZ29');
  });

  it('明るい地に暗いモジュールで、カメラで読むと同じURLに戻る', () => {
    const url = padUrl('http://127.0.0.1:8801', 'XN7Q');
    expect(decode(qrMatrix(url))).toBe(url);
  });

  it('色を反転すると読めない（暗い地に明るいモジュールにしない理由）', () => {
    const url = padUrl('https://irori.example', 'BCDF');
    expect(decode(qrMatrix(url), { invert: true })).toBeNull();
  });

  it('SVG は明るい地の四角と、暗いモジュールの path 1本。まわりに4モジュールの余白', () => {
    const url = padUrl('https://irori.example', 'BCDF');
    const el = qrSvg(url, { dark: '#1a1411', light: '#fbf4ea', label: 'join' });
    const n = qrMatrix(url).length;
    expect(el.getAttribute('viewBox')).toBe(`0 0 ${n + 8} ${n + 8}`);
    expect(el.querySelector('rect')?.getAttribute('fill')).toBe('#fbf4ea');
    expect(el.querySelectorAll('path')).toHaveLength(1);
    expect(el.querySelector('path')?.getAttribute('fill')).toBe('#1a1411');
    expect(el.getAttribute('aria-label')).toBe('join');
    // 余白の中（座標が4未満）には、暗いモジュールを置かない。
    const coords = [...(el.querySelector('path')?.getAttribute('d') ?? '').matchAll(/M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(coords.length).toBeGreaterThan(0);
    expect(Math.min(...coords.map(([x]) => x ?? 0))).toBe(QR_QUIET);
    expect(Math.min(...coords.map(([, y]) => y ?? 0))).toBe(QR_QUIET);
  });

  it('path は横に続く暗いモジュールを1つにまとめる', () => {
    expect(qrPath([[true, true, false, true]], 0)).toBe('M0 0h2v1h-2zM3 0h1v1h-1z');
  });
});
