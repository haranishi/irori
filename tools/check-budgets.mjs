// 容量の点検：ビルドの出力のうち、画面が読む JavaScript を gzip で測り、上限と比べる。KB は 1024 バイト。
//   ホストの画面（/）80KB・スマホの画面（/pad）40KB・SDK（/sdk/v1/irori.js）gzip 60KB。
//   SDK は、そのままの大きさも 72KB まで（docs/architecture.md の上限。読める形で配るので minify しない）。
// 使い方：
//   node tools/check-budgets.mjs           … 自分専用の一時フォルダにビルドして測り、消す（apps/web/dist には触らない）
//   node tools/check-budgets.mjs --dir D   … すでにあるビルドの出力 D を測る（ビルドしない）
// 画面の JS は、HTML の script と modulepreload から、import（動的な import も）をたどって全部を集める。
// gzip は最大の圧縮（level 9）。配信の圧縮はこれより弱いこともあるので、上限に近づいたら余裕を見て判断する。
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildWeb } from './lib/edge-server.mjs';
import { isDirectRun } from './lib/files.mjs';

const KB = 1024;
export const BUDGETS = { host: 80 * KB, pad: 40 * KB, sdk: 60 * KB, sdkRaw: 72 * KB };

const ATTR = /<(?:script|link)\b[^>]*\b(?:src|href)="(\/[^"]+\.js)"/g;
const IMPORT = /(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.js)["']/g;

/** HTML が読む JS（import をたどった全部）の大きさ。 */
export function pageJs(dir, htmlFile) {
  const html = readFileSync(join(dir, htmlFile), 'utf8');
  const queue = [...html.matchAll(ATTR)].map((m) => m[1]);
  if (queue.length === 0) throw new Error(`${htmlFile} に JS の読み込みが見つかりません（測る対象が0件）`);
  const seen = new Set();
  const files = [];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const buf = readFileSync(join(dir, path));
    files.push({ path, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
    for (const m of buf.toString('utf8').matchAll(IMPORT)) queue.push(posix.join(posix.dirname(path), m[1]));
  }
  return { files, bytes: files.reduce((s, f) => s + f.bytes, 0), gzip: files.reduce((s, f) => s + f.gzip, 0) };
}

export function measure(dir) {
  const sdkPath = join(dir, 'sdk/v1/irori.js');
  if (!existsSync(sdkPath)) throw new Error('ビルドの出力に sdk/v1/irori.js がありません（先に npm run build -w @irori/sdk && npm run sync:sdk）');
  const sdk = readFileSync(sdkPath);
  return {
    host: pageJs(dir, 'index.html'),
    pad: pageJs(dir, 'pad.html'),
    sdk: { files: [{ path: '/sdk/v1/irori.js', bytes: sdk.length, gzip: gzipSync(sdk, { level: 9 }).length }], bytes: sdk.length, gzip: gzipSync(sdk, { level: 9 }).length },
  };
}

/** 上限を超えたものの一覧（空なら合格）。 */
export function overBudget(m) {
  const over = [];
  if (m.host.gzip > BUDGETS.host) over.push(`ホストの画面：gzip ${m.host.gzip} B（上限 ${BUDGETS.host} B）`);
  if (m.pad.gzip > BUDGETS.pad) over.push(`スマホの画面：gzip ${m.pad.gzip} B（上限 ${BUDGETS.pad} B）`);
  if (m.sdk.gzip > BUDGETS.sdk) over.push(`SDK：gzip ${m.sdk.gzip} B（上限 ${BUDGETS.sdk} B）`);
  if (m.sdk.bytes > BUDGETS.sdkRaw) over.push(`SDK：そのまま ${m.sdk.bytes} B（上限 ${BUDGETS.sdkRaw} B）`);
  return over;
}

const n = (v) => v.toLocaleString('en-US');
const pct = (v, max) => `${Math.round((v / max) * 100)}%`;

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const given = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : undefined;
  const build = given ? null : buildWeb();
  try {
    const m = measure(given ?? build.outDir);
    console.log(`check-budgets: ${given ? `ビルドの出力 ${given}` : '一時フォルダにビルドした出力'} を測りました（gzip は level 9、KB は 1024 B）`);
    console.log(`  ホストの画面（/）    gzip ${n(m.host.gzip)} B / ${n(BUDGETS.host)} B（${pct(m.host.gzip, BUDGETS.host)}）・${m.host.files.length}ファイル・そのまま ${n(m.host.bytes)} B`);
    console.log(`  スマホの画面（/pad） gzip ${n(m.pad.gzip)} B / ${n(BUDGETS.pad)} B（${pct(m.pad.gzip, BUDGETS.pad)}）・${m.pad.files.length}ファイル・そのまま ${n(m.pad.bytes)} B`);
    console.log(`  SDK（/sdk/v1/irori.js） gzip ${n(m.sdk.gzip)} B / ${n(BUDGETS.sdk)} B（${pct(m.sdk.gzip, BUDGETS.sdk)}）・そのまま ${n(m.sdk.bytes)} B / ${n(BUDGETS.sdkRaw)} B（${pct(m.sdk.bytes, BUDGETS.sdkRaw)}）`);
    for (const [name, part] of [['ホスト', m.host], ['スマホ', m.pad]]) {
      for (const f of part.files) console.log(`    ${name} ${f.path}  gzip ${n(f.gzip)} B・そのまま ${n(f.bytes)} B`);
    }
    const over = overBudget(m);
    if (over.length) {
      console.error(`\ncheck-budgets: 上限を超えました\n  ${over.join('\n  ')}`);
      process.exitCode = 1;
    } else console.log('check-budgets: OK');
  } finally {
    build?.cleanup();
  }
}
