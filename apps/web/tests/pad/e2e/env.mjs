// スマホの画面の実ブラウザ試験で、Node だけが知っている値（環境変数・置き場所）。
// apps/web の型検査は DOM の型だけで行うので、Node の API を使うものは .mjs に置き、型は env.d.mts に書く。
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(HERE, '../../../../..');
export const EDGE_ENV = 'IRORI_PAD_EDGE';
export const DIST_ENV = 'IRORI_PAD_DIST';
export const BUILD_KIND_ENV = 'IRORI_PAD_BUILD';
/** 画面の確認のスクリーンショットの置き場所。 */
export const SHOTS_DIR = resolve(ROOT, '.agent-harness/runs/2026-10-16-bootstrap/review/shots-pad');

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} がありません（global-setup が動いていない）`);
  return v;
}

export const edgeUrl = () => need(EDGE_ENV);
export const distDir = () => need(DIST_ENV);
export const buildKind = () => process.env[BUILD_KIND_ENV] ?? 'unknown';
export const shotsEnabled = () => process.env.IRORI_PAD_SHOTS === '1';
