# 指示書 C1：同梱の4本を、実物どうしで最後まで通す（横断の通し試験・試遊サーバー）

あなたは実装担当。設計は固定済みで、この指示書と `docs/` が契約。設計を変えたくなったら、変えずに報告へ書く。前提：A1・A2・G・B1・B2が作り終え、各担当の試験は、それぞれの範囲で通っている（`apps/edge/tests`・`tests/e2e/bridge`・`apps/web/tests/{host,pad}`・`games/*/logic.test.js`）。あなたの仕事は、**同梱の4本のゲームを、本物のコンソール・本物のスマホ画面・実 Worker で、終わり方をすべて最後まで**通すこと、横断の検査（通信の規律・アクセシビリティ・容量）、評価者が実際に遊ぶための試遊サーバー、変異の確認。スタブやモックで、契約を確かめない。

## 先に読む（読み取りのみ）

`briefs/_common-web.md`（共有の場所を壊さない決まり。あなたも従う）、`docs/ux.md`（受け入れ条件が、試験の期待値）、`docs/pad.md`、`docs/sdk.md`、`docs/security.md`、`HARNESS.md`、各担当の報告（`.agent-harness/runs/2026-10-16-bootstrap/reports/`。とくに B1・B2・G）、`tools/lib/edge-server.mjs`、B1・B2 の試験の補助（`apps/web/tests/host/`・`apps/web/tests/pad/e2e/`：回線の模型 `line.mjs` は使い回してよい）。

## 触ってよい場所

`tests/e2e/**`（A2 の `bridge/` は壊さない）、`tools/check-budgets.mjs`、`tools/playtest-server.mjs`、`tools/playtest-README.md`、`tools/mutations/specs/e2e-*.json`。ほかは読むだけ。実装の不具合を見つけたら、直さずに、再現手順つきで報告する（直す担当は別。試験を通すために実装を変えない）。`git` の書き込み系コマンド、`npm install`、デプロイは禁止。ポートは 5260〜5299 と 8860〜8899。

## 土台

`tests/e2e/playwright.config.ts` に、projects を足す：`desktop-chromium`（ホスト、1280×720）、`phone-chromium`（390×844・タッチ）、`phone-webkit`（iPhone相当）、`desktop-webkit`（ホスト）。前処理（`globalSetup`）は、`tools/lib/edge-server.mjs` の `buildWeb()`（自分専用の出力先）と `startEdge()`（`ALLOW_TEST_OVERRIDES:1`・短い猶予などの `--var`）で実 Worker を起動し、終了時に必ず止める。ホストの `Page` と、N台のスマホの `Page`（別の `BrowserContext`）を作る道具。部屋のコードは、ホストの画面の `data-` 属性から読む。待機は DOM の状態（`data-state`・`document.documentElement.dataset.phase`）か状態の照会で行い、文字列の出力を待つループは書かない。ゲームの状態は、各ゲームの `data-phase`（G の報告）で読める。

## 通すこと（終わり方を、全部）

1. **参加**：3台が `/pad#CODE` で参加し、ホストに3人の帯が出る。QR は `jsqr` で読み取って `/pad#CODE` を確かめる。
2. **tap-race**：リモコンで選び、開始 → 3台が連打 → 結果 →「もう一度」→ 再び完走 →「ホームへ」。終わり方3つ：全員完走・時間切れ（`page.clock` でホストの時計を進める）・全員退出（`bye`）。**3つとも最後まで**。
3. **quiz-4**：問題ごとに `choices` の文字が変わり、正解・誤答・時間切れで得点が変わる。8問の最後まで。終わり方：全問・全員が時間切れ・全員退出。
4. **dot-grab**：スティックの押し続けで動き続け（約1秒ごとの再送）、得点が結果に出る。終わり方：時間切れ・全員退出。席が切れると、その席の入力で動き続けない。
5. **hello-pad**：「おわる」で `end`。全員退出。
6. **再接続・ホストの再読み込み・満員・ロック・退出・遅れて来た人**：B1・B2 の試験にあるものは重ねず、**ゲームの最中**に起こしたときの振る舞いだけを足す（スマホが切れて戻る→画面が復元、ホストの再読み込み→ゲームはどうなるか、`kick` した席の入力がゲームに届かない）。
7. **共有**：ホストの共有パネルの4つと共有URL、OGP と canonical が絶対URLで、ホストとスマホの両ページにある。
8. **通信の規律**：全フローを通して、画面が出した全リクエストを記録し、**同じオリジンとその `ws` 以外へ一度も出ない**こと。`Set-Cookie` が一度も返らない。コンソールのエラー・警告・CSP違反がゼロ。
9. **悪意のあるゲーム**：A2 の `tests/e2e/bridge/pages/games/escape` を、実コンソールの中の枠（外部の別オリジンは `?dev=`、同梱は、ビルドの出力の写しに足した `games/escape/` と登録情報で）で動かし、コンソールが操作できる状態に戻れること。
10. **押すタイミング**：連打・差し替え・再接続を、間隔を0〜500msで振って流す。CDPでページのCPUを6倍遅くした実行を、tap-race と再接続で1本ずつ。
11. **アクセシビリティ**：`@axe-core/playwright`（導入済み）で、ホストの主要画面とスマホの6種に、違反ゼロ。ボタンに名前があり、フォーカスの輪が見えること。
12. **容量**：`tools/check-budgets.mjs` が、ビルド結果のJSの gzip 容量を測る：ホスト80KB・スマホ40KB・SDK60KB 以下。測った値を出力する。

## 試遊サーバー（評価者が実際に遊ぶための道具）

`tools/playtest-server.mjs`：Playwright でホストとスマホN台（別の `BrowserContext`）を実物のまま開き、評価者が `curl` だけで遊べるように、`127.0.0.1` の空きポートで操作を受ける。`POST /start`（実 Worker を起動し、ホストを開く）、`POST /pad/:n/join {name}`、`/pad/:n/tap {id, count?, intervalMs?}`、`/pad/:n/hold {id, ms}`、`/pad/:n/stick {x, y, ms}`、`/pad/:n/choose {index}`、`/pad/:n/disconnect`・`/reconnect`、`POST /host/key {key}`、`POST /clock/advance {ms}`（ホストの時計を進める）、`GET /state`（ホストと各スマホの、いま見えている文字・`data-state`・席の一覧・コントローラーの種類を JSON で）、`POST /shot {target: "host" | n}`（撮ってパスを返す）、`POST /stop`。1手に数秒かかっても時間切れにならないよう、時計を止めて進められること。使い方を、冒頭のコメントと `tools/playtest-README.md`（40行以内）に書く。この試験も `tests/e2e/` に入れる。

## 受け入れ条件（あなたがコマンドを実行して確かめる）

1. `npm run test:e2e` が通る。件数をプロジェクトごとに報告する。**0件の成功は成功でない**。実行された試験名の一覧も報告に書く。
2. 同じ試験を、等速で3回流して、不安定なものがないこと。不安定なものは、直さず、再現手順つきで報告する。
3. 変異の確認：(a) 再接続後に画面を戻さない (b) ゲームの `end` を呼ばせない（結果が出ない）(c) 共有URLを部屋のURLにする (d) 外部ドメインへ1件リクエストを出す (e) Cookie を1つ返す (f) 時間切れの終わり方で結果を出さない (g) dot-grab の再送を止める、を `tools/mutations/specs/e2e-*.json` にして、`node tools/mutations/run.mjs --only e2e-` で全件が KILLED（時間切れでなく、試験が赤くなって）になること。

## 落とし穴（過去の実害）

- 画面がロックされた状態では、Chromium が起動しないことがある。起動できなければ、止まって報告する。
- 全部の終わり方を通す。時間切れだけを通して「全合格」にしない。等速で通ったことを、安定の証拠にしない。
- 実装の自己申告を信じない。あなたの実行結果だけが証拠。作り物は本物と同じ振る舞いか確かめてから使う（B1：作り物が「効かない呼び出し」まで数えて、守りを見誤った）。
- 日本語の文書は、書いたあとに出る lint の指摘を1件ずつ判断する。

## 報告

`.agent-harness/runs/2026-10-16-bootstrap/reports/C1-report.md` に100行以内で：作ったもの、実行したコマンドと結果、見つけた不具合（再現手順つき）、未確認のこと（実機・音・TV）。終わったら、結論を5行で返す。
