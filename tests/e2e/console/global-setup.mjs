// tests/e2e/console の前処理：自分専用の出力先にビルドし、同梱ゲームをいまのソースから置き直し、実 Worker を起こす。
// apps/web/dist は共有の場所なので触らない（tools/lib/edge-server.mjs の buildWeb と startEdge だけを使う）。
//   main  … 本番と同じ CSP。棚は同梱の4本。ほとんどの試験はここ。
//   extra … main のビルドの写しに、試験だけのゲーム（c1-escape＝悪意のあるゲーム、c1-probe＝6種を出すゲーム）を足したもの。
//   dev   … main と同じビルドを、開発用の DEV_FRAMES=1 で配る（?dev= で外部の悪意のあるゲームを枠に入れるため）。
// ほかに、外部のゲームを別のオリジン（localhost）で配る小さなサーバーを立てる。起動の完了は /api/health の照会で確かめる。
// bridge の試験だけを流すとき（--project=bridge、または tests/e2e/bridge のファイルだけを指定）は、何も起こさない。
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { buildWeb, pickPorts, ROOT, startEdge } from '../../../tools/lib/edge-server.mjs';
import { ENV } from './lib/env.mjs';
import { sdkFile, stageGames } from './lib/stage.mjs';

const VARS = { ALLOW_TEST_OVERRIDES: '1', CREATE_PER_IP_PER_MINUTE: '100000', LOOKUP_PER_IP_PER_MINUTE: '100000', MAX_ROOMS_PER_DAY: '100000' };
const ESCAPE_DIR = join(ROOT, 'tests/e2e/bridge/pages/games/escape');
const PROBE_DIR = join(ROOT, 'tests/e2e/console/games/c1-probe');

const manifest = (id, ja, pads) => ({
  schema: 1,
  id,
  title: { ja, en: id },
  summary: { ja: '試験だけで使うゲーム。本番の棚には並ばない', en: 'Test only. Not on the real shelf.' },
  authors: [{ name: 'irori contributors' }],
  license: { code: 'MIT OR Apache-2.0', assets: 'original' },
  players: { min: 1, max: 8 },
  pads,
  entry: { bundled: `games/${id}/` },
  thumbnail: `${id}.png`,
  sdk: 1,
  rating: 'all',
  // 古い日付にして、棚の最後に並べる（同梱の4本の位置を変えない）。
  added: '2026-01-01',
});

/** 試験の対象に console の組が含まれるか。含まれないと分かるときだけ偽（迷ったら起こす）。 */
function wantsConsole() {
  const args = process.argv.slice(2);
  const valued = new Set(['-c', '--config', '-g', '--grep', '--grep-invert', '-j', '--workers', '--reporter', '--repeat-each', '--retries', '--timeout', '--output', '--max-failures', '--shard', '--trace', '--tsconfig', '--global-timeout']);
  const projects = [];
  const filters = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'test') continue;
    if (a.startsWith('--project=')) projects.push(a.slice('--project='.length));
    else if (a === '--project') {
      while (args[i + 1] && !args[i + 1].startsWith('-')) projects.push(args[++i]);
    } else if (valued.has(a)) i++;
    else if (!a.startsWith('-')) filters.push(a);
  }
  if (projects.length > 0) return projects.some((p) => p !== 'bridge');
  if (filters.length > 0) return filters.some((f) => !toRepo(f).startsWith('tests/e2e/bridge'));
  return true;
}

function toRepo(f) {
  const abs = resolve(process.cwd(), f.replace(/:\d+(:\d+)?$/, ''));
  return relative(ROOT, abs).split('\\').join('/');
}

/** ほかの担当が画面を直している最中は、ビルドが一時的に落ちることがある。少し置いて3回まで試す。 */
async function buildWithRetry() {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return buildWeb();
    } catch (e) {
      last = e;
      console.warn(`[c1-e2e] ビルドが落ちました（${i + 1}回目）。20秒おいてもう一度試します。\n${String(e).slice(0, 600)}`);
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  throw last;
}

/** 外部のゲームの配信（別のオリジン）。道は固定の一覧だけ。 */
function externalServer(port) {
  const html = readFileSync(join(ESCAPE_DIR, 'index.html'));
  const js = readFileSync(join(ESCAPE_DIR, 'main.js'));
  const sdk = readFileSync(sdkFile());
  const files = {
    '/escape/': [html, 'text/html; charset=utf-8'],
    '/escape/main.js': [js, 'text/javascript; charset=utf-8'],
    '/sdk/irori.js': [sdk, 'text/javascript; charset=utf-8'],
  };
  const server = createServer((req, res) => {
    const f = files[new URL(req.url ?? '/', 'http://localhost').pathname];
    if (!f) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end(f[0]);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

export default async function globalSetup() {
  if (!wantsConsole()) return undefined;
  const web = await buildWithRetry();
  const main = stageGames(web.outDir);
  const extraBuild = copyBuild(web.outDir);
  stageGames(extraBuild.outDir, [
    { manifest: manifest('c1-escape', '試験の脱出', ['wait']), dir: ESCAPE_DIR },
    { manifest: manifest('c1-probe', '試験の6種', ['wait', 'pad', 'buzzer', 'choices', 'touch', 'tilt']), dir: PROBE_DIR },
  ]);
  // c1-escape は /sdk/irori.js を、c1-probe は ./irori.js を読む。どちらも同梱ゲームと同じ SDK を置く。
  mkdirSync(join(extraBuild.outDir, 'sdk'), { recursive: true });
  cpSync(sdkFile(), join(extraBuild.outDir, 'sdk/irori.js'));
  cpSync(sdkFile(), join(extraBuild.outDir, 'games/c1-probe/irori.js'));

  const ports = await pickPorts(6, { from: 8860, to: 8899 });
  const [extPort] = await pickPorts(1, { from: 5290, to: 5299 });
  const specs = [
    { key: 'main', name: 'c1-main', dir: web.outDir, vars: VARS },
    { key: 'extra', name: 'c1-extra', dir: extraBuild.outDir, vars: VARS },
    { key: 'dev', name: 'c1-dev', dir: web.outDir, vars: { ...VARS, DEV_FRAMES: '1' } },
  ];
  const settled = await Promise.allSettled([
    externalServer(extPort),
    ...specs.map((s, i) => startEdge({ name: s.name, assetsDir: s.dir, port: ports[i * 2], inspectorPort: ports[i * 2 + 1], vars: s.vars })),
  ]);
  const [ext, ...edges] = settled;
  const stopAll = async () => {
    await Promise.all(edges.map((r) => (r.status === 'fulfilled' ? r.value.stop() : undefined)));
    if (ext.status === 'fulfilled') await new Promise((r) => ext.value.close(r));
    web.cleanup();
    extraBuild.cleanup();
  };
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) {
    await stopAll();
    throw failed.reason;
  }
  specs.forEach((s, i) => {
    process.env[ENV[s.key]] = edges[i].value.url;
  });
  process.env[ENV.external] = `http://localhost:${extPort}/escape/`;
  process.env[ENV.dist] = web.outDir;
  process.env[ENV.shelf] = JSON.stringify(main.games);
  return stopAll;
}

/** ビルドの出力を写す（同じものを2回ビルドしない）。 */
function copyBuild(from) {
  const to = `${from}-extra`;
  cpSync(from, to, { recursive: true });
  return { outDir: to, cleanup: () => rmSync(to, { recursive: true, force: true }) };
}
