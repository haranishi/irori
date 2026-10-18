# CIで検証したmainをCloudflareへ公開できるようにする

## 導入前の状態と課題

保守者は、変更を検証して公開する作業を自動化したい。現在はGitHub ActionsのCIと手動デプロイだけがあり、CDのワークフロー、公開用のEnvironment、Actionsの変数・シークレットは未設定。
2026-10-18に確認したmainのCIは成功している。直近の全体実行は約75分で、CDも変異試験の完了を待つ。既存の運用文書では公開デモは未導入。

## 承認済みの範囲

Cloudflare WorkersへのCD、公開前のdry-run、導入・停止・復旧手順を追加する。整理はCI/CDの設定、実行コマンド、運用文書に絞る。
ゲーム・通信・画面、依存の更新、独自ドメイン、PR用プレビューは対象外。

## Boundary Candidates

- 公開する条件と認証の管理。
- 既存のビルドとWorker設定の検証。
- 保守者向けの導入・復旧手順。

## 比較した方法

| 方法 | 既存CIとの関係 | 判断 |
|---|---|---|
| GitHub Actionsから公開 | CI全体の成功を公開条件にできる | 採用。既存の検証を維持できる |
| Cloudflare側のGit連携 | GitHubのCIとは別にビルド・公開が進む | 今回は採らない。公開条件の管理が分散する |

## 既存仕様との関係

配信先と運用上の制約は[operate.md](../../../docs/operate.md)、ビルドと配信の境界は[architecture.md](../../../docs/architecture.md)を引き継ぐ。
ゲーム追加の`ten-seconds-party`仕様とは独立する。

## 承認の境界

要件は[requirements.md](requirements.md)で確認する。保守者が要件・設計・タスク整理・実装・検証と、commit・push・PR作成・マージを承認した。
Cloudflareの認証情報登録・CDの有効化・初回公開は別の運用作業として扱う。
