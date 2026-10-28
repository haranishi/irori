// リポジトリのファイルを数える共通部品。生成物と依存は数えない。
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Dependency/module links and Git metadata are deliberately outside the checkout policy.
const IGNORED_DIRS = new Set(['.git', 'node_modules']);
const GENERATED_DIRS = new Set(['dist', '.wrangler', 'test-results', 'playwright-report', 'coverage']);
// Generated contents are not source inputs, but their metadata must be safe before build tools write here.
const GENERATED = ['apps/web/public/games/', 'apps/web/public/registry/', 'apps/web/public/sdk/'];

export function toPosix(p) {
  return p.split(sep).join('/');
}

/** Reject links and special files without dereferencing them, including existing output ancestors. */
export function assertSafePath(root, rel) {
  root = realpathSync(root);
  const file = resolve(root, rel);
  const within = relative(root, file);
  if (isAbsolute(rel) || within === '..' || within.startsWith(`..${sep}`)) {
    throw new Error('Unsafe source path: path escapes the repository');
  }
  const parts = within === '' ? [] : within.split(sep);
  let current = root;
  let st = lstatSync(root);
  for (let i = 0; i < parts.length; i++) {
    if (!st.isDirectory()) throw new Error(`Unsafe source path: ${toPosix(within)} (ancestor is not a directory)`);
    current = join(current, parts[i]);
    try { st = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) {
      throw new Error(`Unsafe source path: ${toPosix(relative(root, current))} (links and special files are forbidden)`);
    }
  }
  return st;
}

/** Validate a complete tree before copying or removing it. A stable checkout is assumed. */
export function assertSafeTree(root, rel, { allowMissing = false, include = () => true } = {}) {
  const st = assertSafePath(root, rel);
  if (!st) {
    if (allowMissing) return;
    throw new Error(`Unsafe source path: ${rel} (missing)`);
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(join(root, rel)).sort()) {
    if (include(name)) assertSafeTree(root, join(rel, name), { include });
  }
}

export function listFiles(root) {
  root = realpathSync(root);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(dir, name);
      const rel = toPosix(relative(root, full));
      const st = assertSafePath(root, rel);
      if (GENERATED_DIRS.has(name) || GENERATED.some((g) => (rel + '/').startsWith(g))) {
        if (!st.isDirectory()) throw new Error(`Unsafe source path: ${rel} (expected generated directory)`);
        assertSafeTree(root, rel); // Inspect metadata only; do not read or list generated contents as sources.
        continue;
      }
      if (st.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

export function readText(root, rel) {
  assertSafePath(root, rel);
  return readFileSync(join(root, rel), 'utf8');
}

const TEXT_EXT = /\.(md|ts|tsx|js|mjs|cjs|json|jsonc|html|css|svg|yml|yaml|toml|txt|mts|cts)$/i;
export function isTextFile(rel) {
  return TEXT_EXT.test(rel) || /^(LICENSE|\.gitignore|\.gitattributes|\.editorconfig|\.nvmrc)/.test(rel.split('/').pop() ?? '');
}

export function isDirectRun(importMetaUrl) {
  return process.argv[1] !== undefined && importMetaUrl === pathToFileURL(process.argv[1]).href;
}
