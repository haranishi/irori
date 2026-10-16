// 前処理（global-setup.mjs）から試験へ渡す値の名前と、読み出し。Node の API を使うので .mjs に置く（型は env.d.mts）。
export const ENV = {
  main: 'IRORI_C1_MAIN',
  extra: 'IRORI_C1_EXTRA',
  dev: 'IRORI_C1_DEV',
  external: 'IRORI_C1_EXTERNAL',
  dist: 'IRORI_C1_DIST',
  shelf: 'IRORI_C1_SHELF',
};

/** @param {keyof typeof ENV} key */
export function env(key) {
  const v = process.env[ENV[key]];
  if (!v) throw new Error(`${ENV[key]} がありません（前処理 tests/e2e/console/global-setup.mjs が動いていない）`);
  return v;
}
