// 実 Worker（wrangler dev --local）を、自分専用の静的ファイルの置き場・保存先・ポートで起動し、止める道具。
// 画面の試験と試遊サーバーが使う。複数の担当が同時に動かしても、共有の場所（apps/web/dist）を壊さないため、
// ビルドの出力先も、保存先も、ポートも、呼び出し側が自分専用のものを渡す。
// 起動の完了は出力の文字列でなく /api/health の照会で確かめる。子プロセスは自分のプロセスグループにして、
// 止めるときは workerd まで一度に止める。
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE_DIR = join(ROOT, 'apps/edge');
const WEB_DIR = join(ROOT, 'apps/web');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');

/** 外への送信（利用状況の送信・更新の確認）を止める。 */
export const QUIET_ENV = {
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
  WRANGLER_HIDE_BANNER: 'true',
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
  DO_NOT_TRACK: '1',
  FORCE_COLOR: '0',
  CI: '1',
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function canListen(port, host) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => done(true)));
  });
}

/** 範囲 { from, to } の中から、空いているポートを n 個選ぶ（後ろから）。 */
export async function pickPorts(n, { from, to }) {
  const out = [];
  for (let p = to; p >= from && out.length < n; p--) {
    if ((await canListen(p, '127.0.0.1')) && (await canListen(p, '0.0.0.0'))) out.push(p);
  }
  if (out.length < n) throw new Error(`空いているポートが ${from}〜${to} に ${n} 個ありません`);
  return out;
}

/**
 * apps/web を、自分専用の出力先にビルドする（apps/web/dist は共有の場所なので触らない）。
 * outDir を省くと、一時フォルダを作って返す。使い終わったら cleanup() で消す。
 */
export function buildWeb({ outDir } = {}) {
  const dir = outDir ?? mkdtempSync(join(tmpdir(), 'irori-web-'));
  const r = spawnSync(process.execPath, [VITE, 'build', '--outDir', dir, '--emptyOutDir'], { cwd: WEB_DIR, encoding: 'utf8', env: { ...process.env, ...QUIET_ENV } });
  if (r.status !== 0) throw new Error(`vite build が失敗しました\n${r.stdout}\n${r.stderr}`);
  return { outDir: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * wrangler dev を起動する。assetsDir は buildWeb の出力など。apps/web/public/_headers は、assetsDir に無ければ写す。
 * 返す stop() は、プロセスグループごと止めて、一時の保存先を消す。
 */
export async function startEdge({ name, assetsDir, port, inspectorPort, vars: given = {}, timeoutMs = 180_000 }) {
  if (!existsSync(assetsDir)) throw new Error(`assetsDir がありません: ${assetsDir}`);
  // 試験と試遊は、同じIP（127.0.0.1）から何台分もつなぎ直す。WebSocket の受け付けの栓（既定は毎分60）は、
  // 本番の運営者の値なので、ここで上限まで上げる。栓そのものの試験は apps/edge/tests が自前で起動して見ている。
  const vars = { WS_CONNECT_PER_IP_PER_MINUTE: '10000', ...given };
  const work = mkdtempSync(join(tmpdir(), `irori-edge-${name}-`));
  if (!existsSync(join(assetsDir, '_headers'))) cpSync(join(WEB_DIR, 'public/_headers'), join(assetsDir, '_headers'));
  const args = [
    WRANGLER, 'dev',
    '--config', join(EDGE_DIR, 'wrangler.jsonc'),
    '--local',
    '--assets', assetsDir,
    '--persist-to', join(work, 'state'),
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--inspector-port', String(inspectorPort),
    '--show-interactive-dev-session=false',
    '--log-level', 'warn',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  let log = '';
  const child = spawn(process.execPath, args, {
    cwd: EDGE_DIR,
    env: { ...process.env, ...QUIET_ENV, WRANGLER_LOG_PATH: join(work, 'logs'), WRANGLER_REGISTRY_PATH: join(work, 'registry') },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const keep = (d) => {
    log = (log + d.toString()).slice(-20_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited;
  const exit = new Promise((r) => child.once('exit', (code) => ((exited = code ?? -1), r())));

  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exited === undefined && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // もう止まっている
      }
      const done = await Promise.race([exit.then(() => true), pause(10_000).then(() => false)]);
      if (!done) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // もう止まっている
        }
        await exit;
      }
    }
    rmSync(work, { recursive: true, force: true });
  };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited !== undefined) {
      await stop();
      throw new Error(`wrangler dev（${name}）が起動中に終了しました（${exited}）\n${log}`);
    }
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      // まだ受け付けていない
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`wrangler dev（${name}）が時間内に起動しませんでした\n${log}`);
    }
    await pause(250);
  }
  return { name, url, port, stop, output: () => log };
}
