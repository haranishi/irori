/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@irori/protocol';
import { look, shapeSvg, SHAPES } from '../src/index';

// Vitest は CSS の import を空にするので、ファイルを直接読む（happy-dom の URL は fs が受け取らないので、パスで渡す）。
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/pad.css'), 'utf8');

describe('look', () => {
  it('席1は橙の丸。8席で色も形も重ならず、形には必ずパスがある', () => {
    expect(look(1)).toMatchObject({ color: '#E69F00', shape: 'circle', label: '橙の丸' });
    const all = Array.from({ length: LIMITS.MAX_PLAYERS }, (_, i) => look(i + 1));
    expect(new Set(all.map((l) => l.color.toLowerCase())).size).toBe(LIMITS.MAX_PLAYERS);
    expect(new Set(all.map((l) => l.shape)).size).toBe(LIMITS.MAX_PLAYERS);
    expect(new Set(all.map((l) => l.path)).size).toBe(LIMITS.MAX_PLAYERS);
    expect(new Set(all.map((l) => l.label)).size).toBe(LIMITS.MAX_PLAYERS);
    expect(all.map((l) => l.shape)).toEqual(['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'hexagon', 'ring']);
    for (const l of all) expect(l.path).toMatch(/^M[\d.\s\-MLHVZAhvlaz]+$/);
    expect(look(8, 'en').label).toBe('white ring');
  });

  it('席番号の外は投げる', () => {
    for (const bad of [0, 9, 1.5, Number.NaN, -1]) expect(() => look(bad)).toThrow(RangeError);
  });

  it('shapeSvg は読み上げから外した SVG で、形ごとに違うパスを色で塗る', () => {
    const paths = new Set<string>();
    for (const s of SHAPES) {
      const el = shapeSvg(s, 32, '#123456');
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.getAttribute('width')).toBe('32');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.getAttribute('data-shape')).toBe(s);
      const p = el.querySelector('path');
      expect(p?.getAttribute('fill')).toBe('#123456');
      paths.add(p?.getAttribute('d') ?? '');
    }
    expect(paths.size).toBe(SHAPES.length);
    expect(() => shapeSvg('blob' as never, 10, '#fff')).toThrow(RangeError);
  });
});

// docs/identity.md の測れる基準：文字は4.5:1以上、部品の輪郭は3:1以上。
const lum = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const varOf = (name: string) => {
  const m = new RegExp(`${name}:\\s*(?:var\\([^,]+,\\s*)?(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`${name} が pad.css にありません`);
  return m[1];
};

describe('pad.css', () => {
  it('ゲームが選べる5色は、文字との比が4.5:1以上', () => {
    const text = '#f5ebe0';
    const ink = varOf('--pad-ink');
    for (const c of ['red', 'blue', 'green', 'gray']) expect(ratio(varOf(`--pad-${c}`), text), c).toBeGreaterThanOrEqual(4.5);
    expect(ratio(varOf('--pad-yellow'), ink)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(varOf('--pad-on'), ink)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(varOf('--pad-face'), text)).toBeGreaterThanOrEqual(4.5);
  });

  it('部品の輪郭は地に対して3:1以上で、ボタンは48px以上、文字は16px以上', () => {
    expect(ratio(varOf('--pad-edge'), varOf('--pad-ink'))).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/\.irori-pad__btn,\s*\.irori-pad__arrow \{[^}]*min-width: 48px;\s*min-height: 48px;/);
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
    expect(css).toContain('touch-action: none');
    expect(css).toContain('-webkit-touch-callout: none');
  });
});
