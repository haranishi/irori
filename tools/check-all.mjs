// 点検をまとめて流す。1つでも落ちたら、終了コード1。`npm run check` の入口。
// quick で省略する点検はない。省略したいときは、個別のコマンドを直接使う。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectRun } from './lib/files.mjs';

const STEPS = [
  ['文書の長さとリンク', ['node', 'tools/check-docs.mjs']],
  ['権利（禁止語・音声と書体・外部の読み込み）', ['node', 'tools/check-rights.mjs']],
  ['依存の向き', ['node', 'tools/check-deps.mjs']],
  ['依存のライセンス', ['node', 'tools/check-licenses.mjs']],
  ['登録情報', ['node', 'tools/check-registry.mjs'], 'tools/check-registry.mjs'],
  ['SDKの同期', ['node', 'tools/sync-sdk.mjs', '--check'], 'tools/sync-sdk.mjs'],
];

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  let failed = 0;
  for (const [label, cmd, required] of STEPS) {
    if (required && !existsSync(join(root, required))) {
      console.error(`✗ ${label}: ${required} がありません`);
      failed++;
      continue;
    }
    console.log(`\n▶ ${label}`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`✗ ${label}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\ncheck: ${failed}件の点検が落ちました`);
    process.exit(1);
  }
  console.log('\ncheck: すべて OK');
}
