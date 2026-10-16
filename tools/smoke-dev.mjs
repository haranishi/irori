// 「3分で試す」の手順（clone → npm install → npm run dev）が、まっさらな状態でも動くかを確かめる煙試験。
// 配るファイル（同梱のゲーム・登録の一覧・SDK・ライセンスの表示）は、ビルドが作る生成物でリポジトリに入っていない。
// npm run dev がそれを先に作らないと、棚が空になる（実際に起きた不具合）。
// 使い方：node tools/smoke-dev.mjs（まっさらな checkout で流すと意味がある。CIの dev-smoke）。
// ポートは、ほかのサーバーとぶつからないよう、8790〜8799 の空きを選んで dev.mjs に渡す。
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectRun } from './lib/files.mjs';
import { pickPorts } from './lib/edge-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_RANGE = { from: 8790, to: 8799 };
const EXPECT = [
  ['/', 'text/html'],
  ['/pad', 'text/html'],
  ['/registry/index.json', 'application/json'],
  ['/games/hello-pad/', 'text/html'],
  ['/games/tap-race/', 'text/html'],
  ['/games/quiz-4/', 'text/html'],
  ['/games/dot-grab/', 'text/html'],
  ['/sdk/v1/irori.js', 'javascript'],
  ['/licenses.txt', 'text/plain'],
];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function smokeDev({ timeoutMs = 300_000 } = {}) {
  let log = '';
  const [port] = await pickPorts(1, PORT_RANGE);
  const BASE = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(ROOT, 'tools/dev.mjs')], {
    cwd: ROOT,
    env: { ...process.env, IRORI_DEV_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const keep = (d) => {
    log = (log + d.toString()).slice(-20_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = false;
  const exit = new Promise((r) => child.once('exit', () => ((exited = true), r())));

  const problems = [];
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (exited) throw new Error(`dev.mjs が起動中に終了しました\n${log}`);
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        // まだ起動中
      }
      if (Date.now() > deadline) throw new Error(`dev.mjs が時間内に起動しませんでした\n${log}`);
      await pause(500);
    }
    for (const [path, type] of EXPECT) {
      const res = await fetch(`${BASE}${path}`);
      const got = res.headers.get('content-type') ?? '';
      if (res.status !== 200 || !got.includes(type)) problems.push(`${path} → ${res.status} ${got}（${type} の 200 が要る）`);
    }
    const index = await (await fetch(`${BASE}/registry/index.json`)).json().catch(() => null);
    const n = Array.isArray(index?.games) ? index.games.length : 0;
    if (n < 1) problems.push(`/registry/index.json に、ゲームが1本も載っていません（${n}件）`);
  } finally {
    if (!exited && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // もう止まっている
      }
      const done = await Promise.race([exit.then(() => true), pause(15_000).then(() => false)]);
      if (!done) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // もう止まっている
        }
      }
    }
  }
  return problems;
}

if (isDirectRun(import.meta.url)) {
  const problems = await smokeDev().catch((e) => [String(e.message ?? e)]);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\nsmoke-dev: ${problems.length}件の問題`);
    process.exit(1);
  }
  console.log('smoke-dev: OK（画面・登録の一覧・4本のゲーム・SDK・ライセンスの表示を、まっさらな起動から配れた）');
}
