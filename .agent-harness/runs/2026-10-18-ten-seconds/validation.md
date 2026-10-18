# せーので10秒：全体の検証記録

2026-10-18。個別タスク1〜8は実装担当と別の読み取り担当が確認し、APPROVED。
ここでは新旧ゲームを合わせた全体の検証を、承認済み[tasks](../../../.kiro/specs/ten-seconds-party/tasks.md)の順で行う。
実行ログと画像は外部の一時実行領域へ保存し、下表には実際の結果を残す。

| 順序 | コマンド・対象 | 結果 |
|---|---|---|
| 1 | `npm run typecheck` | PASS、exit 0。8 workspacesとゲーム3モジュール |
| 2 | `npm test` | PASS、exit 0。1,180件（実Worker72・tools54・ゲーム196を含む） |
| 3 | `npm test -w @irori/edge`（単体後の実Worker再検査） | PASS、exit 0。72件・8ファイル |
| 4 | `npm run build` | PASS、exit 0。5本・画像5枚・ゲーム32ファイル、SDK 60,000B |
| 5 | `npm run test:e2e` | 再実行PASS、exit 0。126＋27＋69＝222成功、任意撮影66は既定skip、失敗0 |
| 6 | `npm run check` | PASS、exit 0。文書・権利・依存・5件の登録・5本のSDK同期 |
| 7 | `npm run mutations` | PASS、exit 0。164/164 KILLED、検出漏れ・基準不良・強制timeout 0 |
| 8 | `npm run budgets` | PASS、exit 0。host gzip 59,156B、pad 34,558B、SDK 18,439B/raw 60,000B |
| 9 | REUSE、gitleaks、npm audit、依存ライセンス | 全PASS、exit 0。501/501表示、現508ファイルと履歴18commitで漏洩0、脆弱性0、MIT依存1件 |

## 以降の受け入れ
上記の全関門は成功。別担当の[実操作](experience.md)は19/20、[UI評価](ui-review.md)は18/20で合格。
実操作は5分36秒で3勝負・9回を完了。UIは23枚を原寸確認。
別担当の[最終統合検証](feature-validation.md)はGO、completionはVERIFIED。41/41基準・7/7領域、統合契約・境界・依存方向・blockedなしを確認した。
ビルド済み成果物の専用Worker＋実ホスト・スマホ2画面で、開始・合図・停止・一斉発表まで成功。画面例外とconsole errorは0。[起動の証拠](smoke.json)、[ソース照合](audit.json)。
物理端末、実回線、OS共有画面、人間による飲み会の面白さは、機械試験やAI評価から確定しない。

## 全体試験1回目の補正
既存a11yのホスト画面試験が、旧棚順の右1回でhello-padを選ぶ前提だった。新順序ではdot-grabを開き、存在しないendを探して両engineで失敗。
選択の移動数だけを直し、axe・各画面・フォーカスの検査を維持して独立レビューと再実行を行う。新ゲームの31実行は初回も全成功。
右操作1回とhello-padの明示assertionを追加。元担当と別担当のa11y全9実行・厳格TSが成功し、再レビューAPPROVED。
全体再実行で126・27・69件すべて成功。66件は既存 `shots.e2e.ts` の任意撮影で、`IRORI_PAD_SHOTS=1` のときだけ実行される。

## 変異の照合
全164 IDの重複・欠落なし、全件が正常終了コード1で失敗し、guard時間切れはなかった。
実行前後で対象とrunner/guardの43ファイルが同一。[照合記録](mutation-audit.json)にID・ハッシュを残した。

## 最終記録の再検査
文書追記後の漏洩検査で、監査JSONの `api-match.ts` をキーにしたSHA-256値がgeneric-api-keyへ1件誤検出された。
実ファイルの再計算でハッシュ一致を確認。59件の照合値をfile/sha256の配列へ表現し直した。検査の除外・規則緩和は追加していない。
再実行は全exit 0。`npm run check`成功、REUSEは507/507、現514ファイルのgitleaksは漏洩0。LANのホーム・2人プレビュー・healthもHTTP 200を確認した。
