// OGP の画像（apps/web/public/og.png、1200×630）を作る。
// 再生成の手順：
//   1. 書体を取得する（tools/lib/ofl-fonts.mjs の冒頭に URL がある。SIL OFL の Noto Sans JP と Noto Sans Mono）。
//   2. IRORI_FONT_JP=<Noto Sans JP のファイル> IRORI_FONT_MONO=<Noto Sans Mono のファイル> node tools/make-og.mjs
//      （Playwright の Chromium が要る。入っていなければ npx playwright install chromium）
// apps/web/og/og.html を描画して撮るだけで、手で加工した素材や外部の画像は混ぜない（docs/identity.md「ロゴ」）。
// 文字は、OS の書体（Hiragino や SF）でなく、再配布してよい書体で描く。画像を CC BY 4.0 で配るため。
import { chromium } from '@playwright/test';
import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDirectRun } from './lib/files.mjs';
import { fontFaceCss, loadOflFonts, waitForOflFonts } from './lib/ofl-fonts.mjs';

export async function makeOg(root, env = process.env) {
  const out = join(root, 'apps/web/public/og.png');
  loadOflFonts(env); // 書体の取り違えを、撮る前に止める（中身は、ブラウザには file:// で渡す）
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(root, 'apps/web/og/og.html')).href);
    await page.addStyleTag({
      content: [
        fontFaceCss({ jpUrl: pathToFileURL(env.IRORI_FONT_JP).href, monoUrl: pathToFileURL(env.IRORI_FONT_MONO).href }),
        // 画面の文字を、すべて再配布してよい書体に差し替える。
        "html, body, .og, .og * { font-family: 'IroriOfl', sans-serif !important; }",
        ".og__code { font-family: 'IroriOflMono', monospace !important; }",
      ].join('\n'),
    });
    await waitForOflFonts(page, { jp: true, mono: true });
    await page.screenshot({ path: out, type: 'png' });
  } finally {
    await browser.close();
  }
  return { out, bytes: statSync(out).size };
}

if (isDirectRun(import.meta.url)) {
  const r = await makeOg(process.cwd());
  console.log(`make-og: ${relative(process.cwd(), r.out)}（${r.bytes} バイト）`);
}
