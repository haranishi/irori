import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// ホストの画面（/）の実ブラウザ試験。サーバーは前処理が実 Worker を空きポートで立てる（webServer は使わない）。
// スマホ役は、実際の /pad#CODE のページ（別の BrowserContext）と、room-client を使う小さなスクリプト。
// host-chromium が試験、host-shots は評価者に渡すスクリーンショットを撮る（--project host-shots）。
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } };

export default defineConfig({
  testDir: './tests/host',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/host/e2e/global-setup.mjs',
  outputDir: join(tmpdir(), 'irori-host-e2e-results'),
  use: { headless: true, trace: 'off' },
  projects: [
    { name: 'host-chromium', testIgnore: '**/shots.e2e.ts', use: desktop },
    { name: 'host-shots', testMatch: '**/shots.e2e.ts', use: desktop },
  ],
});
