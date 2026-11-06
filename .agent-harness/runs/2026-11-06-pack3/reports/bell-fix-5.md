# bell-fix-5：最小画面の文字の重なり

## 変更
- 製品の変更は games/bell-in-sleeve/style.css の11行のみ。
- 幅1024px以下・高さ620px以下の8席に限定。
- 結果の「出された札」を20px下げ、守りの印と分離。
- 対戦中の進行補足の字間を1px詰め、「いまの番」と分離。
- 見出し・補足は省略せず、文言・文字サイズ・規則・得点・CPUは維持。
- view.js・試験・所有外のソース・依存・Gitの変更操作なし。

## 画像と測定
- .probe-tmp/bell5-browser.mjs：接続先のChromiumを利用し、固定状態で比較。
- 5席／人1＋CPU／8席 × 対戦中／結果 × 3解像度の18通り。
- 修正前 .probe-tmp/shots-bell5-before/、修正後 .probe-tmp/shots-bell5/ に各18枚。
- 重なりは前2件 → 後0件。指定の8席・1024の2件を再現・解消。
- 見出し・補足・名前・枚数・各印・手番札・持ち主・内訳・履歴を測定。
- ブロックの空白や親子の包含は除外。文字列の外接矩形と疑似要素の札の矩形で比較。
- 対象の間隔：補足と手番札3.05px、守りの印と見出し8.89px。
- ほか16枚のSHA-256が16/16一致。文字・席の最小間隔も16/16不変。
- 修正後の8席・1024の対戦中／結果の2枚は自分で画像を開いて確認。
- 詳細は各画像フォルダの measurements.json と .probe-tmp/bell5-comparison.json。

## コマンドと結果
- nice -n 10 を付けたが、優先度の変更自体は環境に拒否された。
- npx vitest run --config vitest.games.config.ts games/bell-in-sleeve --maxWorkers=2：9ファイル142件成功。
- cd packages/protocol && npx vitest run tests/game-end-contract.test.ts：8件成功。
- npm run typecheck:games：終了0。
- npm run check：7項目成功（登録13件、SDK同期13本）。
- npm run prepare:web、npm run build -w @irori/web：終了0。
- git diff --check -- games/bell-in-sleeve/style.css：終了0。
- ログは .probe-tmp/bell5-{tests,contract,typecheck,check,prepare,build}.log。

## 停止・未確認・メインへの連絡
- timeout 3000 env IRORI_DEV_PORT=8836 node tools/dev.mjs で起動。8787には触れていない。
- 専用ブラウザ文脈はfinallyで全て閉じた。実機・WebKit・独立レビューは未実施。
- サーバーのPGID 85254（timeout・dev）、85444（ビルド）、85445（配信）へSIGTERMを試行。
- 全てOperation not permittedで停止できず、workerd PID 85479が8836・8837で待受中。
- メイン側で上記グループの停止をお願いします。記録は .probe-tmp/bell5-stop.json。
- 仕様への証拠の追記は所有外のため未実施。この報告を参照してください。ほかの質問なし。
