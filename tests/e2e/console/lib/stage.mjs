// ビルドの出力（buildWeb の自分専用の置き場）に、同梱ゲームと棚の一覧を、いまのソースから置き直す。
// apps/web/public/{games,registry} は前回の build-registry の写しで、古いことがある。試験は games/・registry/ の
// いまの中身を配る（変異の試験で games/ を壊したときも、その写しが配られるように）。並び方と写す範囲は
// tools/build-registry.mjs の shelfOrder・shipped をそのまま使い、本番の書き出しとそろえる。
// extra には、試験だけで使うゲーム（悪意のあるゲーム・6種を出すゲーム）を足せる。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shelfOrder, shipped } from '../../../../tools/build-registry.mjs';
import { ROOT } from '../../../../tools/lib/edge-server.mjs';

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).sort()) {
    if (!shipped(name)) continue;
    const src = join(from, name);
    if (statSync(src).isDirectory()) copyDir(src, join(to, name));
    else copyFileSync(src, join(to, name));
  }
}

/**
 * @typedef {{ manifest: Record<string, any>, dir: string, thumbFrom?: string }} ExtraGame
 *   dir はゲームのフォルダ（絶対パス）。thumbFrom は registry/thumbs/ の中の、サムネイルに流用する画像。
 */

/**
 * @param {string} outDir buildWeb の出力先
 * @param {ExtraGame[]} [extra]
 * @returns {{ games: string[] }} 棚に並ぶ順の id
 */
export function stageGames(outDir, extra = []) {
  const regDir = join(ROOT, 'registry/games');
  const games = readdirSync(regDir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(regDir, n), 'utf8')));
  const all = [...games, ...extra.map((e) => e.manifest)];
  const list = shelfOrder(all).map((g) => ({ ...g, thumbUrl: `/registry/thumbs/${g.thumbnail}` }));
  rmSync(join(outDir, 'registry'), { recursive: true, force: true });
  rmSync(join(outDir, 'games'), { recursive: true, force: true });
  mkdirSync(join(outDir, 'registry/thumbs'), { recursive: true });
  writeFileSync(join(outDir, 'registry/index.json'), `${JSON.stringify({ schema: 1, games: list }, null, 2)}\n`);
  for (const g of games) {
    copyFileSync(join(ROOT, 'registry/thumbs', g.thumbnail), join(outDir, 'registry/thumbs', g.thumbnail));
    const folder = String(g.entry.bundled).replace(/\/$/, '');
    copyDir(join(ROOT, folder), join(outDir, 'games', folder.slice('games/'.length)));
  }
  for (const e of extra) {
    const id = e.manifest.id;
    copyFileSync(join(ROOT, 'registry/thumbs', e.thumbFrom ?? 'hello-pad.png'), join(outDir, 'registry/thumbs', e.manifest.thumbnail));
    copyDir(e.dir, join(outDir, 'games', id));
  }
  return { games: list.map((g) => g.id) };
}

/** 同梱ゲームと同じ形で配る SDK（sync-sdk が games/* に写したもの）。試験のゲームにも同じものを置く。 */
export function sdkFile() {
  const p = join(ROOT, 'games/hello-pad/irori.js');
  if (!existsSync(p)) throw new Error('games/hello-pad/irori.js がありません（npm run build -w @irori/sdk && npm run sync:sdk）');
  return p;
}
