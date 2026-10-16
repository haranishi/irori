// 日本語の文を、読みやすい塊（文節に近い単位）に分け、塊の中では折らず（nowrap）、塊のあいだでだけ折る（<wbr>）。
// 分け方は BudouX（Google・Apache-2.0）の方式で、日本語のモデル（phrase-model-ja.ts）の重みを足して境目を決める。
// ブラウザ任せ（word-break: auto-phrase）は Safari などが対応しておらず、語の途中でも割るため使わない。
// この画面が持つ文言と、画面の中で組む文にだけ使う。スマホやゲームから来た文字列（名前など）には使わない。
import { model } from './phrase-model-ja';

const JA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** これより長い塊は、包まない（狭い画面で横にはみ出さないため）。 */
const MAX_CHUNK = 14;

const FEATURES = ['UW1', 'UW2', 'UW3', 'UW4', 'UW5', 'UW6', 'BW1', 'BW2', 'BW3', 'TW1', 'TW2', 'TW3', 'TW4'] as const;
type Feature = (typeof FEATURES)[number];

let weights: Record<Feature, Map<string, number>> | null = null;
let baseScore = 0;

function load(): Record<Feature, Map<string, number>> {
  if (weights) return weights;
  const w = {} as Record<Feature, Map<string, number>>;
  let sum = 0;
  for (const f of FEATURES) {
    const m = new Map(Object.entries(model[f] ?? {}));
    for (const v of m.values()) sum += v;
    w[f] = m;
  }
  baseScore = -0.5 * sum;
  weights = w;
  return w;
}

/** i の手前で切るか（文字の並びごとの重みを足して、0 を超えたら切る）。 */
function boundaries(s: string): number[] {
  const w = load();
  const out: number[] = [];
  const at = (f: Feature, a: number, b: number): number => w[f].get(s.substring(a, b)) ?? 0;
  for (let i = 1; i < s.length; i++) {
    const score =
      baseScore +
      at('UW1', i - 3, i - 2) + at('UW2', i - 2, i - 1) + at('UW3', i - 1, i) +
      at('UW4', i, i + 1) + at('UW5', i + 1, i + 2) + at('UW6', i + 2, i + 3) +
      at('BW1', i - 2, i) + at('BW2', i - 1, i + 1) + at('BW3', i, i + 2) +
      at('TW1', i - 3, i) + at('TW2', i - 2, i + 1) + at('TW3', i - 1, i + 2) + at('TW4', i, i + 3);
    if (score > 0) out.push(i);
  }
  return out;
}

export function chunks(text: string): string[] {
  if (text === '') return [];
  const out: string[] = [];
  let start = 0;
  for (const b of boundaries(text)) {
    out.push(text.slice(start, b));
    start = b;
  }
  out.push(text.slice(start));
  return out;
}

/** 画面に入れるノード。日本語でなければ、そのままの文字。 */
export function phrase(text: string): Node[] {
  if (!JA.test(text)) return [document.createTextNode(text)];
  const nodes: Node[] = [];
  chunks(text).forEach((c, i) => {
    if (i > 0) nodes.push(document.createElement('wbr'));
    if ([...c].length > MAX_CHUNK) {
      nodes.push(document.createTextNode(c));
      return;
    }
    const span = document.createElement('span');
    span.className = 'pp-nw';
    span.textContent = c;
    nodes.push(span);
  });
  return nodes;
}

/** 部品（pad-ui）へ渡す文字列の版。HTML を組めないので、塊の切れ目に幅のない空白を入れる（CSS の keep-all と組む）。 */
export function softBreaks(text: string): string {
  return JA.test(text) ? chunks(text).join('​') : text;
}
