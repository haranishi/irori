// @vitest-environment node
/// <reference types="node" />
// tools/sync-sdk.mjs の試験（道具の置き場の試験は別の担当の場所なので、SDK の試験として置く）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

type Built = { js: string; dts: string };
type Tool = {
  targets(root: string): string[];
  syncSdk(root: string, built: Built): string[];
  checkSdk(root: string, built: Built): string[];
  buildFresh(root: string): Promise<Built>;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let tool: Tool;
const dirs: string[] = [];

beforeAll(async () => {
  tool = (await import(pathToFileURL(join(ROOT, 'tools/sync-sdk.mjs')).href)) as Tool;
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeRepo(games: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'irori-sync-test-'));
  dirs.push(root);
  for (const g of games) {
    mkdirSync(join(root, 'games', g), { recursive: true });
    writeFileSync(join(root, 'games', g, 'index.html'), '<!doctype html>');
  }
  return root;
}

const built: Built = { js: 'export { connect };\n', dts: 'export declare function connect(): void;\n' };

describe('tools/sync-sdk.mjs', () => {
  it('同梱ゲームとコンソールの置き場へ、irori.js と irori.d.ts を写す', () => {
    const root = fakeRepo(['b-game', 'a-game']);
    expect(tool.syncSdk(root, built)).toEqual(['games/a-game', 'games/b-game', 'apps/web/public/sdk/v1']);
    for (const d of ['games/a-game', 'games/b-game', 'apps/web/public/sdk/v1']) {
      expect(readFileSync(join(root, d, 'irori.js'), 'utf8')).toBe(built.js);
      expect(readFileSync(join(root, d, 'irori.d.ts'), 'utf8')).toBe(built.dts);
    }
    expect(tool.checkSdk(root, built)).toEqual([]);
  });

  it('--check は、手で直した写し・欠けた写し・古い写しを見つける', () => {
    const root = fakeRepo(['a-game', 'b-game']);
    tool.syncSdk(root, built);
    writeFileSync(join(root, 'games/a-game/irori.js'), `${built.js}// 手で直した\n`);
    rmSync(join(root, 'games/b-game/irori.d.ts'));
    expect(tool.checkSdk(root, built)).toEqual(['games/a-game/irori.js: いまの SDK のビルドと違います', 'games/b-game/irori.d.ts: ありません']);
    expect(tool.checkSdk(root, { ...built, js: 'export {};\n' }).length).toBe(4);
  });

  it('同梱ゲームがまだ無く、配信の置き場も作られていなければ、何も見ずに通る', () => {
    const root = fakeRepo([]);
    expect(tool.targets(root)).toEqual(['apps/web/public/sdk/v1']);
    expect(tool.checkSdk(root, built)).toEqual([]);
  });

  it('いまのソースからのビルドは、何度組んでも同じ中身になる（比べる基準がぶれない）', async () => {
    const fresh = await tool.buildFresh(ROOT);
    expect(fresh.js).toContain('export { IroriError, connect }');
    expect(fresh.dts).toBe(readFileSync(join(ROOT, 'packages/sdk/irori.d.ts'), 'utf8'));
    const again = await tool.buildFresh(ROOT);
    expect(again.js).toBe(fresh.js);
  });
});
