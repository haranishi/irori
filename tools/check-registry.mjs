// 登録情報の検査。docs/registry.md「CIが確かめること」のうち、ネットにつながずにできるものを全部見る。書き出しはしない。
//   node tools/check-registry.mjs                  … 問題があれば理由を出して終了コード1（npm run check から呼ばれる）
//   node tools/check-registry.mjs --sdk-from-dist  … SDK を組み直さず packages/sdk/dist/irori.js と比べる（直前に組んだとき用）
// 見ること：スキーマ（Ajv）・id とファイル名・二重の id・人数の向き・added が実在して未来でない・サムネイルの形式と大きさと容量・
// entry.bundled のフォルダと index.html・同梱ゲームの irori.js が SDK の最新ビルドと同じ・ライセンスが許可の一覧にある・
// URL が https で認証情報を含まない。entry.url の応答と握手の検査は、ネットが要るのでここではしない。
// tools/build-registry.mjs は、この検査を通ってから書き出す。
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { licenseAllowed } from './check-licenses.mjs';
import { assertSafePath, assertSafeTree, isDirectRun, listFiles } from './lib/files.mjs';
import { buildFresh, readDist } from './sync-sdk.mjs';

/** サムネイルの決まり（docs/registry.md）。容量の KB は 1024 バイトで数える。 */
export const THUMB = { width: 640, height: 480, maxBytes: 120 * 1024 };

/** 許可するライセンスの一覧。SPDX の識別子のうち、よく使うもの。足りなければ足す。 */
export const SPDX_ALLOWED = new Set([
  '0BSD', 'AFL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-2.0', 'Artistic-2.0', 'BlueOak-1.0.0',
  'BSD-2-Clause', 'BSD-3-Clause', 'BSL-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0',
  'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-ND-4.0', 'CC-BY-NC-ND-4.0', 'CC0-1.0', 'ECL-2.0', 'EPL-2.0',
  'EUPL-1.2', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC',
  'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'MIT', 'MIT-0', 'MPL-2.0',
  'MS-PL', 'NCSA', 'OFL-1.1', 'PostgreSQL', 'Unlicense', 'UPL-1.0', 'Zlib',
]);
/** コードには SPDX か非公開（LicenseRef-closed）、素材にはそれに加えて自作（original）を許す。 */
const CODE_ALLOWED = new Set([...SPDX_ALLOWED, 'LicenseRef-closed']);
const ASSETS_ALLOWED = new Set([...CODE_ALLOWED, 'original']);

/** 「いま」の日付を、地球上でいちばん進んだ時差（UTC+14）で数える。どの地域で流しても、今日の登録を未来扱いしない。 */
export function latestToday(now = Date.now()) {
  return new Date(now + 14 * 3_600_000).toISOString().slice(0, 10);
}

/** 画像の先頭を読んで、形式と縦横を返す。読めなければ null。 */
export function readImageSize(/** @type {Buffer} */ buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { format: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b = buf.subarray(21, 25);
      return { format: 'webp', width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0〜SOF15（DHT・JPG・DAC を除く）に、高さと幅がある。
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

let validator = null;
function schemaValidator(root) {
  if (validator?.root === root) return validator.fn;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const fn = ajv.compile(JSON.parse(readFileSync(join(root, 'registry/schema/game.schema.json'), 'utf8')));
  validator = { root, fn };
  return fn;
}

/** Ajv の誤りを、どこが・なぜ違うかの1行にする。oneOf の枝ごとの細かい誤りは、まとめの1行に寄せる。 */
function explain(err) {
  const at = err.instancePath === '' ? '（全体）' : err.instancePath.slice(1).replaceAll('/', '.');
  const p = err.params ?? {};
  switch (err.keyword) {
    case 'required': return `${err.instancePath === '' ? '' : `${at} に`}${p.missingProperty} がありません`;
    case 'additionalProperties': return `${at} に知らない項目 ${p.additionalProperty} があります`;
    case 'const': return `${at} は ${JSON.stringify(p.allowedValue)} にします`;
    case 'enum': return `${at} は ${p.allowedValues.map((v) => JSON.stringify(v)).join('・')} のどれかにします`;
    case 'pattern': return `${at} の形が違います（${p.pattern}）`;
    case 'type': return `${at} は ${p.type} にします`;
    case 'minLength': return `${at} は${p.limit}文字以上にします`;
    case 'maxLength': return `${at} は${p.limit}文字以下にします`;
    case 'minItems': return `${at} は${p.limit}個以上にします`;
    case 'maxItems': return `${at} は${p.limit}個以下にします`;
    case 'minimum': return `${at} は${p.limit}以上にします`;
    case 'maximum': return `${at} は${p.limit}以下にします`;
    case 'uniqueItems': return `${at} に同じものが2つあります`;
    case 'minProperties': return `${at} は空にできません`;
    case 'propertyNames': return `${at} の言語は ja か en です`;
    case 'oneOf': return `${at} は bundled か url のどちらか1つにします`;
    default: return `${at} ${err.message}`;
  }
}

/** URL の項目（作者・リンク・外部の entry）。https で、認証情報を含まないこと。 */
function urlProblems(m) {
  const urls = [
    ...(Array.isArray(m.authors) ? m.authors.map((a, i) => [`authors.${i}.url`, a?.url]) : []),
    ['links.source', m.links?.source],
    ['links.homepage', m.links?.homepage],
    ['entry.url', m.entry?.url],
  ].filter(([, v]) => typeof v === 'string');
  const out = [];
  for (const [at, raw] of urls) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      out.push(`${at} が URL として読めません`);
      continue;
    }
    if (u.protocol !== 'https:') out.push(`${at} は https にします（${u.protocol}）`);
    if (u.username !== '' || u.password !== '') out.push(`${at} に認証情報（ユーザー名やパスワード）を入れません`);
  }
  return out;
}

/**
 * registry/games/*.json を検査する。
 * @param {string} root リポジトリの場所
 * @param {{ sdk: { js: string } | null, now?: number }} opts sdk は同梱ゲームの irori.js と比べる中身
 * @returns {{ problems: string[], games: Record<string, unknown>[] }}
 */
export function checkRegistry(root, { sdk, now = Date.now() }) {
  listFiles(root);
  const problems = [];
  const games = [];
  const dir = join(root, 'registry/games');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (files.length === 0) problems.push('registry/games: 登録情報が1件もありません');
  const validate = schemaValidator(root);
  // 二重の id を、ファイル名と合っていないほうに知らせるため、先に全部の id を読んでおく。
  const idOf = new Map(files.map((f) => {
    try {
      return [f, JSON.parse(readFileSync(join(dir, f), 'utf8'))?.id];
    } catch {
      return [f, undefined];
    }
  }));
  const today = latestToday(now);
  for (const file of files) {
    const where = `registry/games/${file}`;
    const say = (msg) => problems.push(`${where}: ${msg}`);
    const name = file.slice(0, -'.json'.length);
    let m;
    try {
      m = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      say(`JSON として読めません（${err.message}）`);
      continue;
    }
    const before = problems.length;
    if (!validate(m)) {
      const errs = validate.errors ?? [];
      for (const e of errs.filter((x) => !x.schemaPath.includes('/oneOf/'))) say(explain(e));
    }
    if (m === null || typeof m !== 'object' || Array.isArray(m)) continue;
    if (m.id !== name) say(`id「${m.id}」がファイル名「${name}」と違います。id とファイル名をそろえます`);
    const twins = files.filter((f) => f !== file && typeof m.id === 'string' && idOf.get(f) === m.id);
    if (twins.length > 0 && name !== m.id) say(`id「${m.id}」が ${twins.map((f) => `registry/games/${f}`).join('・')} と重なっています`);
    if (Number.isInteger(m.players?.min) && Number.isInteger(m.players?.max) && m.players.min > m.players.max) {
      say(`players の min（${m.players.min}）が max（${m.players.max}）より大きい`);
    }
    if (typeof m.added === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.added)) {
      const real = new Date(`${m.added}T00:00:00Z`);
      if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== m.added) say(`added「${m.added}」は実在しない日付です`);
      else if (m.added > today) say(`added「${m.added}」が未来の日付です`);
    }
    for (const [key, allowed] of [['code', CODE_ALLOWED], ['assets', ASSETS_ALLOWED]]) {
      const v = m.license?.[key];
      if (typeof v === 'string' && !licenseAllowed(v, allowed)) {
        say(`license.${key}「${v}」が許可の一覧にありません（SPDX の識別子${key === 'assets' ? '・original' : ''}・LicenseRef-closed）`);
      }
    }
    for (const msg of urlProblems(m)) say(msg);
    if (typeof m.thumbnail === 'string') {
      for (const msg of thumbProblems(root, m.thumbnail)) say(msg);
    }
    if (typeof m.entry?.bundled === 'string') {
      for (const msg of bundledProblems(root, m.entry.bundled, m.id, sdk)) say(msg);
    }
    if (problems.length === before) games.push(m);
  }
  return { problems, games };
}

/** サムネイル：置いてあり、拡張子と中身の形式がそろい、640×480 で、容量内。 */
function thumbProblems(root, file) {
  const path = join(root, 'registry/thumbs', file);
  if (!/^[a-z0-9-]+\.(webp|png|jpg)$/.test(file)) return [];
  assertSafePath(root, `registry/thumbs/${file}`);
  if (!existsSync(path)) return [`サムネイル registry/thumbs/${file} がありません`];
  const out = [];
  const bytes = statSync(path).size;
  if (bytes > THUMB.maxBytes) out.push(`サムネイル ${file} が ${Math.ceil(bytes / 1024)}KB で、上限の${THUMB.maxBytes / 1024}KBを超えています`);
  const img = readImageSize(readFileSync(path));
  const want = extname(file).slice(1);
  if (!img) out.push(`サムネイル ${file} の形式が読めません（png・webp・jpg）`);
  else if (img.format !== want) out.push(`サムネイル ${file} の中身が ${img.format} で、拡張子と違います`);
  else if (img.width !== THUMB.width || img.height !== THUMB.height) {
    out.push(`サムネイル ${file} が ${img.width}×${img.height} です（${THUMB.width}×${THUMB.height} にします）`);
  }
  return out;
}

/** 同梱のゲーム：games/<id>/ にあり、index.html と、SDK の最新ビルドと同じ irori.js がある。 */
function bundledProblems(root, bundled, id, sdk) {
  if (!/^games\/[a-z0-9-]+\/$/.test(bundled)) return [];
  if (bundled !== `games/${id}/`) return [`entry.bundled「${bundled}」は games/${id}/ にします（id と同じフォルダ）`];
  const dir = join(root, bundled);
  assertSafeTree(root, bundled, { allowMissing: true });
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [`entry.bundled のフォルダ ${bundled} がありません`];
  const out = [];
  if (!existsSync(join(dir, 'index.html'))) out.push(`${bundled}index.html がありません`);
  const js = join(dir, 'irori.js');
  if (!existsSync(js)) out.push(`${bundled}irori.js がありません（npm run sync:sdk で写す）`);
  else if (!sdk) out.push(`${bundled}irori.js と比べる SDK のビルドがありません`);
  else if (readFileSync(js, 'utf8') !== sdk.js) {
    out.push(`${bundled}irori.js が SDK の最新ビルドと違います（手で直さず npm run build -w @irori/sdk && npm run sync:sdk）`);
  }
  return out;
}

/** CLI と build-registry から使う：SDK の中身を用意する。--sdk-from-dist なら組み直さない。 */
export async function loadSdk(root, argv = process.argv) {
  if (argv.includes('--sdk-from-dist')) return readDist(root);
  return buildFresh(root);
}

if (isDirectRun(import.meta.url)) {
  const root = process.cwd();
  const { problems, games } = checkRegistry(root, { sdk: await loadSdk(root) });
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\ncheck-registry: ${problems.length}件の問題`);
    process.exit(1);
  }
  console.log(`check-registry: OK（${games.length}件）`);
}
