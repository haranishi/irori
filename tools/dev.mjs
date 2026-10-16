// 開発用の起動：LAN の IPv4 を見つけ、apps/web を vite build --watch で、apps/edge を wrangler dev で起動して、
// 大画面で開く URL を表示する。大画面とスマホを同じ Wi-Fi に置けば遊べる。
// 子プロセスはそれぞれ自分のプロセスグループで起こし、終わるときはグループごと止める（workerd を残さないため）。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 既定のポート。使用中なら、空いている次のポートを使う（IRORI_DEV_PORT で指定もできる）。 */
const DEFAULT_PORT = 8787;
// 試験の担当と同じ範囲に置き、ほかの道具の既定（9229）とぶつけない。
const QUIET = {
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
  WRANGLER_HIDE_BANNER: 'true',
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
  DO_NOT_TRACK: '1',
};

function canListen(port, host) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => done(true)));
  });
}

/** from 以上で、空いているポートを返す（ほかのプロジェクトの開発用サーバーと、ぶつけない）。 */
async function freePort(from, skip = []) {
  for (let p = from; p < from + 100; p++) {
    if (!skip.includes(p) && (await canListen(p, '127.0.0.1')) && (await canListen(p, '0.0.0.0'))) return p;
  }
  throw new Error(`空いているポートが ${from} 以上に見つかりません`);
}

/** 家や職場の LAN でよく使われる範囲の IPv4 を優先する。見つからなければ 127.0.0.1。 */
export function lanIPv4(interfaces = networkInterfaces()) {
  const all = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) all.push(a.address);
  }
  const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return all.find(isPrivate) ?? all[0] ?? '127.0.0.1';
}

const children = [];
let stopping = false;

function start(name, args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', detached: true });
  child.once('exit', (code) => {
    child.exited = true;
    if (!stopping) {
      console.error(`\n${name} が終了しました（${code}）。ほかも止めます。`);
      stop(1);
    }
  });
  children.push(child);
  return child;
}

function killGroup(child, signal) {
  if (child.exited || child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // もう止まっている
  }
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) killGroup(c, 'SIGTERM');
  const deadline = Date.now() + 8_000;
  while (children.some((c) => !c.exited) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  for (const c of children) killGroup(c, 'SIGKILL');
  process.exit(code);
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // まだ起動中
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * 配るファイル（同梱のゲーム・登録の一覧・SDK・ライセンスの表示）は、ビルドが作る生成物で、リポジトリには入っていない。
 * まっさらな clone で `npm run dev` を動かしても、棚が空にならないよう、先に作る。
 * 同梱のゲームや登録情報を直したときは、`npm run prepare:web` で作り直す。
 */
function prepare() {
  const r = spawnSync('npm', ['run', 'prepare:web', '--silent'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\n配るファイルの準備（npm run prepare:web）に失敗しました。上の出力を確かめてください。');
    process.exit(1);
  }
}

async function main() {
  prepare();
  const ip = lanIPv4();
  const PORT = process.env.IRORI_DEV_PORT ? Number(process.env.IRORI_DEV_PORT) : await freePort(DEFAULT_PORT);
  const INSPECTOR_PORT = await freePort(PORT + 1, [PORT]);
  const web = join(ROOT, 'apps/web');
  // wrangler は起動時に静的ファイルの置き場があるかを確かめるので、最初のビルドより先に作っておく。
  mkdirSync(join(web, 'dist'), { recursive: true });
  start('vite build --watch', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--watch'], web);
  start(
    'wrangler dev',
    [
      join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local',
      '--ip', '0.0.0.0',
      '--port', String(PORT),
      '--inspector-port', String(INSPECTOR_PORT),
      '--var', `PUBLIC_URL:http://${ip}:${PORT}`,
      // 開発のときだけ、http://localhost などのゲームを ?dev= で枠に入れられるようにする（CSP の frame-src）。
      '--var', 'DEV_FRAMES:1',
    ],
    join(ROOT, 'apps/edge'),
    QUIET,
  );
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(0));
  if (await waitForHealth(`http://127.0.0.1:${PORT}/api/health`, 180_000)) {
    console.log(`\n大画面で開くURL: http://${ip}:${PORT}/`);
    console.log('スマホは同じ Wi-Fi から、大画面に出るQRコードで参加します。止めるときは Ctrl+C。');
    if (!existsSync(join(web, 'dist/index.html'))) {
      console.log('（画面のビルドがまだできていません。上の vite の出力を確かめてください。直せば自動で作り直します）');
    }
  } else if (!stopping) {
    console.error('wrangler dev が時間内に起動しませんでした。');
    await stop(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    stop(1);
  });
}
