# 指示書 G：同梱ゲーム4本と、登録の道具

あなたは実装担当。設計は固定済みで、この指示書と `docs/` が契約。設計を変えたくなったら、変えずに報告へ書く。前提：A2 が `packages/sdk`・`packages/pad-ui`・`tools/sync-sdk.mjs` を作り終えている。

## 目的

制作者が最初にコピーする見本になる、小さくて壊れにくい4本のゲームを作り、棚に並べる登録情報と、その検査の道具を作る。ゲームは、**ビルドなしで動く素のJavaScript**（ES modules）。コンソールなしでも、SDKの仮想プレイヤー（`?mock=N`）だけで動かせること。

## 先に読む（読み取りのみ）

`docs/sdk.md`、`docs/pad.md`、`docs/registry.md`、`docs/identity.md`、`registry/schema/game.schema.json`、`packages/sdk/`（`irori.d.ts` を含む）、`packages/pad-ui/src/look.ts`。

## 触ってよい場所

`games/**`、`registry/games/**`、`registry/thumbs/**`、`tools/build-registry.mjs`、`tools/check-registry.mjs`、`tools/make-thumbs.mjs`、`tools/tests/**`、`.gitignore`（`apps/web/public/{games,registry,sdk}/` の追記のみ）。それ以外は触らない。`git` の書き込み系コマンド、`npm install`（要る依存は報告）、デプロイは禁止。ポートは 5200〜5219。

## ゲーム（4本）

各ゲームのフォルダは `index.html` `main.js` `logic.js`（描画に依存しない規則。試験の対象）`style.css` `irori.js`（`npm run sync:sdk` で写す。手で直さない）`README.md`（40行以内：何を見せる見本か、使うSDKの機能、コピーして改造する手順）`logic.test.js`（`vitest`）。画面は `960×540` を基準に、リサイズに追従する。席の表示は `irori.look(id)` の色と形の両方。`pause`/`resume` を守る。`end(results)` へ至る道をすべて作り、すべて試験する。画像・音のファイルは使わない（図形は `<canvas>` かSVGで描く。音を出すなら、WebAudio の合成で控えめに）。

1. **hello-pad**（1〜8人）：床の上を、各自の四角（席の色と形の印つき）がスティックで動く。ボタン「ぴょん」で、一瞬ふくらむ。ボタン「おわる」で `end`。SDKの全体像（players・setPad・input・look・ready・end）を30秒で見せる、最小の見本。
2. **tap-race**（2〜8人）：「連打!」の `buzzer`。3・2・1のあと、40回たたいたら完走。順位で得点（1位から 800, 600, 500, 400…）。途中で席が切れたら、その人を除いて続ける。`wait` の画面（「よーい」）と `vibrate` も使う。全員完走・時間切れ（30秒）・全員退出、の3つの終わり方を、`end` まで試験する。
3. **quiz-4**（1〜8人）：`choices` を、問題ごとに差し替える。全8問、1問15秒。正解は早いほど高得点（1000点から200点まで直線で下がる）、誤答と時間切れは −200点。同じ問題を繰り返さない。問題は日本と世界の名所の、**自作の短い文**（`questions.js` に20問以上。選択肢は12文字以内、正解は1つ、紛らわしすぎる選択肢を置かない）。**答えの事実は、信頼できる資料で必ず確かめ、確かめた出典を README の「出典」に書く**（確かめられない問題は入れない）。商標・実在の企業名・個人名を使わない。
4. **dot-grab**（1〜8人）：45秒のあいだ、点を集める。スティック（`axis`）で動く。点は一度に8個まで、取ると少し先に出直す。得点は取った数。時間差の積分で動かす（フレーム間の時間 `dt` を使い、端末の速さで速さが変わらない）。`axis` の入力が途切れても、最後の値で動き続けて暴走しないよう、一定時間で止める。

## 登録情報とサムネイル

- `registry/games/<id>.json`（4本）：`registry/schema/game.schema.json` に合わせる。`license` は `{"code":"MIT OR Apache-2.0","assets":"original"}`、`rating` は `all`、`sdk` は 1、`added` は 2026-10-16、`entry` は `{"bundled":"games/<id>/"}`、作者は `{"name":"Ikki Nishihara"}`（URL は `https://github.com/haranishi`）。`pads` は実際に使う種類。
- サムネイル `registry/thumbs/<id>.png`（640×480・120KB以下）：`tools/make-thumbs.mjs` が、Playwright で各ゲームを `?mock=3` で動かし、数秒進めた画面を撮って作る（外部の画像や手作業の加工を混ぜない）。再生成の手順はスクリプトの冒頭に書く。

## 登録の道具

- `tools/build-registry.mjs`：`registry/games/*.json` を Ajv（`ajv/dist/2020` と `ajv-formats`）でスキーマ検査し、`docs/registry.md`「CIが確かめること」のうち**オフラインでできる項目**（`id`＝ファイル名、`added` が未来でない、サムネイルの大きさ・形式・容量、`entry.bundled` のフォルダと `index.html`、ライセンス表記の許可一覧、同梱ゲームの `irori.js` がSDKの最新ビルドと一致）を検査する。通れば `apps/web/public/registry/index.json`（新しい順。サムネイルの公開パスを足す）を作り、`registry/thumbs/*` と `games/*/`（`README.md`・`*.test.js`・`logic.test.js` を除く）を `apps/web/public/registry/thumbs/` と `apps/web/public/games/` に写す。失敗したら、理由を読める形で出し、終了コード1。
- `tools/check-registry.mjs`：同じ検査を、書き出しなしで行う（CIと `npm run check` から呼ばれる）。
- `tools/tests/`（`node --test`、またはルートの `vitest`）：正しい登録情報と、壊れた登録情報（スキーマ違反・`id` 不一致・過大なサムネイル・存在しない `bundled`・未来の日付・許可外のライセンス・`http://` の外部URL・認証情報つきのURL・二重の `id`）の固定データで、期待どおり通る／落ちること。

## 受け入れ条件（あなたがコマンドを実行して確かめる）

1. `npm run typecheck`、`npm test`（ルート。各ゲームの `logic.test.js` と `tools/tests` を含む）が通り、件数を報告できる。
2. `node tools/build-registry.mjs` が成功し、`apps/web/public/registry/index.json` に4件が出る。壊れた登録情報を一時的に足すと失敗する。
3. 4本とも、`playwright`（Chromium）で `games/<id>/index.html` を `?mock=3` で開いて、起動 → 操作（キー）→ `end` まで進むことを、スクリーンショットつきで確かめる（一時的な確認でよい。本番の試験は別の担当が書く）。
4. 変異に対する門番の確認：次の5つを入れて試験が落ちることを確かめ、元に戻す。(a) tap-race の完走判定の撤去 (b) quiz-4 の「時間切れは −200点」の撤去 (c) dot-grab の `dt` の使用をやめる（フレーム数で動かす） (d) スキーマ検査の `id` 不一致の撤去 (e) サムネイルの容量検査の撤去。これらは手作業で終わらせず、`tools/mutations/specs/games-*.json` に仕様として残し（形は `tools/mutations/run.mjs` の冒頭）、`node tools/mutations/run.mjs --only games-` で全件が KILLED になることを確かめて、件数を報告する。`tools/mutations/` と `tools/tests/` は、`specs/` に自分のJSONを足す以外は触らない。

## 落とし穴（過去の実害）

- 終わり方が複数あるゲームは、**全部の終わり方を最後まで**通す（時間切れだけ通して「全合格」にしない）。
- 押すタイミングが関わるロジック（連打、締切の直前の回答）は、境界の値（締切の1ms前後）の試験を入れる。
- 試験が0件で成功にならないよう、件数を報告する。
- 待機は状態の照会で行い、出力の文字列を待つループは書かない。

## 報告

`.agent-harness/runs/2026-10-16-bootstrap/reports/G-report.md` に100行以内で：作ったもの、実行したコマンドと結果、契約からのずれ、未確認のこと、quiz-4 の出典の一覧。終わったら、結論を5行で返す。
