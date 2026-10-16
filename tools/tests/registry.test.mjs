// 登録の道具の試験。正しい登録情報は通り、壊れた登録情報（スキーマ違反・id 不一致・過大なサムネイル・存在しない bundled・
// 未来の日付・許可外のライセンス・http の外部URL・認証情報つきのURL・二重の id）は、理由つきで落ちること。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { THUMB, checkRegistry, latestToday, readImageSize } from '../check-registry.mjs';
import { shelfOrder, shipped, writeRegistry } from '../build-registry.mjs';

const TOOLS = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA = readFileSync(join(TOOLS, '../registry/schema/game.schema.json'));
const SDK = { js: '// sdk build\n' };
const NOW = Date.parse('2026-10-16T00:00:00Z');

function png(width, height, size = 0) {
  const b = Buffer.alloc(Math.max(45, size));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.write('IEND', 37, 'latin1');
  return b;
}
function webp(width, height) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}
function jpg(width, height) {
  const b = Buffer.alloc(32);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 0);
  b.writeUInt16BE(height, 13);
  b.writeUInt16BE(width, 15);
  return b;
}

const manifest = (id, patch = {}) => ({
  schema: 1,
  id,
  title: { ja: '試験のゲーム' },
  summary: { ja: '試験用の登録情報' },
  authors: [{ name: '作者', url: 'https://example.com/me' }],
  license: { code: 'MIT OR Apache-2.0', assets: 'original' },
  players: { min: 1, max: 4 },
  pads: ['pad'],
  entry: { bundled: `games/${id}/` },
  thumbnail: `${id}.png`,
  sdk: 1,
  rating: 'all',
  added: '2026-10-01',
  ...patch,
});

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * 登録情報の置き場の写しを作る。entries は [ファイル名, 中身]。ゲームのフォルダとサムネイルは、id から用意する。
 * @param {[string, unknown][]} entries
 * @param {Record<string, string | Buffer | null>} [files] 足すファイル（null は消す）
 */
function fixture(entries, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'irori-registry-'));
  dirs.push(root);
  const all = { 'registry/schema/game.schema.json': SCHEMA };
  for (const [name, m] of entries) {
    all[`registry/games/${name}.json`] = typeof m === 'string' ? m : `${JSON.stringify(m, null, 2)}\n`;
    const id = typeof m === 'object' && m !== null ? m.id : null;
    if (typeof id === 'string' && /^[a-z0-9-]+$/.test(id)) {
      all[`registry/thumbs/${id}.png`] = png(640, 480);
      all[`games/${id}/index.html`] = '<!doctype html><title>x</title>\n';
      all[`games/${id}/irori.js`] = SDK.js;
      all[`games/${id}/main.js`] = "import './irori.js';\n";
      all[`games/${id}/README.md`] = '# x\n';
      all[`games/${id}/logic.test.js`] = '// test\n';
    }
  }
  Object.assign(all, files);
  for (const [rel, body] of Object.entries(all)) {
    const full = join(root, rel);
    if (body === null) {
      rmSync(full, { force: true, recursive: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const check = (root, opts = {}) => checkRegistry(root, { sdk: SDK, now: NOW, ...opts });
/** 問題がちょうど1件で、その文が re に合うこと。別の検査が代わりに拾って、目当ての検査の撤去を見逃さないように。 */
function onlyProblem(root, re, opts) {
  const { problems } = check(root, opts);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], re);
}

describe('通るもの', () => {
  it('同梱と外部URLの、正しい登録情報', () => {
    const root = fixture([
      ['alpha', manifest('alpha')],
      ['beta', manifest('beta', { entry: { url: 'https://games.example/beta/' }, links: { source: 'https://example.com/src' } })],
    ]);
    const { problems, games } = check(root);
    assert.deepEqual(problems, []);
    assert.deepEqual(games.map((g) => g.id), ['alpha', 'beta']);
  });

  it('サムネイルは png・webp・jpg のどれでもよく、容量はちょうど上限まで通る', () => {
    const root = fixture([
      ['a-png', manifest('a-png')],
      ['b-webp', manifest('b-webp', { thumbnail: 'b-webp.webp' })],
      ['c-jpg', manifest('c-jpg', { thumbnail: 'c-jpg.jpg' })],
    ], {
      'registry/thumbs/a-png.png': png(640, 480, THUMB.maxBytes),
      'registry/thumbs/b-webp.webp': webp(640, 480),
      'registry/thumbs/c-jpg.jpg': jpg(640, 480),
    });
    assert.deepEqual(check(root).problems, []);
  });

  it('ライセンスは SPDX の式・LicenseRef-closed・素材の original を受ける', () => {
    const root = fixture([
      ['a-one', manifest('a-one', { license: { code: 'LicenseRef-closed', assets: 'CC-BY-4.0' } })],
      ['b-two', manifest('b-two', { license: { code: '(MIT OR Apache-2.0)', assets: 'original AND CC0-1.0' } })],
    ]);
    assert.deepEqual(check(root).problems, []);
  });
});

describe('落ちるもの', () => {
  it('スキーマ違反は、項目と理由を読める形で出す', () => {
    const cases = [
      [{ rating: 'adult' }, /rating は "all" にします/],
      [{ extra: 1 }, /知らない項目 extra/],
      [{ title: { ja: 'あ'.repeat(25) } }, /title\.ja は24文字以下/],
      [{ pads: ['html'] }, /pads\.0 は .*"wait"/],
      [{ sdk: 2 }, /sdk は 1 にします/],
    ];
    for (const [patch, re] of cases) onlyProblem(fixture([['game-x', manifest('game-x', patch)]]), re);
    const missing = manifest('game-x');
    delete missing.summary;
    onlyProblem(fixture([['game-x', missing]]), /summary がありません/);
    onlyProblem(fixture([['game-x', manifest('game-x', { entry: { bundled: 'games/game-x/', url: 'https://a.example/' } })]]), /entry は bundled か url のどちらか1つ/);
  });

  it('id とファイル名が違う', () => {
    const root = fixture([['game-x', manifest('game-other')]]);
    onlyProblem(root, /id「game-other」がファイル名「game-x」と違います/);
  });

  it('二重の id', () => {
    const { problems } = check(fixture([['game-a', manifest('game-a')], ['game-b', manifest('game-a')]]));
    assert.ok(problems.some((p) => /registry\/games\/game-b\.json: id「game-a」が registry\/games\/game-a\.json と重なっています/.test(p)), problems.join('\n'));
    // ファイル名と合っている正しいほうは、責めない。
    assert.ok(!problems.some((p) => p.startsWith('registry/games/game-a.json')), problems.join('\n'));
    // どちらもファイル名と合っていなければ、両方に知らせる。
    const both = check(fixture([['game-b', manifest('game-z')], ['game-c', manifest('game-z')]])).problems;
    assert.equal(both.filter((p) => /重なっています/.test(p)).length, 2, both.join('\n'));
  });

  it('サムネイルが上限を1バイトでも超える', () => {
    const root = fixture([['game-x', manifest('game-x')]], { 'registry/thumbs/game-x.png': png(640, 480, THUMB.maxBytes + 1) });
    onlyProblem(root, /game-x\.png が 121KB で、上限の120KBを超えています/);
  });

  it('サムネイルの大きさ・形式・有無', () => {
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'registry/thumbs/game-x.png': png(800, 600) }), /800×600 です（640×480 にします）/);
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'registry/thumbs/game-x.png': jpg(640, 480) }), /中身が jpg で、拡張子と違います/);
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'registry/thumbs/game-x.png': Buffer.from('not an image') }), /形式が読めません/);
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'registry/thumbs/game-x.png': null }), /registry\/thumbs\/game-x\.png がありません/);
    onlyProblem(fixture([['game-x', manifest('game-x', { thumbnail: 'https://cdn.example/x.png' })]]), /thumbnail の形が違います/);
  });

  it('存在しない bundled・index.html がない・id と違うフォルダ', () => {
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'games/game-x': null }), /フォルダ games\/game-x\/ がありません/);
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'games/game-x/index.html': null }), /games\/game-x\/index\.html がありません/);
    onlyProblem(fixture([['game-x', manifest('game-x', { entry: { bundled: 'games/y/' } })]]), /games\/game-x\/ にします/);
  });

  it('同梱ゲームの irori.js が SDK の最新ビルドと違う・ない', () => {
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'games/game-x/irori.js': '// old build\n' }), /SDK の最新ビルドと違います/);
    onlyProblem(fixture([['game-x', manifest('game-x')]], { 'games/game-x/irori.js': null }), /irori\.js がありません/);
    onlyProblem(fixture([['game-x', manifest('game-x')]]), /比べる SDK のビルドがありません/, { sdk: null });
  });

  it('未来の日付と、実在しない日付。どの地域でも今日なら通す（UTC+14 まで）', () => {
    onlyProblem(fixture([['game-x', manifest('game-x', { added: '2026-10-18' })]]), /added「2026-10-18」が未来の日付です/);
    onlyProblem(fixture([['game-x', manifest('game-x', { added: '2026-02-30' })]]), /実在しない日付/);
    const tomorrow = fixture([['game-x', manifest('game-x', { added: '2026-10-17' })]]);
    onlyProblem(tomorrow, /未来の日付/, { now: Date.parse('2026-10-16T09:59:59Z') });
    assert.deepEqual(check(tomorrow, { now: Date.parse('2026-10-16T10:00:00Z') }).problems, []);
    assert.equal(latestToday(Date.parse('2026-10-15T18:00:00Z')), '2026-10-16');
  });

  it('許可外のライセンス', () => {
    onlyProblem(fixture([['game-x', manifest('game-x', { license: { code: 'Proprietary', assets: 'original' } })]]), /license\.code「Proprietary」が許可の一覧にありません/);
    onlyProblem(fixture([['game-x', manifest('game-x', { license: { code: 'MIT', assets: 'free to use' } })]]), /license\.assets「free to use」/);
    onlyProblem(fixture([['game-x', manifest('game-x', { license: { code: 'original', assets: 'original' } })]]), /license\.code「original」/);
    onlyProblem(fixture([['game-x', manifest('game-x', { license: { code: 'MIT AND Proprietary', assets: 'original' } })]]), /license\.code/);
  });

  it('http の外部URL', () => {
    const { problems } = check(fixture([['game-x', manifest('game-x', { entry: { url: 'http://games.example/x/' } })]]));
    assert.ok(problems.some((p) => /entry/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /entry\.url は https にします/.test(p)), problems.join('\n'));
    const author = check(fixture([['game-x', manifest('game-x', { authors: [{ name: 'a', url: 'http://example.com/' }] })]])).problems;
    assert.ok(author.some((p) => /authors\.0\.url/.test(p)), author.join('\n'));
  });

  it('認証情報つきのURL', () => {
    onlyProblem(fixture([['game-x', manifest('game-x', { authors: [{ name: 'a', url: 'https://user:pass@example.com/' }] })]]), /authors\.0\.url に認証情報/);
    onlyProblem(fixture([['game-x', manifest('game-x', { links: { homepage: 'https://token@example.com/' } })]]), /links\.homepage に認証情報/);
    const ext = check(fixture([['game-x', manifest('game-x', { entry: { url: 'https://u:p@games.example/' } })]])).problems;
    assert.ok(ext.some((p) => /entry\.url に認証情報/.test(p)), ext.join('\n'));
  });

  it('人数の向き・壊れた JSON・登録が1件もない', () => {
    onlyProblem(fixture([['game-x', manifest('game-x', { players: { min: 4, max: 2 } })]]), /min（4）が max（2）より大きい/);
    onlyProblem(fixture([['game-x', '{ "schema": 1, ']]), /JSON として読めません/);
    onlyProblem(fixture([]), /登録情報が1件もありません/);
  });
});

describe('画像の読み取り', () => {
  it('png・webp（VP8X・VP8・VP8L）・jpg の縦横', () => {
    assert.deepEqual(readImageSize(png(640, 480)), { format: 'png', width: 640, height: 480 });
    assert.deepEqual(readImageSize(webp(640, 480)), { format: 'webp', width: 640, height: 480 });
    assert.deepEqual(readImageSize(jpg(640, 480)), { format: 'jpg', width: 640, height: 480 });
    const lossy = Buffer.alloc(30);
    lossy.write('RIFF', 0, 'latin1');
    lossy.write('WEBPVP8 ', 8, 'latin1');
    lossy.writeUInt16LE(640, 26);
    lossy.writeUInt16LE(480, 28);
    assert.deepEqual(readImageSize(lossy), { format: 'webp', width: 640, height: 480 });
    const lossless = Buffer.alloc(30);
    lossless.write('RIFF', 0, 'latin1');
    lossless.write('WEBPVP8L', 8, 'latin1');
    const bits = (640 - 1) | ((480 - 1) << 14);
    lossless.writeUInt32LE(bits, 21);
    assert.deepEqual(readImageSize(lossless), { format: 'webp', width: 640, height: 480 });
    assert.equal(readImageSize(Buffer.from('GIF89a')), null);
  });
});

describe('書き出し', () => {
  it('新しい順の一覧に公開パスを足し、サムネイルとゲームを写す。README と試験は配らず、前回の書き出しは消す', () => {
    const root = fixture([
      ['old-one', manifest('old-one', { added: '2026-09-01' })],
      ['new-b', manifest('new-b', { added: '2026-10-10' })],
      ['new-a', manifest('new-a', { added: '2026-10-10' })],
    ], { 'apps/web/public/games/stale/x.js': 'old\n', 'apps/web/public/registry/thumbs/stale.png': 'old' });
    const { problems, games } = check(root);
    assert.deepEqual(problems, []);
    const r = writeRegistry(root, games);
    assert.deepEqual(r, { games: 3, thumbs: 3, files: 9 });
    const index = JSON.parse(readFileSync(join(root, 'apps/web/public/registry/index.json'), 'utf8'));
    assert.equal(index.schema, 1);
    assert.deepEqual(index.games.map((g) => g.id), ['new-a', 'new-b', 'old-one']);
    assert.equal(index.games[0].thumbUrl, '/registry/thumbs/new-a.png');
    assert.ok(existsSync(join(root, 'apps/web/public/registry/thumbs/old-one.png')));
    assert.ok(existsSync(join(root, 'apps/web/public/games/new-a/index.html')));
    assert.ok(existsSync(join(root, 'apps/web/public/games/new-a/irori.js')));
    assert.ok(!existsSync(join(root, 'apps/web/public/games/new-a/README.md')));
    assert.ok(!existsSync(join(root, 'apps/web/public/games/new-a/logic.test.js')));
    assert.ok(!existsSync(join(root, 'apps/web/public/games/stale')));
    assert.ok(!existsSync(join(root, 'apps/web/public/registry/thumbs/stale.png')));
  });

  it('配らないファイルの判定と、並びの決め方', () => {
    assert.deepEqual(['README.md', 'logic.test.js', 'a.test.js', '.DS_Store', 'node_modules', 'main.js', 'irori.d.ts'].filter(shipped), ['main.js', 'irori.d.ts']);
    assert.deepEqual(shelfOrder([{ id: 'b', added: '2026-01-01' }, { id: 'a', added: '2026-01-01' }, { id: 'c', added: '2026-02-01' }]).map((g) => g.id), ['c', 'a', 'b']);
  });
});

describe('コマンド', () => {
  const sdkDist = { 'packages/sdk/dist/irori.js': SDK.js, 'packages/sdk/irori.d.ts': '// types\n' };
  const run = (script, root) => spawnSync(process.execPath, [join(TOOLS, script), '--sdk-from-dist'], { cwd: root, encoding: 'utf8' });

  it('build-registry：通れば書き出して終了コード0、壊れた登録情報を足すと理由を出して1、何も書かない', () => {
    const root = fixture([['game-x', manifest('game-x')]], sdkDist);
    const ok = run('build-registry.mjs', root);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /1件を/);
    const index = join(root, 'apps/web/public/registry/index.json');
    const first = readFileSync(index, 'utf8');
    writeFileSync(join(root, 'registry/games/game-y.json'), JSON.stringify(manifest('game-y', { added: '2999-01-01' })));
    writeFileSync(join(root, 'registry/thumbs/game-y.png'), png(640, 480));
    mkdirSync(join(root, 'games/game-y'), { recursive: true });
    writeFileSync(join(root, 'games/game-y/index.html'), 'x');
    writeFileSync(join(root, 'games/game-y/irori.js'), SDK.js);
    const bad = run('build-registry.mjs', root);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /registry\/games\/game-y\.json: added「2999-01-01」が未来の日付です/);
    assert.match(bad.stderr, /何も書き出していません/);
    assert.equal(readFileSync(index, 'utf8'), first);
  });

  it('check-registry：同じ検査を書き出しなしで行う', () => {
    const root = fixture([['game-x', manifest('game-x')]], sdkDist);
    const ok = run('check-registry.mjs', root);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /OK（1件）/);
    assert.ok(!existsSync(join(root, 'apps/web/public/registry')));
    writeFileSync(join(root, 'registry/games/game-x.json'), JSON.stringify(manifest('game-x', { rating: 'adult' })));
    const bad = run('check-registry.mjs', root);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /rating は "all" にします/);
  });
});
