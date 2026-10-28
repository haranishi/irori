# 文書の入口：誰が何のために読むかで選ぶ

全部を読む必要はない。どの文書も100行以内で、コードを読めば分かることは書いていない。「なぜそうしたか」と「何を捨てたか」が中身。

## 遊ぶ人・試す人

[README.ja.md](../README.ja.md) の「3分で試す」だけで足りる。傾きのセンサーを使うときは [operate.md](operate.md)。

## ゲームを作る人

1. [sdk.md](sdk.md)：短いコード例と呼び出し、作るときの決まり。
2. [pad.md](pad.md)：スマホの画面の7種と、使い分け。
3. [registry.md](registry.md)：棚に並べるためのPRと、審査の基準。

## 運営する人

1. [operate.md](operate.md)：動かし方、費用の上限、栓、運用の注意。
2. [deploy.md](deploy.md)：Cloudflareへの公開、CDの初期設定・有効化・停止、失敗時の復旧。
3. [security.md](security.md)：誰を信用しないか、設計上防げないもの。
4. [legal/operator-notes.md](legal/operator-notes.md)：公開して運営するときの、法令の宿題6つ。
5. [legal/data-handling.md](legal/data-handling.md)：扱う情報の一覧（プライバシーの説明の元）。

## 貢献する人・設計を知りたい人

1. [philosophy.md](philosophy.md)：何を大切にして、何を作らないか。
2. [architecture.md](architecture.md)：部品と依存の向き、守る性質。
3. [protocol.md](protocol.md)：通信の取り決め。型と上限値の正本は `packages/protocol`。
4. [ux.md](ux.md)：ユーザーストーリーとUX5階層、通したことで変わった実装。
5. [identity.md](identity.md)：見た目と音の決まり。
6. [decisions/](decisions/)：判断の記録（ADR）8本。捨てた案と、見直す条件。
7. [research/](research/)：先行例、端末とCloudflareの制約、参考にしたサイトの観察。
8. [legal/](legal/)：権利の確認の記録、参考サイトの扱い、ライセンスの方針。
9. [known-issues.md](known-issues.md)：実際に遊んで見つけた問題と、まだ確かめていないこと。直したい人の入口。
10. [せーので10秒の詳細設計](../.kiro/specs/ten-seconds-party/design.md)：追加ゲームの仕様。実装済み。[検証記録](../.agent-harness/runs/2026-10-18-ten-seconds/validation.md)に全体試験・独立評価と未確認条件を記載。

進め方の約束（AIと一緒に作るときの役割と完了の判定）は [HARNESS.md](../HARNESS.md)、貢献の入口は [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 翻訳

文書は、日本語を先に書く。英語への翻訳を歓迎する。`docs/en/` に、同じファイル名で置く（README は、ルートに英語版がある）。
