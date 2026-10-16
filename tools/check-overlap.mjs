// 他人のコードとの重なりの検査。参考にしたものの配信コードなどを「照合用の資料」として渡し、
// 自分のコードに、同じ40語の並びが写っていないかを調べる。写していないことの、機械の証拠にする。
//
//   node tools/check-overlap.mjs --corpus <ファイルかフォルダ> [--n 40] [--roots apps packages games]
//
// 語は、識別子・数・文字列・記号。空白と改行は無視する。ありふれた並び（識別子が3語未満）は数えない。
// 照合用の資料は、リポジトリに入れない。見つかったら、終了コード1で、場所を出す。
// 既定を40語にした理由（2026-10-16に、参考サイトの配信コードで測った）：14語では155件、24語で13件、30語で1件が一致したが、
// どれも「選択を無効にするCSS」「flex の中央寄せ」「for (let i = 0; …)」のような、誰が書いても同じになる定型だった。
// 40語では0件。長い並び（関数や規則のまとまり）の丸写しを見つける道具として使い、短い定型の一致は、人が分類して記録する。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isDirectRun, listFiles, readText } from './lib/files.mjs';

const TOKEN = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s\w]/gu;
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|css|html)$/i;

export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    const before = text.slice(0, m.index);
    out.push({ t: m[0], line: before.split('\n').length });
  }
  return out;
}

const isWord = (t) => /^[A-Za-z_$]/.test(t);

function shingles(tokens, n) {
  const res = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const slice = tokens.slice(i, i + n);
    if (slice.filter((x) => isWord(x.t)).length < 3) continue;
    const key = createHash('sha1').update(slice.map((x) => x.t).join('\u0001')).digest('base64');
    res.push({ key, line: slice[0].line, text: slice.map((x) => x.t).join(' ').slice(0, 120) });
  }
  return res;
}

function corpusFiles(path) {
  const st = statSync(path);
  if (st.isFile()) return [path];
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name === '.git') continue;
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (CODE_EXT.test(name)) out.push(p);
    }
  };
  walk(path);
  return out;
}

export function buildCorpusIndex(paths, n = 40) {
  const index = new Set();
  for (const p of paths) {
    for (const f of corpusFiles(p)) {
      for (const s of shingles(tokenize(readFileSync(f, 'utf8')), n)) index.add(s.key);
    }
  }
  return index;
}

export function checkOverlap({ root, corpus, n = 40, roots = ['apps', 'packages', 'games', 'tools'] }) {
  const index = buildCorpusIndex(corpus, n);
  const hits = [];
  for (const rel of listFiles(root)) {
    if (!CODE_EXT.test(rel) || !roots.some((r) => rel.startsWith(r + '/'))) continue;
    for (const s of shingles(tokenize(readText(root, rel)), n)) {
      if (index.has(s.key)) hits.push({ file: rel, line: s.line, text: s.text });
    }
  }
  return { corpusShingles: index.size, hits };
}

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag) {
        for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
      }
    }
    return out;
  };
  const corpus = take('--corpus');
  if (corpus.length === 0) {
    console.error('使い方: node tools/check-overlap.mjs --corpus <ファイルかフォルダ> [--n 40] [--roots apps packages games]');
    process.exit(2);
  }
  const n = Number(take('--n')[0] ?? 40);
  const roots = take('--roots');
  const { corpusShingles, hits } = checkOverlap({ root: process.cwd(), corpus, n, ...(roots.length ? { roots } : {}) });
  console.log(`照合用の資料：${corpusShingles}個の${n}語の並び`);
  if (hits.length) {
    for (const h of hits.slice(0, 50)) console.error(`  ${h.file}:${h.line}  ${h.text}`);
    console.error(`check-overlap: ${hits.length}件の一致`);
    process.exit(1);
  }
  console.log(`check-overlap: 一致 0件（${relative(process.cwd(), process.cwd()) || '.'}）`);
}
