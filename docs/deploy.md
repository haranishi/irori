# Cloudflareへの公開：CIの成功後に自動で配信する

Cloudflareで運営する保守者向けの手順。リポジトリの設定権限と、公開先のCloudflareアカウントが要る。初回は「初期設定」と「公開の条件」を読み、停止・復旧は必要なときに参照する。費用と接続への影響は [operate.md](operate.md) で先に確認する。

CDは既定で無効。利用するには以下の初期設定が必要。公開デモはまだない。

## 初期設定はproductionに認証を登録し、Repository variableで有効にする

1. GitHubのリポジトリで Settings → Environments → New environment を開き、`production` を作る。
2. `production` の Deployment branches and tags で Selected branches and tags を選ぶ。Branch の `main` だけを許すルールを追加する。設定画面の詳細は [GitHub公式手順](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) を参照。
3. Cloudflareで、対象アカウントとWorkerの公開に必要な権限・リソース範囲を選んだAPI tokenを作る。[公式のtoken作成手順](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) に従い、対象外のアカウントへの権限を広げない。
4. 次の2つを `production` の Environment secrets に登録する。値はファイルやログに書かない。

| secret名 | 登録する値 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 公開用API token |
| `CLOUDFLARE_ACCOUNT_ID` | 公開先アカウントのID |

5. Settings → Secrets and variables → Actions → Variables の Repository variables に、`CD_ENABLED` を値 `true` で登録する。Environment variableには置かない。

`CD_ENABLED` が未設定か `true` 以外ならCDは省略され、既存CIの成功判定に影響しない。有効なのに認証が不足していれば、CDは不足したsecret名を示して公開前に失敗する。

## 公開にはmainへのpushとCI全体の成功が要る

有効化した後、`main` へpushするか、過去の `main` へのpushで始まった `ci` を再実行する。`cd` は別のワークフローで、元の `ci` の終了を受けて動く。ビルドだけでなく変異試験を含む全ジョブの成功を待つため、CIの所要時間の目安は約75分。

- 対象は、同じリポジトリの `main` へのpushによる `ci` が成功した場合だけ。失敗・中断、PR、定期実行、手動実行のCIでは公開しない。
- 検証されたコミットをcheckoutし、公開用の認証を渡さずに依存の導入・ビルド・dry-runを行う。認証を使うのは最後の公開stepだけ。
- 公開直前に `main` の先頭と照合する。古くなったコミットは省略し、先頭を取得できなければ失敗する。照合後に始めた公開は、後続pushで中断しない。
- 公開は `cd-production` で同時に1件に制限する。`cancel-in-progress: false` により、後続runが来ても実行中の公開を中断しない。

## 失敗したら原因を直し、元のpush CIを再実行する

GitHubの Actions → `cd` で失敗したstepを確認する。認証不足なら `production` のsecrets、ビルド・dry-runの失敗なら元の変更を直す。新しいコミットが必要なら `main` へのpushで検証し直す。同じコミットで再試行するなら、元のpushによる `ci` を Re-run all jobs する。手動の Run workflow で起動したCIは公開対象にならない。

公開が省略された場合は `CD_ENABLED`、元CIの実行理由、`main` の先頭を確認する。先頭が進んでいれば、最新のpushのCI成功を待つ。

## 停止するときはCD_ENABLEDをfalseにし、残るrunも確認する

Repository variableの `CD_ENABLED` を `false` にする。変数変更は、すでに待機中・実行中のjobには遡って適用されない。Actionsの `cd` 一覧で残るrunを確認し、必要なら Cancel workflow で取り消す。取り消しても、Cloudflareに反映済みの公開は元に戻らない。

## 復旧はCDを停止してから、正常だったversionへ戻す

まず上の手順でCDを止め、待機中・実行中の公開を確認する。リポジトリのルートで、公開先の認証を使って既存Wranglerを実行する。

```sh
npm exec -w @irori/edge -- wrangler deployments list
npm exec -w @irori/edge -- wrangler rollback VERSION_ID
```

`VERSION_ID` は、一覧から選んだ正常な版のIDに置き換える。rollbackは接続先のリソースや保存データを戻さない。Durable Objectのクラスの作成・削除などのlifecycle migrationをまたぐrollbackもできない。データ構造との互換性を確かめてから戻す（[Cloudflare公式の制約](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)）。

デプロイ時は接続が一度切れる。部屋と席は保存され、スマホが再接続する点は [運用の注意](operate.md#運用の注意) を参照。復旧後は原因を修正した `main` を検証し、`CD_ENABLED=true` に戻してpushまたは元のpush CIを再実行する。

## 手元でもビルド込みで検証・公開できる

Node 24以上を用意し、リポジトリのルートで実行する。dry-runは配信物を作り、外部へ公開せずにWorkerのバンドルを検証する。

```sh
npm ci
npm run deploy:dry-run
```

手動で公開する場合は、先に公開先へログインする。`npm run deploy` は最新のソースをビルドしてから公開する。

```sh
npm exec -w @irori/edge -- wrangler login
npm run deploy
```

用語：CIは変更の自動検証、CDは検証後の自動公開。EnvironmentはGitHubで公開先の認証・保護ルールをまとめる設定、dry-runは公開を伴わない検証、rollbackは以前の版への切り替え。
手順で解決しない場合は [貢献の案内](../CONTRIBUTING.md) を参照し、secret値を含めずに失敗したrunとstepを報告する。
