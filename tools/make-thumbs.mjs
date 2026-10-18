// 棚のサムネイル registry/thumbs/<id>.png（640×480）を、ゲームを実際に動かした画面から作る。外部の画像や手作業の加工は混ぜない。
//
// 再生成の手順：
//   1. npm run build -w @irori/sdk && npm run sync:sdk   … 各ゲームの irori.js を最新にする
//   2. IRORI_FONT_JP=<Noto Sans JP のファイル> node tools/make-thumbs.mjs [id ...]
//                                                          … 全部（または指定したゲームだけ）撮り直す。
//      書体の取得先は tools/lib/ofl-fonts.mjs の冒頭。画像の文字は、OS の書体（Hiragino や SF）でなく、
//      再配布してよい Noto Sans JP（SIL OFL）に差し替えて撮る。画像を CC BY 4.0 で配るため。
//   3. node tools/check-registry.mjs                       … 大きさ（640×480）と容量（120KB以下）を確かめる
//
// 中身：games/ を、このスクリプトの小さなサーバー（127.0.0.1、5200〜5219 の空きポート）で本番と同じ CSP をつけて配る。
// Playwright の Chromium で games/<id>/?mock=3 を開き、ゲームごとの手順（仮想プレイヤーのキー操作）で数秒進め、
// 開発用の仮想プレイヤーの表示を隠して撮る。点の位置などは毎回の乱数で変わるので、撮るたびに少し違う絵になる。
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize, sep } from 'node:path';
import { isDirectRun } from './lib/files.mjs';
import { canvasFontPatchScript, fontFaceCss, loadOflFonts, waitForOflFonts } from './lib/ofl-fonts.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
/** apps/web/public/_headers の /games/* と同じ。インラインのスクリプトや外部の読み込みがあれば、ここで動かなくなる。 */
const CSP = "sandbox allow-scripts; default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'";

/** ゲームごとの撮る前の手順。page は Playwright のページ。 */
const SCENES = {
  'hello-pad': async (page) => {
    await hold(page, ['KeyW', 'KeyA'], 450);
    await hold(page, ['ArrowDown'], 400);
    await page.keyboard.press('Space');
    await page.waitForTimeout(140);
  },
  'tap-race': async (page) => {
    await phase(page, 'race');
    for (let i = 0; i < 26; i++) await page.keyboard.press('Space');
    for (let i = 0; i < 17; i++) await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  },
  'quiz-4': async (page) => {
    await phase(page, 'question');
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
  },
  'dot-grab': async (page) => {
    await phase(page, 'play');
    await hold(page, ['KeyD', 'ArrowRight', 'ArrowDown'], 600);
  },
  'ten-seconds': async (page) => {
    await phase(page, 'intro');
  },
};

/** 状態の照会で待つ（画面の文字は待たない）。 */
function phase(page, name) {
  return page.waitForFunction((n) => document.documentElement.dataset.phase === n, name, { timeout: 15_000 });
}

async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}

/** games/ を本番と同じ CSP で配る。ポートは 5200〜5219 の空きを使う。 */
export async function serveGames(root, { from = 5200, to = 5219, fonts = {} } = {}) {
  const base = join(root, 'games');
  const server = createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    // 撮るときだけ、書体を同じオリジンから配る（CSP の font-src 'self'。枠はオリジンが空なので CORS も許す）。
    const font = rel === '/__font/jp.ttf' ? fonts.jp : undefined;
    if (font) {
      res.writeHead(200, { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(font);
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(base, rel));
    if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(readFileSync(file));
  });
  for (let port = from; port <= to; port++) {
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return { port, close: () => new Promise((r) => server.close(r)) };
  }
  throw new Error(`make-thumbs: ${from}〜${to} に空きポートがありません`);
}

export async function makeThumbs(root, ids, env = process.env) {
  const fonts = loadOflFonts(env, ['jp']); // 書体が無い・違うときは、撮る前に止める
  const { chromium } = createRequire(join(root, 'package.json'))('@playwright/test');
  mkdirSync(join(root, 'registry/thumbs'), { recursive: true });
  const srv = await serveGames(root, { fonts });
  const browser = await chromium.launch();
  const made = [];
  try {
    for (const id of ids) {
      const scene = SCENES[id];
      if (!scene) throw new Error(`make-thumbs: ${id} の撮り方がありません（SCENES に足す）`);
      const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, locale: 'ja-JP' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // canvas に描く文字（hello-pad・tap-race・dot-grab）は、CSS では替わらない。ctx.font への代入を、ページの最初から差し替える。
      await page.addInitScript(canvasFontPatchScript());
      await page.goto(`http://127.0.0.1:${srv.port}/${id}/?mock=3`);
      await page.waitForSelector('.irori-mock[data-ready]', { state: 'attached', timeout: 15_000 });
      await scene(page);
      await page.addStyleTag({
        content: [
          '.irori-mock { display: none !important; }',
          fontFaceCss({ jpUrl: '/__font/jp.ttf' }),
          // 画面の文字を、再配布してよい書体に差し替える（OS の書体で描いた画像を配らないため）。
          "html, body, body * { font-family: 'IroriOfl', sans-serif !important; }",
        ].join('\n'),
      });
      await waitForOflFonts(page, { jp: true, mono: false });
      // 読み込んだあとで、canvas を描き直させ（resize を通知）、2フレーム待つ。
      await page.evaluate(() => new Promise((done) => {
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(() => requestAnimationFrame(done));
      }));
      // 画像に、OS の書体が残っていないこと：canvas に代入された書体の指定が、すべて差し替えられていること。
      const bad = await page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = '700 20px ui-rounded, "Hiragino Maru Gothic ProN", sans-serif';
        return ctx.font.includes('IroriOfl') ? '' : ctx.font;
      });
      if (bad) throw new Error(`make-thumbs: ${id} の canvas の書体が差し替わっていません（${bad}）`);
      if (errors.length) throw new Error(`make-thumbs: ${id} でエラー：${errors.join(' / ')}`);
      const path = join(root, 'registry/thumbs', `${id}.png`);
      await page.screenshot({ path, type: 'png' });
      made.push({ id, bytes: statSync(path).size });
      await page.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  return made;
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const made = await makeThumbs(root, ids.length ? ids : Object.keys(SCENES));
  for (const m of made) console.log(`make-thumbs: registry/thumbs/${m.id}.png（${Math.ceil(m.bytes / 1024)}KB）`);
}
