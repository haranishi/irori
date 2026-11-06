# U / ui-m4：独立採点第1周の指摘修正

## 修正と理由
- 旧配置の案内を日英とも左下QRへ整合。ローカルの初回は「①左下のQRを開く ②参加する ③ゲームを選ぶ」。理由と開き直す方法をQRへ集め、長い案内で棚を覆わない。
- 小さいQRのコード付近に「このアドレスでは、スマホは参加できません」。英語も追加。拡大QRの注意文は保持。
- 最大人数を超えた箱にも、人の印と最大人数を出す。不足と同じ暗さで、ゲーム名は追加しない。
- リーダーの案内はホーム・拡大QR・結果で出し分ける。QRは一時停止から重ねた場合も優先。他席の案内は保持。
- `hello-pad.json` は `minutes: {min:1,max:1}` の追加だけ。
- 補助文字を拡大。3手順はQRのすぐ上で番号を強く示す。最初の参加者が入ると消える経路は保持。
- 「あそぶ」は無効時に透明な地・薄い輪郭、有効時に橙の塗り。既存の短い理由を近くに保持。
- QR・道具・ページ送りにフォーカスがある間、選択箱は細枠にし、操作先へ輪郭と光を出す。
- ページ送りの領域を格子の外へ確保。600〜899幅も帯をQRの上に置き、折り返す説明が棚に重ならないようにした。

## 数値（メインの仕様整合用）
- 箱の3:2、角丸28px、列数の境目1700/1200/900/600、左下96px QR、動画と名前の帯を保持。
- 説明・人数・時間・右下の操作は `clamp(16px,1.25vw,24px)`：1280で16px、1920で24px。
- 3手順と番号は `clamp(18px,1.40625vw,27px)`：1280で18px、1920で27px。番号の丸は30px。
- QRカードの短い理由は14px、最大幅110px。拡大画面の注意文は変更なし。
- 手順は通常下端148px、狭幅150px。帯は600未満と600〜899で下端150px。棚の下の余白は90px、1700以上120px、900未満230px。
- ページ送りは通常右外56px・幅40px。600未満は右外48px。棚の最大幅から通常64pxを引く。600未満の棚は最大298px（箱140px×2＋隙間18px）、中央から左へ8px寄せる。
- 1200以上の帯の右余白は「補助文字サイズ×9＋36px」。比例拡大した右下の案内と帯を重ねない。
- 390幅の箱間は18px。その他の箱間は24px。境目12サイズで箱同士・箱と帯/QR/初回案内・矢印と箱を8px以上として検査。

## 変更ファイル
- `apps/web/src/host/{view-home,padplan,console,messages}.ts`、`apps/web/src/styles/host.css`。
- `apps/web/tests/host/{home-guards.e2e,host.e2e,view-home.test,padplan.test,lineup.test,messages.test}.ts`。
- `docs/ux.md`、`registry/games/hello-pad.json`、この報告。一時の道具・画像・ログは `.probe-tmp/`。
- 所有外のソース・仕様・依存は未編集。並行変更を保持。git add・commit・push・ブランチ操作なし。

## 検証
- 重い検証・撮影コマンドに `nice -n 10`。環境は優先度変更を拒否するが、コマンドは実行された。ブラウザ試験のTMPDIRは作業ツリー内。
- `npm run typecheck`：全体成功。
- `npm run test -w @irori/web`：21ファイル・226件成功。
- `npm run check`：すべて成功（登録13件・SDK同期13本）。`npm run build`：成功。
- `git diff --check`：所有範囲で成功。
- 日英の位置案内・リモコン案内の上限、QRの理由、人数超過、状態別リモコン、時間、文字の下限、矢印・隙間、押せる/押せない塗りを試験で守る。
- 「壊すと赤」：位置・QR理由・超過印・QR案内・結果案内・補助文字・矢印・無効ボタンの塗り・フォーカスの光・時間の10項目で終了コード1を確認し、元に戻した。
- 変異の追加ファイルは所有外なので作らず、一時スクリプトで各変更を戻しながら確認。ログは `.probe-tmp/ui-m4-mutation-*.log`。
- ホスト初回は63成功・1失敗（390幅の箱が125pxで既存下限140px未満）。期待値を変えず棚幅を直し、境目と既存スマホ幅の2件が成功。再実行の途中で1920幅の帯と右下案内の重なりも画像で見つけ、右余白を直して途中の試験を中断。最終全件は64件すべて成功。
- ホストの次の全件は63成功・追加1件失敗。一時停止中にホーム専用のQキーを送っていた試験を「QRを表示」の実操作へ直し、メニューのQR状態も案内へ渡した。該当リモコン通し1件成功後、最終全64件がすべて成功（機能61・撮影3、8.2分）。
- console/bridgeは全106件を実行して104成功・2失敗（並行実行時の試験用ポート不足）。他の試験を止めた状態で対象2件を再実行し2件成功。計106件の成功を確認。
- `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9333/pw npx playwright test -c apps/web/playwright.pad.config.ts --project=phone-chromium`：76成功・71既定スキップ・失敗0。
- `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9334/pw npx playwright test -c apps/web/playwright.pad.config.ts --project=phone-webkit`：3件すべて成功。
- `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9334/pw npx playwright test -c tests/e2e/playwright.config.ts --project=phone-webkit --project=desktop-webkit`：82件すべて成功（大画面71・スマホ11、7.8分）。知らされていた揺れも発生せず、WebKitの再実行は不要だった。
- ホスト全件コマンド：`PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9333/pw npx playwright test -c apps/web/playwright.host.config.ts --project=host-chromium --project=host-shots`。
- console/bridge全件コマンド：`PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9333/pw npx playwright test -c tests/e2e/playwright.config.ts --project=bridge --project=desktop-chromium --project=phone-chromium --grep-invert '試遊サーバー：curl'`。
- ポート不足の2件再確認：同じe2e設定で `--project=desktop-chromium --grep '月あかりの寄り合い：5台|月あかりの寄り合い：CPUを4倍'`。

## 画像・未確認・連絡
- 前後の画像は修正前36枚・修正後39枚（追加の操作確認3枚を含む）、不足0。全4サイズで目視確認。
- 前後の画像：`.probe-tmp/shots-m4/before/` と `after/`。4サイズ×公開/ローカル×初期/選択/QR/3人参加、加えて各幅の3人参加で2人上限の箱。
- 12サイズの採寸は `after/layout-metrics.json`。1280の手順18px・補足16px、1920の手順27px・補足24px。帯と右下案内の隙間は1280で約8.5px・1920で約8.8px。390の箱は140px。
- 撮影の道具は `.probe-tmp/shoot-ui-m4.mjs` と `over-m4.mjs`。不足していた修正前の超過画像だけ、保存済みの自分の変更を退避して元の描画へ戻し撮影し、復元した。
- `after/focus-{keyboard-qr,mouse-tool,remote-tool}.png`：TabでQR、クリックで音、リーダーのスマホの上入力で音にフォーカス。いずれも選択箱の光が消え、操作先が強いことを実操作と採寸で確認（`focus-metrics.json`）。
- 撮影は `nice -n 10 timeout 3000 env IRORI_DEV_PORT=8881 node tools/dev.mjs`。すべて停止信号で終了し、撮影文脈もfinallyで閉じた。試験も後処理を終了。最終のTCP照会は8880〜8899すべて接続不可で、残ったサーバーなし。8787は未操作。
- ログは `.probe-tmp/ui-m4-*.log`。ホスト最終は `ui-m4-host-final.log`、WebKitは `ui-m4-console-webkit.log`。
- 箱へのゲーム名の追加は本人の指示に反するため実施しない。骨格は変更しない。
- 実機・実物のゲームパッド・離れた席からの読み取り・人どうしの評価・独立した再採点は未実施。
- メインへ：上記の文言・文字サイズ・余白・人数超過とリモコン状態を仕様に反映してほしい。追加の質問なし。
