// 棚の一覧を作る。tools/check-registry.mjs の検査を全部通ってから、配信の置き場（.gitignore 済み）へ書き出す。
//   node tools/build-registry.mjs                  … 検査して書き出す。問題があれば何も書かずに終了コード1
//   node tools/build-registry.mjs --sdk-from-dist  … SDK を組み直さず packages/sdk/dist/irori.js と比べる
// 書き出すもの：
//   apps/web/public/registry/index.json   … { schema: 1, games: [...] }。新しい順（added の降順、同じ日は id 順）。
//                                           各ゲームに、サムネイルの公開パス thumbUrl（/registry/thumbs/<file>）を足す。
//   apps/web/public/registry/thumbs/      … registry/thumbs/* の写し
//   apps/web/public/games/<id>/           … 同梱ゲームの写し。README.md と *.test.js は配らない
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRegistry, loadSdk } from './check-registry.mjs';
import { assertSafePath, assertSafeTree, isDirectRun, listFiles } from './lib/files.mjs';

const OUT_REGISTRY = 'apps/web/public/registry';
const OUT_GAMES = 'apps/web/public/games';

/** 配らないファイル：説明と試験。隠しファイルと node_modules も写さない。 */
export function shipped(/** @type {string} */ name) {
  return name !== 'README.md' && !name.endsWith('.test.js') && !name.startsWith('.') && name !== 'node_modules';
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from).sort()) {
    if (!shipped(name)) continue;
    const src = join(from, name);
    if (statSync(src).isDirectory()) n += copyDir(src, join(to, name));
    else {
      copyFileSync(src, join(to, name));
      n++;
    }
  }
  return n;
}

/** 新しい順。同じ日は id の順にして、毎回同じ並びにする。 */
export function shelfOrder(games) {
  return [...games].sort((a, b) => (a.added === b.added ? (a.id < b.id ? -1 : 1) : a.added < b.added ? 1 : -1));
}

/**
 * 検査を通った登録情報から、一覧と写しを作る。前回の書き出しは消してから作る（消したゲームが残らないように）。
 * @param {string} root
 * @param {Record<string, any>[]} games
 */
export function writeRegistry(root, games) {
  // Validate every input and destination before removing the previous working output.
  const thumbsStat = assertSafePath(root, 'registry/thumbs');
  if (thumbsStat && !thumbsStat.isDirectory()) throw new Error('Unsafe source path: registry/thumbs (expected directory)');
  assertSafeTree(root, 'registry/thumbs', { allowMissing: true });
  for (const game of games) {
    if (typeof game.entry?.bundled !== 'string') continue;
    if (!/^games\/[a-z0-9-]+\/$/.test(game.entry.bundled)) throw new Error('Unsafe source path: invalid bundled game directory');
    const source = assertSafePath(root, game.entry.bundled);
    if (source && !source.isDirectory()) throw new Error('Unsafe source path: bundled game (expected directory)');
    assertSafeTree(root, game.entry.bundled, { include: shipped });
  }
  for (const out of [OUT_REGISTRY, OUT_GAMES]) {
    const st = assertSafePath(root, out);
    if (st && !st.isDirectory()) throw new Error(`Unsafe source path: ${out} (expected directory)`);
    assertSafeTree(root, out, { allowMissing: true });
  }
  rmSync(join(root, OUT_REGISTRY), { recursive: true, force: true });
  rmSync(join(root, OUT_GAMES), { recursive: true, force: true });
  mkdirSync(join(root, OUT_REGISTRY, 'thumbs'), { recursive: true });
  const list = shelfOrder(games).map((g) => ({ ...g, thumbUrl: `/registry/thumbs/${g.thumbnail}` }));
  writeFileSync(join(root, OUT_REGISTRY, 'index.json'), `${JSON.stringify({ schema: 1, games: list }, null, 2)}\n`);
  const thumbs = join(root, 'registry/thumbs');
  let thumbCount = 0;
  for (const name of existsSync(thumbs) ? readdirSync(thumbs).sort() : []) {
    if (name.startsWith('.') || !statSync(join(thumbs, name)).isFile()) continue;
    copyFileSync(join(thumbs, name), join(root, OUT_REGISTRY, 'thumbs', name));
    thumbCount++;
  }
  let fileCount = 0;
  for (const g of list) {
    if (typeof g.entry?.bundled !== 'string') continue;
    const folder = g.entry.bundled.replace(/\/$/, '');
    fileCount += copyDir(join(root, folder), join(root, OUT_GAMES, folder.slice('games/'.length)));
  }
  return { games: list.length, thumbs: thumbCount, files: fileCount };
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  listFiles(root);
  const { problems, games } = checkRegistry(root, { sdk: await loadSdk(root) });
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\nbuild-registry: ${problems.length}件の問題。何も書き出していません`);
    process.exit(1);
  }
  const r = writeRegistry(root, games);
  console.log(`build-registry: ${r.games}件を ${OUT_REGISTRY}/index.json へ（サムネイル${r.thumbs}枚・ゲームのファイル${r.files}個を写した）`);
}
