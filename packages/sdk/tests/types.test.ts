// @vitest-environment node
/// <reference types="node" />
// 手書きの irori.d.ts が実装と一致し、ゲームの書き方の例が型で通ることを、本物の tsc で確かめる。
// 突き合わせの道具（Equal）が空振りしていないことも、わざと違う型を入れた写しで確かめる。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SDK = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');

function tsc(args: string[], cwd = SDK) {
  const r = spawnSync(process.execPath, [TSC, ...args], { encoding: 'utf8', cwd });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const STRICT = ['--noEmit', '--strict', '--exactOptionalPropertyTypes', '--target', 'es2023', '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', '--lib', 'es2023,dom'];

describe('irori.d.ts', () => {
  it('実装の型と一致し、例が通る（tests/types）', () => {
    const r = tsc(['-p', join(SDK, 'tests/types/tsconfig.json')]);
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });

  it('突き合わせは、席の online を省略可にしただけの違いも見逃さない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'irori-sdk-types-'));
    try {
      const head = `import type * as D from ${JSON.stringify(join(SDK, 'irori.js'))};\n`;
      const equal = 'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;\n';
      writeFileSync(join(dir, 'same.ts'), `${head}${equal}export const ok: Equal<D.PlayerInfo, { id: number; name: string; online: boolean }> = true;\n`);
      writeFileSync(join(dir, 'differ.ts'), `${head}${equal}export const ng: Equal<D.PlayerInfo, { id: number; name: string; online?: boolean }> = true;\n`);
      // TypeScript 6 は、作業フォルダに tsconfig.json があるとファイル指定の実行を拒むので、一時フォルダで流す。
      const same = tsc([...STRICT, join(dir, 'same.ts')], dir);
      expect(same.out).toBe('');
      expect(same.status).toBe(0);
      const bad = tsc([...STRICT, join(dir, 'differ.ts')], dir);
      expect(bad.status).not.toBe(0);
      expect(bad.out).toMatch(/differ\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
