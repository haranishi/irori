// 依存の向きの検査（docs/architecture.md）。部品どうしが逆向きに読み合わないことを、importを数えて確かめる。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { isDirectRun, listFiles, readText, toPosix } from './lib/files.mjs';

export const ALLOWED = {
  '@irori/protocol': [],
  '@irori/room': ['@irori/protocol'],
  '@irori/room-client': ['@irori/protocol'],
  '@irori/pad-ui': ['@irori/protocol'],
  '@irori/host-bridge': ['@irori/protocol'],
  '@irori/sdk': ['@irori/protocol', '@irori/pad-ui'],
  '@irori/edge': ['@irori/protocol', '@irori/room'],
  '@irori/web': ['@irori/protocol', '@irori/pad-ui', '@irori/host-bridge', '@irori/room-client'],
};

// from は、直前が引用符・英数字・ドットのときは読み込みの from ではない（文字列 'from' や、プロパティ model.turn.from の誤認を避ける）。
const IMPORT_RE = /(?:(?<![\w.'"`])from\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)["']([^"']+)["']/g;

function workspaceDirs(root) {
  const dirs = {};
  for (const group of ['apps', 'packages']) {
    if (!existsSync(join(root, group))) continue;
    for (const name of readdirSync(join(root, group))) {
      const pj = join(root, group, name, 'package.json');
      if (!existsSync(pj)) continue;
      dirs[JSON.parse(readFileSync(pj, 'utf8')).name] = `${group}/${name}`;
    }
  }
  return dirs;
}

export function checkDeps(root) {
  const problems = [];
  const dirs = workspaceDirs(root);
  const byDir = Object.fromEntries(Object.entries(dirs).map(([n, d]) => [d, n]));

  // package.json の dependencies / devDependencies にある内部の依存も同じ表で見る。
  for (const [name, dir] of Object.entries(dirs)) {
    const pj = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pj.dependencies, ...pj.devDependencies }).filter((d) => d.startsWith('@irori/'));
    for (const d of deps) {
      if (!(ALLOWED[name] ?? []).includes(d)) problems.push(`${dir}/package.json: ${name} → ${d} は許可された依存の向きではありません`);
    }
  }

  for (const rel of listFiles(root)) {
    if (!/\.(ts|tsx|js|mjs)$/.test(rel)) continue;
    const dir = rel.split('/').slice(0, 2).join('/');
    const owner = byDir[dir];
    const isSrc = /^(apps|packages)\/[^/]+\/src\//.test(rel);
    const isGame = /^games\/[^/]+\//.test(rel);
    // ゲームの試験（配らない）は、試験の道具 vitest だけを読んでよい。ゲーム本体は、自分のフォルダと irori.js だけ。
    const isGameTest = isGame && /\.test\.js$/.test(rel);
    if (!isSrc && !isGame) continue;
    const text = readText(root, rel);
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const target = toPosix(normalize(join(dirname(rel), spec)));
        const base = isGame ? rel.split('/').slice(0, 2).join('/') : dir;
        if (!(target + '/').startsWith(base + '/')) problems.push(`${rel}: 相対importが自分の置き場所の外へ出ています → ${spec}`);
      } else if (spec.startsWith('@irori/')) {
        if (isGame) problems.push(`${rel}: ゲームは部品を読みません（自分のフォルダと irori.js だけ） → ${spec}`);
        else if (owner && spec !== owner && !(ALLOWED[owner] ?? []).includes(spec.split('/').slice(0, 2).join('/'))) {
          problems.push(`${rel}: ${owner} → ${spec} は許可された依存の向きではありません`);
        }
      } else if (isGame && !spec.startsWith('/') && !/^https?:/.test(spec)) {
        if (isGameTest && spec === 'vitest') continue;
        problems.push(`${rel}: ゲームは外の部品を読みません → ${spec}`);
      }
    }
  }
  return problems;
}

if (isDirectRun(import.meta.url)) {
  const problems = checkDeps(process.cwd());
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\ncheck-deps: ${problems.length}件の問題`);
    process.exit(1);
  }
  console.log('check-deps: OK');
}
