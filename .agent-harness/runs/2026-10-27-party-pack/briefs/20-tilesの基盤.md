# 担当 PadUi・SdkBridge：tiles（タスク2.7と2.8。スマホの部品・SDK・橋・棚・スキーマ・文書）（Codex）

`00-共通の約束.md` を先に読む。そのあと `.kiro/specs/party-game-pack/design-contracts.md`（tiles の節）と `requirements.md` の要件 2 を読む。型・上限・検証（`packages/protocol/src/{types,limits,validate,bridge}.ts`）は**実装済み**。変えない（変えたくなったら報告に書く）。

## 所有する場所
`packages/pad-ui`、`packages/sdk`（`dist` を除く）、`packages/host-bridge`、`packages/room/tests`、`packages/room-client/tests`、`packages/protocol/tests`、`apps/web/src/{host,pad,styles}`、`apps/web/tests`、`registry/schema/`、`tools/playtest-server.mjs`、`docs/{pad,protocol,sdk,security,ux,README}.md`、`docs/decisions/0004-fixed-pad-kinds.md`（末尾に「7種目は ADR 0009」と1行足す）。`README.md`・`README.ja.md` は触らない（メインが直す）。

## 作るもの（順に）
1. **pad-ui の `Tiles`**（`packages/pad-ui/src/pad.ts` の `build` に `case 'tiles'` を足す。大きければ新しいファイルに分ける）。動作は design-contracts.md のとおり：札の押下で選択・解除、`max` が1なら入れ替え、上限なら断る（`aria-live`・動きを減らす設定では揺らさない）、選択中は太い枠＋チェック印＋`aria-pressed`、`off` は薄く `aria-disabled`、決定は `min`〜`max` のときだけ、押したら `{k:'tiles', ids}` を1回送って全体を「送りました」にする、パスは `{ids:[], pass:true}`、`disabled` は見るだけ、新しい画面で選択を空にする。20個でも390px幅で札の領域だけが縦に動き、決定とパスは下に固定。文言は `PadStrings` に日英で足す。CSS は `packages/pad-ui/src/pad.css`、スマホ画面の配置は `apps/web/src/styles/pad.css`（`.pp-pad .irori-pad[data-kind=…]` の並びに足す）。
2. **スマホ画面の再描画**：`apps/web/src/pad/play.ts` の `applySpec` は同じ指定の再送を省略する。再接続のあとは、選択が空の同じ札が戻るようにする（`force` の扱いを確かめ、試験で固定）。
3. **SDK**：`packages/sdk/src/core.ts` の `CAPS` に `pad-tiles-v1` を足し、`setPad` が `tiles` を能力なしで送る前に `unsupported-feature` で断る（`result-options-v1` の断り方が手本）。`mock.ts`・`mock.css`：仮想プレイヤーで `tiles` を操作できる（矢印で動く・Space で選択・Enter で決定・P でパス・クリックでも）。`irori.d.ts`（手書き）に `TileSpec`・`tiles` の `PadSpec`・`tiles` の `GameInput`・能力の型を足し、`tests/types/api-match.ts` の一致を通す。
4. **橋と棚**：`packages/host-bridge/src/manifest.ts` の `PADS` に `tiles`、`frame.ts` の能力の申告に `pad-tiles-v1`。棚の印：`apps/web/src/host/{icons,view-home,messages}.ts`（`tiles` のアイコンと日英の名称）。`registry/schema/game.schema.json` の `pads` に `tiles`。
5. **能力の完全一致の期待値**を能力を足すと同時に更新する：`packages/sdk/tests/mock.test.ts`、`packages/host-bridge/tests/timeouts.test.ts`、`packages/sdk/tests/host.test.ts` の関連。
6. **試験**：`packages/protocol/tests/validate.test.ts`・`fuzz.test.ts`（独立した検証器にも tiles の規則を足す）、`packages/pad-ui/tests/pad.test.ts`、`packages/sdk/tests/{mock,checks-agreement}.test.ts`、`packages/host-bridge/tests/{validate,storage-manifest}.test.ts`、`packages/room/tests/relay.test.ts`、`packages/room-client/tests/socket.test.ts`。実ブラウザの試験（`apps/web/tests/pad/{controllers,zoom,shots,zoom-webkit,reconnect}.e2e.ts` への追加）は**書くだけ**。走らせるのはメイン。
7. **文書**：`docs/pad.md`（「定型7種」へ。tiles の指定・入力・上限・操作）、`protocol.md`（能力 `pad-tiles-v1` と新しい入力）、`sdk.md`（能力の確認と旧ホストの扱い）、`security.md`・`ux.md`・`docs/README.md` の「6種」を直す。各100行以内。
8. **最後に**：`npm run build -w @irori/sdk && node tools/sync-sdk.mjs`（SDKの写しを更新）。

## 守る数字（超えそうなら止めて報告）
SDK の生の大きさは72,000バイト以下（`packages/sdk/tests/build.test.ts`）。スマホの画面の JS は gzip で40,960バイト以下（`apps/web/tests/pad/budget.e2e.ts`、道具は `node tools/check-budgets.mjs`）。

## 走らせるもの（件数を報告）
`npm run typecheck`、`npm test`、`node tools/check-budgets.mjs`、`npm run check`。落ちたら直す。`npm run check` の文書の検査が `.kiro/settings/` のテンプレートで落ちる場合は、メインが消す前提なので報告に書くだけでよい。
