# ファイル構成と変更範囲

承認済みの詳細設計に沿う変更範囲。下記の責任ごとに実装・検証する。
担当を分ける場合も共通契約を先に固定し、同じファイルを同時に編集しない。

## 新しいゲーム
| ファイル | 責任 |
|---|---|
| `games/ten-seconds/logic.js` | GameLogic。状態・受付・採点・中断・公開情報への射影 |
| `games/ten-seconds/main.js` | GameRuntime。SDKと時計・DOMの接続、効果の実行、破棄 |
| `games/ten-seconds/view.js` | GameView。GameViewModelだけをDOMへ描画 |
| `games/ten-seconds/index.html` | 文書の骨格。外部JS/CSS、読み上げの状態領域 |
| `games/ten-seconds/style.css` | ゲームの配置・文字・reduced-motion |
| `games/ten-seconds/README.md` | 遊び方、計測の意味、再開のルール |
| `games/ten-seconds/logic.test.js` | 時刻を注入して、受付・確定・採点・中断を検証 |
| `registry/games/ten-seconds.json` | 2〜8人、pad/wait、sdk=1、bundledの登録情報 |
| `registry/thumbs/ten-seconds.png` | 自作の640×480・120KB以内のサムネイル |
| `tools/make-thumbs.mjs` | 契約で許可した既存の撮影手順に、新ゲームの説明画面シーンだけを追加 |

## 共通契約とSDK
| ファイル | 変更する責任 |
|---|---|
| `packages/protocol/src/bridge.ts` | GameResult、GameEndOptions、HostEnvironment、HostCapability、iframeメッセージ |
| `packages/protocol/src/end.ts` | EndContract。終了データを検証し、既知キーだけで再構成する新しい純粋関数 |
| `packages/protocol/src/index.ts` | 終了の型・共通検証を公開 |
| `packages/protocol/src/code.ts`、`validate.ts` | 定数の初期化を必要時に行い、SDKが使わない検証を同梱しない。検証ルールは変更しない |
| `packages/host-bridge/src/validate.ts` | 共通検証を使ってend/optionsを受ける |
| `packages/host-bridge/src/frame.ts` | initの能力・環境、握手前の保持、optionsの転送 |
| `packages/sdk/src/types.ts`、`packages/sdk/irori.d.ts` | 公開するSDKの型を一致させる |
| `packages/sdk/src/core.ts` | capabilities/environmentの保持と通知、拡張endの送信 |
| `packages/sdk/src/host.ts` | initの能力・環境の受け取り |
| `packages/sdk/src/mock.ts` | 環境と拡張結果の開発用表示 |
| `packages/sdk/src/checks.ts`、`errors.ts`、`index.ts` | 終了検証、unsupported-feature、型の公開 |

最後の行のerrors.ts・index.tsは、同じ `packages/sdk/src/` の各ファイルを指す。

## 共用画面
| ファイル | 変更する責任 |
|---|---|
| `apps/web/src/host/console.ts` | HostAdapter。環境通知、end/optionsの保持、結果・再戦への接続 |
| `apps/web/src/host/results.ts` | rankedによる順位対象の限定とrank=null |
| `apps/web/src/host/view-panels.ts` | record表示、順位なし、勝敗なし、注記 |
| `apps/web/src/host/messages.ts` | 汎用の結果表示の日本語・英語の文言 |
| `apps/web/src/styles/host.css` | 2〜8行の記録・注記・結果操作が収まる配置 |

## 試験と記録
| 対象ファイル | 検証する責任 |
|---|---|
| `packages/protocol/tests/end.test.ts` | 新規。終了データの検証 |
| `packages/host-bridge/tests/validate.test.ts`、`timeouts.test.ts` | options転送、握手前の環境保持 |
| `packages/sdk/tests/checks-agreement.test.ts`、`host.test.ts`、`mock.test.ts`、`types.test.ts` | 検証・host/mock・型・互換性 |
| `packages/sdk/tests/types/api-match.ts`、`example.ts` | 公開型の一致と新しい使用例 |
| `apps/web/tests/host/results.test.ts`、`console.test.ts`、`fakes.ts` | 順位・環境の送信順と複合中断 |
| `tests/e2e/console/ten-seconds.spec.ts` | 新規。実ホスト＋複数スマホの一勝負・秘匿・中断・再戦 |
| `tests/e2e/console/a11y.spec.ts` | 棚の件数とhello-padまでの移動数を新順序へ更新。既存の重なり・アクセシビリティ検査は保つ |
| `apps/web/tests/host/play-layout.e2e.ts` | 棚の固定期待と名称を5本へ更新。新旧5本×3画面の重なり検査を保つ |
| `tests/e2e/console/playtest.spec.ts` | 試遊サーバーの操作試験が参照する棚順を5本へ更新。既存4本の操作検査は保つ |
| `apps/web/tests/host/host.e2e.ts` | 初期カードとhello-padまでのリモコン・キー・ゲームパッド操作数を新しい棚順へ合わせる |
| `tools/mutations/specs/ten-seconds.json` | 新規。旧試行・期限・秘匿・順位除外の守りを外して試験が落ちること |
| `tools/mutations/specs/host-b1.json`、`e2e-b-no-end.json` | 変更した実装に既存3定義の検索位置を合わせ、守りと実行コマンドを維持 |
| `docs/sdk.md`、`docs/protocol.md`、`docs/README.md`、`README.ja.md`、`README.md` | 追加契約と5本目の遊び方を実装後の事実で更新 |

試験・型の省略したファイル名は、その行の最初に書いたディレクトリ内を指す。
既存workspacesの型検査はゲームのJSを対象にしていない。`tsconfig.games.json`と既存package.jsonの型検査に、新ゲーム3モジュールのJSDoc検査だけを追加する。

## 生成物と対象外
`games/*/irori.js`・`games/*/irori.d.ts` と公開SDKは、既存sync-sdkで更新する生成物。
`apps/web/public/games/`・`public/registry/` は既存prepare:webが作り、手編集・新規の配布経路は足さない。
Worker、room、room-client、入力6種、machine、padplan、既存ゲーム4本の独自コード、依存・lockfileは変更対象外。
