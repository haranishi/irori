// 文書の検査：1ファイル100行以内、相対リンクが切れていないこと。
// 基準は「読み切られること」。長くなったら、テーマごとに分けて入口からリンクする。
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { isDirectRun, listFiles, readText } from './lib/files.mjs';

export const MAX_LINES = 100;
// 外部の規約の全文で、行数を直せないもの。
// 調査の生の記録（出典つきの一覧）は、分けずにそのまま残す。人が読む入口は docs/research/ に要約を置く。
const LINE_EXEMPT = [/^LICENSES\//, /^LICENSE-/, /^package-lock\.json$/, /^\.agent-harness\/runs\/[^/]+\/research\//];

function stripFences(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

export function checkDocs(root) {
  const problems = [];
  const files = listFiles(root).filter((f) => f.endsWith('.md'));
  for (const rel of files) {
    const text = readText(root, rel);
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    if (lines > MAX_LINES && !LINE_EXEMPT.some((re) => re.test(rel))) {
      problems.push(`${rel}: ${lines}行（上限${MAX_LINES}行）。テーマごとに分けて、入口からリンクしてください`);
    }
    const body = stripFences(text).replace(/`[^`\n]*`/g, '');
    for (const m of body.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = decodeURI(target.split('#')[0].split('?')[0]);
      if (path === '') continue;
      const resolved = normalize(join(dirname(rel), path));
      if (!existsSync(join(root, resolved))) problems.push(`${rel}: リンク切れ → ${target}`);
    }
  }
  return problems;
}

if (isDirectRun(import.meta.url)) {
  const problems = checkDocs(process.cwd());
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\ncheck-docs: ${problems.length}件の問題`);
    process.exit(1);
  }
  console.log('check-docs: OK');
}
