import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// スマホの画面（/pad）の実ブラウザ試験。実 Worker（wrangler dev --local）を global-setup が起こす。
// Chromium は iPhone 風の 390×844・タッチ・モバイルのエミュレーション。WebKit（iPhone 相当）は1本の通しだけ。
// 結果の置き場は一時フォルダ（apps/web/test-results はほかの担当と共有になるため使わない）。
const phone = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 13'].userAgent,
  locale: 'ja-JP',
};

export default defineConfig({
  testDir: './tests/pad',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/pad/e2e/global-setup.mjs',
  outputDir: join(tmpdir(), 'irori-pad-e2e-results'),
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'phone-chromium', testIgnore: /webkit\.e2e\.ts$/, use: { browserName: 'chromium', ...phone } },
    { name: 'phone-webkit', testMatch: /webkit\.e2e\.ts$/, use: { ...devices['iPhone 13'], locale: 'ja-JP' } },
  ],
});
