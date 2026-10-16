import { defineConfig } from 'vitest/config';

// 試験の前に wrangler dev を3つ起動する（tests/global-setup.ts）。起動は重いので、待ち時間を長めに取る。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
