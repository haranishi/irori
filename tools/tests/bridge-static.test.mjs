// Only synthetic temporary files are served; no real private files or credentials are accessed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { startStatic } from '../../tests/e2e/bridge/server/static.mjs';

const fixtures = [];
const servers = [];
const SENTINEL = 'synthetic external sentinel: never serve this';
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});
function put(root, rel, body) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'irori-bridge-static-'));
  fixtures.push(base);
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  put(root, 'index.html', '<title>synthetic bridge</title>');
  put(root, 'games/demo/main.js', 'export const game = true;');
  put(root, 'sdk/irori.js', 'export const sdk = true;');
  put(outside, 'sentinel.txt', SENTINEL);
  return { root, outside };
}
async function serve(rootDir, host) {
  const server = await startStatic({ rootDir, ...(host ? { host } : {}) });
  servers.push(server);
  assert.ok(server.port > 0);
  return server;
}
// Use the raw request path so the client does not normalize traversal before the server sees it.
function get(server, path) {
  const url = new URL(server.url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(3_000, () => req.destroy(new Error('static request timed out')));
    req.end();
  });
}
function denied(response) {
  assert.equal(response.status, 403);
  assert.equal(response.body.includes(Buffer.from(SENTINEL)), false);
}

describe('bridge static server file boundary', () => {
  it('rejects an existing external file symlink over actual HTTP', async () => {
    const { root, outside } = fixture();
    symlinkSync(join(outside, 'sentinel.txt'), join(root, 'leak.txt'));
    const server = await serve(root);
    denied(await get(server, '/leak.txt'));
    assert.equal(readFileSync(join(outside, 'sentinel.txt'), 'utf8'), SENTINEL);
  });

  it('rejects a directory symlink in a request ancestor', async () => {
    const { root, outside } = fixture();
    symlinkSync(outside, join(root, 'linked'));
    denied(await get(await serve(root), '/linked/sentinel.txt'));
  });

  it('rejects internal links, dangling links and link cycles too', async () => {
    const { root } = fixture();
    symlinkSync('index.html', join(root, 'internal.html'));
    symlinkSync('missing.txt', join(root, 'dangling.txt'));
    symlinkSync('cycle', join(root, 'cycle'));
    const server = await serve(root);
    for (const path of ['/internal.html', '/dangling.txt', '/cycle']) denied(await get(server, path));
  });

  it('rejects a FIFO without opening it', { skip: process.platform === 'win32' }, async () => {
    const { root } = fixture();
    const made = spawnSync('mkfifo', [join(root, 'pipe')], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    denied(await get(await serve(root), '/pipe'));
  });

  it('rejects raw and encoded traversal before URL normalization can erase it', async () => {
    const { root } = fixture();
    const server = await serve(root);
    for (const path of [
      '/../index.html', '/games/../index.html', '/games/%2e%2e/index.html',
      '/games/%2E%2E%2findex.html', '/games/%2e%2e%5cindex.html', '/games/..%5cindex.html',
      '/games/%2e/index.html', '//outside/index.html',
    ]) denied(await get(server, path));
    assert.equal((await get(server, '/games/%252e%252e/index.html')).status, 404);
  });

  it('returns a bounded error for malformed encoding and keeps serving', async () => {
    const { root } = fixture();
    const server = await serve(root);
    for (const path of ['/%', '/%FF', '/%E0%A4', '/bad%00name']) {
      const response = await get(server, path);
      assert.equal(response.status, 400);
      assert.equal(response.body.toString(), 'bad request');
    }
    assert.equal((await get(server, '/')).status, 200);
  });

  it('serves ordinary HTML, JavaScript, JSON, CSS and font bytes with the existing CORS policy', async () => {
    const { root } = fixture();
    put(root, 'games/demo/data.json', '{"synthetic":true}');
    put(root, 'games/demo/style.css', 'body{color:red}');
    const font = Buffer.from([0, 1, 0, 0, 2, 3, 4]);
    put(root, 'games/demo/face.ttf', font);
    const server = await serve(root);
    const html = await get(server, '/?cache=ignored');
    assert.equal(html.status, 200);
    assert.match(html.headers['content-type'], /^text\/html/);
    assert.equal(html.headers['access-control-allow-origin'], undefined);
    for (const path of ['/games/demo/main.js', '/sdk/irori.js', '/games/demo/data.json', '/games/demo/style.css']) {
      const response = await get(server, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers['access-control-allow-origin'], '*');
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.deepEqual((await get(server, '/games/demo/face.ttf')).body, font);
    assert.equal((await get(server, '/missing.js')).status, 404);
  });

  it('serves ordinary files added after startup and decoded names', async () => {
    const { root } = fixture();
    const server = await serve(root);
    put(root, 'games/later/index.html', '<title>created later</title>');
    put(root, 'games/later/space name.js', '// encoded filename');
    assert.equal((await get(server, '/games/later/')).body.toString(), '<title>created later</title>');
    assert.equal((await get(server, '/games/later/space%20name.js')).body.toString(), '// encoded filename');
  });

  it('keeps localhost and automatic port selection working', async () => {
    const { root } = fixture();
    const server = await serve(root, 'localhost');
    assert.match(server.url, /^http:\/\/localhost:\d+$/);
    assert.equal((await get(server, '/')).status, 200);
  });
});
