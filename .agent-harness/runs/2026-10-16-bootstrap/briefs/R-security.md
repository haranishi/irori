# 指示書 R-security：独立した、読み取りだけのセキュリティ・コードレビュー

あなたは独立したレビュアー。**ファイルを変更しない**（報告書だけを書く）。実装した担当の報告は信用せず、コードを読んで、実行して確かめる。毎回、新しいセッションで、前のレビューを知らない状態から始める。

## 先に読む

`docs/security.md`、`docs/architecture.md`、`docs/protocol.md`、`docs/decisions/0001〜0008`。**`docs/security.md`「設計上、防げないもの」に書かれたことは、既知の受け入れ済みの制約。再報告しない。**

## 見る範囲（すべて）

`packages/{protocol,room,room-client,pad-ui,host-bridge,sdk}`、`apps/{edge,web}`（`public/_headers` を含む）、`games/*`、`tools/`、`tests/e2e`。

## 見る観点

1. **なりすまし・認可**：席番号・役割・ホストの鍵・再開の札の扱い。フレームの `p` や役割を、クライアントが決められる経路はないか。鍵の比較は定数時間か。
2. **入力の検証**：サーバー・ホスト・SDK・隔離枠の4か所で、検証の抜け・食い違い（片方が通して片方が落とす）がないか。大きさ・数・深さ・書記素・制御文字・プロトタイプ汚染（`__proto__`）。
3. **XSS・DOM**：`innerHTML`・`insertAdjacentHTML`・`outerHTML`・`setAttribute('href'|'src'|'style')`・`javascript:` URL・`target=_blank` と `rel`。スマホやゲームから来る文字列の行き先を、入口から描画まで追う。
4. **隔離枠**：`sandbox` 属性、`allow`、握手（`event.source`・`origin`）、`MessagePort` の取り違え、外部ゲームの `allow-same-origin` の条件、`?dev=` の制限、CSP（`apps/edge/src/policy.ts` と `public/_headers`）の穴。
5. **費用・資源の悪用**：部屋の作成・存在確認・接続・メッセージ・1日の総数の上限が、本当にすべての経路で効くか（迂回路：IPv6・`X-Forwarded-For` の偽装・WebSocket の再接続・Durable Object の起こし方）。無限ループ・メモリの増え方・タイマーの取りこぼし（休止中に動かないタイマー）。
6. **状態機械の正しさ**（`packages/room/src/core.ts`）：再接続・猶予・二重の札・ホストの交代・ロック・満員・時間切れの組み合わせで、席の取り違え・席の二重取り・行方不明の席・部屋が閉じない／閉じすぎる、がないか。休止からの復元（`restore`）と通常の経路が同じ結果になるか。
7. **秘密と個人情報**：IP・名前・鍵がログ・保存・応答・画面に出る経路。`Set-Cookie`。外部ドメインへの送信。`docs/legal/data-handling.md` の記述と実装が一致するか。
8. **エラー処理と競合**：例外の握りつぶし、await の抜け、イベントの順序（切断と入室が同時、`end` と退出が同時）。
9. **依存とビルド**：`package.json` の依存、`npm audit`（実行してよい）、CI（`.github/workflows/ci.yml`）の権限・固定・秘密の扱い。

## やること

- 指摘ごとに、**実際にコードを読み、可能なら実行して再現**してから書く（再現できなければ「未再現」と書く）。推測だけの指摘は「疑い」と明記。
- 実行してよいもの：`npm run typecheck`・`npm test`・`node tools/*.mjs`・Playwright・`wrangler dev`（`tools/lib/edge-server.mjs` の `startEdge`、ポートは 5300〜5319 と 8840〜8859）。**既存のファイルを書き換えない**。一時ファイルは `mkdtemp` の一時フォルダだけに置き、終わったら消す。`git` の書き込み・`npm install`・デプロイ・外部への送信は禁止。
- 「問題なし」と書くのは、見た範囲と方法を添えたときだけ。見ていない範囲は「未確認」。

## 出力

`.agent-harness/runs/2026-10-16-bootstrap/review/security-review.md` に100行以内で：**指摘の一覧**（重大度：高・中・低、場所 `file:line`、何が起きるか＝再現の手順または疑いの理由、直し方の案）、見た範囲と方法、未確認のこと。終わったら、高の件数・中の件数と、最も重い3つを返す。
