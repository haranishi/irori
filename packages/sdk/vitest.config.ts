import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // ビルドと tsc を流す試験があるので、既定より長く待つ。
    testTimeout: 60_000,
  },
});
