import { defineConfig } from 'vite';

// ゲームのフォルダに写して使う1ファイル（dist/irori.js）。依存を含めて1つにまとめ、読める形のまま（minify しない）にする。
// 生の72KBの上限は tests/build.test.ts が測る（gzip の上限は tools/check-budgets.mjs）。
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    // JS は読める形のまま、埋め込む CSS だけを詰める（容量のため）。
    cssMinify: true,
    sourcemap: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'irori.js',
    },
    rolldownOptions: {
      // 説明の注釈はソース（packages/sdk/src）に残し、配る1ファイルからは外す。コードの形と名前は崩さない。
      output: { comments: false },
    },
  },
});
