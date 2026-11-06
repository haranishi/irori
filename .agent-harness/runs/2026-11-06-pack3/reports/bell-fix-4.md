# bell-fix-4：第3周の採点指摘の仕上げ

## 変更と理由
- A：結果の見出しに持ち主の名前を先頭10文字まで入れ、発見・逃げ切りの両方で示す。
- B：結果の持ち主席の枚数の行を「鈴の持ち主」に替える。席を高くせず一覧との重なりを防ぐ。
  鈴と猫、金の枠は維持。守り・非所持・枚数の補足は16px以上にした。
- C：結果へ入るremainingだけを20000msに変更。配札8秒・選択25/30秒などは維持。
  大画面の時間の比率も20秒に合わせ、終了後の案内文は維持。
- D：結果の内訳・指名・得票、進行・履歴を1024幅でも16px以上にした。
  8席の斜めの位置を上下に2ポイントずらし、5席の結果の扇も3px縮め、席間を確保。
  8席の斜めの補足は内側へ12px寄せ、隣席に文字が隠れないようにした。
- E：つかまえるのsubを「指名・外れ−1点」に変更。使用前は従来の周制限を優先。
- F：既存のtiles.hintを使い、選択中だけ25秒／30秒以内という固定の案内を表示。
  1秒後もpadが同じで、再送しないことを試験。note120字・hint40字を維持。
- G：指示を先頭、手札を履歴より先に保ち、当時の記録は新しい順に最大2件。
  全文が入らない古い記録から落とす。内部の観測情報は減らさずCPUの判断は維持。
- H：CSSを宣言ごとに改行、viewを文・引数・意味のまとまりで整形。
- 規則・得点・CPUの強さ・SDKの写し・登録・依存・Gitには変更操作なし。

## 変更したファイル
- games/bell-in-sleeve/logic.js・view.js・style.css
- 同フォルダのlogic.test.js・memory.test.js・sim.test.js・view.test.js・新規fix4.test.js
- packages/protocol/tests/game-end-contract.test.ts（実際のpad検証器による上限確認を追加）
- .kiro/specs/game-pack-3/game-bell-in-sleeve.md（秒数・字サイズ・履歴件数と検証記録）
- この報告。一時の道具・ログ・画像はすべて.probe-tmp/内。

## コマンドと件数
重い処理はnice -n 10付き。優先度の変更自体は環境に拒否された。
- npx vitest run --config vitest.games.config.ts games/bell-in-sleeve --maxWorkers=1
  変更前130件、整形だけの後130件、変更後9ファイル142件すべて成功。
  3〜8人×2000局の終了試験を含む。ログ：.probe-tmp/bell4-all-tests-final.log。
- cd packages/protocol && npx vitest run tests/game-end-contract.test.ts：8件成功。
- npm run typecheck:games：終了0。最終の折り返し後も成功。
- npm run check：7項目成功（登録13件・SDK同期13本）。
  途中の報告リンク未作成による1件失敗は、この報告を作成後に再検査した。
- 末尾の折り返し後のview.test.js・fix4.test.js：20件成功。
- npm run prepare:web、npm run build -w @irori/web：終了0。
- git diff --check（担当ファイル）：終了0。
- python3 .probe-tmp/bell4-mutate.py：8変異すべて赤、finallyで復元・ハッシュ一致。
  A名前削除1件、B印削除1件、C8秒へ戻す2件、E減点削除1件が失敗。
  F時間逆転6件・hint41字6件・note超過7件、G件数制限削除1件が失敗。
  復元後142件成功。内訳：.probe-tmp/bell4-mutations.json、bell4-mut-*.log。

## 画像と動作
- 起動：timeout 3000 env IRORI_DEV_PORT=8830 node tools/dev.mjs（nice付き）。
- .probe-tmp/bell4-browser.mjs：mock=5/1/8は終了・再戦、demo=1は終了・次局へ。
  全4条件pageerror0件。専用のブラウザ文脈はfinallyで全て閉じた。
- 変更前：.probe-tmp/shots-bell4-before/（通常の対戦・結果18枚）。
- 整形の比較：.probe-tmp/shots-bell4-format-before/ と shots-bell4-format-after/。
  時計停止・同じ固定状態18枚のSHA-256が18/18一致。最初の時計割込を除いて撮り直した。
- 最終：.probe-tmp/shots-bell4/（対戦・結果、5席／人1＋CPU／8席×3解像度＝18枚）。
  1280×720・1920×1080・1024×576。見出し・持ち主ラベル・補足・余白を目視確認。
  最小席間9.28px。8席の結果は1280で37.28px、1920で89.66px、1024で19.55px。
  対象の補足文字は全て16px以上、見出し1行、横はみ出し0件。
  実測値：.probe-tmp/bell4-browser-results.json。
- 長い名前30字の固定結果も5席・8席×3解像度＝6枚で見出し1行を確認。
  .probe-tmp/shots-bell4-long/。ブラウザ文脈は全て閉じた。

## 残件・メインへの連絡
- コンソール側の課題：結果後のスマホの「ゲームを選んで、［決定］…」は担当外のため未変更。
- 放置時の待ち：時間切れの上限は規則を変えない依頼のため維持（結果だけ20秒）。
- 過去の履歴の別表示：共有の操作盤の変更が要るため未実装。今回の範囲では最新2件に絞る。
- 実機・人どうしの会話・WebKit・独立再採点は未確認。今回の目視は自己確認。
- 開発サーバーの停止は環境に拒否された。PGID 66811（timeout・dev）、66911（ビルド）、66912（配信）
  すべてへのSIGTERMがOperation not permitted。配信PID 66929は8830・8831で待受が残る。
  メイン側で上記グループの停止をお願いします。timeoutは3000秒。8787には触れていない。
  記録：.probe-tmp/bell4-stop.json。機能・仕様についての質問はなし。
