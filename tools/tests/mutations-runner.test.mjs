// 変異試験の実行器そのものの試験。「壊しても緑」を見逃さず、「壊す前から赤」を成功と誤認しないこと。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSpecs, runMutations, selectSpecs } from '../mutations/run.mjs';

const dirs = [];
function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'irori-mutfx-'));
  dirs.push(root);
  const files = {
    'package.json': '{"name":"fx","type":"module"}\n',
    'src/gate.mjs': 'export function allowed(n) {\n  return n < 10; // 上限\n}\n',
    'tests/gate.test.mjs':
      "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { allowed } from '../src/gate.mjs';\n" +
      "test('上限', () => { assert.equal(allowed(9), true); assert.equal(allowed(10), false); });\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const cmd = ['node', '--test', 'tests/gate.test.mjs'];

describe('変異試験の実行器', () => {
  it('試験が赤くなる変異はKILLED、緑のままの変異はSURVIVED', () => {
    const root = fixtureRepo();
    const specs = [
      { id: 'gate-removed', file: 'src/gate.mjs', find: 'n < 10', replace: 'true', command: cmd },
      { id: 'comment-only', file: 'src/gate.mjs', find: '// 上限', replace: '// 制限', command: cmd },
    ];
    const r = runMutations({ root, specs, log: () => {} });
    assert.equal(r.find((x) => x.id === 'gate-removed').verdict, 'KILLED');
    assert.equal(r.find((x) => x.id === 'comment-only').verdict, 'SURVIVED');
  });

  it('作業ツリーは書き換えない', () => {
    const root = fixtureRepo();
    const before = readFileSync(join(root, 'src/gate.mjs'), 'utf8');
    runMutations({ root, specs: [{ id: 'x', file: 'src/gate.mjs', find: 'n < 10', replace: 'true', command: cmd }], log: () => {} });
    assert.equal(readFileSync(join(root, 'src/gate.mjs'), 'utf8'), before);
  });

  it('見つからない・複数一致・壊す前から赤、は成功にしない（ERROR）', () => {
    const root = fixtureRepo();
    const r = runMutations({
      root,
      log: () => {},
      specs: [
        { id: 'no-match', file: 'src/gate.mjs', find: '存在しない文字列', replace: 'x', command: cmd },
        { id: 'multi', file: 'src/gate.mjs', find: 'n', replace: 'm', command: cmd },
        { id: 'no-file', file: 'src/none.mjs', find: 'a', replace: 'b', command: cmd },
      ],
    });
    assert.deepEqual(r.map((x) => x.verdict), ['ERROR', 'ERROR', 'ERROR']);
    writeFileSync(join(root, 'src/gate.mjs'), 'export function allowed(n) {\n  return true;\n}\n');
    const red = runMutations({ root, log: () => {}, specs: [{ id: 'red', file: 'src/gate.mjs', find: 'true', replace: 'false', command: cmd }] });
    assert.equal(red[0].verdict, 'ERROR');
  });

  it('壊すと固まる変異は、時間切れで止めて KILLED にし、時間切れと分かる印を付ける', () => {
    const root = fixtureRepo();
    // 壊れていると（allowed(10) が真になると）固まる試験。壊す前は、すぐ終わる。
    writeFileSync(
      join(root, 'tests/maybe-hang.mjs'),
      "import { allowed } from '../src/gate.mjs';\nif (allowed(10)) setTimeout(() => {}, 60_000);\n",
    );
    const t0 = Date.now();
    const r = runMutations({
      root,
      log: () => {},
      specs: [{ id: 'hang', file: 'src/gate.mjs', find: 'n < 10', replace: 'true', command: ['node', 'tests/maybe-hang.mjs'], timeoutMs: 2_000 }],
    });
    assert.equal(r[0].verdict, 'KILLED');
    assert.equal(r[0].timedOut, true);
    assert.match(r[0].detail, /時間切れ/);
    assert.ok(Date.now() - t0 < 30_000, '60秒待たずに返ること');
  });

  it('仕様の読み込みは、欠けた項目と重複したidを拒む', () => {
    const root = fixtureRepo();
    const dir = join(root, 'specs');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.json'), JSON.stringify([{ id: 'a', file: 'f', find: 'x', replace: 'y' }]));
    assert.throws(() => loadSpecs(dir), /command/);
    writeFileSync(join(dir, 'a.json'), JSON.stringify([
      { id: 'a', file: 'f', find: 'x', replace: 'y', command: ['true'] },
      { id: 'a', file: 'f', find: 'x', replace: 'y', command: ['true'] },
    ]));
    assert.throws(() => loadSpecs(dir), /重複/);
  });
});

describe('変異試験の分割', () => {
  const specs = Array.from({ length: 11 }, (_, i) => ({ id: `gate-${i}` }));

  it('4つの分割は重複せず、全件を元の順番に従って1回ずつ選ぶ', () => {
    const shards = [1, 2, 3, 4].map((index) => selectSpecs({ specs, shard: `${index}/4` }));
    assert.deepEqual(shards.map((group) => group.map((s) => s.id)), [
      ['gate-0', 'gate-4', 'gate-8'], ['gate-1', 'gate-5', 'gate-9'],
      ['gate-2', 'gate-6', 'gate-10'], ['gate-3', 'gate-7'],
    ]);
    assert.equal(new Set(shards.flat()).size, specs.length);
    assert.deepEqual(selectSpecs({ specs }), specs);
    assert.deepEqual(selectSpecs({ specs, shard: '1/1' }), specs);
  });

  it('--onlyを適用したあとの添字で分割する', () => {
    const mixed = [{ id: 'other-0' }, { id: 'gate-0' }, { id: 'other-1' }, { id: 'gate-1' }, { id: 'gate-2' }];
    assert.deepEqual(selectSpecs({ specs: mixed, only: 'gate-', shard: '1/2' }).map((s) => s.id), ['gate-0', 'gate-2']);
    assert.deepEqual(selectSpecs({ specs: mixed, only: 'gate-' }).map((s) => s.id), ['gate-0', 'gate-1', 'gate-2']);
  });

  it('不正な分割指定と空の選択を、試験を始める前に拒む', () => {
    for (const shard of ['1', '1/0', '0/4', '5/4', '-1/4', '1.5/4', '1/4x', '01/4', '1/04', '1/9007199254740992', ' 1/4', '']) {
      assert.throws(() => selectSpecs({ specs, shard }), /shard/, shard);
    }
    assert.throws(() => selectSpecs({ specs, only: 'missing' }), /0件/);
    assert.throws(() => selectSpecs({ specs: [], shard: '1/4' }), /0件/);
    assert.throws(() => selectSpecs({ specs: specs.slice(0, 1), shard: '2/4' }), /0件/);
    assert.throws(() => runMutations({ root: 'unused', specs, shard: '0/4' }), /shard/);
    assert.throws(() => runMutations({ root: 'unused', specs, only: 'missing' }), /0件/);
  });

  it('runMutationsは選択された変異だけを実行し、基準と失敗判定を維持する', () => {
    const root = fixtureRepo();
    const cases = [
      { id: 'gate-removed', file: 'src/gate.mjs', find: 'n < 10', replace: 'true', command: cmd },
      { id: 'comment-only', file: 'src/gate.mjs', find: '// 上限', replace: '// 制限', command: cmd },
    ];
    const result = runMutations({ root, specs: cases, shard: '2/2', log: () => {} });
    assert.deepEqual(result.map((r) => [r.id, r.verdict]), [['comment-only', 'SURVIVED']]);
  });

  it('CLIの--listも同じ分割を使い、不正・不足の引数と空の選択を終了コード1にする', () => {
    const root = fixtureRepo();
    const specsDir = join(root, 'tools/mutations/specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'gates.json'), JSON.stringify(specs.map((s) => ({ ...s, file: 'src/gate.mjs', find: 'n < 10', replace: 'true', command: cmd }))));
    const runner = fileURLToPath(new URL('../mutations/run.mjs', import.meta.url));
    const run = (...args) => spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    const listed = run('--list', '--only', 'gate-', '--shard', '2/4');
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split('\n').map((line) => line.split('\t')[0]), ['gate-1', 'gate-5', 'gate-9']);
    for (const args of [['--shard'], ['--shard', '--list'], ['--shard', '0/4'], ['--only'], ['--only', '--list'], ['--list', '--only', 'missing']]) {
      const result = run(...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stdout.includes('件で赤くなった'), false, '空の成功を表示しない');
    }
  });
});

describe('guard（時間切れとプロセスグループの後始末）', () => {
  const guard = fileURLToPath(new URL('../mutations/guard.mjs', import.meta.url));
  const runGuard = (ms, cwd, ...command) =>
    spawnSync(process.execPath, [guard, String(ms), cwd, ...command], { encoding: 'utf8', timeout: 30_000 });

  it('時間切れは終了コード124で、早く返る', () => {
    const t0 = Date.now();
    const r = runGuard(600, tmpdir(), 'sleep', '30');
    assert.equal(r.status, 124);
    assert.ok(Date.now() - t0 < 15_000, '30秒待たずに返ること');
  });

  it('コマンドの終了コードをそのまま返す', () => {
    assert.equal(runGuard(10_000, tmpdir(), 'sh', '-c', 'exit 3').status, 3);
    assert.equal(runGuard(10_000, tmpdir(), 'sh', '-c', 'exit 0').status, 0);
  });

  it('コマンドが終わったあとに残った孫のプロセスも止める（孤児を残さない）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'irori-guard-'));
    dirs.push(dir);
    const pidFile = join(dir, 'pid');
    // sh が孫（sleep）を背景に残して、すぐ終わる。
    const r = runGuard(10_000, dir, 'sh', '-c', `sleep 60 & echo $! > "${pidFile}"; exit 0`);
    assert.equal(r.status, 0);
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    assert.ok(pid > 1, '孫の番号が取れること');
    let alive = true;
    for (let i = 0; i < 30 && alive; i++) {
      try {
        process.kill(pid, 0);
        spawnSync('sleep', ['0.1']);
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, '孫のプロセスが残っていない');
  });
});
