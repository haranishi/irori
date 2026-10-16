// 色の値の正本（tokens.css）から、文字と部品の輪郭のコントラストを計算して固定する（docs/identity.md「測れる基準」）。
// 値を変えたら、この試験が、測り直しを求める。
// vitest は CSS の読み込みを空の文字列にするので（?raw も同じ）、ファイルとして読む。
import { describe, expect, it } from 'vitest';

// 画面の型定義（apps/web）は node の型を持たないので、名前を変数にして読み込む。場所は、この試験のファイルの場所から決める
// （どのフォルダから試験を走らせても、変異試験の写しの中でも、同じ tokens.css を読む）。
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: 'utf8'): string };
const here = (import.meta as { dirname?: string }).dirname;
if (!here) throw new Error('この試験のファイルの場所が分からない（import.meta.dirname がない）');
const tokens = fs.readFileSync(`${here}/../../src/styles/tokens.css`, 'utf8');

function token(name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i').exec(tokens);
  if (!m?.[1]) throw new Error(`tokens.css に --${name} がない`);
  const hex = m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(token(a)), luminance(token(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe('コントラスト（tokens.css の値から計算）', () => {
  it('操作部品の輪郭 --line-ui は、地と面の両方に対して 3:1 以上', () => {
    expect(ratio('line-ui', 'bg')).toBeGreaterThanOrEqual(3);
    expect(ratio('line-ui', 'bg-card')).toBeGreaterThanOrEqual(3);
  });

  it('本文と補足の文字（「つながっていません」「作者」「記録」など）は、地と面の両方に対して 4.5:1 以上', () => {
    for (const fg of ['text', 'text-dim', 'glow']) {
      for (const bg of ['bg', 'bg-card']) expect(ratio(fg, bg), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('主ボタン（光の色の地に暗い字）も 4.5:1 以上', () => {
    expect(ratio('bg', 'glow')).toBeGreaterThanOrEqual(4.5);
  });
});
