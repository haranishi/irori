// 試験用に wrangler dev を起動・停止する。静的ファイルは試験用の小さな site に、実物の apps/web/public/_headers を足して配る。
// 起動の完了は、出力の文字列ではなく /api/health の照会で確かめる。止めるときは子プロセス（workerd）ごと止める。

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const EDGE_DIR = resolve(import.meta.dirname, '..');
export const ROOT = resolve(EDGE_DIR, '../..');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
/** 指示書で決めた、この担当が使ってよいポート。 */
export const PORTS = { from: 8787, to: 8799 } as const;

export interface EdgeServer {
  name: string;
  url: string;
  port: number;
  stop(): Promise<void>;
  output(): string;
}

/** 外への送信（利用状況の送信・更新の確認）を止める。 */
export const QUIET_ENV: Record<string, string> = {
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
  WRANGLER_HIDE_BANNER: 'true',
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
  DO_NOT_TRACK: '1',
  FORCE_COLOR: '0',
  CI: '1',
};

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => done(true)));
  });
}

/** 範囲の中から、空いているポートを n 個選ぶ。後ろから選び、開発用の 8787 はなるべく残す。 */
export async function pickPorts(n: number, taken: Set<number> = new Set()): Promise<number[]> {
  const out: number[] = [];
  for (let p = PORTS.to; p >= PORTS.from && out.length < n; p--) {
    if (taken.has(p)) continue;
    if ((await canListen(p, '127.0.0.1')) && (await canListen(p, '0.0.0.0'))) {
      out.push(p);
      taken.add(p);
    }
  }
  if (out.length < n) throw new Error(`空いているポートが ${PORTS.from}〜${PORTS.to} に ${n} 個ありません`);
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startEdge(opts: {
  name: string;
  port: number;
  inspectorPort: number;
  vars: Record<string, string>;
  timeoutMs?: number;
}): Promise<EdgeServer> {
  const work = mkdtempSync(join(tmpdir(), `irori-edge-${opts.name}-`));
  const site = join(work, 'site');
  cpSync(join(EDGE_DIR, 'tests/fixtures/site'), site, { recursive: true });
  cpSync(join(ROOT, 'apps/web/public/_headers'), join(site, '_headers'));
  const args = [
    WRANGLER, 'dev',
    '--config', join(EDGE_DIR, 'wrangler.jsonc'),
    '--local',
    '--assets', site,
    '--persist-to', join(work, 'state'),
    '--ip', '127.0.0.1',
    '--port', String(opts.port),
    '--inspector-port', String(opts.inspectorPort),
    '--show-interactive-dev-session=false',
    '--log-level', 'warn',
    ...Object.entries(opts.vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];
  let log = '';
  const child: ChildProcess = spawn(process.execPath, args, {
    cwd: EDGE_DIR,
    env: { ...process.env, ...QUIET_ENV, WRANGLER_LOG_PATH: join(work, 'logs'), WRANGLER_REGISTRY_PATH: join(work, 'registry') },
    stdio: ['ignore', 'pipe', 'pipe'],
    // 自分のプロセスグループにして、止めるときに workerd まで一度に止める。
    detached: true,
  });
  const keep = (d: Buffer) => {
    log = (log + d.toString()).slice(-20_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited: number | null | undefined;
  const exit = new Promise<void>((r) => child.once('exit', (code) => ((exited = code), r())));

  const url = `http://127.0.0.1:${opts.port}`;
  const stop = async () => {
    if (exited === undefined && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // もう止まっている
      }
      const killed = await Promise.race([exit.then(() => true), pause(10_000).then(() => false)]);
      if (!killed) {
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

  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  for (;;) {
    if (exited !== undefined) {
      await stop();
      throw new Error(`wrangler dev（${opts.name}）が起動中に終了しました（${exited}）\n${log}`);
    }
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) break;
    } catch {
      // まだ受け付けていない
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`wrangler dev（${opts.name}）が時間内に起動しませんでした\n${log}`);
    }
    await pause(250);
  }
  return { name: opts.name, url, port: opts.port, stop, output: () => log };
}
