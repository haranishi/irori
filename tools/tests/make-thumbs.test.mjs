// Temporary synthetic games exercise real HTTP and the real thumbnail output boundary.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeThumbs, serveGames } from '../make-thumbs.mjs';
import { readImageSize } from '../check-registry.mjs';

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function put(root, rel, body) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'irori-thumbs-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) put(root, rel, body);
  return root;
}
function link(root, rel, target) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  rmSync(file, { recursive: true, force: true });
  symlinkSync(target, file);
}
const unsafe = /Unsafe source path/;
const fontEnv = () => process.env.IRORI_FONT_JP ? { IRORI_FONT_JP: process.env.IRORI_FONT_JP } : {};
const moduleUrl = new URL('../make-thumbs.mjs', import.meta.url).href;
const dependencyDir = fileURLToPath(new URL('../../node_modules', import.meta.url));
const start = (root, fonts = {}) => serveGames(root, { from: 61520, to: 61539, fonts });
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}
function gameFixture() {
  const root = fixture({
    'package.json': '{"type":"module"}',
    'games/blade-duel/index.html': '<!doctype html><html lang="ja" data-phase="intro"><head><link rel="stylesheet" href="style.css"><script type="module" src="main.js"></script></head><body><h1>画像の試験</h1><div class="irori-mock" data-ready>synthetic controller</div></body></html>',
    'games/blade-duel/style.css': 'body { background: #fff; color: #111; }',
    'games/blade-duel/main.js': 'export const synthetic = true;',
    'registry/games/blade-duel.json': '{"id":"blade-duel","thumbnail":"blade-duel.jpg"}',
    'registry/thumbs/blade-duel.jpg': 'previous synthetic thumbnail',
  });
  link(root, 'node_modules', dependencyDir);
  return root;
}

describe('thumbnail game HTTP boundary', () => {
  it('serves ordinary HTML/JS/CSS, binary assets and buffered fonts with the existing CSP/CORS', async () => {
    const root = gameFixture();
    put(root, 'games/blade-duel/asset.bin', Buffer.from([1, 2, 3]));
    const srv = await start(root, { jp: Buffer.from('synthetic font bytes') });
    try {
      const html = await get(srv.port, '/blade-duel/?mock=2');
      assert.equal(html.status, 200);
      assert.match(html.body.toString(), /画像の試験/);
      assert.equal(html.headers['access-control-allow-origin'], '*');
      assert.match(html.headers['content-security-policy'], /sandbox allow-scripts/);
      assert.match(html.headers['content-security-policy'], /connect-src 'self'/);
      assert.equal(html.headers['cache-control'], 'no-store');
      for (const [path, type] of [['main.js', 'text/javascript'], ['style.css', 'text/css'], ['asset.bin', 'application/octet-stream']]) {
        const got = await get(srv.port, `/blade-duel/${path}`);
        assert.equal(got.status, 200);
        assert.ok(got.headers['content-type'].startsWith(type));
      }
      const font = await get(srv.port, '/__font/jp.ttf');
      assert.equal(font.status, 200);
      assert.equal(font.headers['content-type'], 'font/ttf');
      assert.equal(font.headers['access-control-allow-origin'], '*');
      assert.equal(font.body.toString(), 'synthetic font bytes');
    } finally { await srv.close(); }
  });
  for (const kind of ['external-file', 'external-directory', 'internal-file', 'dangling', 'cycle']) {
    it(`does not serve a ${kind} link and keeps ordinary requests working`, async () => {
      const root = gameFixture();
      const external = fixture({ 'sentinel.txt': 'external synthetic sentinel' });
      const target = kind === 'external-file' ? join(external, 'sentinel.txt') : kind === 'external-directory' ? external : kind === 'internal-file' ? 'main.js' : kind === 'cycle' ? '.' : 'missing.txt';
      link(root, 'games/blade-duel/linked', target);
      const srv = await start(root);
      try {
        const path = kind === 'external-directory' ? '/blade-duel/linked/sentinel.txt' : '/blade-duel/linked';
        const bad = await get(srv.port, path);
        assert.equal(bad.status, 404);
        assert.ok(!bad.body.toString().includes('external synthetic sentinel'));
        assert.equal((await get(srv.port, '/blade-duel/')).status, 200);
      } finally { await srv.close(); }
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'external synthetic sentinel');
    });
  }
  it('rejects a linked games root before listening', async () => {
    const root = fixture();
    const external = fixture({ 'demo/index.html': 'external synthetic page' });
    link(root, 'games', external);
    await assert.rejects(async () => { const srv = await start(root); await srv.close(); }, unsafe);
  });
  it('does not escape games through encoded path segments', async () => {
    const root = gameFixture();
    put(root, 'outside.txt', 'outside game root');
    const srv = await start(root);
    try {
      for (const path of ['/../outside.txt', '/%2e%2e%2foutside.txt', '/blade-duel/%2e%2e/%2e%2e/outside.txt', '/blade-duel/%5c..%5coutside.txt', '/%00']) {
        const bad = await get(srv.port, path);
        assert.ok([400, 404].includes(bad.status), `${path}: ${bad.status}`);
        assert.ok(!bad.body.toString().includes('outside game root'));
      }
      assert.equal((await get(srv.port, '/blade-duel/')).status, 200);
    } finally { await srv.close(); }
  });
  for (const mode of ['encoding', 'fifo']) {
    it(`rejects malformed ${mode} requests without stopping or blocking the server`, { skip: mode === 'fifo' && process.platform === 'win32' }, () => {
      const root = gameFixture();
      if (mode === 'fifo') assert.equal(spawnSync('mkfifo', [join(root, 'games/blade-duel/pipe')]).status, 0);
      const script = `import { request } from 'node:http'; import { serveGames } from ${JSON.stringify(moduleUrl)}; const srv = await serveGames(process.argv[1], { from: 61540, to: 61559 }); const get = (path) => new Promise((resolve, reject) => { const req = request({hostname:'127.0.0.1', port:srv.port, path}, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); }); try { const bad = await get(${JSON.stringify(mode === 'fifo' ? '/blade-duel/pipe' : '/%ZZ')}); const good = await get('/blade-duel/'); console.log(JSON.stringify({ bad, good })); } finally { await srv.close(); }`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()), { bad: mode === 'fifo' ? 404 : 400, good: 200 });
    });
  }
});

describe('thumbnail file output boundary', () => {
  for (const rel of ['registry', 'registry/thumbs', 'registry/thumbs/blade-duel.jpg', 'registry/games/blade-duel.json', 'games/blade-duel']) {
    it(`rejects ${rel} links before touching output or starting a browser`, async () => {
      const root = gameFixture();
      const external = fixture({ 'sentinel.txt': 'external synthetic sentinel', 'blade-duel.jpg': 'external previous image', 'manifest.json': '{"id":"blade-duel","thumbnail":"blade-duel.jpg"}' });
      const target = rel.endsWith('.json') ? join(external, 'manifest.json') : rel.endsWith('.jpg') ? join(external, 'sentinel.txt') : external;
      link(root, rel, target);
      await assert.rejects(makeThumbs(root, ['blade-duel'], fontEnv()), unsafe);
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'external synthetic sentinel');
      assert.equal(readFileSync(join(external, 'blade-duel.jpg'), 'utf8'), 'external previous image');
    });
  }
  it('rejects an output directory replaced by an ordinary file', async () => {
    const root = gameFixture();
    rmSync(join(root, 'registry/thumbs'), { recursive: true });
    put(root, 'registry/thumbs', 'directory-position sentinel');
    await assert.rejects(makeThumbs(root, ['blade-duel'], fontEnv()), unsafe);
    assert.equal(readFileSync(join(root, 'registry/thumbs'), 'utf8'), 'directory-position sentinel');
  });
  it('accepts scene ids only as own registered properties', async () => {
    const root = gameFixture();
    await assert.rejects(makeThumbs(root, ['constructor'], fontEnv()), /撮り方がありません/);
    assert.equal(readFileSync(join(root, 'registry/thumbs/blade-duel.jpg'), 'utf8'), 'previous synthetic thumbnail');
  });
  it('rejects sparse ids before the first thumbnail is written', async () => {
    const root = gameFixture();
    const ids = ['blade-duel'];
    ids.length = 2;
    await assert.rejects(makeThumbs(root, ids, fontEnv()), unsafe);
    assert.equal(readFileSync(join(root, 'registry/thumbs/blade-duel.jpg'), 'utf8'), 'previous synthetic thumbnail');
  });
  it('validates every requested manifest/output before writing the first thumbnail', async () => {
    const root = gameFixture();
    put(root, 'games/lantern-market/index.html', '<!doctype html><html data-phase="intro"><body><div class="irori-mock" data-ready>synthetic</div></body></html>');
    put(root, 'registry/games/lantern-market.json', '{"id":"lantern-market","thumbnail":"../outside.png"}');
    put(root, 'registry/outside.png', 'outside thumbnail sentinel');
    await assert.rejects(makeThumbs(root, ['blade-duel', 'lantern-market'], fontEnv()), unsafe);
    assert.equal(readFileSync(join(root, 'registry/thumbs/blade-duel.jpg'), 'utf8'), 'previous synthetic thumbnail');
    assert.equal(readFileSync(join(root, 'registry/outside.png'), 'utf8'), 'outside thumbnail sentinel');
  });
  for (const name of ['../outside.png', '/outside.png', 'nested/image.png', '..\\outside.png']) {
    it(`rejects a thumbnail name outside its flat directory: ${name}`, async () => {
      const root = gameFixture();
      put(root, 'registry/games/blade-duel.json', JSON.stringify({ id: 'blade-duel', thumbnail: name }));
      await assert.rejects(makeThumbs(root, ['blade-duel'], fontEnv()), unsafe);
      assert.equal(readFileSync(join(root, 'registry/thumbs/blade-duel.jpg'), 'utf8'), 'previous synthetic thumbnail');
    });
  }
  for (const id of ['../blade-duel', '/blade-duel', 'blade-duel/../tap-race']) {
    it(`rejects invalid game identifiers: ${id}`, async () => {
      const root = gameFixture();
      await assert.rejects(makeThumbs(root, [id], fontEnv()), unsafe);
      assert.equal(readFileSync(join(root, 'registry/thumbs/blade-duel.jpg'), 'utf8'), 'previous synthetic thumbnail');
    });
  }
  it('rejects output FIFOs before browser startup', { skip: process.platform === 'win32' }, async () => {
    const root = gameFixture();
    rmSync(join(root, 'registry/thumbs/blade-duel.jpg'));
    assert.equal(spawnSync('mkfifo', [join(root, 'registry/thumbs/blade-duel.jpg')]).status, 0);
    // No font is supplied: validation must reject the FIFO before even loading the font.
    await assert.rejects(makeThumbs(root, ['blade-duel'], {}), unsafe);
  });
  it('writes a real 640x480 JPEG with verified OFL font and actual Chromium', { skip: !process.env.IRORI_FONT_JP }, async () => {
    const root = gameFixture();
    const made = await makeThumbs(root, ['blade-duel'], fontEnv());
    assert.deepEqual(made.map(({ id, thumbnail }) => ({ id, thumbnail })), [{ id: 'blade-duel', thumbnail: 'blade-duel.jpg' }]);
    const bytes = readFileSync(join(root, 'registry/thumbs/blade-duel.jpg'));
    assert.deepEqual(readImageSize(bytes), { format: 'jpg', width: 640, height: 480 });
    assert.ok(bytes.length > 1000);
    assert.equal(made[0].bytes, bytes.length);
  });
});
