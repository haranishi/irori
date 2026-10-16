// 名前の掃除と、文字を数える補助。名前は画面に textContent で出す前提だが、
// 見えない文字や向きを変える文字は、textContent でも「空に見える名前」「逆向きに読める名前」を作れるので、ここで除く。
// 書記素（人が1文字と見る単位）の数え方は実行環境の ICU の版で違う（ミャンマー文字などの結合子音を、Node 24 は2つ、
// ブラウザと workerd は1つと数える）。そのため受け手の検査は、環境に依らない符号位置とバイトで行い、
// 書記素は「切る場所を決める」ことと表示の切り詰めにだけ使う。
// 正規表現は u フラグ付きで \u{...} と書く（u なしだと、対になっていないサロゲートの扱いが変わる）。

import { LIMITS } from './limits';

let segmenter: Intl.Segmenter | undefined;

function segments(s: string): Iterable<{ segment: string }> {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter.segment(s);
}

/** 書記素の数。stopAfter を超えた時点で数えるのをやめる（長い入力で時間を使わないため）。 */
export function countGraphemes(s: string, stopAfter = Number.POSITIVE_INFINITY): number {
  let n = 0;
  for (const _ of segments(s)) {
    if (++n > stopAfter) break;
  }
  return n;
}

/** 書記素で max を超えないか。1書記素は1符号単位以上なので、短い文字列は分割せずに答える。 */
export function fitsGraphemes(s: string, max: number): boolean {
  if (s.length <= max) return true;
  return countGraphemes(s, max) <= max;
}

/** 符号位置の数（対のないサロゲートも1つと数える）。どの実行環境でも同じ値になる。 */
export function countCodePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** 符号位置で max を超えないか。 */
export function fitsCodePoints(s: string, max: number): boolean {
  return s.length <= max || countCodePoints(s) <= max;
}

/** UTF-8 にしたときのバイト数。対のないサロゲートは置換文字（3バイト）として数える。 */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

interface Budget {
  graphemes: number;
  codePoints: number;
  bytes: number;
}

/** 符号位置の切れ目で、符号位置とバイトの上限に届く手前まで残す（サロゲートの対は割らない）。 */
function takeCodePoints(s: string, maxCp: number, maxBytes: number): string {
  let out = '';
  let cp = 0;
  let by = 0;
  for (const ch of s) {
    const chBy = utf8Length(ch);
    if (cp + 1 > maxCp || by + chBy > maxBytes) break;
    out += ch;
    cp++;
    by += chBy;
  }
  return out.replace(/[\u{200c}\u{200d}]+$/u, '');
}

/**
 * 書記素の切れ目で、3つの上限のどれかに届く手前まで残す。結合記号を積んだ書記素も、符号位置とバイトで止まる。
 * 最初の1書記素だけで上限を超えるものは、空にせず、符号位置の切れ目で入るところまで残す。
 */
function takeWithin(s: string, b: Budget): string {
  if (s.length <= Math.min(b.graphemes, b.codePoints) && utf8Length(s) <= b.bytes) return s;
  let out = '';
  let g = 0;
  let cp = 0;
  let by = 0;
  for (const { segment } of segments(s)) {
    const segCp = countCodePoints(segment);
    const segBy = utf8Length(segment);
    if (g + 1 > b.graphemes || cp + segCp > b.codePoints || by + segBy > b.bytes) {
      if (g === 0 && b.graphemes > 0) out = takeCodePoints(segment, b.codePoints, b.bytes);
      break;
    }
    out += segment;
    g++;
    cp += segCp;
    by += segBy;
  }
  return out;
}

/** 先頭から max 書記素まで。結合文字や絵文字の途中では切らない。 */
export function truncateGraphemes(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  let n = 0;
  for (const { segment } of segments(s)) {
    if (n++ >= max) break;
    out += segment;
  }
  return out;
}

// u フラグでは、正しく対になったサロゲートは1文字として読まれるので、この範囲は対のないものだけに当たる。
const LONE_SURROGATE = /[\u{d800}-\u{dfff}]/gu;
// 空白の役をする制御文字は、消すと語がくっつくので、空白に変えてから畳む。
const SPACE_CONTROLS = /[\t\n\v\f\r\u{85}\u{2028}\u{2029}]/gu;
const CONTROLS = /[\u{0}-\u{1f}\u{7f}-\u{9f}]/gu;
const BIDI_CONTROLS = /[\u{61c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;
// 幅のない文字と、見えない詰め物。ZWJ・ZWNJ は絵文字の合成やペルシア文字に要るので、ここでは残す。
const INVISIBLE = /[\u{ad}\u{34f}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{180e}\u{200b}\u{2060}-\u{2064}\u{3164}\u{feff}\u{ffa0}]/gu;
const JOINER_RUN = /[\u{200c}\u{200d}]{2,}/gu;
// 端や空白の隣の ZWJ・ZWNJ は、何もつながないので除く。
const JOINER_EDGE = /(^|\s)[\u{200c}\u{200d}]|[\u{200c}\u{200d}](?=\s|$)/gu;
const SPACES = /\s+/gu;

/**
 * 参加者が打った名前を、表示してよい形にする。制御文字・向きを変える文字・幅のない文字の連続を除き、
 * 空白を1つに畳み、12書記素・32符号位置・96バイトの、先に届いたところで切る。残りが空なら fallback を返す
 * （fallback は検査しない）。どの環境で切っても、受け手の検査（符号位置とバイト）を必ず通る。
 */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  let s = raw.replace(LONE_SURROGATE, '').normalize('NFC');
  s = s
    .replace(SPACE_CONTROLS, ' ')
    .replace(CONTROLS, '')
    .replace(BIDI_CONTROLS, '')
    .replace(INVISIBLE, '')
    .replace(JOINER_RUN, '')
    .replace(JOINER_EDGE, '$1');
  s = s.replace(SPACES, ' ').trim();
  s = takeWithin(s, { graphemes: LIMITS.NAME_MAX_GRAPHEMES, codePoints: LIMITS.NAME_MAX_CODEPOINTS, bytes: LIMITS.NAME_MAX_BYTES }).trimEnd();
  return s === '' ? fallback : s;
}

/** 重複した名前の後ろに番号を付ける（「たろう」→「たろう2」）。番号の分だけ前を削り、3つの上限に収める。 */
export function numberedName(base: string, n: number): string {
  const suffix = String(n);
  const k = suffix.length; // 番号は ASCII なので、1文字が1書記素・1符号位置・1バイト
  const budget = {
    graphemes: Math.max(0, LIMITS.NAME_MAX_GRAPHEMES - k),
    codePoints: Math.max(0, LIMITS.NAME_MAX_CODEPOINTS - k),
    bytes: Math.max(0, LIMITS.NAME_MAX_BYTES - k),
  };
  return takeWithin(base, budget).trimEnd() + suffix;
}
