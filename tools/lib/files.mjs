// リポジトリのファイルを数える共通部品。生成物と依存は数えない。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.wrangler', 'test-results', 'playwright-report', 'coverage',
]);
// ビルドが作る置き場。コミットしないので、検査もしない。
const GENERATED = ['apps/web/public/games/', 'apps/web/public/registry/', 'apps/web/public/sdk/'];

export function toPosix(p) {
  return p.split(sep).join('/');
}

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(dir, name);
      const rel = toPosix(relative(root, full));
      if (GENERATED.some((g) => (rel + '/').startsWith(g))) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

export function readText(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const TEXT_EXT = /\.(md|ts|tsx|js|mjs|cjs|json|jsonc|html|css|svg|yml|yaml|toml|txt|mts|cts)$/i;
export function isTextFile(rel) {
  return TEXT_EXT.test(rel) || /^(LICENSE|\.gitignore|\.gitattributes|\.editorconfig|\.nvmrc)/.test(rel.split('/').pop() ?? '');
}

export function isDirectRun(importMetaUrl) {
  return process.argv[1] !== undefined && importMetaUrl === pathToFileURL(process.argv[1]).href;
}
