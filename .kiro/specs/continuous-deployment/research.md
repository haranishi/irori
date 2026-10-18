# CD導入で確認した制約と採用理由

## 導入前に確認した状態

導入調査時（2026-10-18）、GitHubには`ci`とDependabotだけがあり、Actionsのsecrets・variables・Environmentは未設定。mainのコミット`fc6921053af1a5b6c1b9b24b950c45fce21fb184`に対する[CI](https://github.com/haranishi/irori/actions/runs/39114624823)は全7ジョブ成功した。実行時間は約75分で、変異試験の完了を待つ。
公開デモは既存文書で未導入。配信先はWorkerと静的ファイルの一体配信、状態はSQLite型のDurable Objects。既存設定と公開用workspaceを再利用する。

## 公式資料で確認したこと

- [Cloudflareの外部CI/CD](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)は、API tokenとaccount IDによるWranglerの実行を案内している。両方をGitHub Environment secretsで管理する。
- [GitHubのworkflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)は、成功以外の完了でも起動し、権限とsecretsを持てる。元のevent、結果、repository、branchを明示的に絞る。元runの`head_sha`を使い、PRからのartifactを実行しない。
- [Wranglerのdeploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/)の`--dry-run`は公開せずにバンドルを検証する。インストール済み4.151.0のhelpでも確認した。
- [ロールバック](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)は保存データを戻さない。DO migrationを含む変更には制約があるため、コマンドだけで無条件に戻せるとは案内しない。

## Design Decisions

公開条件・認証・直列化はGitHub Actionsの標準機能で足りる。独自の判定サービスや新しい依存は追加しない。公開前にmainの先頭を照合する小さなstepだけを置く。
CI内に公開jobを足す案は採らない。既存CIのconcurrencyによる中断を公開から分けるため、`workflow_run`を使う。Cloudflare側のGit連携も、公開条件がGitHubのCIから分離するため今回は使わない。
CDは既定で無効にし、検証済みSHAを改めてビルドする。CIのartifactを受け渡すためだけのActionsや、artifactの信頼性検証を増やす必要がない。

## 手順と検証の扱い

cc-sddの承認記録、cloudflare・wranglerの公式資料優先、natural-japaneseのクイック工程を適用する。共有の仕様テンプレートを参考にし、未導入の`.kiro/settings`一式は追加しない。
保守者が設計・タスク整理・実装・検証と、commit・push・PR作成・マージを承認した。Cloudflareの認証設定と初回公開は別途行う。
