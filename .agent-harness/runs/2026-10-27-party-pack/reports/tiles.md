# tiles 基盤（PadUi・SdkBridge）

## 進捗
- 既存の要件2・design-contracts.md と tasks.md の2.7・2.8を引継ぎ。証拠はこの報告に集約し、所有外のタスク更新はメインへ渡す。
- 開始時は変更0件。途中から他担当のゲーム・試験が追加された。所有外のソースには触れていない。
- UIの選択・解除・入れ替え・上限通知・off・見るだけ・送信1回・日英・領域スクロールを実装。
- 同一再送を省く既存動作を保ち、再接続の force で選択と送信済み状態が消えることを固定。
- SDK能力判定・仮想プレイヤー操作・手書き型・橋・棚・スキーマ・文書を更新。
- 型検査で既存cue未対応を検出。橋では未知の種類として拒む既存動作を保ち、mockは保存処理へ流さず捨てる最小補正。
- SDKビルドと同期を完了。commit・push・依存追加・ブラウザ/サーバー起動なし。

## 変更したファイル（手編集44件、報告1件、同期による追跡対象22件）
- `packages/pad-ui/src/{pad.ts,pad.css}`、`packages/pad-ui/tests/pad.test.ts`
- `packages/sdk/src/{core.ts,index.ts,mock.ts,mock.css}`、`packages/sdk/irori.d.ts`
- `packages/sdk/tests/{host,mock,checks-agreement}.test.ts`、`packages/sdk/tests/types/api-match.ts`
- `packages/host-bridge/src/{frame,manifest,validate}.ts`
- `packages/host-bridge/tests/{validate,storage-manifest,timeouts}.test.ts`
- `packages/protocol/tests/{validate,fuzz}.test.ts`（protocolの型・上限・検証実装は変更なし）
- `packages/room/tests/relay.test.ts`、`packages/room-client/tests/socket.test.ts`
- `apps/web/src/host/{icons,messages,view-home}.ts`、`apps/web/src/pad/play.ts`、`apps/web/src/styles/pad.css`
- `apps/web/tests/host/{console,view-home}.test.ts`、`apps/web/tests/pad/app.test.ts`
- `apps/web/tests/pad/{controllers,reconnect,shots,zoom,zoom-webkit}.e2e.ts`
- `registry/schema/game.schema.json`、`tools/playtest-server.mjs`
- `docs/{pad,protocol,sdk,security,ux,README}.md`、`docs/decisions/0004-fixed-pad-kinds.md`
- この報告: `.agent-harness/runs/2026-10-27-party-pack/reports/tiles.md`
- 同期のみ: `games/{blade-duel,daifugo,dot-grab,hello-pad,lantern-market,moon-village,old-maid,quiz-4,strike-alley,tap-race,ten-seconds}/{irori.js,irori.d.ts}`
- 明示された同期コマンドが `packages/sdk/dist/irori.js` と `apps/web/public/sdk/v1/{irori.js,irori.d.ts}` も生成。手編集なし。

## 実行したコマンドと件数
- `npm test -w @irori/pad-ui -w @irori/protocol -w @irori/sdk -w @irori/host-bridge -w @irori/room -w @irori/room-client -w @irori/web`
- 上記の最終結果: 45ファイル・913成功・0失敗・0スキップ（40/272/143/141/67/41/209件）。初回904成功・5失敗、修正後911成功、追加後912成功、最終913成功。
- `npm run typecheck`: 最終は8ワークスペースとゲームの型検査が成功・エラー0。途中の所有外ゲーム1エラーも後続実行では解消。
- `node --test tools/tests/checks.test.mjs tools/tests/mutations-runner.test.mjs tools/tests/ofl-fonts.test.mjs tools/tests/registry.test.mjs`: 51成功・0失敗・0スキップ。
- `npm run test:games`: 1回目は6ファイル・67成功・0失敗・0スキップ。追加された他担当の試験を含む再実行は完了出力がなく中断（終了130、成功件数を計上しない）。
- `npm run build -w @irori/sdk && node tools/sync-sdk.mjs`: ビルド成功、最終69,123B、12か所へ同期。
- `node tools/check-budgets.mjs`: 4指標すべて成功。スマホgzip 35,791/40,960B、SDK生69,123/72,000B（厳しい単体試験上限）、SDK gzip 20,715B、ホストgzip 60,431B。
- `npm run check`: 最終5成功・1失敗・0スキップ。文書・権利・ライセンス・登録7件・SDK同期11本は成功。依存検査は所有外の1件で失敗。
- `node --check tools/playtest-server.mjs`、`git diff --check`: ともに成功。`ps` による進行状況の照会は環境に拒否された。
- 全体の `npm test` は edge が実サーバー3本、playtest-guardがHTTPサーバーを起動するため未実行。上記のサーバー不要部分を個別実行した。

## 壊して確かめた変異（すべて復元済み）
- UI上限 `>=` を `>` に変更: pad.test 2失敗。送信済みを false に変更: 1失敗。
- offを押せるよう変更: pad.test 1失敗。SDK能力判定を反転: host.test 2失敗。
- 再接続の force を無視: app.test 2失敗。manifestからtilesを除外: storage-manifest.test 1失敗。
- 独立検証器の `max > cap` を反転: fuzz.test 1失敗。計7変異を検出し、復元後の単体913件は成功。
- 選択の16パターン全探索、固定種500通りのtiles仕様/入力と独立検証器の一致、既存3000入力のfuzzを実行。

## 先行時点の未解決・設計への引継ぎ（再検証結果は末尾）
- `games/moon-village/logic.test.js` の `../../packages/protocol/src/validate.ts` へのimportが依存検査に違反。所有外につきメインで対応する。
- cue担当は `host-bridge/src/validate.ts` のキー一覧の型をcue実装に合わせて戻す/更新すること。cue能力はこの担当では申告していない。
- ゲーム全体の再実行が完了しない原因は未特定。担当の単体913件と、先行したゲーム67件の成功を全ゲーム成功とは扱わない。

## メイン・人が確かめること
- E2Eは書いただけで未実行。Chromium: controllers/zoom/reconnect/shots、WebKit: zoom-webkitを実行する。
- `IRORI_PAD_SHOTS=1 npm run test:e2e:pad -w @irori/web -- --grep tiles` で3幅と縦横の画像を撮れる（既存撮影先）。
- 390・768・1440px、20枚の指スクロールと下部固定、キーボード、読み上げ、動きを減らす設定、送信後と選択中の実機再接続。
- 試遊ツールに `POST /pad/:n/tiles`（ids配列かpass:true）と、stateのtiles一覧を追加した。実操作はメインが確認する。

## 再開後の確認
- 既存実装・44件の手編集と同期結果を引継ぎ。今回は開始時から変更あり。先行実行の記録は上記。
- 初回再検証: 型検査成功、単体913成功。全体試験はサーバーを起動するため共通の約束により実行しない。
- mockで2件再現: 別席tilesへの切替がキー離しを奪う／管理ボタン上のEnterが札を確定する。回帰試験は修正前2失敗・修正後23成功。
- キー離しを先に処理し、管理ボタンの標準操作を保護。今回の手編集は `packages/sdk/src/mock.ts`・`packages/sdk/tests/mock.test.ts` とこの報告。

## 再検証の最終結果
- 上記7ワークスペースの `npm test -w …`: 45ファイル・915成功・0失敗・0スキップ（40/272/145/141/67/41/209件）。
- `npm run typecheck`: 8ワークスペースとゲームの型検査が成功・エラー0。E2Eの型も対象。
- 上記4ファイルの `node --test`: 51成功・0失敗・0スキップ。
- `npm run build -w @irori/sdk && node tools/sync-sdk.mjs`: 成功・12か所同期。今回更新された写しは11本の `irori.js`。
- `node tools/check-budgets.mjs`: 4指標成功。SDK生69,497/72,000B（単体試験の上限）、gzip20,789B、スマホgzip35,791/40,960B。
- `npm run check`: 6検査成功・0失敗・0スキップ（登録7件・SDK同期11本）。先行時点の依存違反は解消している。
- `git diff --check`・`node --check tools/playtest-server.mjs`: 成功。
- 追加の変異2件: キー離しの保護を無効化→mock試験1失敗、管理ボタンの保護を無効化→1失敗。いずれも22成功・1失敗。復元後の915件は成功。
- `npm run test:games`: 45秒で完了出力がないため中断。成功件数は計上しない。再実行を重ねず、メインへ返す。
- 残件: サーバー・ブラウザが必要な全体 `npm test` とE2E・実機検証、ゲーム全体試験の完走、仕様タスクの完了反映はメインが行う。
- cueの実装は後工程。先行のcue引継ぎと上記の人による確認事項は継続。commit・push・依存追加なし。
