# 担当B・改善第1周：bell-fix-2

## 状態
- 指摘1〜10を実装。機械検証・通常配信のブラウザ確認・3解像度の撮影を実施。
- 開発サーバーの停止だけは権限に拒否された。PID 32880の停止をメインへ依頼。

## 指摘ごとの対応
1. `logic.js` の `memoryNote` で、本人の手札・手がかりを常時表示。新着の数秒通知も維持。
   最新の事実は相手名6文字、古い事実は3文字に短縮し、新しい順に全文が入る分だけ120文字以内で残す。
   一枚を見ただけで「その人は鈴を持っていない」と断定せず、見た札・渡した札を「当時」と記す。
2. 話し合いは手札を見るだけのtiles。一斉指名にも押せない手札を追加。停止中・結果も要約を保持。
3. 札の効果を指定のsubで表示。使えない指名札は従来の使用開始周を優先。
4. `publicView.results` に投票先・得票数・投票者・得点理由と増減を追加し、結果の各行へ表示。
   得点そのものとendRowsは変更せず、endは人の席・p/score/label/rankedの4項目を維持。
5. 全員の消化手数から周と残り手を算出。スマホnoteと大画面の上部に表示。
6. 猫・鈴を席の札の領域へ移し、名前・枚数との重なりを解消。8席の結果は伏せ札を小さくする。
7. 中央の札を傾けず、隙間を空けて並べ、名前を見せる。
8. 中央の位置と結果時の高さを調整。上中央の席と見出しの間隔を実ブラウザで測定。
9. 1024×576でも枚数・説明・ログ・得点内訳を13px以上にする。
10. 結果の時計を「あと◯秒で、次の画面へ」にする。再戦ボタンから説明へ戻ることも確認。

## 変更したファイル
- `games/bell-in-sleeve/logic.js`・`logic.test.js`・新規`memory.test.js`
- `games/bell-in-sleeve/view.js`・`view.test.js`・`style.css`
- `.kiro/specs/game-pack-3/game-bell-in-sleeve.md` のスマホ・大画面・結果の説明、この報告。
- 登録情報・サムネイル・生成SDK・他担当のソースは手編集していない。Git操作・依存追加なし。

## コマンドと結果
重いコマンドにはnice -n 10を付けたが、優先度変更は環境が拒否。試験は1ワーカーで実行。
- `npx vitest run --config vitest.games.config.ts games/bell-in-sleeve --maxWorkers=1`：最終7ファイル126件成功。
- 上記には追加8件を含む。各効果の記憶、長さ・順序、話し合い・投票・停止・結果、札効果、進行、内訳の数字を検証。
- 従来の3〜8人×2000局も全て終了。初回は「本人の手札を変更しても本人noteは同じ」という旧試験が失敗し、新要件に合わせて修正。
- `cd packages/protocol && npx vitest run tests/game-end-contract.test.ts`：1ファイル7件成功。
- `npm run typecheck:games`：終了0。`npm run check`：7項目成功（登録12件・SDK同期12本）。
- `npm run prepare:web`：成功。`npm run build -w @irori/web`：成功（70モジュール）。
- `python3 .probe-tmp/bell2-mutate.py`：120文字の防御を外すと対象1件失敗。復元後SHA-256一致、全126件成功。
- `node .probe-tmp/bell2-browser.mjs`：mock=5・mock=1が終了、8秒後に結果受付、再戦でintroへ。demoも終了・次局へ。pageerror各0件。
- `node .probe-tmp/bell2-eight.mjs`：mock=8も終了・再戦。結果を3解像度で撮影。
- `node .probe-tmp/bell2-privacy.mjs`：5席・48入力・280件のpad表示を本人用の判定と照合し一致。
- `node .probe-tmp/bell2-privacy-peek.mjs`：51入力・305件一致。のぞき見・交換・見せ合い、話し合い・投票を含む。
- 上の秘匿確認では全席の札名とnote全文を照合。結果前の大画面に持ち主の鈴・猫がないことも検査。
- `node .probe-tmp/bell2-layout.mjs`：5席と8席の対戦画面、3解像度で間隔16px以上を検査。
- `git diff --check`：担当の差分に問題なし。

## ブラウザと証拠
- 9333へconnectし専用contextを使用、全て閉じた。確認URLは8830のmock=5・mock=1・mock=8・demo=1。
- 通常の静的配信で確認。最初はwatchビルドが古いゲームを返したため、明示的なWebビルドで更新し撮影し直した。
- `.probe-tmp/shots-bell2/` に1280×720・1920×1080・1024×576の対戦・結果画像。各解像度を自分で閲覧。
- 測定値と結果：`.probe-tmp/bell2-layout.json`・`bell2-browser-results.json`・`bell2-eight-results.json`。
- 結果画面も全サイズ16px以上をブラウザで要求。5席は23px以上、8席も16px以上。
- 試験・ビルドの出力は `.probe-tmp/bell2-*.log`。新しいファイルはサーバー起動前に追加済み。

## 未確認・メインへの引き継ぎ
- 8830の起動PID 32880。SIGTERMをプロセスグループ・PIDそれぞれへ試したがEPERM。停止済みとは扱わない。
- メインでPID 32880とその子のプロセスグループを停止してください。8787など他担当のポートには触っていない。
- 実機・WebKit・人どうしの会話・実ホスト＋実スマホの通し・音の聞こえ方は未確認。
- 独立した再採点は実施していない。依頼どおりメインから別担当へ引き継ぐ。
