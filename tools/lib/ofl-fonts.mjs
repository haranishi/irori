// 公開する画像（OGP・サムネイル）の文字を、再配布してよい書体で描くための道具。
// OS の書体（Hiragino や SF）で描いた画像を、CC BY 4.0 の画像として配るのを避けるため、
// SIL Open Font License 1.1 の Noto Sans JP と Noto Sans Mono で描く。書体ファイルは、リポジトリに入れない。
//
// 入手：次の2つのファイルを取得し、置いた場所を環境変数で渡す。SHA-256 が一致しないファイルは使わない
// （別の書体や、ライセンスの違う版を、うっかり混ぜないため）。
//   IRORI_FONT_JP    Noto Sans JP    https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf
//   IRORI_FONT_MONO  Noto Sans Mono  https://github.com/google/fonts/raw/main/ofl/notosansmono/NotoSansMono%5Bwdth%2Cwght%5D.ttf
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const OFL_FONTS = {
  jp: {
    env: 'IRORI_FONT_JP',
    url: 'https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf',
    sha256: 'c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f',
  },
  mono: {
    env: 'IRORI_FONT_MONO',
    url: 'https://github.com/google/fonts/raw/main/ofl/notosansmono/NotoSansMono%5Bwdth%2Cwght%5D.ttf',
    sha256: '2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081',
  },
};

/** 環境変数が指す書体ファイルを読み、SHA-256 を確かめて返す。足りない・違うときは、手順つきで落とす。 */
export function loadOflFonts(env = process.env, which = ['jp', 'mono'], specs = OFL_FONTS) {
  const out = {};
  for (const key of which) {
    const spec = specs[key];
    const path = env[spec.env];
    if (!path) {
      throw new Error(`書体のファイルが指定されていません。${spec.env} に、次のファイルを置いた場所を渡してください\n  ${spec.url}`);
    }
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== spec.sha256) {
      throw new Error(`${spec.env} のファイルが、確認ずみの書体と違います（SHA-256 が一致しません）。次から取り直してください\n  ${spec.url}`);
    }
    out[key] = bytes;
  }
  return out;
}

/** @font-face。url は、ページが読める場所（同じオリジンのパスか data:）。 */
export function fontFaceCss({ jpUrl, monoUrl }) {
  const face = (family, url) =>
    `@font-face { font-family: '${family}'; src: url('${url}') format('truetype'); font-weight: 100 900; font-display: block; }`;
  return [jpUrl ? face('IroriOfl', jpUrl) : '', monoUrl ? face('IroriOflMono', monoUrl) : ''].filter(Boolean).join('\n');
}

/**
 * canvas の font 指定（CSS の font の短い書き方）の、書体の名前の並びを、IroriOfl に替える。
 * canvas に描く文字は、ページの CSS の差し替えが効かない（ゲームが ctx.font に、OS の書体を直接書くため）。
 * 例：'700 18px ui-rounded, "Hiragino Maru Gothic ProN", sans-serif' → '700 18px IroriOfl'
 */
export function rewriteCanvasFont(font) {
  return String(font).replace(/^(.*?\d+(?:\.\d+)?(?:px|pt|em|rem))(?:\s*\/\s*[\d.]+(?:px|pt|em|rem)?)?\s+.+$/s, '$1 IroriOfl');
}

/**
 * ページの最初に流す小さな文。canvas の font への代入をすべて IroriOfl に替え、替える前の値を window.__canvasFonts に残す
 * （撮る側が「OS の書体が canvas に残っていない」ことを確かめるため）。page.addInitScript に渡す。
 */
export function canvasFontPatchScript() {
  return `(() => {
  const rewrite = ${rewriteCanvasFont.toString()};
  const seen = (window.__canvasFonts = new Set());
  const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(this); },
    set(v) { seen.add(String(v)); desc.set.call(this, rewrite(v)); },
  });
})();`;
}

/** 書体が実際に読み込まれたことを確かめる（読めなければ、OS の書体で描いた画像になってしまうので、落とす）。 */
export async function waitForOflFonts(page, { jp = true, mono = false } = {}) {
  await page.evaluate(async ({ jp, mono }) => {
    const loads = [];
    if (jp) loads.push(document.fonts.load("700 24px 'IroriOfl'", 'あア漢Aa1'));
    if (mono) loads.push(document.fonts.load("700 24px 'IroriOflMono'", 'R4X9'));
    await Promise.all(loads);
    await document.fonts.ready;
  }, { jp, mono });
  const ok = await page.evaluate(
    ({ jp, mono }) => (!jp || document.fonts.check("700 24px 'IroriOfl'", 'あア漢Aa1')) && (!mono || document.fonts.check("700 24px 'IroriOflMono'", 'R4X9')),
    { jp, mono },
  );
  if (!ok) throw new Error('書体（Noto Sans）が読み込まれませんでした。画像は撮りません');
}
