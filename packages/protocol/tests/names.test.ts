import { describe, expect, it } from 'vitest';
import { LIMITS, countCodePoints, countGraphemes, numberedName, sanitizeName, truncateGraphemes, utf8Length } from '../src/index';
import { mulberry32, nastyString } from './random';

const FB = 'プレイヤー3';
const FAMILY = '👨\u{200d}👩\u{200d}👧';
const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

describe('sanitizeName', () => {
  const table: Array<[string, unknown, string]> = [
    ['ふつうの名前', 'たろう', 'たろう'],
    ['前後の空白を除く', '  たろう  ', 'たろう'],
    ['空白を1つに畳む（全角空白・タブ・改行も）', 'a \u{3000}\t\n b', 'a b'],
    ['制御文字を除く', 'a\u{0}b\u{7}c\u{1b}d\u{7f}e\u{9f}f', 'abcdef'],
    ['向きを変える文字を除く', 'abc\u{202e}fed\u{2066}x\u{2069}\u{200e}\u{61c}', 'abcfedx'],
    ['幅のない文字を除く', 'a\u{200b}b\u{feff}c\u{2060}d\u{ad}e', 'abcde'],
    ['ZWJ の連続を除く', 'a\u{200d}\u{200d}\u{200d}b', 'ab'],
    ['端の ZWJ を除く', '\u{200d}abc\u{200c}', 'abc'],
    ['空白の隣の ZWJ を除く', 'a \u{200d}b', 'a b'],
    ['絵文字の ZWJ は残す', FAMILY, FAMILY],
    ['見えない詰め物だけなら fallback', '\u{3164}\u{3164}', FB],
    ['空なら fallback', '', FB],
    ['空白だけなら fallback', ' \u{3000} ', FB],
    ['文字列でなければ fallback', 42, FB],
    ['null も fallback', null, FB],
    ['NFC にそろえる', 'e\u{301}', 'é'],
    ['対のないサロゲートを除く', `a${String.fromCharCode(0xd800)}b`, 'ab'],
    ['HTMLは文字として残す', '<b>x</b>', '<b>x</b>'],
    ['12書記素で切る', 'あいうえおかきくけこさしすせそ', 'あいうえおかきくけこさし'],
    // 家族の絵文字は1書記素・5符号位置・18バイト。6つで108バイトになるので、96バイトの手前の5つで止まる
    ['書記素の途中では切らず、バイトの上限で止まる', FAMILY.repeat(13), FAMILY.repeat(5)],
    ['切った後の空白を除く', 'あいうえおかきくけこさ す', 'あいうえおかきくけこさ'],
  ];
  it.each(table)('%s', (_name, raw, expected) => {
    expect(sanitizeName(raw, FB)).toBe(expected);
  });

  it('乱数の入力（2000通り）で、例外を投げず、上限と禁止文字を守る', () => {
    const rng = mulberry32(20261016);
    const banned = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{200b}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{61c}\u{feff}\u{3164}\u{ad}]/u;
    for (let i = 0; i < 2000; i++) {
      const raw = nastyString(rng, 40);
      const out = sanitizeName(raw, FB);
      expect(out.length).toBeGreaterThan(0);
      expect(graphemes(out)).toBeLessThanOrEqual(LIMITS.NAME_MAX_GRAPHEMES);
      expect(countCodePoints(out)).toBeLessThanOrEqual(LIMITS.NAME_MAX_CODEPOINTS);
      expect(utf8Length(out)).toBeLessThanOrEqual(LIMITS.NAME_MAX_BYTES);
      expect(out, JSON.stringify(raw)).not.toMatch(banned);
      expect(out).toBe(out.trim());
      expect(out).not.toMatch(/\s\s/u);
      expect(out).not.toMatch(/[\u{200c}\u{200d}]{2}/u);
      expect(out).not.toMatch(/[\u{d800}-\u{dfff}]/u); // u フラグでは、対のないサロゲートだけに当たる
    }
  });
});

describe('名前の3つの上限（12書記素・32符号位置・96バイト）', () => {
  it('結合記号を積んだ名前（約430バイト）は、96バイトの手前で止まる', () => {
    const stacked = ('a' + '\u{301}'.repeat(17)).repeat(12);
    expect(utf8Length(stacked)).toBeGreaterThan(400);
    const out = sanitizeName(stacked, FB);
    expect(out).not.toBe(FB);
    expect(countCodePoints(out)).toBeLessThanOrEqual(LIMITS.NAME_MAX_CODEPOINTS);
    expect(utf8Length(out)).toBeLessThanOrEqual(LIMITS.NAME_MAX_BYTES);
  });

  it('1書記素だけで上限を超えるものは、空にせず、符号位置の上限のところで切る', () => {
    const out = sanitizeName('a' + '\u{301}'.repeat(40), FB);
    expect(out).not.toBe(FB);
    expect(countCodePoints(out)).toBe(LIMITS.NAME_MAX_CODEPOINTS);
    expect(utf8Length(out)).toBeLessThanOrEqual(LIMITS.NAME_MAX_BYTES);
    expect(sanitizeName('ab' + '\u{301}'.repeat(40), FB)).toBe('a'); // 2つ目の書記素からは、書記素の切れ目で切る
  });

  it('番号を付けても、3つの上限に収まる', () => {
    const base = sanitizeName('😀'.repeat(30), FB);
    const numbered = numberedName(base, 12);
    expect(numbered.endsWith('12')).toBe(true);
    expect(countCodePoints(numbered)).toBeLessThanOrEqual(LIMITS.NAME_MAX_CODEPOINTS);
    expect(utf8Length(numbered)).toBeLessThanOrEqual(LIMITS.NAME_MAX_BYTES);
  });
});

describe('符号位置', () => {
  it('対のサロゲートは1つ、対のないものも1つと数える', () => {
    expect(countCodePoints('a😀b')).toBe(3);
    expect(countCodePoints(FAMILY)).toBe(5);
    expect(countCodePoints(String.fromCharCode(0xd800) + 'x')).toBe(2);
  });
});

describe('書記素の補助', () => {
  it('数える・切る', () => {
    expect(countGraphemes(FAMILY + 'e\u{301}🇯🇵')).toBe(3);
    expect(countGraphemes('abcdef', 2)).toBe(3); // 上限を1つ超えたところで止まる
    expect(truncateGraphemes(FAMILY + 'ab', 2)).toBe(`${FAMILY}a`);
  });
});

describe('numberedName', () => {
  it.each([
    ['たろう', 2, 'たろう2'],
    ['あいうえおかきくけこさし', 2, 'あいうえおかきくけこさ2'],
    ['あいうえおかきくけこさし', 10, 'あいうえおかきくけこ10'],
    ['ab ', 3, 'ab3'],
  ] as const)('%s + %i → %s', (base, n, expected) => {
    expect(numberedName(base, n)).toBe(expected);
    expect(graphemes(numberedName(base, n))).toBeLessThanOrEqual(LIMITS.NAME_MAX_GRAPHEMES);
  });
});
