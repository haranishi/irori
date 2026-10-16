// 容量：スマホの画面が読み込む JavaScript は gzip で40KB以下（指示書 B2）。試験が使うのと同じビルドの出力で測る。
import { padJsSizes } from './e2e/budget.mjs';
import { buildKind, distDir } from './e2e/env.mjs';
import { expect, test } from './e2e/fixtures';

const BUDGET = 40 * 1024;

test('スマホの画面の JavaScript は gzip で40KB以下', async () => {
  const r = padJsSizes(distDir());
  expect(r.files.length).toBeGreaterThan(0);
  for (const f of r.files) console.log(`${f.path}\t${f.bytes} B\tgzip ${f.gzip} B`);
  console.log(`合計 ${r.totalBytes} B・gzip ${r.totalGzip} B（上限 ${BUDGET} B）・ビルド=${buildKind()}`);
  expect(r.totalGzip).toBeLessThanOrEqual(BUDGET);
});
