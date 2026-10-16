import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// ホストの画面（/）とスマホの画面（/pad）を別のHTMLにする。どちらも同じ部品を使う。
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Vite の modulepreload の補助（MIT）を、配布物に入れない（最新のブラウザは、自前で対応している）。
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        host: resolve(import.meta.dirname, 'index.html'),
        pad: resolve(import.meta.dirname, 'pad.html'),
      },
    },
  },
});
