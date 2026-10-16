// SDK の配る1ファイル（packages/sdk/dist/irori.js）と型（packages/sdk/irori.d.ts）を、
// 同梱ゲーム（games/*/）とコンソールの配信の置き場（apps/web/public/sdk/v1/）へ写す。写した先は手で直さない。
//   npm run build -w @irori/sdk && node tools/sync-sdk.mjs   … 写す
//   node tools/sync-sdk.mjs --check                          … ずれがあれば終了コード1（npm run check から呼ばれる）
// --check は dist を使わず、いまのソースから一時フォルダへビルドし直して比べる。古い dist と比べると、ずれを見逃すため。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isDirectRun } from './lib/files.mjs';

const SDK = 'packages/sdk';
/** コンソールが配る置き場。ビルドが作るもの（.gitignore 済み）なので、無ければ --check では見ない。 */
const PUBLIC_DIR = 'apps/web/public/sdk/v1';

/** 写す先のフォルダ（リポジトリからの相対パス）。同梱ゲームがまだ無ければ、ゲームの分は空。 */
export function targets(root) {
  const out = [];
  const games = join(root, 'games');
  if (existsSync(games)) {
    for (const name of readdirSync(games).sort()) {
      if (!name.startsWith('.') && statSync(join(games, name)).isDirectory()) out.push(`games/${name}`);
    }
  }
  out.push(PUBLIC_DIR);
  return out;
}

export function readDist(root) {
  const js = join(root, SDK, 'dist/irori.js');
  if (!existsSync(js)) return null;
  return { js: readFileSync(js, 'utf8'), dts: readFileSync(join(root, SDK, 'irori.d.ts'), 'utf8') };
}

/**
 * npm run build -w @irori/sdk と同じ中身を、一時フォルダへ作る。出力の区切りの印（//#region）には
 * 実行したフォルダからの相対パスが入るので、同じ packages/sdk で、別のプロセスとして組む。
 */
export async function buildFresh(root) {
  const pkg = createRequire(join(root, 'package.json')).resolve('vite/package.json');
  const vite = join(dirname(pkg), 'bin/vite.js');
  const out = mkdtempSync(join(tmpdir(), 'irori-sync-sdk-'));
  try {
    const r = spawnSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: join(root, SDK),
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`SDK のビルドに失敗しました\n${r.stdout}${r.stderr}`);
    return { js: readFileSync(join(out, 'irori.js'), 'utf8'), dts: readFileSync(join(root, SDK, 'irori.d.ts'), 'utf8') };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

export function syncSdk(root, built) {
  const written = [];
  for (const dir of targets(root)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'irori.js'), built.js);
    writeFileSync(join(root, dir, 'irori.d.ts'), built.dts);
    written.push(dir);
  }
  return written;
}

export function checkSdk(root, built) {
  const problems = [];
  for (const dir of targets(root)) {
    if (dir === PUBLIC_DIR && !existsSync(join(root, dir))) continue;
    for (const [name, want] of [['irori.js', built.js], ['irori.d.ts', built.dts]]) {
      const file = join(root, dir, name);
      if (!existsSync(file)) problems.push(`${dir}/${name}: ありません`);
      else if (readFileSync(file, 'utf8') !== want) problems.push(`${dir}/${name}: いまの SDK のビルドと違います`);
    }
  }
  return problems;
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  if (process.argv.includes('--check')) {
    const problems = checkSdk(root, await buildFresh(root));
    if (problems.length) {
      console.error(problems.join('\n'));
      console.error(`\nsync-sdk: ${problems.length}件のずれ。手で直さず、npm run build -w @irori/sdk && npm run sync:sdk で写し直してください`);
      process.exit(1);
    }
    const n = targets(root).filter((d) => d !== PUBLIC_DIR).length;
    console.log(`sync-sdk: OK（同梱ゲーム ${n} 本${n === 0 ? '。まだ無いので、ゲームの分は飛ばした' : ''}）`);
  } else {
    const built = readDist(root);
    if (!built) {
      console.error(`sync-sdk: ${SDK}/dist/irori.js がありません。先に npm run build -w @irori/sdk を実行してください`);
      process.exit(1);
    }
    const written = syncSdk(root, built);
    console.log(`sync-sdk: ${written.length}か所に写しました（${written.join(', ')}）`);
  }
}
