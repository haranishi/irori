// 実際のゲーム画面を撮影し、無音の棚用動画を作る。手順と制約は docs/previews.md。
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { assertSafePath, assertSafeTree, isDirectRun } from './lib/files.mjs';
import { canvasFontPatchScript, fontFaceCss, loadOflFonts, waitForOflFonts } from './lib/ofl-fonts.mjs';
import { seededRandom, step } from './preview-scripts/driver.mjs';

export const GAME_PLAYERS = {
  'hello-pad': 3, 'tap-race': 3, 'dot-grab': 3, 'quiz-4': 3, 'ten-seconds': 3,
  'blade-duel': 2, 'lantern-market': 3, 'strike-alley': 1, daifugo: 4,
  'old-maid': 3, 'moon-village': 5, 'bell-in-sleeve': 6, poker: 4,
};
/** 環境変数 → Homebrew の場所 → PATH の順に探す（Homebrew が無い環境でも、PATH にあれば動く）。 */
const findTool = (env, brew, name) => process.env[env] ?? (existsSync(brew) ? brew : name);
export const FFMPEG = findTool('IRORI_FFMPEG', '/opt/homebrew/bin/ffmpeg', 'ffmpeg');
export const FFPROBE = findTool('IRORI_FFPROBE', '/opt/homebrew/bin/ffprobe', 'ffprobe');
const ENDPOINT = 'ws://127.0.0.1:9333/pw';
export const MAX_BYTES = 1_000_000;

function command(bin, args, binary = false) {
  const r = spawnSync('nice', ['-n', '10', bin, ...args], {
    encoding: binary ? undefined : 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
  });
  if (r.error || r.status !== 0) throw new Error(`${bin.split('/').pop()}: ${r.error?.message ?? r.stderr.toString().slice(-2000)}`);
  return r.stdout;
}
function ffmpeg(args, binary = false) {
  return command(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-threads', '2', '-filter_threads', '1', ...args], binary);
}

export function parseArgs(args) {
  const options = { baseUrl: 'http://127.0.0.1:8787', ids: Object.keys(GAME_PLAYERS), verifyOnly: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) options.baseUrl = args[++i];
    else if (args[i] === '--only' && Object.hasOwn(GAME_PLAYERS, args[i + 1])) options.ids = [args[++i]];
    else if (args[i] === '--verify-only') options.verifyOnly = true;
    else throw new Error(`不明な引数、またはゲームIDです: ${args[i]}`);
  }
  const url = new URL(options.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--base-url は認証情報・検索・フラグメントの無いHTTP URLにしてください');
  }
  options.baseUrl = url.href.replace(/\/$/, '');
  return options;
}

export function inspectMetadata(probe, bytes) {
  const video = probe.streams?.filter((s) => s.codec_type === 'video') ?? [];
  const problems = [];
  if (video.length !== 1 || video[0].codec_name !== 'h264' || video[0].width !== 640 || video[0].height !== 360
    || video[0].pix_fmt !== 'yuv420p' || video[0].avg_frame_rate !== '30/1') problems.push('640×360・30fps・H.264・yuv420pではありません');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration < 8 || duration > 12) problems.push('長さが8〜12秒ではありません');
  if (probe.streams?.some((s) => s.codec_type === 'audio')) problems.push('音声の流れがあります');
  if (bytes <= 0 || bytes > MAX_BYTES) problems.push('容量が1MB以下ではありません');
  return problems;
}

export function motionDifference(frames, width = 640, height = 360) {
  const pixels = width * height;
  if (frames.length < pixels * 4) throw new Error('先頭4コマを取得できません');
  let sum = 0, changed = 0;
  for (let i = 0; i < pixels; i++) {
    const d = Math.abs(frames[i] - frames[pixels * 3 + i]);
    sum += d;
    if (d >= 8) changed++;
  }
  return { mean: sum / pixels, changed, moving: changed >= 32 && sum / pixels >= 0.01 };
}

// 0.5秒ごとの代表コマを比べる。圧縮雑音や数画素だけの点滅は活動に数えない。
export function activityRate(frames, width = 640, height = 360) {
  const pixels = width * height;
  const count = Math.floor(frames.length / pixels);
  if (count < 2) throw new Error('活動率に必要なコマがありません');
  let active = 0;
  for (let n = 1; n < count; n++) {
    let changed = 0, sum = 0;
    for (let i = 0; i < pixels; i++) {
      const d = Math.abs(frames[n * pixels + i] - frames[(n - 1) * pixels + i]);
      sum += d;
      if (d >= 8) changed++;
    }
    if (changed >= 32 && sum / pixels >= 0.01) active++;
  }
  const rate = active / (count - 1);
  return { activity: rate, active, intervals: count - 1, activeEnough: rate >= 0.6 };
}

export function verifyPreview(path) {
  const probe = JSON.parse(command(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]));
  const bytes = statSync(path).size;
  const problems = inspectMetadata(probe, bytes);
  if (problems.length) throw new Error(problems.join(' / '));
  const frames = ffmpeg(['-i', path, '-frames:v', '4', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], true);
  const motion = motionDifference(frames);
  if (!motion.moving) throw new Error(`先頭が動いていません（差 ${motion.mean.toFixed(4)}、変化 ${motion.changed}画素）`);
  const samples = ffmpeg(['-i', path, '-vf', 'fps=2', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], true);
  const activity = activityRate(samples);
  if (!activity.activeEnough) throw new Error(`活動率が0.6未満です（${activity.activity.toFixed(3)}、${activity.active}/${activity.intervals}区間）`);
  return { bytes, duration: Number(probe.format.duration), ...motion, ...activity };
}

// 検査か退避が失敗したら、正式ファイルには触れない。
export function replacePreview(root, id) {
  if (!Object.hasOwn(GAME_PLAYERS, id)) throw new Error('対象外のゲームIDです');
  for (const dir of ['registry/previews', '.probe-tmp/previews']) assertSafeTree(root, dir);
  const candidate = join(root, `.probe-tmp/previews/${id}.mp4`);
  const output = join(root, `registry/previews/${id}.mp4`);
  const checked = verifyPreview(candidate);
  let backup;
  if (existsSync(output)) {
    const dir = join(root, '.probe-tmp/previews/_backup');
    mkdirSync(dir, { recursive: true });
    backup = join(dir, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`);
    copyFileSync(output, backup, constants.COPYFILE_EXCL);
  }
  renameSync(candidate, output);
  return { ...checked, backup };
}

export function contactSheet(path, output) {
  const probe = JSON.parse(command(FFPROBE, ['-v', 'error', '-show_format', '-of', 'json', path]));
  const duration = Number(probe.format.duration);
  ffmpeg(['-y', '-i', path, '-vf', `fps=9/${duration},scale=320:180,tile=3x3`, '-frames:v', '1', output]);
}

function encode(raw, output, start, skipQuiet, duration, fade = 0.5) {
  // 両端だけを重ねる。途中の順序と実時間は保つ。
  const cut = skipQuiet ? `,select='lt(t,${skipQuiet.from})+gte(t,${skipQuiet.to})',setpts=N/(30*TB)` : '';
  const graph = fade === 0 ? `[0:v]fps=30${cut},scale=640:360,setsar=1,format=yuv420p[out]`
    : `[0:v]fps=30${cut},scale=640:360,setsar=1,format=yuv420p,split=2[m][h];`
    + `[m]trim=start=${fade}:end=${duration + fade},setpts=PTS-STARTPTS[main];`
    + `[h]trim=start=0:end=${fade},setpts=PTS-STARTPTS[head];`
    + `[main][head]xfade=transition=fade:duration=${fade}:offset=${duration - fade}[out]`;
  ffmpeg(['-y', '-ss', start.toFixed(3), '-i', raw, '-filter_complex_threads', '1', '-filter_complex', graph,
    '-map', '[out]', '-t', String(duration), '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
}

function movingStarts(raw, start) {
  // 粗い0.5秒刻みでは、一瞬の札の公開や画面切替を飛ばす。縮小コマで先に位置を探す。
  const pixels = 160 * 90;
  const frames = ffmpeg(['-ss', (start + 0.5).toFixed(3), '-i', raw, '-t', '5.5',
    '-vf', 'fps=30,scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], true);
  const starts = [];
  for (let frame = 0; frame + 3 < frames.length / pixels; frame++) {
    const difference = motionDifference(frames.subarray(frame * pixels, (frame + 4) * pixels), 160, 90);
    if (difference.mean >= 0.01 && difference.changed >= 4) {
      starts.push(start + frame / 30);
      frame += 2;
      if (starts.length === 12) break;
    }
  }
  return starts;
}

export function editPreview(raw, candidate, start = 0, skipQuiet, duration = 10) {
  for (const position of movingStarts(raw, start)) {
    encode(raw, candidate, position, skipQuiet, duration);
    try { return verifyPreview(candidate); } catch (error) {
      if (!error.message.startsWith('先頭が動いていません')) throw error;
    }
  }
  throw new Error('録画内で動いている先頭が見つかりません');
}

// 連続窓の候補を縮小コマで順位付けし、正式な解像度と基準で検査する。
export function editContinuousPreview(raw, candidate, windows, duration = 9.5) {
  const pixels = 160 * 90;
  const frames = ffmpeg(['-i', raw, '-vf', 'fps=10,scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], true);
  const positions = [];
  for (const [from, to] of windows) {
    for (let n = Math.ceil(from * 10); n / 10 + duration <= to; n++) {
      let score = 0;
      for (let k = n; k + 5 <= n + duration * 10; k += 5) {
        const sample = Buffer.concat([frames.subarray(k * pixels, (k + 1) * pixels),
          frames.subarray((k + 5) * pixels, (k + 6) * pixels)]);
        if (activityRate(sample, 160, 90).activeEnough) score++;
      }
      positions.push({ start: n / 10, score });
    }
  }
  positions.sort((a, b) => b.score - a.score || a.start - b.start);
  const attempt = candidate.replace(/\.mp4$/, '-attempt.mp4');
  let best, failure;
  for (const { start } of positions.slice(0, 12)) {
    encode(raw, attempt, start, undefined, duration, 0);
    const samples = ffmpeg(['-i', attempt, '-vf', 'fps=2', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], true);
    const activity = activityRate(samples);
    if (!best || activity.activity > best.activity) {
      best = { start, ...activity };
      copyFileSync(attempt, candidate);
    }
    try {
      const checked = verifyPreview(attempt);
      copyFileSync(attempt, candidate);
      console.log('連続窓', JSON.stringify({ from: start, to: start + duration, fade: 0 }));
      return checked;
    } catch (error) { failure = error; }
  }
  console.log('連続窓の最高活動率', JSON.stringify(best));
  throw failure ?? new Error('9〜10秒の連続窓がありません');
}

/**
 * 動画の文字を、OS の書体（Hiragino や SF）でなく、再配布してよい Noto Sans JP（SIL OFL）に替える CSS。
 * 動画を CC BY 4.0 で配るため（docs/legal/rights-check.md）。書体ファイルは、リポジトリに入れない。
 */
export function previewFontCss() {
  return [
    fontFaceCss({ jpUrl: '/__font/jp.ttf' }),
    "html, body, body * { font-family: 'IroriOfl', sans-serif !important; }",
  ].join('\n');
}

/**
 * 画面に描かれた文字のうち、OS の書体で描かれたものを数える（CDP の CSS.getPlatformFontsForNode の結果を渡す）。
 * 動画に OS の書体の文字が残っていないことを確かめるため。entries は [{ selector, fonts: [{ familyName, isCustomFont, glyphCount }] }]。
 */
export function osFontUsage(entries) {
  const used = new Map();
  for (const { selector, fonts } of entries) {
    for (const f of fonts) {
      if (f.isCustomFont || !(f.glyphCount > 0)) continue;
      const row = used.get(f.familyName) ?? { glyphs: 0, selectors: new Set() };
      row.glyphs += f.glyphCount;
      row.selectors.add(selector);
      used.set(f.familyName, row);
    }
  }
  return [...used].map(([family, { glyphs, selectors }]) => ({ family, glyphs, selectors: [...selectors].slice(0, 5) }));
}

/** 録画する画面に、OS の書体が使われていないこと。使われていれば、動画を作らずに止める。 */
async function assertNoOsFonts(page, id) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    // 撮影では見えない仮想プレイヤーの帯（opacity:0）は、動画に写らないので除く。
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body *:not(.irori-mock):not(.irori-mock *)' });
    const entries = [];
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      if (!fonts.some((f) => !f.isCustomFont && f.glyphCount > 0)) continue;
      const { node } = await cdp.send('DOM.describeNode', { nodeId });
      const cls = (node.attributes ?? []).find((_, i, a) => a[i - 1] === 'class') ?? '';
      entries.push({ selector: `${node.nodeName.toLowerCase()}${cls ? `.${cls.split(/\s+/)[0]}` : ''}`, fonts });
    }
    const bad = osFontUsage(entries);
    if (bad.length) {
      throw new Error(`${id}: 画面に OS の書体が使われています（動画に残せません）: ${bad.map((b) => `${b.family}×${b.glyphs}字（${b.selectors.join(', ')}）`).join(' / ')}`);
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function capture(browser, root, id, baseUrl, fonts) {
  const scriptPath = join(root, `tools/preview-scripts/${id}.mjs`);
  const script = existsSync(scriptPath) ? await import(pathToFileURL(scriptPath)) : {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    locale: 'ja-JP', recordVideo: { dir: join(root, '.probe-tmp/previews/recordings'), size: { width: 1280, height: 720 } } });
  let video;
  const errors = [];
  let start;
  let segments;
  let windows;
  try {
    await context.addInitScript(() => {
      // OSのポインタを捕まえない。ゲームの規則や描画は変更しない。
      Element.prototype.requestPointerLock = () => Promise.reject(new Error('撮影ではマウス固定を使いません'));
    });
    // 画面の文字を、再配布してよい書体に替える。書体は同じオリジンから配る（枠はオリジンが空なので CORS も許す）。
    await context.route('**/__font/jp.ttf', (route) => route.fulfill({ status: 200, contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: fonts.jp }));
    await context.addInitScript(canvasFontPatchScript());
    const page = await context.newPage();
    const born = performance.now();
    video = page.video();
    page.on('pageerror', (error) => errors.push(error.message));
    const query = script.query ?? `mock=${script.players ?? GAME_PLAYERS[id]}`;
    await page.goto(`${baseUrl}/games/${id}/?${query}`, { timeout: 20_000 });
    await page.locator('.irori-mock[data-ready]').waitFor({ state: 'attached', timeout: 15_000 });
    await page.addStyleTag({ content: '.irori-mock__banner,.irori-mock__panel,.irori-mock__results { opacity:0!important; pointer-events:none!important } body { cursor:none!important }' });
    await page.addStyleTag({ content: previewFontCss() });
    await waitForOflFonts(page, { jp: true, mono: false });
    // 書体が読み込まれたあとで、canvas を描き直させる。
    await page.evaluate(() => new Promise((done) => { window.dispatchEvent(new Event('resize')); requestAnimationFrame(() => requestAnimationFrame(done)); }));
    await assertNoOsFonts(page, id);
    const rng = seededRandom(20261106);
    let tick = 0;
    const act = async () => {
      if (script.step) return script.step(page, rng, tick++);
      return step(page, rng, tick++, script.options);
    };
    if (script.capture) {
      const clock = () => (performance.now() - born) / 1000;
      ({ start = 0, segments, windows } = await script.capture(page, rng, clock));
    } else {
      // 冒頭の説明を抜け、操作が始まった場面から候補を取る。
      for (let n = 0; n < (script.warmupSteps ?? 8); n++) { await act(); await page.waitForTimeout(450); }
      start = (performance.now() - born) / 1000;
      for (let n = 0; n < (script.captureSteps ?? 40); n++) { await act(); await page.waitForTimeout(450); }
    }
    if (errors.length) throw new Error(`ゲームの例外: ${errors.join(' / ')}`);
  } finally {
    await context.close();
  }
  const raw = join(root, `.probe-tmp/previews/${id}.webm`);
  await video.saveAs(raw);
  if (windows) return { raw, windows, duration: script.duration ?? 9.5 };
  if (segments) {
    // 操作は実時間のまま撮り、止まっている区間だけを編集で省く。
    const cut = join(root, `.probe-tmp/previews/${id}-cut.mp4`);
    let graph = segments.map(([from, to], i) => `[0:v]fps=30,trim=start=${from}:end=${to},setpts=PTS-STARTPTS,format=yuv420p[s${i}]`).join(';');
    if (script.segmentFade) {
      let length = segments[0][1] - segments[0][0];
      for (let i = 1; i < segments.length; i++) {
        graph += `;[${i === 1 ? 's0' : `f${i - 1}`}][s${i}]xfade=transition=fade:duration=${script.segmentFade}:offset=${length - script.segmentFade}[f${i}]`;
        length += segments[i][1] - segments[i][0] - script.segmentFade;
      }
      graph += `;[f${segments.length - 1}]null[out]`;
    } else {
      graph += ';' + segments.map((_, i) => `[s${i}]`).join('') + `concat=n=${segments.length}:v=1:a=0[out]`;
    }
    ffmpeg(['-y', '-i', raw, '-filter_complex_threads', '1', '-filter_complex', graph, '-map', '[out]',
      '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '18', cut]);
    return { raw: cut, start: 0, duration: script.duration ?? 10 };
  }
  return { raw, start, skipQuiet: script.skipQuiet, duration: script.duration ?? 10 };
}

export async function makePreviews(root, options) {
  // 出力と中間ファイルのリンクを、ブラウザ接続や書き込みより前に拒む。
  for (const dir of ['registry/previews', '.probe-tmp/previews', '.probe-tmp/sheets']) {
    assertSafeTree(root, dir, { allowMissing: true });
  }
  for (const id of options.ids) {
    if (!Object.hasOwn(GAME_PLAYERS, id)) throw new Error('対象外のゲームIDです');
    assertSafePath(root, `tools/preview-scripts/${id}.mjs`);
  }
  for (const dir of ['registry/previews', '.probe-tmp/previews', '.probe-tmp/sheets']) mkdirSync(join(root, dir), { recursive: true });
  const results = [];
  // 書体が無い・確認ずみのものと違うときは、ブラウザにつなぐ前に止める（OS の書体の動画を作らないため）。
  const fonts = options.verifyOnly ? null : loadOflFonts(process.env, ['jp']);
  const browser = options.verifyOnly ? null : await chromium.connect(ENDPOINT, { timeout: 15_000 });
  try {
    for (const id of options.ids) {
      try {
        const output = join(root, `registry/previews/${id}.mp4`);
        if (!options.verifyOnly) {
          const { raw, start, skipQuiet, duration, windows } = await capture(browser, root, id, options.baseUrl, fonts);
          const candidate = join(root, `.probe-tmp/previews/${id}.mp4`);
          // 同じ録画内で開始位置だけを探す。静止画への人工的な動きは加えない。
          if (windows) editContinuousPreview(raw, candidate, windows, duration);
          else editPreview(raw, candidate, start, skipQuiet, duration);
          replacePreview(root, id);
        }
        const checked = verifyPreview(output);
        contactSheet(output, join(root, `.probe-tmp/sheets/${id}.png`));
        results.push({ id, ...checked });
        console.log(`make-previews: OK ${id} ${checked.bytes} B / ${checked.duration.toFixed(2)}秒 / 先頭差 ${checked.mean.toFixed(3)}（${checked.changed}画素） / 活動率 ${checked.activity.toFixed(3)}（${checked.active}/${checked.intervals}）`);
      } catch (error) {
        results.push({ id, error: error.message });
        console.error(`make-previews: NG ${id}: ${error.message}`);
      }
    }
  } finally { await browser?.close(); }
  return results;
}

if (isDirectRun(import.meta.url)) {
  const results = await makePreviews(process.cwd(), parseArgs(process.argv.slice(2)));
  const failed = results.filter((r) => r.error).length;
  console.log(`make-previews: 成功 ${results.length - failed}件 / 失敗 ${failed}件`);
  if (failed) process.exitCode = 1;
}
