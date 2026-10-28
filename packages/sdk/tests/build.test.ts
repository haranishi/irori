// @vitest-environment node
/// <reference types="node" />
// 配る1ファイルの約束（docs/architecture.md「SDKは1ファイルで依存がなく、生の容量の上限（72KB）を試験で守る」）。
// 本物の設定（vite.config.ts）で、一時フォルダへビルドして確かめる。
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const SDK = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 72KB（1KB＝1000バイトで数える。ビルドの表示と同じ数え方で、厳しいほう）。60KBから上げた理由は docs/decisions/0009-party-pack-platform.md。 */
const MAX_BYTES = 72_000;

let out = '';
let code = '';

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'irori-sdk-build-'));
  await build({ root: SDK, configFile: join(SDK, 'vite.config.ts'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
  code = readFileSync(join(out, 'irori.js'), 'utf8');
}, 60_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe('dist/irori.js', () => {
  it(`1ファイルで、${MAX_BYTES}バイト以下`, () => {
    expect(readdirSync(out)).toEqual(['irori.js']);
    expect(statSync(join(out, 'irori.js')).size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('外への import が残っていない（静的・動的とも）', () => {
    expect(code).not.toMatch(/^\s*import[\s{*]/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toContain('@irori/');
  });

  it('仮想プレイヤーの表示に使う CSS（pad-ui と仮想プレイヤー）を中に持つ', () => {
    expect(code).toContain('.irori-pad{');
    expect(code).toContain('.irori-mock{');
  });

  it('読める形のまま（1行に詰め込まれていない）', () => {
    const lines = code.split('\n');
    expect(lines.length).toBeGreaterThan(500);
    const longJs = lines.filter((l) => l.length > 400 && !/^var \w+ = "/.test(l));
    expect(longJs).toEqual([]);
  });

  it('書き出す名前が irori.d.ts の宣言と同じで、読み込んだだけでは何もしない', async () => {
    const dts = readFileSync(join(SDK, 'irori.d.ts'), 'utf8');
    const declared = [...dts.matchAll(/^export declare (?:function|class|const) (\w+)/gm)].map((m) => m[1]).sort();
    const exported = /^export \{([^}]*)\};?$/m.exec(code)?.[1]?.split(',').map((s) => s.trim()).sort();
    expect(exported).toEqual(declared);
    const mod = (await import(pathToFileURL(join(out, 'irori.js')).href)) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(declared);
    expect(typeof mod.connect).toBe('function');
  });
});
