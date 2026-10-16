import { defineConfig } from 'vitest/config';

// 単体の試験：画面に依存しない規則・状態・描画の部品。ファイル名は *.test.ts。
// 実ブラウザの試験（Playwright）は *.e2e.ts にして、ここには入れない。
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
