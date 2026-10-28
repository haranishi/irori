import { defineConfig } from 'vitest/config';

// 同梱ゲームの規則（logic.js）の試験。ゲームはビルドなしの素のJavaScriptなので、設定はこれだけ。
export default defineConfig({
  test: {
    include: ['games/**/*.test.js'],
    passWithNoTests: false,
    // 全組み合わせや無作為な対戦を回す試験は、手元で1〜2秒でも、遅いCIの機械では5秒（既定）を超える（ボウリングの物理の全組で実際に落ちた）。
    testTimeout: 30_000,
  },
});
