# U / ui-m1：ホーム M1

## 実装
- 4列×3行の16:9の箱、空き枠、13本以上のページ送り。箱にDOMの文字を載せず、読み上げに名前と人数を残した。
- マウスで選択・クリックで決定、タッチは同じ箱の2回目で決定。キーボード・リモコンは既存の入力経路を再利用。戻るでページ先頭。
- 選択した箱のジャンル・名前・説明・人数・不足人数・あそぶを帯に集約。人数不足ならホームに留まる。
- 下のドックに約88pxのQR・コード・参加者・音・締め切り・共有・ライセンス。道具は48px。
- QRのタップ・決定・Qで拡大。500pxのQRを出し、戻る・外側クリックで閉じる。1024×576でも戻るを収めた。
- 最初の参加まで3手順の案内を出す。表示が重ならないよう、案内の高さを箱の大きさに反映する。
- 動画はミュート・ループ・インライン。動画なし・読込失敗はサムネイル。最大12本。
- 画面外・タブ非表示・動きを減らす設定・省データ・ホームを離れる場合は動画を停止し、ポスターへ戻す。
- 動画の交差監視は箱に置いた。隠したvideo自身を監視すると、再生に戻れないため。
- kind（任意・日英各12文字以内）とpreview（任意のローカルファイル名）を追加。旧登録も読める。
- build-registryが登録IDと同じ動画を自動検出し、配信先へコピー。消した動画の指定とコピーも除く。
- 既存11件の登録JSONはkindだけ追加。日本語・英語を用意した。

## 変更したファイル
- apps/web/src/host/catalog.ts、console.ts、messages.ts、view-home.ts、preview.ts（新規）
- apps/web/src/styles/host.css
- apps/web/tests/host/catalog.test.ts、console.test.ts、view-home.test.ts、shelf.e2e.ts（新規）
- registry/schema/game.schema.json、registry/games/*.json（既存11件のkindだけ）
- tools/build-registry.mjs、tools/tests/registry.test.mjs
- docs/ux.md、docs/registry.md
- この報告。一時スクリプト・ログ・画像・仮動画は.probe-tmp配下。
- 同時に現れたREUSE.toml、tools/check-budgets.mjs、他担当のゲーム・動画・文書等の差分は編集していない。

## コマンドと結果
重いコマンドにはnice -n 10を付けた。環境は優先度変更を拒否する警告を出すが、コマンド自体は実行できた。
一時ファイルを作る検証はTMPDIRを.probe-tmpに向けた。
- npm run typecheck：成功（ワークスペースとゲームの型検査）。
- npm run test -w @irori/web -- tests/host：18ファイル・168件成功。
- node --test tools/tests/registry.test.mjs：22件成功。
- npm run check：境界・文書・権利・依存・ライセンス・登録・SDK同期がすべて成功。登録11件。
- npm run build：成功。依存は追加していない。
- 接続先をPW_TEST_CONNECT_WS_ENDPOINTに指定し、npx playwright test -c .probe-tmp/playwright.ui-m1.config.mjs：5件成功。
- 実Workerは8810だけを利用。専用の一時設定で、既存e2e前処理による他ポートの起動を避けた。終了時はdevの停止処理で子プロセスグループごと終了し、8810への接続不可を確認した。
- ブラウザ試験：3サイズの配置・箱の16:9・文字なし・選択・QRの復号・参加・リモコン、タッチ2回・ページ送り、動画の各停止条件。
- axe：3サイズのQR拡大・参加後の計6状態で違反0件。外部通信・CSP・ページエラーの監視も成功。
- ffmpegで仮の無音動画を.probe-tmp/preview.mp4に生成。動画試験だけIRORI_PREVIEW_TEST_FILEで指定し、ルートを差し替えた。製品ビルド用の環境変数は追加していない。
- node .probe-tmp/shoot-ui-m1.mjs：3サイズ×4状態＝12枚。
- git diff --check：成功。git add・commit・push・ブランチ操作はしていない。

## 画像
.probe-tmp/shots/{1280,1920,1024}-{initial,selected,qr,joined}.png
- 1280×720、1920×1080、1024×576。初期／選択の帯／QR拡大／実際のスマホ参加後。
- 画像を目視し、初回案内と帯の重なり・上端の欠け・QRの戻る・選択の光・大画面の帯の文字を修正した。

## M2への引き継ぎ・未確認
- npm run mutationsは指示どおり未実行。既存の実ブラウザ試験の全面実行・全面更新も未実施。
- 旧ホームを前提にする残件：host.e2e.ts（横一列の移動・詳細を挟む起動・上の道具・右のQR・旧い狭幅順序）、shots.e2e.ts（詳細と旧配置の採寸）、play-layout.e2e.ts（横移動と詳細経由の起動）、link.e2e.ts（詳細経由の外部起動）。
- 既存試験は一括置換せず、新構造の通しはshelf.e2e.tsで検証した。詳細板は外部接続を取り消した場合などの既存経路に残る。
- tools/mutations/specs/host-b1.jsonのfindは読み取り照合で全件1一致。実行時の意味が変わる候補：host-a-e2e-no-grey、host-h-e2e-origin-always-location、host-n-e2e-narrow-top-tall、host-q-e2e-narrow-join-last、host-t-shots-small-caption-1366、host-u-e2e-left-stays-participant、host-v-e2e-fallback-focus-stays、host-w-e2e-shelf-grows-column、host-y-e2e-header-down-geometric、host-aa-e2e-menu-no-wrap、host-bb-e2e-lock-text-fixed-size。
- 表示を隠した旧promptも残るため、host-r-unplayable-says-chooseはM2で帯を対象に見直す必要がある。
- 実機・WebKit・実物のゲームパッド・人が離れた位置から読む評価・独立レビューは未実施。
- タブ非表示はdocument.hiddenと通知を変えるブラウザ試験。実端末のバックグラウンド遷移は未確認。
- 初回のdev起動で監視が進まず404になったため、ポーリングを有効にして再起動。ログの出力先も.probe-tmpへ指定した。

## メインへの質問
- 帯の「時間」は既存登録に正本がなく、値を作らず省略した。ゲーム別の目安と登録項目をM2で確定してほしい。
- 旧e2eと変異の上記残件をM2へ引き継いでほしい。

## ui-m15：M1.5 追記（2026-11-06）
- 列数を1700以上6・1200以上5・900以上4・未満3に変更。各ページは列×3枠、余りは破線。リサイズ時も選択を保ってページを組み直す。
- 箱を3:2・角丸28px・間隔24pxに変更。動画・静止画はcover、選択は1.06倍と暖色の光。1280幅の左右余白は約51px。
- 全幅ドックを廃止し、左下は96pxのQRとコードだけのカード。参加者と道具は上へ、右下は操作の合図。初回案内は短い3手順を下の中央へ。
- 名前の帯は格子の下に独立配置。人数不足は箱全体を暗くし、隅の人の印＋必要人数で表示。人数が足りれば印を消す。
- minutesを任意追加（整数1〜120）。実行時の読取と書き出しは逆転も拒否。schemaは形・整数・上下限を検査。名前の帯で単一値／範囲を表示し、未登録なら省略する。
- 時間は依頼値に準拠。大富豪だけ既存仕様の「約10分」に合わせて10分。動画は実物11本を読み、生成素材による差し替えを廃止。18枠でも動画は最大12本。
- 追加変更：apps/web/src/host/{catalog,messages,view-home}.ts、apps/web/src/styles/host.css。
- 試験：apps/web/tests/host/{catalog.test,view-home.test,shelf.e2e}.ts、tools/tests/registry.test.mjs。
- 登録：registry/schema/game.schema.json、registry/gamesの10本のminutes、tools/build-registry.mjs。既存kindを保持し、ほかの登録項目は変えていない。
- 文書：docs/ux.md、docs/registry.md、この報告。一時スクリプト・ログ・画像は.probe-tmp配下。所有外のソースは変更していない。
- nice -n 10 npm run typecheck：成功。niceの優先度変更は環境に拒否されたが、各コマンドは実行できた。
- nice -n 10 npm run test -w @irori/web -- tests/host：18ファイル・170件成功。旧期待値の人数表示を更新した。
- nice -n 10 node --test tools/tests/registry.test.mjs：23件成功。時間の省略・整数・上下限・逆転時の出力保持を確認。
- nice -n 10 npm run check：全点検成功（登録11件・SDK同期12本）。指定のSDK不足は今回は発生しなかった。
- nice -n 10 npm run build：成功。依存追加・git add・commit・push・ブランチ操作はしていない。
- PW_TEST_CONNECT_WS_ENDPOINTを指定し、nice -n 10 npx playwright test -c .probe-tmp/playwright.ui-m1.config.mjs：Chromium 6件成功。
- e2eは3サイズの配置・QR復号・参加・タッチ2回・ページ送り、列数の境界6点とリサイズ、最大12動画、停止条件を確認。axeは6状態で違反0。
- 実物動画11本すべてを0.5秒間隔のcanvas画像で比較する試験にした。撮影でも3サイズ×11本＝33組すべてにフレーム差があった。
- nice -n 10 node .probe-tmp/shoot-ui-m15.mjs：3サイズ×5状態＝15枚、動画フレーム66枚を保存。
- 画面画像：.probe-tmp/shots/{1280,1920,1024}-{initial,selected,qr,joined,playable}.png。playableは実際に5人参加し、大富豪を選択。
- 動画画像：同じ場所の<size>-video-<0〜10>-{a,b}.png。15画面を目視し、旧CSSの最低高さと帯の幅を修正。QR・案内・箱・帯の重なりを確認した。
- 開発は8810だけを使用。監視で更新が届かない場合があったため、明示ビルド後に再検証・撮影した。終了時はdevの停止処理で子プロセスグループも停止。
- 一時的に権利検査が試験用変換キャッシュの偶然の文字列を拾った。自分が生成したキャッシュだけ除去し、再検査した。検査の除外や製品コードの変更はしていない。
- 未実施：M2の旧e2e全面更新・変異整理、WebKit・実機・実物ゲームパッド・独立レビュー。前回のM2引き継ぎは継続。
- メインへ：home-shelf.mdには旧列数・灰色の帯・初回案内の位置が残るため、今回の依頼に合わせた仕様の整合をお願いしたい（所有外なので未編集）。追加の質問なし。
