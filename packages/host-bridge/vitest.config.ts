import { defineConfig } from 'vitest/config';

// 握手と枠は実ブラウザで試す（tests/e2e/bridge）。ここは検証・解決・保存の単体の試験。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
