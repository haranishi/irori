// 守りが生きているかの確認：わざと壊して、試験が赤くなるかを見る（変異試験）。
//
// 仕様は tools/mutations/specs/*.json（1ファイルに配列でもよい）。1件の形：
//   { "id": "edge-no-rate-limit",            // 一意の名前
//     "note": "レート制限を外す",              // 何を壊すか
//     "file": "packages/room/src/core.ts",   // 壊すファイル（リポジトリの相対パス）
//     "find": "if (!bucket.take(now))",      // 置き換える元の文字列。ちょうど1か所にあること
//     "replace": "if (false)",
//     "command": ["npm", "test", "-w", "@irori/room"],   // 赤くなるべき試験のコマンド
//     "timeoutMs": 300000 }                  // 省略可
//
// 実際の作業ツリーは書き換えない。リポジトリを一時フォルダに写し、そこで壊す。
// 写しの node_modules は、元のものへの近道にし、@irori/* だけを写しの中の部品へ向ける（部品どうしの参照が、
// 壊した写しを読むように）。壊す前の状態でも、同じコマンドが緑になることを先に確かめる。
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectRun } from '../lib/files.mjs';

/** コマンドは、時間切れとプロセスグループの後始末をするこの道具の下で走らせる。 */
const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'guard.mjs');

const SKIP = new Set(['.git', 'node_modules', 'dist', '.wrangler', 'test-results', 'playwright-report', 'coverage']);

export function loadSpecs(specsDir) {
  if (!existsSync(specsDir)) return [];
  const specs = [];
  for (const name of readdirSync(specsDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(specsDir, name), 'utf8'));
    for (const s of Array.isArray(data) ? data : [data]) specs.push({ ...s, from: name });
  }
  const ids = new Set();
  for (const s of specs) {
    for (const k of ['id', 'file', 'find', 'replace', 'command']) {
      if (s[k] === undefined) throw new Error(`${s.from}: ${s.id ?? '(idなし)'} に ${k} がありません`);
    }
    if (ids.has(s.id)) throw new Error(`${s.from}: id が重複しています → ${s.id}`);
    ids.add(s.id);
  }
  return specs;
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = lstatSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else cpSync(from, to, { recursive: false, verbatimSymlinks: true });
  }
}

/** 元の node_modules へ近道を張り、@irori/* だけを写しの中の部品へ向ける。 */
function linkModules(root, copy) {
  const nm = join(root, 'node_modules');
  if (!existsSync(nm)) return;
  mkdirSync(join(copy, 'node_modules'), { recursive: true });
  for (const name of readdirSync(nm)) {
    if (name === '@irori') continue;
    symlinkSync(join(nm, name), join(copy, 'node_modules', name));
  }
  const scope = join(nm, '@irori');
  if (existsSync(scope)) {
    mkdirSync(join(copy, 'node_modules', '@irori'), { recursive: true });
    for (const name of readdirSync(scope)) {
      const real = readlinkTarget(join(scope, name));
      const target = join(copy, relative(root, real));
      symlinkSync(target, join(copy, 'node_modules', '@irori', name));
    }
  }
  // 各部品の下に自分の node_modules がある場合も、元のものへの近道にする。
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const inner = join(dir, name, 'node_modules');
      if (existsSync(inner)) symlinkSync(inner, join(copy, group, name, 'node_modules'));
    }
  }
}

/** シンボリックリンクの行き先を、絶対パスで返す。 */
function readlinkTarget(p) {
  return resolve(dirname(p), readlinkSync(p));
}

function makeCopy(root) {
  const copy = mkdtempSync(join(tmpdir(), 'irori-mut-'));
  copyTree(root, copy);
  linkModules(root, copy);
  return copy;
}

function run(command, cwd, timeoutMs) {
  // 外側が node --test で動いていると、内側の node --test が「子」と誤認して、試験を流さず緑で終わる。
  // 試験が0件で成功する罠なので、この変数は引き継がない。
  const env = { ...process.env, CI: '1' };
  delete env.NODE_TEST_CONTEXT;
  // 外側の timeout は保険（guard が先に止める）。時間切れは guard が終了コード124で知らせる。
  const r = spawnSync(process.execPath, [GUARD, String(timeoutMs), cwd, ...command], {
    cwd, encoding: 'utf8', timeout: timeoutMs + 60_000, maxBuffer: 64 * 1024 * 1024, env,
  });
  return { status: r.status, signal: r.signal, timedOut: r.status === 124, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export function runMutations({ root, specs, log = console.log, only }) {
  const results = [];
  const baselines = new Map();
  for (const spec of specs) {
    if (only && !spec.id.startsWith(only)) continue;
    const timeoutMs = spec.timeoutMs ?? 300_000;
    const key = JSON.stringify(spec.command);
    const copy = makeCopy(root);
    try {
      if (!baselines.has(key)) {
        const base = run(spec.command, copy, timeoutMs);
        baselines.set(key, base.status === 0);
        if (base.status !== 0) log(`  基準（壊す前）が赤です: ${spec.command.join(' ')}\n${base.out.slice(-800)}`);
      }
      if (!baselines.get(key)) {
        results.push({ id: spec.id, verdict: 'ERROR', detail: '壊す前から試験が赤い（基準が通らない）' });
        continue;
      }
      const target = join(copy, spec.file);
      if (!existsSync(target)) {
        results.push({ id: spec.id, verdict: 'ERROR', detail: `${spec.file} がありません` });
        continue;
      }
      const text = readFileSync(target, 'utf8');
      const count = text.split(spec.find).length - 1;
      if (count !== 1) {
        results.push({ id: spec.id, verdict: 'ERROR', detail: `find が${count}か所に一致（ちょうど1か所にする）` });
        continue;
      }
      writeFileSync(target, text.replace(spec.find, () => spec.replace));
      const r = run(spec.command, copy, timeoutMs);
      const killed = r.status !== 0;
      let detail = '壊しても試験が緑のまま';
      if (killed) detail = r.timedOut ? '時間切れで強制終了' : r.signal ? `強制終了（${r.signal}）` : `終了コード${r.status}`;
      results.push({ id: spec.id, verdict: killed ? 'KILLED' : 'SURVIVED', detail, timedOut: killed && r.timedOut });
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
    const last = results.at(-1);
    log(`${last.verdict === 'KILLED' ? '✔' : '✗'} ${last.id}: ${last.verdict}（${last.detail}）`);
  }
  return results;
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const specs = loadSpecs(join(root, 'tools/mutations/specs'));
  if (args.includes('--list')) {
    for (const s of specs) console.log(`${s.id}\t${s.note ?? ''}`);
    process.exit(0);
  }
  if (specs.length === 0) {
    console.error('mutations: 仕様が1件もありません（tools/mutations/specs/*.json）。0件の成功は、成功ではありません');
    process.exit(1);
  }
  const results = runMutations({ root, specs, only });
  const bad = results.filter((r) => r.verdict !== 'KILLED');
  console.log(`\nmutations: ${results.length}件中 ${results.length - bad.length}件で赤くなった`);
  const slow = results.filter((r) => r.timedOut);
  if (slow.length) {
    console.log(`  注意：時間切れで止まったもの（本当に試験が赤くなったのか、中身を確かめる）: ${slow.map((r) => r.id).join(', ')}`);
  }
  if (bad.length) {
    for (const b of bad) console.error(`  ${b.verdict} ${b.id}: ${b.detail}`);
    process.exit(1);
  }
}
