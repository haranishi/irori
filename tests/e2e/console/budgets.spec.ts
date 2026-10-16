// 容量：試験が配っているビルドの出力を、tools/check-budgets.mjs で測る（ホスト80KB・スマホ40KB・SDK60KB、gzip）。
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../../tools/lib/edge-server.mjs';
import { env } from './lib/env.mjs';
import { expect, test } from './fixtures';
import { ONLY_DC } from './lib/tags';

test('容量：ホストの画面・スマホの画面・SDK の JS が、gzip で上限の内（測った値を出す）', ONLY_DC, async () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools/check-budgets.mjs'), '--dir', env('dist')], { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  test.info().annotations.push({ type: '容量', description: out.split('\n').filter((l) => /gzip/.test(l) && /\//.test(l) && !/^\s{4}/.test(l)).join(' ／ ') });
  expect(out).toMatch(/ホストの画面（\/）\s+gzip [\d,]+ B/);
  expect(out).toMatch(/スマホの画面（\/pad） gzip [\d,]+ B/);
  expect(out).toMatch(/SDK（\/sdk\/v1\/irori\.js） gzip [\d,]+ B/);
  expect(r.status, out).toBe(0);
});
