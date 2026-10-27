// 点検の道具そのものの試験。守りが「何も見ていない」状態になっていないことを、壊れた入力で確かめる。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkDeps } from '../check-deps.mjs';
import { checkDocs } from '../check-docs.mjs';
import { licenseAllowed } from '../check-licenses.mjs';
import { checkRights } from '../check-rights.mjs';

const dirs = [];
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'irori-check-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const lines = (n) => Array.from({ length: n }, (_, i) => `行${i + 1}`).join('\n') + '\n';

describe('check-docs', () => {
  it('100行は通り、101行は落ちる', () => {
    assert.deepEqual(checkDocs(fixture({ 'docs/a.md': lines(100) })), []);
    const p = checkDocs(fixture({ 'docs/a.md': lines(101) }));
    assert.equal(p.length, 1);
    assert.match(p[0], /101行/);
  });
  it('切れた相対リンクを見つけ、コードの中と外部URLは見ない', () => {
    const root = fixture({
      'docs/a.md': '[有る](b.md) [無い](c.md) [外](https://example.com/x.md)\n```\n[例](d.md)\n```\n`[例](e.md)`\n',
      'docs/b.md': 'b\n',
    });
    const p = checkDocs(root);
    assert.equal(p.length, 1);
    assert.match(p[0], /c\.md/);
  });
  it('アンカーとクエリは外してファイルの有無を見る', () => {
    const root = fixture({ 'docs/a.md': '[節](b.md#x) [問](b.md?y=1)\n', 'docs/b.md': 'b\n' });
    assert.deepEqual(checkDocs(root), []);
  });
});

describe('check-rights', () => {
  it('コードや登録情報の中の他社の名称を拒み、文書の中の言及は許す', () => {
    assert.equal(checkRights(fixture({ 'apps/web/src/a.ts': "const s = 'Nintendo';\n" })).length, 1);
    assert.equal(checkRights(fixture({ 'games/g/main.js': '// マリオ風\n' })).length, 1);
    assert.equal(checkRights(fixture({ 'registry/games/x.json': '{"title":"vvii"}\n' })).length, 1);
    assert.deepEqual(checkRights(fixture({ 'docs/legal/r.md': 'Wii U と Nintendo の商標\n' })), []);
  });
  it('音声と書体のファイルを拒む', () => {
    assert.equal(checkRights(fixture({ 'games/g/a.mp3': 'x' })).length, 1);
    assert.equal(checkRights(fixture({ 'apps/web/public/f.woff2': 'x' })).length, 1);
    assert.deepEqual(checkRights(fixture({ 'apps/web/public/a.png': 'x' })), []);
  });
  it('画面とゲームの外部読み込みを拒み、通常のリンクは許す', () => {
    const bad = [
      '<script src="https://cdn.example.com/a.js"></script>',
      '<link rel="stylesheet" href="https://fonts.example.com/css">',
      '@import url("https://fonts.example.com/x.css");',
      'a{background:url(https://x.example.com/a.png)}',
      "import x from 'https://esm.example.com/x.js';",
    ];
    for (const b of bad) {
      assert.equal(checkRights(fixture({ 'games/g/index.html': b + '\n' })).length, 1, b);
    }
    assert.deepEqual(checkRights(fixture({ 'games/g/index.html': '<a href="https://x.com/intent/post">共有</a>\n' })), []);
  });
  it('私的な絶対パスを拒む', () => {
    assert.equal(checkRights(fixture({ 'docs/a.md': '場所は /Users/someone/Projects/x\n' })).length, 1);
  });
  it('OSの一時フォルダと作業フォルダ名も拒み、CIの /home/runner は通す', () => {
    for (const p of ['/private/tmp/work/a.ttf', '/var/folders/zz/abc/T/x', '/home/someone/work/x', 'projects/-Users-someone-x/memory']) {
      assert.equal(checkRights(fixture({ 'docs/a.md': `場所は ${p}\n` })).length, 1, p);
    }
    assert.deepEqual(checkRights(fixture({ 'docs/a.md': '場所は /home/runner/work/irori\n' })), []);
  });
});

describe('check-deps', () => {
  const pkg = (name, deps = {}) => JSON.stringify({ name, dependencies: deps });
  const base = {
    'packages/protocol/package.json': pkg('@irori/protocol'),
    'packages/room/package.json': pkg('@irori/room', { '@irori/protocol': '*' }),
    'packages/pad-ui/package.json': pkg('@irori/pad-ui', { '@irori/protocol': '*' }),
  };
  it('許可された向きは通り、逆向きは落ちる', () => {
    const ok = fixture({ ...base, 'packages/room/src/a.ts': "import type { X } from '@irori/protocol';\n" });
    assert.deepEqual(checkDeps(ok), []);
    const bad = fixture({ ...base, 'packages/protocol/src/a.ts': "import { r } from '@irori/room';\n" });
    assert.equal(checkDeps(bad).length, 1);
    const sideways = fixture({ ...base, 'packages/room/src/a.ts': "import { p } from '@irori/pad-ui';\n" });
    assert.equal(checkDeps(sideways).length, 1);
  });
  it('package.json の依存の向きも見る', () => {
    const bad = fixture({ ...base, 'packages/protocol/package.json': pkg('@irori/protocol', { '@irori/room': '*' }) });
    assert.ok(checkDeps(bad).some((p) => /package\.json/.test(p)));
  });
  it('置き場所の外へ出る相対importを拒む', () => {
    const bad = fixture({ ...base, 'packages/room/src/a.ts': "import x from '../../pad-ui/src/index';\n" });
    assert.equal(checkDeps(bad).length, 1);
  });
  it('ゲームは自分のフォルダだけを読む', () => {
    const ok = fixture({ ...base, 'games/g/main.js': "import { connect } from './irori.js';\n" });
    assert.deepEqual(checkDeps(ok), []);
    assert.equal(checkDeps(fixture({ ...base, 'games/g/main.js': "import x from '@irori/sdk';\n" })).length, 1);
    assert.equal(checkDeps(fixture({ ...base, 'games/g/main.js': "import x from '../h/a.js';\n" })).length, 1);
    assert.equal(checkDeps(fixture({ ...base, 'games/g/main.js': "import x from 'lodash';\n" })).length, 1);
  });
  it('文字列の \'from\' や、プロパティの from を、読み込みと誤認しない（ババ抜きの画面で起きた誤検知）', () => {
    const code = "const role = t.from === id ? 'from' : t.to === id ? 'to' : '';\nconst x = a.from + \"from\" + \"y\";\n";
    assert.deepEqual(checkDeps(fixture({ ...base, 'games/g/view.js': code })), []);
    // 本物の import は、これまでどおり拒む。
    assert.equal(checkDeps(fixture({ ...base, 'games/g/view.js': code + "import x from 'lodash';\n" })).length, 1);
  });
  it('ゲームの試験（*.test.js）だけは vitest を読める。ゲーム本体は読めない', () => {
    const test = "import { describe, it } from 'vitest';\nimport { rule } from './logic.js';\n";
    assert.deepEqual(checkDeps(fixture({ ...base, 'games/g/logic.test.js': test })), []);
    assert.equal(checkDeps(fixture({ ...base, 'games/g/main.js': "import { it } from 'vitest';\n" })).length, 1);
    // 試験でも、ほかの外部の部品や、フォルダの外は読めない。
    assert.equal(checkDeps(fixture({ ...base, 'games/g/logic.test.js': "import x from 'lodash';\n" })).length, 1);
    assert.equal(checkDeps(fixture({ ...base, 'games/g/logic.test.js': "import x from '../h/a.js';\n" })).length, 1);
  });
});

describe('check-licenses', () => {
  it('SPDX式を読む', () => {
    assert.ok(licenseAllowed('MIT'));
    assert.ok(licenseAllowed('MIT OR Apache-2.0'));
    assert.ok(licenseAllowed('(MIT OR GPL-3.0-only)'));
    assert.ok(!licenseAllowed('GPL-3.0-only'));
    assert.ok(!licenseAllowed('MIT AND GPL-3.0-only'));
    assert.ok(!licenseAllowed(undefined));
  });
});

describe('check-overlap', async () => {
  const { checkOverlap, tokenize } = await import('../check-overlap.mjs');
  const snippet =
    "const handler = (event) => { if (event.source !== frame.contentWindow) return; port.postMessage({ type: 'ready', value: event.data }); };\n";

  it('同じ並びを見つけ、空白や改行の違いは無視し、別のコードには反応しない', () => {
    const corpusDir = fixture({ 'ref/a.js': 'function x(){}\n' + snippet + 'function y(){}\n' });
    const copied = fixture({ 'apps/web/src/a.ts': 'const handler = (event) =>\n  {\n if (event.source !== frame.contentWindow) return;\n port.postMessage({ type: \'ready\', value: event.data });\n };\n' });
    const other = fixture({ 'apps/web/src/a.ts': 'export function add(a: number, b: number) { return a + b; }\nconst list = items.map((item) => item.id).filter(Boolean);\n' });
    assert.ok(checkOverlap({ root: copied, corpus: [join(corpusDir, 'ref')] }).hits.length > 0);
    assert.equal(checkOverlap({ root: other, corpus: [join(corpusDir, 'ref')] }).hits.length, 0);
  });
  it('識別子が少ない並び（記号だけ）は数えない', () => {
    const tokens = tokenize('((((((((((((((((( ))))))))))))))))');
    assert.ok(tokens.length > 14);
    const corpusDir = fixture({ 'ref/a.js': '((((((((((((((((( ))))))))))))))))\n' });
    const mine = fixture({ 'apps/web/src/a.ts': '((((((((((((((((( ))))))))))))))))\n' });
    assert.equal(checkOverlap({ root: mine, corpus: [join(corpusDir, 'ref')] }).hits.length, 0);
  });
});
