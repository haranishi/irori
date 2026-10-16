// 実ブラウザの契約試験の土台。本物を使うため、起動時に：
//   1. SDK を本物の設定でビルドし、dist/irori.js を webroot/sdk/ に置く
//   2. host-bridge の実ソースを、試験の入口ごと esbuild で1つに束ね、webroot/host.js に置く
//   3. 試験用のページとゲームを webroot にそろえ、別オリジンのサーバーを2つ立てる（127.0.0.1 と localhost）
// サーバーは空きポート（5190〜5199のうち）を選ぶ。固定ポートだと並列の実行で重なるため。
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';
import { startStatic } from './server/static.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const require = createRequire(import.meta.url);

export interface Server {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export interface Harness {
  /** コンソール役のオリジン（127.0.0.1）。host.html と同梱ゲームを配る。 */
  consoleServer: Server;
  /** 外部ゲーム役のオリジン（localhost）。別オリジンから同じゲームとSDKを配る。 */
  externalServer: Server;
  webroot: string;
}

function buildWebroot(): string {
  const webroot = mkdtempSync(join(tmpdir(), 'irori-bridge-e2e-'));

  // 1. SDK を本物の設定でビルドして置く。
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const sdkOut = join(webroot, 'sdk');
  const sdk = spawnSync(process.execPath, [vite, 'build', '--outDir', sdkOut, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: join(ROOT, 'packages/sdk'),
    encoding: 'utf8',
  });
  if (sdk.status !== 0) throw new Error(`SDK のビルドに失敗: ${sdk.stdout}${sdk.stderr}`);

  // 2. 試験の入口（本物の host-bridge を読む）を1つに束ねる。
  const esbuild = require('esbuild') as typeof import('esbuild');
  esbuild.buildSync({
    entryPoints: [join(HERE, 'src/host-entry.ts')],
    outfile: join(webroot, 'host.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    absWorkingDir: ROOT,
  });

  // 3. ページとゲームを置く。
  cpSync(join(HERE, 'pages'), webroot, { recursive: true });
  return webroot;
}

export const test = base.extend<Record<string, never>, Harness>({
  webroot: [
    async ({}, use) => {
      const webroot = buildWebroot();
      await use(webroot);
      rmSync(webroot, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  consoleServer: [
    async ({ webroot }, use) => {
      const s = await startStatic({ rootDir: webroot, host: '127.0.0.1' });
      await use(s);
      await s.close();
    },
    { scope: 'worker' },
  ],
  externalServer: [
    async ({ webroot }, use) => {
      const s = await startStatic({ rootDir: webroot, host: 'localhost' });
      await use(s);
      await s.close();
    },
    { scope: 'worker' },
  ],
});

export const expect = test.expect;

/** host.html を開き、土台（window.H）が用意できるまで待つ。 */
export async function openHost(page: import('@playwright/test').Page, server: Server): Promise<void> {
  await page.goto(`${server.url}/host.html`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
}

export function readSdk(webroot: string): string {
  return readFileSync(join(webroot, 'sdk/irori.js'), 'utf8');
}

export { writeFileSync };
