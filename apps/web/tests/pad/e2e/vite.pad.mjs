// スマホの画面だけのビルド。ホストの画面（B1）が作りかけで全体のビルドが通らない間も、スマホの画面を確かめるために使う。
// 出力先は呼び出し側が一時フォルダを渡す（apps/web/dist は共有の場所なので使わない）。設定は apps/web/vite.config.ts と同じ。
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const WEB = resolve(import.meta.dirname, '../../..');

export default defineConfig({
  root: WEB,
  build: {
    target: 'es2022',
    rollupOptions: { input: { pad: resolve(WEB, 'pad.html') } },
  },
});
