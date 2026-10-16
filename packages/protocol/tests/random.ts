// 試験用の再現できる乱数。種が同じなら、毎回同じ入力が出る（落ちた入力をそのまま再現するため）。

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** 名前や文字の試験に混ぜる、扱いにくい文字の素。 */
export const NASTY = [
  'a', 'Z', ' ', '\t', '\n', '\r', '\u{0}', '\u{7}', '\u{1b}', '\u{7f}', '\u{85}', '\u{9f}',
  '\u{200b}', '\u{200c}', '\u{200d}', '\u{200e}', '\u{202e}', '\u{2066}', '\u{2069}', '\u{61c}',
  '\u{feff}', '\u{ad}', '\u{3164}', '\u{3000}', '\u{a0}', '\u{2028}', '\u{301}', '\u{fe0f}',
  '\u{d800}', '\u{dfff}', 'é', 'e\u{301}', '漢', 'か', 'ｶ', '😀', '👨\u{200d}👩\u{200d}👧', '🇯🇵',
  '<', '>', '&', '"', "'", '<script>', '\\', '/', '-', '_', '0', '9',
];

export function nastyString(rng: Rng, maxParts: number): string {
  let s = '';
  const n = int(rng, 0, maxParts);
  for (let i = 0; i < n; i++) s += pick(rng, NASTY);
  return s;
}
