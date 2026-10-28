// 棚のサムネイル registry/thumbs/（640×480）を、ゲームを実際に動かした画面から作る。外部の画像や手作業の加工は混ぜない。
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
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { assertSafePath, assertSafeTree, isDirectRun } from './lib/files.mjs';
import { canvasFontPatchScript, fontFaceCss, loadOflFonts, waitForOflFonts } from './lib/ofl-fonts.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
/** apps/web/public/_headers の /games/* と同じ。インラインのスクリプトや外部の読み込みがあれば、ここで動かなくなる。 */
const CSP = "sandbox allow-scripts; default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'";

/** 仮想プレイヤーの人数（既定は3）。人狼は4人以上が要る。 */
const PLAYERS = { 'blade-duel': 2, 'moon-village': 8 };

/** ゲームごとの撮る前の手順。page は Playwright のページ。 */
const SCENES = {
  'blade-duel': async (page) => {
    await phase(page, 'intro');
  },
  'lantern-market': async (page) => {
    await phase(page, 'intro');
  },
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
  // ボウリング：10フレームを選び、1人目が引いてはなす。ピンが舞う瞬間を撮る（強さ0.7・曲がり0.6でストライクが続く幅の中ほど）。
  'strike-alley': async (page) => {
    await phase(page, 'intro');
    await page.keyboard.press('Space');
    await phase(page, 'aim');
    await page.waitForTimeout(500);
    const box = await page.locator('.irori-mock__seat[data-p="1"] .irori-pad__touch').boundingBox();
    if (!box) throw new Error('make-thumbs: strike-alley の touch の枠がありません');
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    await page.mouse.move(...at(0.1, 0.15));
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(...at(0.1 + (0.21 * i) / 8, 0.15 + (0.561 * i) / 8));
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(80);
    await page.mouse.up();
    await phase(page, 'rolling');
    await page.waitForTimeout(2650);
  },
  // 大富豪：番の席の手札から、ジョーカーと8を除いて一番多い数を最大4枚出す（4枚なら革命の印も入る）。
  daifugo: async (page) => {
    await phase(page, 'intro');
    await page.keyboard.press('Space');
    await phase(page, 'play');
    const seat = page.locator('.irori-mock__seat:has(.irori-pad__tiles-actions)').first();
    await seat.waitFor({ timeout: 15_000 });
    const tiles = seat.locator('.irori-pad__tile:not(:disabled)');
    const byRank = new Map();
    for (let i = 0, n = await tiles.count(); i < n; i++) {
      const label = (await tiles.nth(i).locator('.irori-pad__tile-label').textContent()) ?? '';
      const m = /^[♠♥♦♣](.+)$/.exec(label);
      if (!m || m[1] === '8') continue;
      byRank.set(m[1], [...(byRank.get(m[1]) ?? []), i]);
    }
    const pick = [...byRank.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    for (const i of pick.slice(0, 4)) await tiles.nth(i).click();
    await seat.locator('[data-action="ok"]').click();
    await page.waitForTimeout(2600);
  },
  // ババ抜き：配札のあと、演出が落ち着いた勝負中の机（引く線・表向きのペアが乗った捨て札）を撮る。
  'old-maid': async (page) => {
    await phase(page, 'intro');
    await page.keyboard.press('Space');
    await phase(page, 'play');
    await page.waitForFunction(() => !document.getElementById('stage')?.hasAttribute('data-busy'), null, { timeout: 15_000 });
    await page.waitForTimeout(600);
  },
  // 人狼：8人で、役の確認（見る→かくす）を済ませ、夜に3人が決める（月と8軒の家、窓が3つ消えた夜）。
  'moon-village': async (page) => {
    await phase(page, 'intro');
    await page.keyboard.press('Space');
    await phase(page, 'reveal');
    const seatOf = (p) => page.locator(`.irori-mock__seat[data-p="${p}"]`);
    for (let p = 1; p <= 8; p++) {
      await seatOf(p).locator('[data-action="ok"]').click();
      await seatOf(p).locator('[data-action="ok"]').click();
    }
    await phase(page, 'night');
    for (let p = 1; p <= 3; p++) {
      await seatOf(p).locator('.irori-pad__tile').first().click();
      await seatOf(p).locator('[data-action="ok"]').click();
    }
    await page.waitForTimeout(1200);
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
  const gameRoot = assertSafePath(root, 'games');
  if (!gameRoot?.isDirectory()) throw new Error('Unsafe source path: games (expected directory)');
  const server = createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent((req.url ?? '/').split(/[?#]/, 1)[0]);
      if (!rel.startsWith('/') || rel.startsWith('//') || rel.includes('\\') || rel.includes('\0') || rel.split('/').some((part) => part === '.' || part === '..')) {
        res.writeHead(400).end();
        return;
      }
    } catch {
      res.writeHead(400).end();
      return;
    }
    // 撮るときだけ、書体を同じオリジンから配る（CSP の font-src 'self'。枠はオリジンが空なので CORS も許す）。
    const font = rel === '/__font/jp.ttf' ? fonts.jp : undefined;
    if (font) {
      res.writeHead(200, { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(font);
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    let content;
    const source = `games/${rel.slice(1)}`;
    try {
      const st = assertSafePath(root, source);
      if (!st?.isFile()) { res.writeHead(404).end(); return; }
      content = readFileSync(join(root, source));
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(source)] ?? 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(content);
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

/** Validate the complete input/output set before fonts, browser startup, mkdir or screenshots. */
function thumbnailPlan(root, ids) {
  if (!Array.isArray(ids)) throw new Error('Unsafe source path: game ids must be an array');
  const out = assertSafePath(root, 'registry/thumbs');
  if (out && !out.isDirectory()) throw new Error('Unsafe source path: registry/thumbs (expected directory)');
  assertSafeTree(root, 'registry/thumbs', { allowMissing: true });
  return Array.from(ids, (id) => {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new Error('Unsafe source path: invalid game id');
    if (!Object.hasOwn(SCENES, id)) throw new Error(`make-thumbs: ${id} の撮り方がありません（SCENES に足す）`);
    const game = assertSafePath(root, `games/${id}`);
    if (!game?.isDirectory()) throw new Error(`Unsafe source path: games/${id} (expected directory)`);
    assertSafeTree(root, `games/${id}`);
    const manifestFile = `registry/games/${id}.json`;
    if (!assertSafePath(root, manifestFile)?.isFile()) throw new Error(`Unsafe source path: ${manifestFile} (expected file)`);
    const manifest = JSON.parse(readFileSync(join(root, manifestFile), 'utf8'));
    if (manifest?.id !== id || typeof manifest.thumbnail !== 'string' || !/^[a-z0-9-]+\.(png|jpg|webp)$/.test(manifest.thumbnail)) {
      throw new Error(`Unsafe source path: ${manifestFile} (invalid thumbnail or id)`);
    }
    const output = `registry/thumbs/${manifest.thumbnail}`;
    const existing = assertSafePath(root, output);
    if (existing && !existing.isFile()) throw new Error(`Unsafe source path: ${output} (expected file)`);
    return { id, scene: SCENES[id], thumbnail: manifest.thumbnail, path: join(root, output) };
  });
}

export async function makeThumbs(root, ids, env = process.env) {
  const plan = thumbnailPlan(root, ids);
  const fonts = loadOflFonts(env, ['jp']); // 書体が無い・違うときは、撮る前に止める
  const { chromium } = createRequire(join(root, 'package.json'))('@playwright/test');
  mkdirSync(join(root, 'registry/thumbs'), { recursive: true });
  const srv = await serveGames(root, { fonts });
  let browser;
  const made = [];
  try {
    browser = await chromium.launch();
    for (const { id, scene, thumbnail, path } of plan) {
      const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, locale: 'ja-JP' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // canvas に描く文字（hello-pad・tap-race・dot-grab）は、CSS では替わらない。ctx.font への代入を、ページの最初から差し替える。
      await page.addInitScript(canvasFontPatchScript());
      await page.goto(`http://127.0.0.1:${srv.port}/${id}/?mock=${PLAYERS[id] ?? 3}`);
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
      const jpeg = /\.jpe?g$/.test(thumbnail);
      await page.screenshot({ path, type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 90 } : {}) });
      made.push({ id, thumbnail, bytes: statSync(path).size });
      await page.close();
    }
  } finally {
    await browser?.close();
    await srv.close();
  }
  return made;
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const made = await makeThumbs(root, ids.length ? ids : Object.keys(SCENES));
  for (const m of made) console.log(`make-thumbs: registry/thumbs/${m.thumbnail}（${Math.ceil(m.bytes / 1024)}KB）`);
}
