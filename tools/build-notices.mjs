// 配布物に、ライセンスとクレジットの全文を載せる。THIRD_PARTY_NOTICES.md を、そのまま /licenses.txt として配る。
// 画面の「ライセンスとクレジット」から開く。MITの表示義務（著作権表示と許諾文を、配るものに含める）と、
// Apache-2.0 の4条(a)（ライセンスの写しを渡す。BudouX の日本語モデルの写しに適用）を満たすため。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDirectRun } from './lib/files.mjs';

export function buildNotices(root) {
  const out = join(root, 'apps/web/public/licenses.txt');
  mkdirSync(dirname(out), { recursive: true });
  const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const apache = readFileSync(join(root, 'LICENSES/Apache-2.0.txt'), 'utf8');
  writeFileSync(out, `${notices.trimEnd()}\n\n## Apache License 2.0（BudouX の日本語モデルの写しに適用）\n\n${apache.trimEnd()}\n`);
  return out;
}

if (isDirectRun(import.meta.url)) {
  console.log(`build-notices: ${buildNotices(process.cwd())}`);
}
