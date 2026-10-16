# A2 報告：pad-ui・host-bridge・sdk・sync-sdk・bridge e2e

担当：スマホ画面の部品、ゲームの隔離枠、ゲーム側SDK、SDKの同期、実ブラウザの契約試験。設計は指示書どおり、変更なし。

## 作ったもの

- **packages/pad-ui**：`mountPad`（7種＝wait/pad/buzzer/choices/touch/tilt＋コンソール専用 remote）。Pointer Events＋ポインタ捕捉でマルチタッチ、`touch-action:none`・長押し/選択/ダブルタップ抑止。間引きは `SEND_RATE_HZ`（決め打ちせず読み込み、最後の値は必ず送る）。`setSpec`/`releaseAll`/`destroy` で押下中を終わらせる（btn→d:0・axis→0,0・ptr→e）。`look`/`shapeSvg`（8席の色と形、`path` つき）。`pad.css`（色は identity の変数、ボタン48px・文字16px以上）。
- **packages/host-bridge**：`resolveEntry`（同梱=allow-scripts/オリジン空、外部=別オリジンのみ allow-same-origin、同一オリジン・認証情報・非httpsを拒否、allow は autoplay だけ）、`parseDevParam`（ループバック/プライベートIP/.local のときだけ有効）、`GameFrame`（握手は event.source が自分の枠のときだけ→MessageChannel→init、握手3秒/ready10秒の timeout、1秒100通超で枠停止、store 応答）、`validateGameToHost`（信用せず検査・捨てた数を数える・remote 拒否）、`createGameStorage`（名前空間＋16KB/64KB）、`validateManifestEntry`。画面の検査は protocol の `validatePadSpec` を使う（中継と同じ規則にそろえる）。
- **packages/sdk**：`connect`（枠内＝握手/3秒で handshake-timeout、最上位＝仮想プレイヤー）、`Irori`（players/leader/on/setPad/vibrate/look/ready/end/storage）。仮想プレイヤー（既定2・`?mock=N` で1〜8、WASD/矢印、折りたたみパネル、結果＋もう一度、`irori-mock:` 保存）。ビルドは `vite build` ライブラリモードで `dist/irori.js` の1ファイル（55.79KB・import なし・minify せず）。`irori.d.ts` は手書きし、実装との一致と例を `tsc` で確認。
- **tools/sync-sdk.mjs**：`dist/irori.js`＋`irori.d.ts` を `games/*` と `apps/web/public/sdk/v1/` へ写す。`--check` はいまのソースから別プロセスで組み直して比較（古い dist を見逃さない）。同梱ゲーム0本なのでゲーム分は飛ばす。
- **tests/e2e**：`playwright.config.ts`（Chromium・ワーカー1・list）。`bridge/` は、本物の host-bridge を esbuild で束ね、本物の `sdk/dist/irori.js` を使い、別オリジン2つ（127.0.0.1 と localhost・**空きポート**＝固定せず・tmp は mkdtemp）で配ってスタブなしで確認。

## 実行したコマンドと結果

- `npm run typecheck`（ルート）→ OK（exit 0）。
- `npm test -w @irori/pad-ui` → 27 passed、`-w @irori/host-bridge` → 126 passed、`-w @irori/sdk` → 107 passed。
- `npm run build -w @irori/sdk` → `dist/irori.js 55.79 kB`（<60KB・1ファイル・import 文なし＝`build.test.ts` で確認）。
- `node tools/sync-sdk.mjs --check` → OK。`node tools/check-deps.mjs`／`check-rights.mjs` → OK。
- `npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/bridge` → **10 passed**（同梱・外部の通し、押下↔差替えを0〜500msで振る1本、悪意ゲームの脱出全阻止＋ホスト継続、連投で枠停止、なりすまし無視、同一オリジン拒否、ready なし timeout、sandbox 属性、`?mock=3` 仮想プレイヤー）。

## 変異に対する門番の確認（6つ・`tools/mutations/specs/` に仕様化、全件 KILLED）

`node tools/mutations/run.mjs --only bridge-` → **5件中5件 KILLED**、`--only pad-` → **1件 KILLED**。実行器が壊す前に基準が緑であることも確認済み。

| 変異 | 仕様(JSON) | 赤くなる試験 |
|---|---|---|
| (a) sandbox 属性の撤去 | bridge-a-sandbox-attr-removed | e2e `sandbox.spec.ts` |
| (b) 同梱へ allow-same-origin | bridge-b-bundled-allow-same-origin | e2e `sandbox.spec.ts` |
| (c) event.source 検査の撤去 | bridge-c-no-event-source-check | e2e `spoof-reject.spec.ts` |
| (d) setPad 検査の素通り | bridge-d-setpad-not-validated | `host-bridge/tests/validate.test.ts` |
| (e) 外部・同一オリジン拒否を外す | bridge-e-external-same-origin-allowed | `host-bridge/tests/entry.test.ts` |
| (f) setSpec の離し補いを外す | pad-f-setspec-no-release | `pad-ui/tests/pad.test.ts` |

(c) は、なりすましの枠も allow-same-origin なし sandbox にしてオリジンを 'null' にそろえ、判別が event.source だけになるよう試験を組んだ（オリジンで弾けてしまうと検査撤去を見逃すため）。

## 契約からのずれ・設計への気づき（変更はしていない）

- 指示書は `tilt` の許可で「DeviceOrientationEvent.requestPermission があれば許可ボタン」。HTTPS でない文脈（`isSecureContext===false`）では案内を出しつつ購読だけ行う実装にした（LAN の HTTP でセンサーが来ない前提。docs/pad.md と整合）。設計変更ではない。
- `GameFrame` は、`end` 後の `setPad`/`vibrate` を受けない（コンソールのリモコンを上書きしないため）。bridge.ts に明文はないが docs の方針に沿う。必要なら設計側で明記を。
- SDK 容量は、protocol の検査（`validatePadSpec` 等）を取り込むと 60.29KB で上限を超えた。配布物の注釈を落とす設定（`output.comments:false`・ソースのコメントは残す）で 55.79KB に収めた。将来 protocol の検査が重くなると上限に近づく。

## 未確認のこと／次の担当への注意

- **実機・実センサー・振動**：傾きの許可フロー（iOSの requestPermission）、`navigator.vibrate`、Wake Lock は、happy-dom と Chromium では十分に確かめられていない（実機確認が残る）。
- **pad-ui の公開**：`mountPad({send, strings?})`・`look(id, locale?)`・`shapeSvg(shape,size,color)`・`SHAPES`・CSS は `@irori/pad-ui/pad.css`。B2 は縁の色＝`look(id).color`、形＝`shapeSvg`。
- **host-bridge の公開**：`resolveEntry`/`parseDevParam`/`GameFrame`/`validateGameToHost`/`createGameStorage`/`validateManifestEntry`。B1 は `GameFrame` のイベント（ready/setPad/vibrate/end/store/timeout/error）を購読し、`post` で players/pause/resume/input を送る。
- **SDK 同期**：ゲーム追加後は `npm run build -w @irori/sdk && npm run sync:sdk`。手で `irori.js` を直さない（`--check` が落とす）。
- `apps/web/public/sdk/v1/irori.js` は sync-sdk が書く生成物（.gitignore 対象）。

## 追補（押したままの送り直し・HELD_REPEAT_MS）

コーディネーターの追加依頼。正本 `HELD_REPEAT_MS`（protocol/limits.ts、私は触っていない）を読み込んで使う。

- **pad-ui**：送り直しを `Throttle`（間引きと同じ経路）に持たせた。送信のたびに次の送り直しまでを数え直し、`cancel`（差し替え・離し・破棄）で止める。`axis` は中立でない間、同じ値を送り直す（**十字も axis なので含めた**＝解釈。スティックだけに絞るなら `DirPad` の第5引数を外す）。`ptr` は触れている間、最後の位置を `m` として送り直す（触れた直後で `m` が無ければ触れた位置）。`btn` と `tilt` には付けない。公開の形（`mountPad` の引数・`look`・`shapeSvg`）は変えていない。
- **SDK の仮想プレイヤー**：方向キーで送る `axis` に同じ規則（キーを離す・`setPad`・窓のフォーカス喪失・切断のボタンで止まる）。矢印で真似る `tilt` とボタンは送り直さない。

| 確認 | 結果 |
|---|---|
| `npm test -w @irori/pad-ui` | 34 passed（+7：a 3.5間隔で3回／b 変化で数え直し／c 中立・離しで停止／d setSpec・releaseAll・destroy で停止／e btn・tilt は送り直さない／十字／なぞる面） |
| `npm test -w @irori/sdk` | 109 passed（+2：f 仮想プレイヤーの同じ規則） |
| `npm test -w @irori/host-bridge` | 127 passed（127件目は別の手で足された `timeouts.test.ts`。host-bridge に `handshakeTimeoutFor`・`EXTERNAL_HANDSHAKE_TIMEOUT_MS` も足されていた。意図的な変更として戻していない） |
| 型検査 | 担当3パッケージは exit 0。ルート `npm run typecheck` は exit 2 だが、失敗は `@irori/web` の `tests/pad/e2e/*.ts`・`tests/pad/shots.e2e.ts`（B2 が作成中・Node の型の参照なし、計22件）だけ |
| `npm run build -w @irori/sdk` | 57.24 kB（+1.45kB、60KB以下） |
| `node tools/sync-sdk.mjs --check` | exit 1・ずれ5件＝`games/{dot-grab,hello-pad,quiz-4,tap-race}/irori.js` と `apps/web/public/sdk/v1/irori.js`。SDK を直したので想定どおり（`irori.d.ts` は変わらずずれなし）。指示どおり `games/` は触っていない＝`npm run sync:sdk` で解消 |
| e2e `tests/e2e/bridge` | 10 passed |
| 変異 | `--only pad-` 2件中2件 KILLED（f と新しい **pad-g-no-held-repeat**）、`--only bridge-` 5件中5件 KILLED（host-bridge への別の手の変更のあとも find は各1か所） |

仮想プレイヤーの送り直しの撤去も、実行器の関数に一時の仕様を渡して写しの上で壊し、`tests/mock.test.ts` が赤くなる（KILLED）ことを確かめた（仕様ファイルは指示どおり1件だけ）。

送り直しの量は、押している部品1つあたり毎秒1通で、中継の上限（スマホ毎秒60通）に対して小さい。
