# PR #3：試験用時計の競合を補正

2026-10-18。task 7.1のE2Eヘルパーだけを補正。ゲームの仕様・製品コード・依存は変更しない。

## 原因と修正
[初回Linux CI](https://github.com/haranishi/irori/actions/runs/39111071424)はroot 125成功・1失敗。新ゲームは30/31成功だった。
CPU6倍ケースの時計準備で、`Date.now()`取得から`pauseAt(now + 1)`までのAPI往復が1msを超えた。
停止先が過去となり、ゲーム操作前に`Cannot fast-forward to the past`が発生した。

`setFixedTime(now)`でDateを一時固定し、`pauseAt(now)`の後に`setSystemTime(now)`で通常の進行へ戻す。
既存timerと単調時計を保持する。未来への固定幅ジャンプ、リトライ、skipは追加しない。
CPU倍率と適用順、31実行の対象、assertion、timeoutは変更しない。

## 再現と再検証
| 検査 | 実際の結果 |
|---|---|
| 旧helperへAPI遅延100ms、Chromium CPU6倍 | 同じ例外を1件再現、期待どおりexit 1 |
| 修正後、同じ遅延、Chromium CPU6倍・WebKit | 2件成功、exit 0 |
| 停止後150ms待機 | Date・performance・timerが不変 |
| 既存timerとiframe、`fastForward(1000)` | host/iframeのDate・performanceが各+1000ms。interval保持、5秒deadlineの早発火なし |
| CPU6倍の実Worker E2E | 1件成功、6.9秒、exit 0 |
| 新ゲーム全E2E | 31件成功、2.9分、exit 0。Chromium host15・WebKit host14・phone各1 |
| 厳格TypeScript検査 | exit 0 |
| 別担当の独立再検証 | 旧helperのRED、修正後probe2件、CPU実ゲーム1件を確認。APPROVED |

独立担当は全31件の生ログと厳格TSの成功報告も監査した。専用Workerとbrowserは終了済み。
Linux CIの再実行は、この記録の作成時点では未確認。[PRのチェック](https://github.com/haranishi/irori/pull/3/checks)で確認する。

## 既存の受け入れ証拠との照合
[元の59ファイル照合](audit.json)を再計算し、58ファイルは一致した。
変更は`tests/e2e/console/ten-seconds.spec.ts`の`pause`内だけ。helper外は元head `47c69e9`とbyte単位で一致。
元の監査と変異検証のスナップショットは、当時の記録として保持する。

| 対象 | SHA-256 |
|---|---|
| 変更前の試験 | `73c4104dbff5a4aab2053d19dee2f7f15ab4976f7bca9a44ffa247ed3e62e7d8` |
| 修正後の試験 | `2aa007470ac153bf0540836874b6ba346fb7b3d2164b53a13b98625f82e00f0a` |
| 旧helperのREDログ | `5fec0aff5ebe03d4f61d980b211156a6780005e79ca86caf8caad547a2c81cbd` |
| 修正後のprobeログ | `b76d961e9f373dcc182c0631c74eae81b28296cef2bb104a2759a53171582829` |
| CPU単独のGREENログ | `7b93a9c55974391250fce1796d74e9467bc3b70d31f649fa616524067c3f2e7a` |
| 全31件のGREENログ | `5900d02b10af311625f176496b01b3eddc5e907ba4b6992705821d696fbc8297` |

実行ログ・probe・独立レビュー原本は外部の一時実行領域に保存した。
