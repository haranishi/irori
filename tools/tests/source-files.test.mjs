// All targets below are synthetic temporary fixtures; no real credentials are accessed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listFiles } from '../lib/files.mjs';
import { writeRegistry } from '../build-registry.mjs';
import { checkRegistry } from '../check-registry.mjs';
import { checkSourceFiles } from '../check-source-files.mjs';
import { checkSdk, readDist, syncSdk } from '../sync-sdk.mjs';

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'irori-source-files-'));
  dirs.push(root);
  for (const [rel, value] of Object.entries(files)) put(root, rel, value);
  return root;
}
function put(root, rel, value) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}
function link(root, rel, target) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  rmSync(file, { recursive: true, force: true });
  symlinkSync(target, file);
}
const unsafe = /Unsafe source path/;
const built = { js: '// synthetic sdk\n', dts: '// synthetic types\n' };
const game = { id: 'demo', thumbnail: 'demo.png', added: '2026-01-01', entry: { bundled: 'games/demo/' } };
function registryFixture() {
  return fixture({
    'games/demo/index.html': '<title>synthetic</title>',
    'games/demo/main.js': '// synthetic game',
    'registry/thumbs/demo.png': 'synthetic thumbnail',
    'apps/web/public/registry/index.json': 'previous registry',
    'apps/web/public/games/previous/main.js': 'previous game',
  });
}
function previousOutput(root) {
  assert.equal(readFileSync(join(root, 'apps/web/public/registry/index.json'), 'utf8'), 'previous registry');
  assert.equal(readFileSync(join(root, 'apps/web/public/games/previous/main.js'), 'utf8'), 'previous game');
}

describe('source inventory boundary', () => {
  it('lists ordinary sources while retaining dependency, Git, and generated exclusions', () => {
    const root = fixture({ 'games/demo/main.js': 'ok', '.github/workflows/ci.yml': 'ok', '.git/config': 'ignored', 'node_modules/x/index.js': 'ignored', 'apps/web/public/games/demo/main.js': 'generated', 'packages/sdk/dist/irori.js': 'generated' });
    assert.deepEqual(listFiles(root), ['.github/workflows/ci.yml', 'games/demo/main.js']);
  });
  for (const rel of ['packages/sdk/dist', 'apps/web/dist', 'apps/edge/.wrangler', 'test-results', 'playwright-report', 'coverage', 'apps/web/public/games', 'apps/web/public/registry', 'apps/web/public/sdk']) {
    for (const nested of [false, true]) {
      it(`rejects a linked generated ${nested ? 'child in' : 'root at'} ${rel} before building`, () => {
        const root = fixture({ 'source.js': 'export const source = 1;' });
        const external = fixture({ 'sentinel.txt': 'external sentinel' });
        link(root, nested ? `${rel}/linked` : rel, external);
        const problems = checkSourceFiles(root);
        assert.equal(problems.length, 1);
        assert.match(problems[0], unsafe);
        assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'external sentinel');
      });
    }
  }
  for (const nested of [false, true]) {
    it(`rejects a generated FIFO at ${nested ? 'a child path' : 'the output root'}`, { skip: process.platform === 'win32' }, () => {
      const root = fixture({ 'source.js': 'ok', 'packages/sdk/ordinary.txt': 'ok' });
      const rel = nested ? 'packages/sdk/dist/pipe' : 'packages/sdk/dist';
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      const made = spawnSync('mkfifo', [join(root, rel)], { encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      assert.equal(checkSourceFiles(root).length, 1);
      assert.match(checkSourceFiles(root)[0], unsafe);
    });
  }
  it('retains intentional dependency and Git metadata symlink exclusions', () => {
    const root = fixture({ 'source.js': 'ok' });
    const external = fixture({ 'sentinel.txt': 'external sentinel' });
    link(root, 'node_modules', external);
    link(root, '.git', external);
    assert.deepEqual(checkSourceFiles(root), []);
    assert.deepEqual(listFiles(root), ['source.js']);
  });
  for (const rel of ['packages/sdk/dist', 'apps/web/dist']) {
    it(`the actual Vite build gate preserves the external sentinel behind ${rel}`, () => {
      const root = fixture({ 'main.js': 'export const value = 1;', 'vite.config.mjs': `export default { build: { outDir: '${rel}', emptyOutDir: true, minify: false, lib: { entry: 'main.js', formats: ['es'], fileName: () => 'bundle.js' } } };` });
      const external = fixture({ 'sentinel.txt': 'external sentinel' });
      link(root, rel, external);
      const checker = fileURLToPath(new URL('../check-source-files.mjs', import.meta.url));
      const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
      const pipeline = "import { spawnSync } from 'node:child_process'; const [checker, vite] = process.argv.slice(1); const check = spawnSync(process.execPath, [checker], { stdio: 'inherit' }); if (check.status !== 0) process.exit(check.status ?? 1); const build = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.config.mjs'], { stdio: 'inherit' }); process.exit(build.status ?? 1);";
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', pipeline, checker, vite], { cwd: root, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, unsafe);
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'external sentinel');
      assert.ok(!existsSync(join(external, 'bundle.js')));
    });
  }
  for (const kind of ['external-file', 'external-directory', 'internal-file', 'dangling', 'cycle']) {
    it(`rejects a ${kind} link without following it`, () => {
      const root = fixture({ 'games/demo/main.js': 'source' });
      const external = fixture({ 'target.txt': 'external synthetic data' });
      const target = kind === 'external-file' ? join(external, 'target.txt') : kind === 'external-directory' ? external : kind === 'internal-file' ? 'main.js' : kind === 'cycle' ? '.' : 'missing.txt';
      link(root, 'games/demo/linked', target);
      assert.throws(() => listFiles(root), unsafe);
      assert.equal(readFileSync(join(external, 'target.txt'), 'utf8'), 'external synthetic data');
    });
  }
  it('the dependency-free preflight fails closed on a linked source', () => {
    const root = fixture({ 'ordinary.txt': 'ok' });
    link(root, 'linked.txt', 'ordinary.txt');
    assert.equal(checkSourceFiles(root).length, 1);
    assert.match(checkSourceFiles(root)[0], unsafe);
  });
  it('the registry API rejects a linked manifest before reading its target', () => {
    const root = fixture({ 'registry/games/ordinary.json': '{}' });
    put(root, 'registry/schema/game.schema.json', readFileSync(new URL('../../registry/schema/game.schema.json', import.meta.url)));
    const external = fixture({ 'manifest.json': '{}' });
    link(root, 'registry/games/linked.json', join(external, 'manifest.json'));
    assert.throws(() => checkRegistry(root, { sdk: built }), unsafe);
  });
  it('the preflight CLI rejects links with a relative diagnostic and exit code 1', () => {
    const root = fixture({ 'ordinary.txt': 'ok' });
    const external = fixture({ 'synthetic.txt': 'no output of contents' });
    const script = fileURLToPath(new URL('../check-source-files.mjs', import.meta.url));
    const clean = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
    link(root, 'linked.txt', join(external, 'synthetic.txt'));
    const bad = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stderr, /Unsafe source path: linked.txt/);
    assert.ok(!bad.stderr.includes(external));
    assert.ok(!bad.stderr.includes('no output of contents'));
  });
  it('rejects a FIFO instead of skipping or opening it', { skip: process.platform === 'win32' }, () => {
    const root = fixture({ 'games/demo/main.js': 'ok' });
    const made = spawnSync('mkfifo', [join(root, 'games/demo/pipe')], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    assert.throws(() => listFiles(root), unsafe);
  });
});

describe('registry copy boundary', () => {
  for (const rel of ['games/demo/linked.txt', 'games/demo/assets', 'registry/thumbs/linked.png']) {
    it(`rejects linked input ${rel} before removing previous output`, () => {
      const root = registryFixture();
      const external = fixture({ 'secret.txt': 'external synthetic data' });
      link(root, rel, rel.endsWith('assets') ? external : join(external, 'secret.txt'));
      assert.throws(() => writeRegistry(root, [game]), unsafe);
      previousOutput(root);
      assert.equal(readFileSync(join(external, 'secret.txt'), 'utf8'), 'external synthetic data');
      assert.ok(!existsSync(join(root, 'apps/web/public/games/demo/linked.txt')));
    });
  }
  for (const rel of ['apps/web', 'apps/web/public/registry', 'apps/web/public/games/previous/linked']) {
    it(`rejects output link ${rel} before touching its synthetic target`, () => {
      const root = registryFixture();
      const external = fixture({ 'public/registry/index.json': 'external registry', 'secret.txt': 'external sentinel' });
      link(root, rel, external);
      assert.throws(() => writeRegistry(root, [game]), unsafe);
      assert.equal(readFileSync(join(external, 'secret.txt'), 'utf8'), 'external sentinel');
      assert.equal(readFileSync(join(external, 'public/registry/index.json'), 'utf8'), 'external registry');
      if (rel.endsWith('linked')) previousOutput(root);
    });
  }
  for (const rel of ['games/demo', 'registry/thumbs']) {
    it(`rejects non-directory input ${rel} before removing previous output`, () => {
      const root = registryFixture();
      rmSync(join(root, rel), { recursive: true });
      put(root, rel, 'ordinary file at directory path');
      assert.throws(() => writeRegistry(root, [game]), unsafe);
      previousOutput(root);
    });
  }
  it('rejects bundled paths outside the games namespace before deleting output', () => {
    const root = registryFixture();
    assert.throws(() => writeRegistry(root, [{ ...game, entry: { bundled: '../outside/' } }]), unsafe);
    previousOutput(root);
  });
  it('copies ordinary sources and replaces old outputs', () => {
    const root = registryFixture();
    assert.deepEqual(writeRegistry(root, [game]), { games: 1, thumbs: 1, files: 2 });
    assert.equal(readFileSync(join(root, 'apps/web/public/games/demo/main.js'), 'utf8'), '// synthetic game');
    assert.ok(!existsSync(join(root, 'apps/web/public/games/previous')));
  });
});

describe('SDK synchronization boundary', () => {
  for (const rel of ['games/b-demo', 'games/b-demo/irori.js', 'games/b-demo/irori.d.ts', 'apps/web/public', 'apps/web/public/sdk/v1/irori.js']) {
    it(`rejects ${rel} before any SDK destination is written`, () => {
      const root = fixture({ 'games/a-demo/index.html': 'ok', 'games/a-demo/irori.js': 'old sdk', 'games/b-demo/index.html': 'ok' });
      const external = fixture({ 'sentinel.txt': 'external sentinel' });
      const fileLink = rel.endsWith('.js') || rel.endsWith('.ts');
      link(root, rel, fileLink ? join(external, 'sentinel.txt') : external);
      assert.throws(() => syncSdk(root, built), unsafe);
      assert.equal(readFileSync(join(root, 'games/a-demo/irori.js'), 'utf8'), 'old sdk');
      assert.ok(!existsSync(join(root, 'games/a-demo/irori.d.ts')));
      assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), 'external sentinel');
      assert.ok(!existsSync(join(external, 'irori.js')));
    });
  }
  it('rejects a dangling public SDK destination when checking', () => {
    const root = fixture();
    link(root, 'apps/web/public/sdk', 'missing');
    assert.throws(() => checkSdk(root, built), unsafe);
  });
  it('rejects a linked SDK when checking or reading build inputs', () => {
    const root = fixture({ 'games/demo/index.html': 'ok' });
    const external = fixture({ 'target.txt': 'synthetic SDK' });
    link(root, 'games/demo/irori.js', join(external, 'target.txt'));
    assert.throws(() => checkSdk(root, built), unsafe);
    link(root, 'packages/sdk/dist/irori.js', join(external, 'target.txt'));
    assert.throws(() => readDist(root), unsafe);
  });
  it('supports an ordinary SDK build and synchronization', () => {
    const root = fixture({ 'games/demo/index.html': 'ok', 'packages/sdk/dist/irori.js': built.js, 'packages/sdk/irori.d.ts': built.dts });
    assert.deepEqual(readDist(root), built);
    assert.deepEqual(syncSdk(root, built), ['games/demo', 'apps/web/public/sdk/v1']);
    assert.deepEqual(checkSdk(root, built), []);
  });
});
