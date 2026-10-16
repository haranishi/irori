// スマホの画面が読み込む JavaScript の容量を、ビルドの出力から測る（pad.html の script と modulepreload、そこから import されるもの）。
// 型は budget.d.mts。
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { gzipSync } from 'node:zlib';

const ATTR = /<(?:script|link)\b[^>]*\b(?:src|href)="(\/[^"]+\.js)"/g;
const IMPORT = /(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.js)["']/g;

export function padJsSizes(distDir) {
  const html = readFileSync(`${distDir}/pad.html`, 'utf8');
  const queue = [...html.matchAll(ATTR)].map((m) => m[1]);
  const seen = new Set();
  const files = [];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const buf = readFileSync(`${distDir}${path}`);
    files.push({ path, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
    for (const m of buf.toString('utf8').matchAll(IMPORT)) queue.push(posix.join(posix.dirname(path), m[1]));
  }
  return { files, totalBytes: files.reduce((s, f) => s + f.bytes, 0), totalGzip: files.reduce((s, f) => s + f.gzip, 0) };
}
