// スマホの画面の実ブラウザ試験の前に、apps/web を自分専用の一時フォルダへビルドし、実 Worker を起こす。
// apps/web/dist は共有の場所なので作らない（B1・G と同時に動くため）。ポートは B2 の範囲（8820〜8839）から選ぶ。
// ビルドは buildWeb()（ホストとスマホの両方）を先に試す。ホストの画面が作りかけで通らないときだけ、スマホの画面だけを
// ビルドし直して進む（警告を出す）。上書きは回数の栓だけ（同じIPから何度も部屋を作り、存在を確かめるため）。時間は上書きしない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ENV, ROOT, buildWeb, pickPorts, startEdge } from '../../../../../tools/lib/edge-server.mjs';
import { BUILD_KIND_ENV, DIST_ENV, EDGE_ENV } from './env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function buildPadOnly() {
  const dir = mkdtempSync(join(tmpdir(), 'irori-pad-web-'));
  const vite = join(ROOT, 'node_modules/vite/bin/vite.js');
  const r = spawnSync(process.execPath, [vite, 'build', '--config', resolve(HERE, 'vite.pad.mjs'), '--outDir', dir, '--emptyOutDir'], {
    cwd: join(ROOT, 'apps/web'),
    encoding: 'utf8',
    env: { ...process.env, ...QUIET_ENV },
  });
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`スマホの画面のビルドが失敗しました\n${r.stdout}\n${r.stderr}`);
  }
  return { outDir: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export default async function setup() {
  let build;
  try {
    build = buildWeb();
    process.env[BUILD_KIND_ENV] = 'all';
  } catch (e) {
    console.warn(`[pad-e2e] 全体のビルドが通らないため、スマホの画面だけをビルドして続けます。\n${String(e).slice(0, 400)}`);
    build = buildPadOnly();
    process.env[BUILD_KIND_ENV] = 'pad-only';
  }
  const [port, inspectorPort] = await pickPorts(2, { from: 8820, to: 8839 });
  let edge;
  try {
    edge = await startEdge({
      name: 'pad-e2e',
      assetsDir: build.outDir,
      port,
      inspectorPort,
      vars: { ALLOW_TEST_OVERRIDES: '1', LOOKUP_PER_IP_PER_MINUTE: '1000000', CREATE_PER_IP_PER_MINUTE: '1000000' },
    });
  } catch (e) {
    build.cleanup();
    throw e;
  }
  process.env[EDGE_ENV] = edge.url;
  process.env[DIST_ENV] = build.outDir;
  return async () => {
    await edge.stop();
    build.cleanup();
  };
}
