# ライセンスは3層に分け、貢献は署名つきで受け取る

コード、文書と画像、設定と登録情報で、ライセンスを分けた。同じ構成は、保守者の別のOSS（kamoku）と揃えている。ファイルごとの表示は [`REUSE.toml`](../../REUSE.toml) にまとめ、CIの `reuse lint` で、すべてのファイルが覆われているかを確かめている。

## 層ごとのライセンス

| 層 | ライセンス | 対象 |
|---|---|---|
| コード | MIT OR Apache-2.0（選べる） | TypeScript、同梱ゲーム、道具、CIの設定 |
| 文書と自作の画像 | CC BY 4.0 | `docs/`、READMEなど、ハーネスの記録、ロゴ・OGP・サムネイル |
| 設定と登録情報 | CC0 1.0 | `package.json`、`tsconfig`、`wrangler.jsonc`、`registry/games/`、スキーマ、Issueのひな形 |

登録情報をCC0にしたのは、誰でも棚の一覧を再利用してよいから。登録情報の中の `license` 欄は、**ゲーム本体**のライセンスで、この表とは別のもの。

## 貢献の受け取り方

コミットに `Signed-off-by` を付けてもらう（`git commit -s`。意味は [Developer Certificate of Origin](https://developercertificate.org/)）。貢献は、コードを MIT OR Apache-2.0、文書を CC BY 4.0 として受け取る。著作権者の表記は「Ikki Nishihara and the irori contributors」。貢献者に、著作権の譲渡や、別の契約への署名は求めない。

## 同梱するもの、しないもの

- **同梱するゲーム**は、MIT・Apache-2.0・CC0のどれかに合うものだけ。素材は自作か、CC0・CC BYの表記が守れるもの。copyleft（GPL・AGPL・CC BY-SA）の素材は、この構成のライセンス表示と混ぜないために入れない。
- **外部のゲーム**は、登録情報にライセンスを書いてもらう。ソース非公開の無料ゲームは `LicenseRef-closed`。リンクして動かすだけで、このリポジトリには入れない。
- **依存**は、配布物に入るものを、MIT・ISC・Apache-2.0・BSDなどの許可の一覧に限る（`tools/check-licenses.mjs`）。いまは、QRコードの生成が1つだけ（MIT）。ほかに、BudouX（Google・Apache-2.0）の日本語モデルの値を、帰属表示つきで `apps/web/src/shared/phrase-model-ja.ts` に写している。依存にしなかったのは、使わない部品（CLI・HTML処理）の依存まで入るため。
- **音声と書体のファイル**は入れない。音は合成し、書体はOSのものを使う。外部のドメインから読み込むものも入れない（[identity.md](../identity.md)）。
- **AIが作った素材**（画像・文章）は、人の創作と認められる関与がないと、著作物にならない場合がある。そのため、画像は、コードで描く・画面から撮るものだけにしている。画像の生成AIによる素材は、現時点で入れていない。

## 名前とロゴ

「irori」と、ロゴ（SVG）に、登録商標はない。名称の商標の調査（J-PlatPat）は、保守者の作業として残っている（[rights-check.md](rights-check.md)）。改作を妨げる意図はないが、他人の商品と紛らわしい使い方は、避けてほしい。

## 限界

個別の権利関係は、資料の比較だけでは決められない。ここに書いた判断は、弁護士の確認を受けていない。
