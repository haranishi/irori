// 権利の検査：他社の名称・参考にしたサイトの識別子・音声と書体のファイル・私的なパス・外部の読み込みを拒む。
// 文書の中での事実の言及（docs/ と .agent-harness/）は許す。画面・コード・ゲーム・登録情報には入れない。
import { isDirectRun, isTextFile, listFiles, readText } from './lib/files.mjs';

const BRANDS = [
  /wii\s?u/i, /\bwii\b/i, /nintendo/i, /任天堂/, /ニンテンドー/, /miiverse/i,
  /\bmario\b/i, /マリオ/, /zelda/i, /ゼルダ/, /pokemon/i, /ポケモン/, /splatoon/i, /minecraft/i,
];
const REFERENCE_IDS = [/vvii/i, /驚額/, /んぽたそ/, /itsu\.dev/i];
const BANNED_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|woff2?|ttf|otf|eot)$/i;
// 私的な場所：ホームの下、OSの一時フォルダ、AIの作業フォルダ名（-Users-名前-）。CIの /home/runner は私的ではない。
const PRIVATE_PATH = /\/Users\/[A-Za-z0-9._-]+\/|\/private\/tmp\/|\/var\/folders\/|\/home\/(?!runner\/)[A-Za-z0-9._-]+\/|-Users-[A-Za-z0-9._]+-/;

// 言及を許す場所：文書・判断の記録・ハーネスの記録・この検査自身と試験。
const MENTION_OK = [/^docs\//, /^\.agent-harness\//, /^tools\/check-rights\.mjs$/, /^tools\/tests\//, /^CONTRIBUTING\.md$/];
// 読み込みの検査の対象：画面とゲーム。
const LOAD_SCOPE = [/^apps\/web\/(index|pad)\.html$/, /^apps\/web\/src\//, /^games\//];

// 画面やゲームが外部から読み込むもの（src・href=stylesheet・@import・url()・import）。
const EXTERNAL_LOAD = [
  /<(?:script|img|iframe|source|video|audio|link)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i,
  /@import\s+(?:url\()?["']?https?:\/\//i,
  /url\(\s*["']?https?:\/\//i,
  /\bimport\s*(?:\(|[^;'"]*\bfrom\s*)["']https?:\/\//,
  /\bfetch\(\s*["'`]https?:\/\//,
  /new\s+(?:WebSocket|EventSource)\(\s*["'`]wss?:\/\//,
];

export function checkRights(root) {
  const problems = [];
  for (const rel of listFiles(root)) {
    if (BANNED_EXT.test(rel)) problems.push(`${rel}: 音声・書体のファイルは入れません（見た目と音は自作。docs/identity.md）`);
    if (!isTextFile(rel)) continue;
    const text = readText(root, rel);
    if (PRIVATE_PATH.test(text) && !/^tools\/(check-rights\.mjs|tests\/)/.test(rel)) {
      problems.push(`${rel}: 私的な絶対パス（/Users/…・一時フォルダ・作業フォルダ名）が含まれています`);
    }
    const mentionOk = MENTION_OK.some((re) => re.test(rel));
    if (!mentionOk) {
      for (const re of [...BRANDS, ...REFERENCE_IDS]) {
        const m = re.exec(text);
        if (m) problems.push(`${rel}: 禁止語「${m[0]}」（他社の名称や参考サイトの識別子。docs/legal/reference-policy.md）`);
      }
    }
    if (LOAD_SCOPE.some((re) => re.test(rel))) {
      // 1つのファイルに複数の型が重なっても、報告は1件にする。
      const hit = EXTERNAL_LOAD.map((re) => re.exec(text)).find(Boolean);
      if (hit) problems.push(`${rel}: 外部ドメインの読み込み「${hit[0].slice(0, 60)}」（画面とゲームは自分のオリジンだけを使う）`);
    }
  }
  return problems;
}

if (isDirectRun(import.meta.url)) {
  const problems = checkRights(process.cwd());
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\ncheck-rights: ${problems.length}件の問題`);
    process.exit(1);
  }
  console.log('check-rights: OK');
}
