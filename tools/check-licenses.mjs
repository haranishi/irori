// 配布物に入る依存（production）のライセンスを検査する。開発用の依存は、一覧を表示するだけ。
// 許可するのは、このリポジトリの MIT OR Apache-2.0 と組み合わせても、再配布の条件が増えないもの。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectRun } from './lib/files.mjs';

export const ALLOWED_LICENSES = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense',
]);

/** SPDX式を、(a OR b) AND c の形まで読む。括弧は1段まで。 */
export function licenseAllowed(expr, allowed = ALLOWED_LICENSES) {
  if (!expr || typeof expr !== 'string') return false;
  const clean = expr.replace(/[()]/g, ' ').trim();
  return clean.split(/\s+OR\s+/i).some((alt) =>
    alt.split(/\s+AND\s+/i).every((id) => allowed.has(id.trim())),
  );
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function productionPackages(root) {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) return { error: 'package-lock.json がありません' };
  const lock = readJson(lockPath);
  const pkgs = lock.packages ?? {};
  const workspaceNames = new Set();
  const queue = [];
  for (const [path, info] of Object.entries(pkgs)) {
    if (path === '' || (!path.includes('node_modules') && info.name)) {
      workspaceNames.add(info.name ?? path);
      for (const dep of Object.keys(info.dependencies ?? {})) queue.push({ name: dep, from: path });
    }
  }
  const seen = new Map();
  while (queue.length) {
    const { name, from } = queue.pop();
    if (name.startsWith('@irori/')) continue;
    // lock の探索規則：from の下の node_modules → 上の階層 → ルート
    const candidates = [];
    let base = from;
    while (true) {
      candidates.push(`${base ? base + '/' : ''}node_modules/${name}`);
      if (!base) break;
      const idx = base.lastIndexOf('/node_modules/');
      base = idx === -1 ? '' : base.slice(0, idx);
    }
    const key = candidates.find((c) => pkgs[c]);
    if (!key || seen.has(key)) continue;
    const info = pkgs[key];
    seen.set(key, { name, version: info.version, license: info.license });
    for (const dep of Object.keys(info.dependencies ?? {})) queue.push({ name: dep, from: key });
  }
  return { list: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function checkLicenses(root) {
  const { list, error } = productionPackages(root);
  if (error) return [error];
  return list
    .filter((p) => !licenseAllowed(p.license))
    .map((p) => `${p.name}@${p.version}: ライセンス「${p.license ?? '不明'}」は許可の一覧にありません（配布物に入る依存）`);
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  const { list } = productionPackages(root);
  if (list) console.log(`配布物に入る依存 ${list.length} 件：` + (list.map((p) => `${p.name}(${p.license})`).join(', ') || 'なし'));
  const problems = checkLicenses(root);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('check-licenses: OK');
}
