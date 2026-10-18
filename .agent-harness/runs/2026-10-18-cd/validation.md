# CD導入のローカル検証記録

2026-10-18に、承認済みの[要件](../../../.kiro/specs/continuous-deployment/requirements.md)と[設計](../../../.kiro/specs/continuous-deployment/design.md)に沿って検証した。ローカルの設定追加と検証は完了。外部での有効化・公開は未実施。

## 実行した検査はすべて成功

| 検査 | 結果（終了コードはすべて0） |
|---|---|
| `npm run typecheck` | 全workspaceとゲームの型検査に成功 |
| `npm test` | 単体・実Worker結合・ツール・ゲーム、計1,180件成功、失敗0件 |
| `npm run check` | 文書、権利、依存の向き、ライセンス、登録5件、SDK同期が成功 |
| `npm run deploy:dry-run` | Cloudflareの2認証変数を外して成功。静的ファイル62件、Worker 57.47 KiB、gzip 17.20 KiB |
| `npm run smoke:dev` | ローカルWorker起動後、画面・登録一覧・ゲーム・SDK・ライセンスの配信を確認 |
| `node tools/check-budgets.mjs --dir apps/web/dist` | ホスト59,156 B、スマホ34,558 B（gzip）、SDK本体60,000 B。すべて上限内 |
| actionlint 1.7.12（CI・CD両ファイル）、`bash -n` | 構文と式の検査に成功 |
| `git diff --check` | 問題なし |

テスト件数の内訳はedge 72、web 206、host-bridge 140、pad-ui 34、protocol 238、room 66、room-client 40、SDK 134、tools 54、games 196。
公開前の検証は、ビルド済みの出力だけを信頼せず、ルートの新しいコマンドでソースから作り直して確認した。

## 公開条件とシェルの実行を直接確認

実際の`cd.yml`を読み、GitHub公式の式評価器`@actions/expressions` 0.3.61で14ケースを検査した。検証用ツールは隔離した一時領域に置き、リポジトリの依存は追加していない。

- 有効なmainのpushは許可。
- 有効化の未設定・false、CIの失敗・中断・省略、PR・PR target・定期・手動実行は拒否。
- 別ブランチ・別リポジトリ、repositoryの欠落、空のrunも拒否。

実際の先頭照合・公開stepも、GitHub CLIとnpmを検証用に置き換えて7ケース実行した。一致時の公開、古いSHAの省略、API失敗での停止、token不足、account不足、両方不足、公開コマンドのエラー伝播がすべて期待どおりだった。
公開コマンドの引数に検証対象SHAが渡り、検証用の認証値がログに出ないことも確認した。本番の認証情報は使っていない。
提出前には隔離したワークフローのコピーで、実行理由・古いSHA・token不足の守りを1つずつ外した。3件すべてで検証が失敗し、元のワークフローでは21ケースが成功することを確かめた。

## 独立レビューと要件の対応

- タスク案：`cd_task_review`がPASS。
- 設定と公開前検証：`cd_code_review`がAPPROVED。実diff・未追跡ファイルを読み、構文検査と上記21ケースを再実行した。
- 運用文書：`cd_docs_review`がAPPROVED。実装との整合、文書検査、Wranglerのコマンドと公式の運用上の制約を確認した。

1.1, 1.2, 2.1は条件の14ケース、1.3, 2.2, 3.2はシェルの7ケースで確認。1.4, 2.3, 2.4はconcurrency・認証のstep限定・権限・checkoutのレビューで確認した。
3.1, 3.3は新しいルートコマンドのdry-runと既存CIへの接続、4.1, 4.2は[運用手順](../../../docs/deploy.md)との照合、4.3はこの記録で対応する。
日本語文書はクイックlintと通読を実施した。要件・設計の短い説明に対するリズム警告は、仕様の定型形式を保つため残した。既存本文と英語READMEの統計警告は今回の追記と分けて確認した。

## ローカル検証と外部での検証を区別する

この記録はローカルで実行した検証の結果。GitHubでの最新の検証状況は[CIの実行履歴](https://github.com/haranishi/irori/actions/workflows/ci.yml)を参照する。Cloudflareの認証情報登録・有効化・本番公開・実環境でのrollbackは、このローカル検証には含めていない。CDは既定で無効。
有効化には`production`の2つのsecrets、mainの公開許可、repository variableの`CD_ENABLED=true`が要る。手順は[deploy.md](../../../docs/deploy.md)にまとめた。
ゲーム・画面・通信の実装と依存は変更していない。今回のローカル検証では全ブラウザE2Eと全変異試験を再実行せず、GitHubの既存CIではこれらを含む全ジョブの成功を公開条件として維持した。
