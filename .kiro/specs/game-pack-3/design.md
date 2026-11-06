# 設計：第3弾

要件 1〜4。プラットフォーム（SDK・コントローラー・中継）は変えない。第2弾で足した `tiles`（`pad-tiles-v1`）・`token`・`cue` をそのまま使う。

## 構成
- ゲームは既存の札遊びと同じ形：`createGame(init)` / `updateGame(state, event)` / `publicView(state)`。乱数は種つき。
- 段階：`intro` → `deal` → `turn`（`pickCard` → `pickTarget` → `pickSlot` → `pickGive` → 解決）→ … → `talk` → `vote` → `result`。ひそひそ話（2席）と一斉指名（全席）は、同時に選ぶ段階。
- 効果は `pad`（席ごと）・`cue`・`vibrate`・`end`。公開の出来事の列は連番つきで `publicView` が返す。

## 守ること（過去の罠）
- ホストは前回と同じ内容の画面を送り直さない。断る入力には、席ごとの `token` を進めて、毎回違う画面にする。
- 場面が新しくなるときは、全席の `token` を進める。
- 最後に見せたい画面があるときは、`end` を数秒遅らせる（結果の公開は8秒置く）。
- フェードのある要素を `display:none` から `block` にすると、透明のまま固まる。opacity も試験で測る。
- SDK の写し（`games/*/irori.js`）は `node tools/sync-sdk.mjs` で更新し、コミットし忘れない。

## 分担と所有
| 担当 | 所有する場所 | してはいけないこと |
|---|---|---|
| A 判定 | `games/bell-in-sleeve/` の `cards.js` `logic.js` `*.test.js` | 画面ファイル・共有部品の編集、commit・push、依存の追加 |
| B 画面 | 同フォルダの `index.html` `style.css` `main.js` `view.js` `view.test.js` `README.md`、登録JSON | 判定の編集（変えたいときは報告）、commit・push |
| メイン | 仕様・READMEの本数・`docs/`・サムネイル・通しの確認・コミット | — |

Codex の入れ物では、ポートを開く試験（実ブラウザ・Worker 結合）が動かない。担当は単体試験と型の検査までを行い、実ブラウザの確認はメインが行う。

## 関門
この順に通し、落ちたら担当へ差し戻す（3周まで）。
`npm run typecheck` → `npm run test:games`（新ゲームの単体）→ `npm run check` → `npm run build` → 実ブラウザ（Chromium・WebKit）の通しと3幅の撮影 → 別担当の採点。
