# cue 基盤（SdkBridge・ConsoleSynth）

cue-v1とtilesのtoken伝達を実装した。最終の単体944件、型検査、全体検査6項目、容量予算4指標は成功。
実ブラウザの波形試験23件は作成のみ。全体npm testと聞こえ方の検証はメインへ渡す。

## 進捗
- 共通の約束・cue指示書・承認済みの要件3とcue-v1契約・既存tiles報告を引き継いだ。
- 指示書0が挙げるpad-ui・protocolの試験・docs/pad.mdも変更範囲として扱った。
- tokenをpad-uiと仮想プレイヤーの決定・パスへ返し、手書き型と独立検証器をそろえた。
- SDKと橋で同名50ms・直近1秒20件を制限する。橋は有効なcueの超過を黙って捨て、形式の誤りを違反に数える。
- コンソールで消音・未解除・一時停止・覆い・非表示・終了後の再生を防ぎ、音は23種を独自合成する。
- 他担当のゲーム等の変更あり。所有外は編集せず、SDKの写しだけを指定コマンドで同期した。
- commit・push・依存追加・ブラウザ・localhost・サーバー起動は行っていない。

## 変更したファイル（手編集25件・報告1件・同期22件）
- `packages/sdk/src/{core,types,index}.ts`、`packages/sdk/irori.d.ts`
- `packages/sdk/tests/{cue,mock}.test.ts`、`packages/sdk/tests/types/api-match.ts`
- `packages/host-bridge/src/{frame,validate}.ts`、`packages/host-bridge/tests/{timeouts,validate}.test.ts`
- `packages/pad-ui/src/pad.ts`、`packages/pad-ui/tests/pad.test.ts`
- `packages/protocol/tests/{validate,fuzz}.test.ts`（protocolの型・上限・検証実装は変更なし）
- `apps/web/src/host/{console,audio,audio-cues}.ts`
- `apps/web/tests/host/{console,audio-wake}.test.ts`、`apps/web/tests/host/audio-cues.e2e.ts`
- `docs/{sdk,pad,protocol,security}.md`
- この報告: `.agent-harness/runs/2026-10-27-party-pack/reports/cue.md`
- 同期のみ: `games/{blade-duel,daifugo,dot-grab,hello-pad,lantern-market,moon-village,old-maid,quiz-4,strike-alley,tap-race,ten-seconds}/{irori.js,irori.d.ts}`
- 指定コマンドは `packages/sdk/dist/irori.js` と `apps/web/public/sdk/v1/{irori.js,irori.d.ts}` も生成した。手編集なし。

## 実行したコマンドと件数
- `npm run typecheck`: 最終は8ワークスペースとゲームの型検査が成功・エラー0。E2Eと手書きAPIの一致も対象。
- `npm test -w @irori/pad-ui -w @irori/protocol -w @irori/sdk -w @irori/host-bridge -w @irori/room -w @irori/room-client -w @irori/web`
- 上記の最終結果: 46ファイル・944成功・0失敗・0スキップ（41/274/151/157/67/41/213件）。変異復元後にも成功。
- `node --test tools/tests/checks.test.mjs tools/tests/mutations-runner.test.mjs tools/tests/ofl-fonts.test.mjs tools/tests/registry.test.mjs`: 51成功・0失敗・0スキップ。
- `npm run build -w @irori/sdk && node tools/sync-sdk.mjs`: 成功、12か所へ同期。最終SDKは70,451Bで、単体試験の厳しい上限72,000B以内。
- `node tools/check-budgets.mjs`: 4指標成功。ホストgzip61,765/81,920B、スマホgzip35,871/40,960B、SDK gzip21,120/61,440B、SDK生70,451/73,728B。
- `npm run check`: 6成功・0失敗・0スキップ。文書・権利・依存方向・依存ライセンス・登録7件・SDK同期11本。
- `git diff --check`: 成功。
- 初回は追加コンソール試験の呼び出し誤り1件、次回は存在しない操作ボタンの指定1件で失敗した。双方を修正し、3回目と変異復元後は成功。
- 同期前の型検査ではゲームの古いSDK型2件も検出した。指定の同期後は解消した。
- natural-japaneseのlintは既存Pythonに解析用依存がなく失敗した。依存は追加せず、手動チェックと通読で確認した。
- 全体の `npm test` はedgeと一部toolsの試験が実サーバーを起動するため未実行。上記のサーバー不要部分を実行した。未実行分をスキップ成功とは数えない。

## 壊して確かめた変異（10件すべて検出・復元済み）
- SDKの能力判定を無効化: cue試験1失敗・4成功。
- SDKの同名間隔を50msから0msへ変更: cue試験2失敗・3成功。
- SDKの毎秒上限を20から200へ変更: cue試験2失敗・3成功。
- 橋の名前検証を無効化: validate試験3失敗・72成功。
- 橋の毎秒上限を20から200へ変更: timeouts試験1失敗・6成功。
- コンソールの消音判定を無効化: console試験1失敗・30成功。
- コンソールの音解除判定を無効化: console試験1失敗・30成功。
- nightを1.4秒から1.6秒へ延長: audio-wake試験1失敗・8成功。
- tilesのtoken返送を削除: pad試験1失敗・35成功。
- 独立検証器のtoken検証を無効化: fuzz試験1失敗・2成功。
- 各パッケージを作業場所として `node ../../node_modules/vitest/vitest.mjs run tests/<対象>.test.ts` を実行した。
- 通常試験では固定種2000件のcue送信で任意の1秒窓・同名間隔を検証し、既存の固定種500通りのtilesと独立検証器の一致も保った。

## 設計への提案・未解決
- メインが仕様タスク3.1・3.2へこの証拠を反映する。所有外の仕様ファイルは編集していない。
- SDKの元の `mock.ts` には既にcueを捨てる分岐があり、その挙動を維持した。公開APIもmockでは送信しない。
- 実ブラウザの波形ピークと長さは未検証。単体は音源の生成・停止時刻・粒数・高さ±3%・消音等を確認している。
- 旧ホスト・実MessagePortを使うSDKと橋・不正名/範囲/余分なキー・過剰送信・終了後の破棄を単体で確認した。
- サーバーを伴う全体npm test、ブラウザ、実機、聴感、独立したレビューは未実施。

## 人が確かめるべきこと
- メインが `npm run test:e2e:host -w @irori/web -- --project=host-chromium audio-cues.e2e.ts` を実行する。
- 23件で各cueの強さ0/0.25/0.7/1をOfflineAudioContextに描き、非無音・ピーク0.7以下・1.5秒以内・pinsの長さの変化を確かめる。
- 人の耳で確かめる。23種の性格・音量・pinsの強さと粒・連続した依頼の聞こえ方を確認する。
- 実ホストとスマホで消音・最初の操作・一時停止・メニュー・復帰・終了時の挙動を確認する。
