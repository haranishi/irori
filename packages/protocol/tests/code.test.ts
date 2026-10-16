import { describe, expect, it } from 'vitest';
import { LIMITS, generateCode, isValidCode, normalizeCode } from '../src/index';
import { mulberry32 } from './random';

const bytesFrom = (seed: number) => {
  const rng = mulberry32(seed);
  return (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rng() * 256));
};

describe('部屋のコード', () => {
  it('決まった文字から4文字を作る', () => {
    const rand = bytesFrom(1);
    for (let i = 0; i < 500; i++) {
      const code = generateCode(rand);
      expect(code).toHaveLength(LIMITS.CODE_LENGTH);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it('偏りを出さないため、文字数で割り切れない範囲のバイトは捨てる', () => {
    // 29文字なので、232以上は捨てる。0→'2'、28→'Z'、231→231%29=28→'Z'
    const seq = [255, 232, 0, 28, 231, 29];
    const rand = (n: number) => Uint8Array.from({ length: n }, (_, i) => seq[i] ?? 0);
    expect(generateCode(rand)).toBe('2ZZ2');
  });

  it('壊れた乱数源では、止まらずに失敗する', () => {
    expect(() => generateCode((n) => new Uint8Array(n).fill(255))).toThrow();
  });

  it('文字ごとの出方がおおむね一様', () => {
    const rand = bytesFrom(7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 2900; i++) for (const c of generateCode(rand)) counts.set(c, (counts.get(c) ?? 0) + 1);
    const expected = (2900 * 4) / LIMITS.CODE_ALPHABET.length;
    for (const c of LIMITS.CODE_ALPHABET) {
      expect(counts.get(c) ?? 0).toBeGreaterThan(expected * 0.7);
      expect(counts.get(c) ?? 0).toBeLessThan(expected * 1.3);
    }
  });

  it.each([
    [' bc-df ', 'BCDF'],
    ['bc df', 'BCDF'],
    ['ｂｃｄｆ', 'BCDF'],
    ['BC－DF', 'BCDF'],
    ['bcーdf', 'BCDF'],
    ['b\u{2010}c\u{2212}df', 'BCDF'],
    ['', ''],
  ])('normalizeCode(%j) → %s', (raw, expected) => {
    expect(normalizeCode(raw)).toBe(expected);
  });

  it('文字列でない入力は空にする', () => {
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode(1234)).toBe('');
  });

  it.each([
    ['BCDF', true],
    ['2345', true],
    ['ZZZZ', true],
    ['BCD', false],
    ['BCDFG', false],
    ['bcdf', false],
    ['ABCD', false], // 母音
    ['0BCD', false],
    ['1BCD', false],
    ['OBCD', false],
    ['IBCD', false],
  ])('isValidCode(%s) → %s', (code, valid) => {
    expect(isValidCode(code)).toBe(valid);
  });
});
