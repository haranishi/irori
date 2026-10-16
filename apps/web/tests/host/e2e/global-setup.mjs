// ホストの画面の実ブラウザ試験の前処理：apps/web を自分専用の出力先にビルドし、実 Worker を4つ起動する。
// apps/web/dist は共有の場所なので触らない（tools/lib/edge-server.mjs の buildWeb と startEdge を使う）。
//   main : 上書きあり。作成・確認の回数の栓を広げ、開発用の DEV_FRAMES=1（?dev= の外部ゲームの試験）。
//   caps : 1日の部屋数を1にした運営者の値（2つ目の作成が 503）。
//   idle : 無操作の時間を短くした部屋（閉じた画面の試験）。
//   public : 本番と同じく PUBLIC_URL を渡したもの（127.0.0.1 で開いても、部屋の案内は公開のアドレスになる）。撮影はこれで撮る。
// もう1つ、別のオリジン（localhost）で試験用の外部ゲームを配る小さなサーバーを立てる。
// 起動の完了は /api/health の照会で確かめる（出力の文字列は待たない）。URL は環境変数で試験に渡す。
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { buildWeb, pickPorts, ROOT, startEdge } from '../../../../../tools/lib/edge-server.mjs';

export const ENV = { main: 'IRORI_HOST_E2E_MAIN', caps: 'IRORI_HOST_E2E_CAPS', idle: 'IRORI_HOST_E2E_IDLE', public: 'IRORI_HOST_E2E_PUBLIC', shots: 'IRORI_HOST_E2E_SHOTS', dev: 'IRORI_HOST_E2E_DEV' };
/** 撮影と試験で使う、架空の公開アドレス（example は予約済みのドメインで、だれのものでもない）。 */
export const PUBLIC_URL = 'https://irori.example';

const BASE = { ALLOW_TEST_OVERRIDES: '1', CREATE_PER_IP_PER_MINUTE: '1000', LOOKUP_PER_IP_PER_MINUTE: '1000', MAX_ROOMS_PER_DAY: '100000' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

/** 試験用の外部ゲームを配る。道は固定の一覧だけ（道の組み立てで、ほかのファイルへ出ない）。 */
function devGameServer(port) {
  const dir = join(ROOT, 'apps/web/tests/fixtures/host/dev-game');
  const files = {
    '/': [readFileSync(join(dir, 'index.html')), TYPES['.html']],
    '/main.js': [readFileSync(join(dir, 'main.js')), TYPES['.js']],
    '/noready/': [readFileSync(join(dir, 'noready.html')), TYPES['.html']],
    '/noready.js': [readFileSync(join(dir, 'noready.js')), TYPES['.js']],
    '/nohello/': [readFileSync(join(dir, 'nohello.html')), TYPES['.html']],
    '/irori.js': [readFileSync(join(ROOT, 'apps/web/public/sdk/v1/irori.js')), TYPES['.js']],
  };
  const server = createServer((req, res) => {
    const f = files[new URL(req.url ?? '/', 'http://localhost').pathname];
    if (!f) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-store' }).end(f[0]);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export default async function globalSetup() {
  const web = buildWeb();
  const ports = await pickPorts(8, { from: 8800, to: 8819 });
  const [devPort] = await pickPorts(1, { from: 5220, to: 5239 });
  const specs = [
    { name: 'host-main', vars: { ...BASE, PAD_GRACE_MS: '4000', HOST_GRACE_MS: '8000', DEV_FRAMES: '1' } },
    { name: 'host-caps', vars: { MAX_ROOMS_PER_DAY: '1' } },
    { name: 'host-idle', vars: { ...BASE, ROOM_IDLE_MS: '4000' } },
    { name: 'host-public', vars: { ...BASE, PAD_GRACE_MS: '4000', HOST_GRACE_MS: '8000', PUBLIC_URL } },
  ];
  const [dev, ...started] = await Promise.allSettled([
    devGameServer(devPort),
    ...specs.map((s, i) => startEdge({ name: s.name, assetsDir: web.outDir, port: ports[i * 2], inspectorPort: ports[i * 2 + 1], vars: s.vars })),
  ]);
  const servers = started.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = [dev, ...started].find((r) => r.status === 'rejected');
  const stopAll = async () => {
    await Promise.all(servers.map((s) => s.stop()));
    if (dev.status === 'fulfilled') await new Promise((r) => dev.value.close(r));
    web.cleanup();
  };
  if (failed) {
    await stopAll();
    throw failed.reason;
  }
  const [main, caps, idle, pub] = servers;
  process.env[ENV.main] = main.url;
  process.env[ENV.caps] = caps.url;
  process.env[ENV.idle] = idle.url;
  process.env[ENV.public] = pub.url;
  process.env[ENV.dev] = `http://localhost:${devPort}/`;
  const shots = join(ROOT, '.agent-harness/runs/2026-10-16-bootstrap/review/shots-host');
  process.env[ENV.shots] = shots;
  // 撮り直すときは、前の画像を残さない（撮らなくなった画像が混ざると、評価者を迷わせる）。
  // 「--project=host-shots」も「--project host-shots」も拾う（1つの引数に入っていることがある）。
  if (process.argv.some((a) => a.endsWith('host-shots'))) rmSync(shots, { recursive: true, force: true });
  return stopAll;
}
