## Validation Report

- DECISION: GO
- 対象：ten-seconds-party。2026-10-18、実装担当と別の読み取り担当による最終統合検証。
- 範囲：承認済み41基準と既存機能の機械・AI受け入れ。公開判断、物理端末、実回線、人間同士の面白さは含めない。
- 方法：仕様・隣接仕様・差分・実ログを照合し、既存buildの専用Worker/ブラウザ起動だけを追加。製品ファイルは変更していない。

### MECHANICAL_RESULTS

| 検査 | 結果と証拠 |
|---|---|
| 正規コマンドの導出 | package.json → toolsのrunner → CI → E2E設定・fixtureを確認。型・test・build・test:e2e・check・mutations・budgetsを正規関門とした |
| 型 | PASS・提供exit 0。8 workspaces＋新ゲーム3モジュール。`final-typecheck.log` |
| 全suite | PASS・提供exit 0。`npm test`：1,180件＝edge72＋web206＋bridge140＋pad-ui34＋protocol238＋room66＋client40＋sdk134＋tools54＋games196。`final-test.log` |
| 実Worker再検査 | PASS・提供exit 0。`npm test -w @irori/edge`：72件/8ファイル。`final-edge.log` |
| Build | PASS・提供exit 0。`npm run build`：5本/5画像/32ゲーム配布ファイル。SDK raw60,000B。`final-build.log` |
| 全E2E | PASS・提供exit 0。`npm run test:e2e`：root126＋host27＋pad69＝222成功。新ゲーム31実行も全成功。`final-e2e-rerun.log` |
| skip範囲 | 66件全て既存pad/shots.e2e.tsの任意撮影。`IRORI_PAD_SHOTS=1`専用で、新ゲームの操作試験にskipはない |
| 文書・権利・登録・依存方向・SDK同期 | PASS・提供exit 0。`npm run check`。登録5件・同梱SDK5本一致。`final-check.log` |
| 変異 | PASS・提供exit 0。164/164 KILLED、SURVIVED/ERROR/強制timeout 0。8件の新規変異を含む。`final-mutations.log` |
| 容量 | PASS・提供exit 0。host gzip59,156B、pad34,558B、SDK gzip18,439B/raw60,000B。`final-budgets.log` |
| 供給元 | PASS・提供exit 0。REUSE501/501、当時の現508ファイル/履歴18commitで漏洩0、audit脆弱性0、配布依存MIT1件。各finalログを照合 |
| TODO等 | CLEAN。機能境界へのrgでTBD/TODO/FIXME/HACK/XXXが0件。追加差分も0件。`audit.json` |
| 秘密候補 | CLEAN。password/api_key/secret/token代入名のrg、追加差分の私的パス候補とも0件。`audit.json` |
| Smoke boot | PASS・独立実行exit 0。既存distをstartEdgeで配信し、Chromium実ホスト＋スマホ2面でintro→開始→実時間合図→本人受付→2人発表→次へ有効。pageerrors/console errors 0。`smoke.json`/`smoke.log` |
| 成果物の実体 | 新ゲーム7配布ファイルはソースとSHA一致。smoke前後でdist全51ファイル不変。専用ブラウザ/Workerは停止済み。`smoke-intro.png`を原寸確認 |

全suiteは再実行せず、実行した親からのexit 0記録と生ログを独立監査した。
現在の対象/runner/guardの43ファイルはmutation-audit.jsonと全件SHA一致、変異ログのSHAも一致。
現在の変更コード・試験・生成物59ファイルのSHAを`audit.json`へ記録した。製品コードは正規関門後に変更されていない。
初回`final-e2e.log`は旧棚順のa11y前提で両engineの2件が失敗した。操作数の修正・独立承認後、全体を再実行して上記222件が成功した。初回も新ゲーム31件は成功している。

### INTEGRATION

- Cross-task contracts: PASS。タスク1の共通終了検証を2のSDK/bridgeが共用し、3のconsoleへoptionsを保持。4の純粋判定を5が接続し、6の登録/同期後に7〜10で回帰・独立評価した。
- Shared state consistency: PASS。復帰welcomeはlineup照合→players通知→connected=true。環境のfalse→trueを描画へまとめず通知し、握手前は最新initを保持する。
- pause/resumeはメニュー専用のまま。4種blockerの24解除順でも自動再開せず、新操作IDを現在leaderだけへ渡す。中断試行だけ破棄し確定記録を保持する。
- 旧host: capability欠如は空配列/environment=null。新ゲームは開始を出さず更新案内。SDKは拡張endを送信前に拒否し、省略旧endの送信キーを保持する。
- leader/lineup: 固定参加席と元の名前を保持し、退出/席再利用を次戦待ちにする。gameLeaderは現参加者から選び、旧leader/旧control/旧stop入力を拒否する。
- 結果: 負の整数累計を汎用score順位へ接続し、同点は1・1・3。ranked=falseは順位/優勝から除外、incompleteは全員rank=null。recordは点数を出さず、旧endは従来の点数表示を維持する。
- 秘匿: viewはpublicViewだけを受ける。countingモデルに時刻/停止席/件数/記録がなく、本人padだけ更新。実smokeでも最初の停止前後の共用DOMが同一だった。
- 共有: 既存4入口は固定の公開ホーム案内だけ。行/注記/部屋/名前/記録を渡さない。実Worker E2Eの4入口assertionと共有実装を照合した。

### COVERAGE

41/41基準、7/7領域を原番号で追跡。対応タスクは全て[x]、未カバー0。表の試験は実ログで成功を確認した対象を指す。

| 要件の原番号（件数） | タスクと具体的根拠 |
|---|---|
| 1.1〜1.5（5） | 4.1/5/6/7。createGame/reconcile/padForの人数・固定席・leader・切断待ち、viewの1文説明。logic.testの参加席群、E2E:161/620、独立intro smoke |
| 2.1〜2.7（7） | 4.1/5/7.1/8。updateGameはGO描画frameの単調時計、最初のdownだけ、20,000msを期限優先。publicViewと本人効果を分離。logic.test:163〜334、E2E:207/295、秘匿/旧ID/期限変異 |
| 3.1〜3.7（7） | 1〜5/7。0.1秒整数で丸め/差/累計を共用し、timeoutは実測なし100単位。第3回もreveal、finalResultsの退出除外とrankResultsの同順位。logic.test:358〜549、E2E:264/620 |
| 4.1〜4.5（5） | 3/4.2/5/6/7.1。各回の順位/累計と世代付きnext、3回目発表→拡張end→既存再戦/ホーム/共有。新nonce/現名簿で再戦。logic.test:531の最長84秒、E2E:161の100秒以内と記録初期化 |
| 5.1〜5.8（8） | 1〜5/7.2。reconcileは現試行だけを破棄、オンライン席は名簿に従い独自60秒timerなし。blocker全解除＋手動再試行、人数不足incomplete、発表保持、環境通知順、reload→home。logic.test:564〜807、E2E:431〜752 |
| 6.1〜6.5（5） | 3/5/7.1/10。縦1ボタン、文字合図/結果、SDKの色＋形、reduced-motion静止。E2E:362の48px/Enter/Space/無音無振動/別幅、8人配置試験、23画像とUI18/20を照合 |
| 7.1〜7.4（4） | 2/3/5/6/7.2/9/10。既存参加のみ、ゲームはメモリだけで新権限/保存/解析/広告/課金なし。E2E:781の共有4入口、権利記録、操作文言・source importを確認 |

### DESIGN

- Architecture/Components and Interfaces/Data Models/System Flows: PASS。Logic→公開モデル→View、RuntimeのSDK/時計/効果という設計の分離を維持する。end後の購読/RAF/stateも解放する。
- Boundary Commitments: PASS。10秒/3回/丸め/試行/中断のゲーム固有処理はgames/ten-seconds内。protocol/SDK/bridge/consoleは汎用契約のみでゲーム名・秒数・roundIndexの分岐を持たない。
- Dependency direction: PASS。ゲームは同梱SDKと自分のモジュールのみを読み、LogicにDOM/通信なし。protocol→sdk/host-bridge→webの方向を保ち、上流からゲームをimportしない。
- File Structure Plan: 一致。logic/main/view/画面、end.ts、SDK/bridge/HostAdapter、登録/画像、公開型/配布物、試験/変異はfile-planと契約の範囲内。make-thumbsの変更はintro撮影シーン3行だけ。
- Revalidation Triggers: 実施済み。終了/環境/公開型/順位の追加に対し、host/mock/bridgeの契約試験、既存4本E2E、同期/型/容量を照合した。protocol/codeの遅延初期化とPURE注釈は検証規則を変えない。
- 境界外のWorker/room/room-client/machine/padplan、依存/lockfile、既存4本の独自コードは差分0。既存4本の変更は生成SDKと宣言型のみ。構造の逸脱・隠れた依存0。

### OWNERSHIP

LOCAL（対象機能の統合検証）。具体的な修正対象0。

### UPSTREAM_SPEC

N/A。隣接正本docs/architecture・protocol・sdk・ux・registryとの不整合は見つからない。上流修正を要求する事項0。

### BLOCKED_TASKS

なし。未チェック0、_Blocked_0。Implementation NotesのSDK raw60,000Bには追加余裕がないが現上限内。

### REMEDIATION

必須修正なし。非blocking候補は「今回の順位」の明示、同じ冒頭の長名の省略、結果時の汎用リモコン文言。独立評価の範囲で進行阻害はない。
独立試遊19/20（3勝負/9回）、UI18/20（23画像）を確認。ui-manifestの23画像は現実体と全件SHA一致。
親が最終文書の追記分をcheck/REUSE/source漏洩検査へ含める。物理端末・実回線・OS共有画面・人間の面白さは今回のGOの保証範囲に広げない。

## Verification Result

- STATUS: VERIFIED
- CLAIM_TYPE: FEATURE_GO
- CLAIM: ten-seconds-partyは承認済みの機械・AI受け入れ範囲で統合完了している。
- EVIDENCE: 全suiteの実出力/exit、current SHA照合、独立built smoke、41基準、統合契約、設計境界、blockedなしを照合。
- GAPS: この受け入れ範囲の欠落なし。上記の物理/人間条件は未確認。
- FEATURE_GO: GO
