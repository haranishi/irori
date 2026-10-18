// 部屋のコード。秘密でも鍵でもない（docs/protocol.md「部屋と席」）。乱数は呼び出し側から受け取る。

import { LIMITS } from './limits';

/** n バイトの乱数を返す関数。Worker では crypto.getRandomValues、試験では固定の種から作る。 */
export type RandomBytes = (n: number) => Uint8Array;

const ALPHABET = LIMITS.CODE_ALPHABET;
let codePattern: RegExp | undefined;
// 区切りとして打たれやすい横棒。全角の長音記号も、コードを読み上げて打つと入りやすい。
const SEPARATORS = /[\s\-\u{2010}-\u{2015}\u{2212}\u{30fc}\u{ff0d}\u{ff70}]+/gu;

export function generateCode(rand: RandomBytes): string {
  // 256を文字数で割り切れる範囲だけを使う。生成しないSDKでは、この計算も不要。
  const acceptBelow = 256 - (256 % ALPHABET.length);
  let out = '';
  // 乱数源が壊れて棄却が続いても、止まらずに失敗するようにする。
  for (let round = 0; round < 64; round++) {
    for (const b of rand(LIMITS.CODE_LENGTH * 2)) {
      if (b >= acceptBelow) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === LIMITS.CODE_LENGTH) return out;
    }
  }
  throw new Error('generateCode: 乱数が偏っていてコードを作れません');
}

/** 打たれたコードを比べられる形にする。全角は半角に、小文字は大文字にし、空白と横棒を除く。 */
export function normalizeCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').toUpperCase().replace(SEPARATORS, '');
}

export function isValidCode(code: unknown): code is string {
  // SDKが使わないときは、部屋コード用の正規表現も初期化しない。
  codePattern ??= new RegExp(`^[${ALPHABET}]{${LIMITS.CODE_LENGTH}}$`);
  return typeof code === 'string' && codePattern.test(code);
}
