import { defineConfig } from 'vitest/config';

// 同梱ゲームの規則（logic.js）の試験。ゲームはビルドなしの素のJavaScriptなので、設定はこれだけ。
export default defineConfig({
  test: {
    include: ['games/**/*.test.js'],
    passWithNoTests: false,
  },
});
