import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// 実ブラウザの試験は2つのまとまり。
//   bridge  … 隔離枠の契約（tests/e2e/bridge）。Chromium だけ。サーバーは各ワーカーのフィクスチャが空きポートで立てる。
//   console … 本物のコンソール・本物のスマホ画面・実 Worker を組み合わせた通し（tests/e2e/console）。
//             前処理（console/global-setup.mjs）が自分専用の出力先にビルドし、実 Worker を起こし、終わりに必ず止める。
// console の試験がどの組で流れるかは、試験に付けた札（@desktop-chromium など）で決める（console/lib/tags.ts）。
//   desktop-* … ホストが主役（1280×720）。スマホ役は同じエンジンの電話の画面。
//   phone-*   … スマホが主役（その組の端末の設定）。ホスト役は同じエンジンの 1280×720。
const desktop = { viewport: { width: 1280, height: 720 }, locale: 'ja-JP' } as const;
const phone = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 13'].userAgent,
  locale: 'ja-JP',
} as const;
const consoleProject = { testDir: './console', testMatch: '**/*.spec.ts', timeout: 150_000, expect: { timeout: 15_000 } } as const;

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  globalSetup: './console/global-setup.mjs',
  outputDir: join(tmpdir(), 'irori-e2e-results'),
  use: { headless: true, trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [
    { name: 'bridge', testDir: './bridge', testMatch: '**/*.spec.ts', timeout: 30_000, expect: { timeout: 10_000 }, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-chromium', ...consoleProject, grep: /@desktop-chromium\b/, use: { browserName: 'chromium', ...desktop } },
    { name: 'desktop-webkit', ...consoleProject, grep: /@desktop-webkit\b/, use: { browserName: 'webkit', ...desktop } },
    { name: 'phone-chromium', ...consoleProject, grep: /@phone-chromium\b/, use: { browserName: 'chromium', ...phone } },
    { name: 'phone-webkit', ...consoleProject, grep: /@phone-webkit\b/, use: { ...devices['iPhone 13'], browserName: 'webkit', locale: 'ja-JP' } },
  ],
});
