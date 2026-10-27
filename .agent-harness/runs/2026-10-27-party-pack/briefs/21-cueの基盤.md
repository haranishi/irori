# 担当 SdkBridge・ConsoleSynth：cue（タスク3.1と3.2。効果音の依頼）（Codex）

`00-共通の約束.md` を先に読む。そのあと `.kiro/specs/party-game-pack/design-contracts.md`（cue-v1 の節）と `requirements.md` の要件 3 を読む。tiles（タスク2.7・2.8）が済んだあとに始める。型と一覧（`packages/protocol/src/bridge.ts` の `CUES`・`GameToHost` の `cue`・`HostCapability` の `cue-v1`）は**実装済み**。変えない。

## 所有する場所
`packages/sdk`（`dist` を除く）、`packages/host-bridge`、`apps/web/src/host/{console,audio}.ts` と関連、`apps/web/tests/host`、`docs/{sdk,protocol,security}.md`。`README.md`・`README.ja.md` は触らない。B1 が足した tiles の部分は壊さない。

## 作るもの（順に）
1. **SDK**：`irori.cue(name, v?)`。能力 `cue-v1` が無ければ何もしない（例外を出さない）。同じ名前は50ms以内に重ねて送らない。全体で毎秒20件まで（超過は黙って捨てる）。`v` は0〜1に丸め、省略時は0.7。`packages/sdk/src/{core,types,index,mock}.ts` と `irori.d.ts`。仮想プレイヤーでは何もしない。
2. **橋**：`packages/host-bridge/src/validate.ts` の `validateGameToHost` に `cue` を足す（名前は `CUES` に含まれる、`v` は数で範囲内、余分なキーは不正）。形式の誤りは `setPad` や `vibrate` と同じ扱いで違反として数える。`frame.ts` の能力の申告に `cue-v1`。受け取った `cue` をコンソールへ渡す経路は、`vibrate` の経路を手本にする。
3. **コンソール**：`apps/web/src/host/console.ts` が `cue` を受け、`Sounds` に渡す。鳴らす条件は、消音でなく、AudioContext が使え、ゲームが前面（一時停止やメニューが無い）のとき。条件に合わなければ黙って捨てる。
4. **合成音**：`apps/web/src/host/audio.ts` に `cue(name, v)` を足し、`CUES` の23個を、WebAudio の振動子・ノイズ・フィルタ・包絡だけで作る。音声ファイルは足さない。1つ1.5秒以内、ピークはフルスケールの0.7以下、同じ cue でも高さを±3%ふらつかせる（`v` で強さが変わる。`pins` は `v` で長さと粒の数が変わる）。音の性格：`tick` 短いクリック、`confirm` 上がる2音、`deny` 低いブザー、`turn` やわらかい鐘、`win` 上がる3音、`lose` 下がる音、`count`/`go` ビープ（`go` は高い）、`deal`/`flip` 札の擦れ（ノイズ）、`place` 軽い衝撃、`sweep` 払う音、`revolution` 上がる唸り、`roll` 低い転がり、`pins` 衝突の破裂（粒つき）、`strike`/`spare` 衝突＋鐘、`gutter` 鈍い音と下がる音、`night` 低い持続音、`dawn` 明るく上がる鐘、`vote` 太鼓、`execute` 重い音、`reveal` きらめき。
5. **能力の完全一致の期待値**を同時に更新：`packages/sdk/tests/mock.test.ts`、`packages/host-bridge/tests/timeouts.test.ts` ほか。
6. **試験**：SDK（能力なし・頻度・丸め）、橋（一覧外・範囲外・余分なキー）、コンソール（消音・未解除・前面でないときに鳴らさない。`Sounds` の差し替えで確かめる）。全 cue を `OfflineAudioContext` で描き、無音でない・ピークの上限・長さの上限を確かめる実ブラウザの試験（`apps/web/tests/host/` の e2e）は**書くだけ**。走らせるのはメイン。
7. **文書**：`docs/sdk.md` に `irori.cue` と名前の一覧、`protocol.md` に能力、`docs/sdk.md` の「音は…」の節（消音が伝わらない旨）を「コンソールが鳴らす」へ直す。各100行以内。
8. **最後に**：`npm run build -w @irori/sdk && node tools/sync-sdk.mjs`。

## 守る数字
SDK の生の大きさは72,000バイト以下。ホストの画面の JS は gzip で81,920バイト以下（`node tools/check-budgets.mjs`）。

## 走らせるもの（件数を報告）
`npm run typecheck`、`npm test`、`node tools/check-budgets.mjs`、`npm run check`。音の聞こえ方は、機械では確かめられない。報告の⑤に「人の耳で確かめる」と書く。
