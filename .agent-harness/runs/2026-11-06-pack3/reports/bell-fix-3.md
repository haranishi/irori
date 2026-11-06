# bell-fix-3：採点第2周の指摘への修正

## 状態
- 指摘1〜10を実装。単体130件・契約7件・型・通常配信4条件を確認。
- 全体検査は最終再実行で7項目すべて成功。開発サーバーの停止拒否だけが残る（末尾）。

## 指摘ごとの対応
1. 手がかりの短縮名はCPUがC番号、人は先頭3文字。衝突時は席順番号を足して一意にする。
   人2〜8＋CPU・同名・CPU風の人名・短縮後の衝突、CPU1/3の実際の要約を試験。
2. CPUありのendは人だけ・4項目だけを維持し、ranked:false・N位(CPUこみ)。
   人だけの局・勝負なしは従来どおり。ゲーム内はCPUを含む順位を維持。
3. 守り札のsub「つかまえるを防ぐ」、一斉指名noteに「守りは、一斉指名には効きません」。
   大画面は「つかまえる除け」。README・設計にも適用範囲を明記。
4. 外れ直後の本人noteに「外れました −1点」、出来事に指名者・外れ・減点を表示。
   対象がいま持っていない旨も保持する。
5. 人1人の話し合いは10秒、画面にCPUが話さない理由を表示。人2人以上は45秒。
   押せない手札＋「指名へ進む」。人全員の同意で早期終了し、CPUの同意は求めない。
   10秒境界・45秒・全員の同意・重複拒否・同時操作のtoken維持を試験。
6. 8席の左右斜めの席を外側の上下へずらし、角の重なりを解消。
   全枠の最短距離は1280の対戦37.27px/結果37.92px、1024は対戦31.92px/結果23.25px。
7. 結果の内訳・指名・得票は14px以上。1024・1280で14px、1920で19pxを実測。
8. 結果一覧の列数を人数の半分の切り上げにし、5人は3＋2、6人は3＋3。
9. 結果後は「あと◯秒で、『もう一度／ホームへ』の画面へ」と行き先を明記。
10. 猫と鈴は出現時も透明度を下げず、移動だけで表示。最終画像でも明るいことを確認。
    8席の上中央の守り印も下へ移し、隣席の枠との重なりを解消。

## 変更したファイル
- games/bell-in-sleeve/logic.js・view.js・style.css・README.md
- 同フォルダのmemory.test.js・view.test.js・新規fix3.test.js
- packages/protocol/tests/game-end-contract.test.ts
- .kiro/specs/game-pack-3/game-bell-in-sleeve.md、この報告。
- 生成SDKの手編集・依存追加・Gitの変更操作はなし。

## コマンドと結果
重い処理にはnice -n 10を付けたが、優先度変更は環境に拒否された。
- npx vitest run --config vitest.games.config.ts games/bell-in-sleeve --maxWorkers=1：8ファイル130件成功。
  従来の3〜8人×2000局の終了試験を含む。旧文言の期待値2件を更新して再実行した結果。
- cd packages/protocol && npx vitest run tests/game-end-contract.test.ts：7件成功。
- python3 .probe-tmp/bell3-mutate.py：rankedの規則、CPUこみのlabelを別々に外すと各2件失敗。
  finallyで復元しSHA-256一致。復元後の契約7件も成功。
- npm run typecheck:games：終了0。git diff --check（担当範囲）：終了0。
- 最終CSS変更後のview.test.js：8件成功。
- npm run prepare:web、npm run build -w @irori/web：終了0（Webは70モジュール）。
- npm run check：最終実行で7項目すべて成功（登録12件・SDK同期13本）。
- nice -n 10 node .probe-tmp/bell3-browser.mjs：通常配信でmock=5/1/8が終了・再戦へ。
  demo=1も終了・次局へ。全4条件のpageerrorは0件。
  初回撮影は旧配信物を検出し再ビルド。途中の操作競合を避けて再撮影した最終結果。
- .probe-tmp/shots-bell3/：対戦・結果を各3条件×3解像度、18枚。
  1280×720・1920×1080・1024×576。5席・8席・CPU結果を目視確認。
- ブラウザの測定結果：.probe-tmp/bell3-browser-results.json。

## 未確認・メインへの連絡
- npm run checkは他担当の一時検証コピー・一時E2E報告・変換キャッシュを走査して失敗した。
  切り分け時の最後の権利1件も一時変換キャッシュ内だけ。最終実行では消えて全項目成功。
  一時領域以外の文書・権利の問題も0件。ほかの担当の一時ファイルには触れていない。
- 開発サーバーはPID 48291（timeoutのグループ）、ポート8830。
  グループ・個別のSIGTERMとも権限が拒否。メイン側でグループ停止をお願いします。
  timeout 2700付きで起動済み。8787には触れていない。専用ブラウザ文脈は全て閉じた。
- 実機・人どうしの会話・WebKitは未確認。3周目の再採点は実施していない。
