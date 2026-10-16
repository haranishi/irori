# 先行事例とブラウザ・Cloudflareの制約（調査メモ）

- 調査日は2026-10-16。各事実の末尾に［確度 確認日］と出典を付けた。確認日の年はすべて2026年。
- 確度の意味：**確認済み**＝公式か一次資料で確認（報道だけで確かめたものは「報道」と付記）／**未確認**＝公式で裏が取れない、または資料が古い／**推測**＝調査者の判断や計算。
- 「最終push」はGitHubの pushed_at（いずれかのブランチへ最後にpushした日）。星の数も10/16時点。

## 0. 結論
1. 公開SDKで第三者がゲームを作れる「ゲーム機型」の先行例は AirConsole と Playroom Kit。どちらも運営のサーバーに依存し、SDKはOSSのライセンスで出ていない。Jackbox は開発者向けAPIを公開していない。
2. 同種のOSSは小粒。最も近い HappyFunTimes は2020年に開発終了を宣言し、最大の理由に「HTTPSが用意できず傾きセンサーが使えない」を挙げた。
3. iPhoneのブラウザでは「全画面・画面の向きの固定・振動」の3つが使えない。この3つに頼らない設計が要る。
4. Cloudflare は無料プランでも SQLite 型の Durable Objects が使え、無料枠を超えると止まる（課金されない）。有料プランに自動停止の仕組みは見当たらず、予算アラートは通知だけ。
5. 費用と無料枠を決めるのは「スマホからサーバーへのメッセージ数」。無料枠でも「20通＝1件」で数えるかは公式に書かれていない（未確認）。

## 1. 先行事例

### 1-1 ゲーム機型のサービス

**AirConsole**（N-Dream AG・スイス）
- 何か：ブラウザを本体、スマホを操作器にするゲーム機。動作先はブラウザ・タブレット・Android TV・車 ［確認済み 10/16］ https://developers.airconsole.com/
- 稼働と更新：サイトは応答あり。JS SDK は 1.11.0（2026-07-07）、APIリポジトリは2026-10-13にも更新 ［確認済み 10/16］ https://github.com/AirConsole/airconsole-api/blob/master/CHANGELOG.md
- 事業の重心は車載に移った。2025-10-15 に KPIT が株式を約26%から約90%へ買い増し ［確認済み 10/16］ https://www.automotiveworld.com/news-releases/kpit-acquires-n-dream-the-company-behind-airconsole-to-drive-the-next-era-of-digital-car-experiences/ 。VW米国の2027年モデルに搭載、停車中のみ・年$149の有料サービス経由（2026-09-24）［確認済み 10/16・報道、複数媒体で一致］ https://www.mediapost.com/publications/article/418284/volkswagen-introduces-airconsole-in-vehicle-gaming.html
- SDKの形：大画面用 screen.html とスマホ用 controller.html の2枚を作る。`message(device_id, data)`／`broadcast`／`onMessage`／`setCustomDeviceState`／`onConnect`／`setActivePlayers`／`vibrate` で通信し、大画面は常に device_id 0 ［確認済み 10/16］ https://airconsole.github.io/airconsole-api/
- 掲載と審査：開発者コンソールで作成 → 2枚のHTMLを直下に置いた zip を上げる → プレビューで試す → 審査申請 → 運営が試して修正点を返す → 開発者の同意で公開。版は上書きされず残る ［確認済み 10/16］ https://developers.airconsole.com/publishing-your-game
- 内容方針：性的表現・暴力・差別・賭博・権利侵害・なりすまし・欺く挙動・利用者データの扱いを定める（2016年版PDF）［確認済み 10/16］ https://www.airconsole.com/file/AirConsole-Developer-Content-Policy.pdf
- 収益：有料会員（Hero）の売上をプレイ時間に応じて分配 ［確認済み 10/16］ https://developers.airconsole.com/
- ライセンスと規約：API本体はOSSライセンスがなく「All rights reserved」。操作部品 airconsole-controls は GPL-2.0、Unityプラグインは LGPL-3.0。利用規約は複製と逆コンパイルを禁止（2024-08-07版）。AirConsole 自体を自前で動かすことは「不可」で、ゲームは自分のURLに置いて AirConsole 経由で開く形 ［確認済み 10/16］ https://www.airconsole.com/file/terms_of_use.html ／ https://developers.airconsole.com/faq-help
- 通信：WebRTC に対応し「遅延が大きく減る」とFAQに記載。`?server=地域` を付けて開くと全通信がその地域のデータセンターを通り、WebRTC は無効になる（遅延の試験用）。端末2台の間は毎秒25通まで、超えた分は捨てずに待ち行列に入る ［確認済み 10/16］ https://developers.airconsole.com/faq-help 。通常時の経路の詳細は書かれていない ［未確認］
- 学べる点：大画面とスマホで画面を分ける構成、大画面の固定ID、通数の上限、審査前の版管理、内容方針の明文化。
- 避けたい点：SDKがOSSでなく、運営に縛られる。スマホ側にもゲームごとのコードが載るため、センサーなどの権限問題がゲームごとに出る ［推測］

**Jackbox**（Jackbox Games）
- 仕組み：本体の画面に出る部屋コードを使い、スマホで jackbox.tv を開いて参加 ［確認済み 10/16］ https://www.jackboxgames.com/how-to-play 。コードの桁数はこのページに記載なし。
- 開発者向けAPI：公開されたものは見つからなかった ［未確認：「無い」と明記した公式文書もない］
- 通信：非公式の私設サーバー実装の説明では、新しいゲームは「Ecast／API v2」、古いゲームは Socket.IO（WebSocket）を使う ［未確認：非公式実装の記述］ https://github.com/InvoxiPlayGames/johnbox
- 規約：派生物の作成、許可のない改造や第三者ソフトの使用、商標の無断使用を禁止 ［確認済み 10/16］ https://www.jackboxgames.com/terms-of-service
- 学べる点：「URL＋短いコード」で入れる手軽さ。避けたい点：名前・作品名（Quiplash等）・画面の見た目を寄せること。

**Playroom Kit**（joinplayroom.com）
- 何か：自前サーバー不要をうたう多人数SDK。`insertCoin({ streamMode: true })` で大画面＝表示役、スマホ＝操作器になり、`isStreamScreen()` で描き分ける ［確認済み 10/16］ https://docs.joinplayroom.com/features/games/stream
- 更新：npm `playroomkit` 0.0.97（2026-07-06）［確認済み 10/16］ https://www.npmjs.com/package/playroomkit
- 料金：無料は1日10人まで。Lite は月$10で月1万人込み、超過は1人$0.0015で自動課金 ［確認済み 10/16］ https://docs.joinplayroom.com/billing
- 掲載・審査の仕組み：なし（各自が自分のサイトで公開する形）［推測］
- ライセンス：npm にライセンス表記がなく、元のリポジトリも示されていない ［未確認］。通信方式も文書に記載なし ［未確認］
- 学べる点：同じSDKで大画面とスマホを判定する作り、ジョイスティック部品の同梱。避けたい点：無料枠が極端に小さく、運営に依存する。

**Netflix のテレビ向けパーティーゲーム**（2025-11開始：報道）
- テレビのQRをスマホで読む方式。ただしスマホにはアプリが必須（Android は Netflix アプリ、iPhone は専用コントローラーアプリで iOS 17 以降）。公式ヘルプは「画面がオフになると接続が切れることがあり、QRの再読み取りが必要な場合がある」と案内 ［確認済み 10/16］ https://help.netflix.com/ja/node/602905750076006
- 示唆：大手もスマホ側はアプリで安定させている。ブラウザだけで作るなら、切断と再参加を最初から設計に入れる ［推測］

### 1-2 部品として使えるリアルタイム基盤

| 名前 | 何か | ライセンス | 星 | 最終push | 通信 |
|---|---|---|---:|---|---|
| Colyseus | Node.js の権威サーバー型。部屋・状態の差分同期。0.18系（npm 0.18.9、2026-09-30） | MIT | 7,369 | 2026-10-15 | WebSocket（ほか uWebSockets.js・WebTransport・Bun） |
| PartyKit（旧本体） | 部屋型の多人数基盤。READMEに「開発は cloudflare/partykit へ移った」 | MIT | 5,732 | 2026-10-09 | WebSocket |
| PartyServer／PartySocket | Durable Objects 上の部屋サーバー部品と、自動再接続・未送信分の保持つきクライアント | ISC | 1,294 | 2026-08-03 | WebSocket（休止API対応） |
| Nakama | Go製のゲーム用サーバー一式（対戦・ランキング・チャット等） | Apache-2.0 | 13,512 | 2026-10-14 | 未確認 |
| Socket.IO | 汎用の双方向通信 | MIT | 63,219 | 2026-09-29 | WebSocket など |
| PeerJS | WebRTC の端末間通信を簡単にする（npm 1.5.5、2025-06） | MIT | 13,468 | 2026-02-27 | WebRTC |
| Trystero | 公開の仲介網（BitTorrent・Nostr・MQTT等）か自前の中継で WebRTC 接続 | MIT | 2,789 | 2026-10-05 | WebRTC |
| geckos.io | WebRTC で UDP 風に送受信（Node.js サーバー） | BSD-3-Clause | 1,488 | 2026-03-27 | WebRTC |
| boardgame.io | ターン制ゲームの状態管理と通信 | MIT | 12,461 | 2026-09-18 | 未確認 |

- 上表は GitHub API と各README で確認 ［確認済み 10/16］ https://github.com/colyseus/colyseus ／ https://github.com/partykit/partykit ／ https://github.com/cloudflare/partykit ／ https://github.com/dmotz/trystero
- Colyseus：クラウド版は月$15から、OSS版の自前運用は無料 ［確認済み 10/16］ https://colyseus.io/pricing/ 。Cloudflare Workers 上で動くかは文書に記載なし ［未確認］ https://docs.colyseus.io/
- PartySocket の再接続の既定値：最小1〜5秒（乱数）、最大10秒、伸び率1.3 ［確認済み 10/16］ https://github.com/cloudflare/partykit/tree/main/packages/partysocket
- 今回の構成（Workers＋DO）に直接載るのは PartyServer 系だけ。Colyseus と Nakama は常駐サーバーが要る ［推測］

### 1-3 GitHub の「スマホを操作器にするWebゲーム」系OSS（星の多い順）

英語13種・日本語5種の検索語で集めた中から、ゲーム機・基盤・代表作に近いものを選んだ。ゲームの改造ツールや無関係なものは除外 ［確認済み 10/16：GitHub API］

| 名前 | ライセンス | 星 | 最終push | 何をするか |
|---|---|---:|---|---|
| konaraddi/web-riimote | MIT | 479 | 2018-07（凍結） | スマホを傾けて操る3D操作器のWebアプリ |
| greggman/HappyFunTimes | BSD-3-Clause | 394 | 2020-04 | 10〜100人超のローカル多人数ゲーム基盤。開発終了を宣言 |
| tannerkrewson/rocketcrab | MIT | 269 | 2026-08 | スマホだけで遊ぶWebパーティーゲームのロビー兼ランチャー |
| ehzhang/nunchuck | MIT | 242 | 2014-08 | スマホのセンサー値を大画面と同期 |
| colfin22/intro-quiz | MIT | 103 | 2026-10 | 自宅運用のイントロ当てクイズ。TVに映し、スマホで回答 |
| kcgidw/fao | GPL-3.0 | 95 | 2021-08（凍結） | スマホで描く推理パーティーゲーム |
| tomalama/hackbox | MIT | 89 | 2023-01 | Jackbox 風パーティーゲームの枠組み |
| extism/game_box | BSD-3-Clause | 39 | 2023-06 | 各ゲームを利用者作成のWASMプラグインとして動かす Jackbox 風の基盤 |
| mholzi/quizify | MIT | 18 | 2026-10 | Home Assistant 用クイズ。QRで参加し、TVが盤面 |
| Couchfriends/Controller-API | なし | 17 | 2024-02 | WebRTC でスマホをゲームパッド化 |
| zalo/ctrl.js | MIT | 16 | 2024-09 | 端末間直結（P2P）のスマホ操作器ライブラリ |
| tfoxy/sts2-couch-coop | Apache-2.0 | 12 | 2026-10 | 市販ゲームをスマホで共同操作 |
| rodwilco/rumpus | AGPL-3.0 | 10 | 2026-07 | 自前運用型の Jackbox 風基盤（TV＋スマホ） |

- **HappyFunTimes の終了理由**（作者のREADME）：①Safari と Chrome が傾きセンサーにHTTPSを要求し、ローカル運用では用意できない ②ブラウザの変更で全画面・音・タッチ・向きが毎年のように壊れる ③OSの通信まわりが約2年ごとに変わる ④オフライン運用は、iOS/Android のネット接続確認を偽装し続ける必要がある ［確認済み 10/16］ https://github.com/greggman/HappyFunTimes 。公式サイト happyfuntimes.net には10/16に接続できなかった（20秒で打ち切り）［確認済み 10/16］
- **rocketcrab の掲載方式**：各ゲームを全員の端末で iframe 表示する。`config/games/_template.ts` を写して埋め、PRを出せば掲載。条件は「部屋を作るAPI（または乱数のコード）」と「参加URL」だけで、URLに `?rocketcrab=true&name=…&ishost=…` を自動で付ける ［確認済み 10/16］ https://github.com/tannerkrewson/rocketcrab 。通信は各ゲーム任せなので、基盤が通信を受け持つ今回の設計とは役割が違う ［推測］

### 1-4 日本語圏
- GitHub を日本語5語で検索したが、星10以上の同種OSSは見つからなかった ［確認済み 10/16］
- 2012年：カヤック「jsdo.it WebSocket Controller」。URLを開くだけでスマホとPCのブラウザを WebSocket でつなぐ ［確認済み 10/16］ https://gihyo.jp/news/nr/2012/04/2001
- 2013年：Google「World Wide Maze」。スマホを傾けて遊ぶ。描画は WebGL、端末間は WebSocket ［確認済み 10/16］ https://blog.google/intl/ja-jp/products/android-chrome-play/2013_03_chrome-experimen/
- 2013年：東京工科大「WebSocket通信によるブラウザ間協調動作プラットフォームの開発」（EC2013）［確認済み 10/16］ https://ipsj.ixsq.nii.ac.jp/records/95964
- 国内で今も動いているOSSのゲーム機は見当たらない ［推測］

## 2. スマホとTVのブラウザの制約

### 2-1 スマホ（操作器側）
対応状況は caniuse の元データ（GitHub、最終更新2026-10-13）と MDN の互換性データ（最終更新2026-10-15）で確認。

| 項目 | iOS Safari | Android Chrome | 設計上の注意 | 確度・出典 |
|---|---|---|---|---|
| 傾き・加速度 | `requestPermission()` が必要（MDNの表では iOS 14.5〜）。利用者の操作の中で呼ぶこと、HTTPS必須 | Chrome 152 から同じメソッドを持つ。当面は既定で許可、将来は確認を既定にする計画 | 全端末で「センサーを使う」ボタンを1回押させ、その中で呼ぶ | 確認済み 10/16 https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static ／ https://groups.google.com/a/chromium.org/g/blink-dev/c/ckd2rFmT3PA |
| 画面を消さない（Wake Lock） | 16.4〜。ホーム画面に追加したWebアプリでは 18.4 まで効かなかった | 84〜 | 画面が隠れると自動解除。`visibilitychange` で取り直す。HTTPS必須。別オリジンの iframe には `allow="screen-wake-lock"` が要る | 確認済み 10/16 https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API |
| 振動（`navigator.vibrate`） | 非対応（iOS 27系まで） | 対応。利用者の操作が必要、別オリジンの iframe 内では使えない。Firefox Android は呼んでも振動しない | 振動は「無くても遊べる」演出にとどめる | 確認済み 10/16 https://caniuse.com/vibration ＋MDN互換性データ |
| 全画面（Fullscreen） | iPhone は非対応。iPad のみで、消せないボタンが出て下スワイプで解除＝ゲーム向きでない | 対応 | iPhone はブラウザの枠が残る前提で配置 | 確認済み 10/16 https://caniuse.com/fullscreen ＋MDN互換性データ |
| 向きの固定（`screen.orientation.lock`） | 非対応（向きの読み取りは 16.4〜） | 対応。ただし通常は全画面中のみ | 縦横どちらでも成り立つ配置か「横にしてね」表示 | 確認済み 10/16 https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock ／ https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ |
| 音（AudioContext） | 鳴らし始めに利用者の操作が要る（Safari 16.4 の修正記録） | 操作前に作ると停止状態。操作の後に `resume()` | 「タップして開始」を必ず挟む。別オリジンの iframe は `allow="autoplay"` で権限を渡す | 確認済み 10/16 https://developer.chrome.com/blog/autoplay ／ https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay |
| 消音スイッチ | Web Audio は既定で消音スイッチに従う。iOS 17 以降は `navigator.audioSession.type = "playback"` で回避できる | — | 効果音は大画面側で鳴らすのを基本にする | 確認済み 10/16（WebKitバグ記録のコメント） https://bugs.webkit.org/show_bug.cgi?id=237322 |
| マルチタッチ | Pointer Events は 13.2〜 完全対応 | 対応 | `pointerId` で指を区別。ブラウザがジェスチャーを横取りすると `pointercancel` が来る | 確認済み 10/16 https://caniuse.com/pointer ／ https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action |
| 拡大・スクロールの抑止 | `touch-action` は 13〜 完全対応。`user-scalable` の指定は Safari 10 以降は無視される | 対応 | 操作面は `touch-action: none`、ボタンだけなら `manipulation`（ダブルタップ拡大を止める）。引っ張って更新は `overscroll-behavior`（iOS 16〜） | 確認済み 10/16 https://developer.apple.com/library/archive/releasenotes/General/WhatsNewInSafari/Articles/Safari_10_0.html ／ https://webkit.org/blog/5610/more-responsive-tapping-on-ios/ ／ https://caniuse.com/css-overscroll-behavior |
| iframe 内の権限 | `allow` 属性は 11.1〜。Permissions-Policy ヘッダーは非対応 | 両方対応 | センサー・振動・画面維持は親ページ（操作器の本体）で扱い、postMessage で中継するほうが確実 | 確認済み 10/16（MDN互換性データ）。中継の判断は推測 |

### 2-2 画面ロック・タブ切り替えと切断
- Android の Chrome は、裏に回ったページを1分で「凍結」する（Chrome 139・2025-08-05から。以前は5分）［確認済み 10/16］ https://developer.chrome.com/release-notes/139
- 凍結中はタイマーや通信の処理が走らない。Chrome は凍結時に WebSocket を閉じるよう勧めている ［確認済み 10/16］ https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Chrome 149（2026-06-02）から、戻る/進むのキャッシュに入るときに WebSocket を閉じる ［確認済み 10/16］ https://developer.chrome.com/release-notes/149
- Chrome は5分以上隠れたページのタイマーを1分に1回まで間引く（WebRTC使用中や音が鳴っている間は対象外）［確認済み 10/16］ https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- iOS：裏のタブを8分待たずに止める変更が 2024-01 に WebKit へ入った ［確認済み 10/16］ https://bugs.webkit.org/show_bug.cgi?id=265064 。ロックで WebSocket が切れる、切れても通知が来ない、という開発者の報告は多いが、Apple の公式説明は見つからない ［未確認］ https://developer.apple.com/forums/thread/696310
- Netflix も「画面オフで切断することがある」と公式に案内している（1-1参照）［確認済み 10/16］
- 設計への含み：切断は前提。アプリ側の心拍（数秒ごと）で生死を判定し、`visibilitychange`／`pageshow` で再接続し、席（プレイヤー番号）を合言葉（トークン）で復元する ［推測］

### 2-3 大画面（ホスト側）
- 現実的な順番：①ノートPCをHDMIでTVへ。PCのブラウザで動くため制約が最も少ない ［推測］ ②Chrome のタブキャスト ③TV内蔵ブラウザ。
- タブキャスト：Chromecast・Google TV Streamer・Cast対応TVへ送れる。同じWi-Fiが条件で「ほとんどのWebコンテンツ」を送れ、タブの音はTV側だけで鳴る。遅延の記載はない ［確認済み 10/16（遅延は未確認）］ https://support.google.com/chromecast/answer/3228332
- LG（webOS TV）：2026年モデルは Chromium 132、2025年は120、2024年は108。アプリ用エンジンの表で、内蔵ブラウザが同じかは書かれていない ［確認済み 10/16（ブラウザは未確認）］ https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
- Samsung（Tizen）：2026年モデルは Chromium M130、2025年は M120。WebGL と WebSocket は「Yes」。年式ごとの内訳と内蔵ブラウザへの適用は読み取れず ［確認済み 10/16（一部未確認）］ https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- Fire TV：Silk ブラウザ。Amazon の文書は「WebGLを有効化し大半の機能に対応」「WebSocket対応」と書くが、2015年ごろの古い文書 ［未確認（資料が古い）］ https://docs.aws.amazon.com/silk/latest/developerguide/html.html
- Google TV：標準ブラウザの有無について公式文書は見つからない。第三者製ブラウザを入れる記事はある ［未確認］。Chromecast with Google TV は2025-02に販売終了 ［確認済み 10/16・報道］ https://www.androidcentral.com/streaming-tv/the-chromecast-with-google-tv-is-officially-no-longer-available-for-purchase
- 別の道：Cast機器の上で動く Web Receiver（Webアプリ）を作る方法もある。開発者登録は$5 ［確認済み 10/16］ https://developers.google.com/cast/docs/registration
- TV内蔵ブラウザの描画性能とリモコン操作は機種差が大きい。PCのブラウザを正式対応にし、TVは「動けば可」とするほうが保守が軽い ［推測］

## 3. Cloudflare（2026-10時点の公式文書）

### 3-1 Durable Objects と WebSocket 休止API
Durable Objects（以下DO）は、ID（部屋コードなど）ごとに1つだけ立ち上がる、状態を持つサーバー部品。
- 休止API：`ctx.acceptWebSocket(ws)` で受けると、イベントがない間はDOをメモリから外せる。休止中は時間課金（GB秒）がかからない ［確認済み 10/16］ https://developers.cloudflare.com/durable-objects/best-practices/websockets/ （2026-09-30更新）
- 休止すると変数は消える。接続ごとの状態は `serializeAttachment`（16,384バイトまで）か保存領域に置く。`setTimeout`／`setInterval` が動いていると休止しない ［確認済み 10/16］ 同上
- 1つのDOの接続数は休止API使用時に最大32,768本。実際はCPUとメモリでもっと下がる ［確認済み 10/16］ https://developers.cloudflare.com/durable-objects/api/state/
- 受信メッセージは32 MiBまで。1つのDOの目安は毎秒1,000リクエスト（ソフト上限）。CPU時間は既定で1回30秒、メッセージごとに戻る ［確認済み 10/16］ https://developers.cloudflare.com/durable-objects/platform/limits/ （2026-06-01更新）
- 小さなメッセージを大量に送るとDOが詰まる。50〜100ミリ秒ごと、または50〜100通ごとにまとめて送るよう公式が勧めている ［確認済み 10/16］ best-practices/websockets
- 心拍：`setWebSocketAutoResponse` で決まった文字列に自動で返事でき、DOを起こさない（要求・応答とも2,048文字まで）。WebSocket の制御用 ping にも自動で応じる ［確認済み 10/16］ api/state ／ best-practices/websockets
- コードを更新（デプロイ）すると、全WebSocketが切れる ［確認済み 10/16］ best-practices/websockets
- 置き場所：最初の要求が来た場所の近くに作られる。`locationHint: "apac-ne"`（北東アジア）などで指定できるが保証はない ［確認済み 10/16］ https://developers.cloudflare.com/durable-objects/reference/data-location/
- DOから外へ張る WebSocket は休止しない。休止できるのはDOが受け手のときだけ ［確認済み 10/16］ best-practices/websockets

### 3-2 料金（Workers と DO）

| 項目 | Free | Paid（月$5から） |
|---|---|---|
| Workers のリクエスト | 1日10万（UTC 0時に戻る） | 月1,000万込み、超過は100万あたり$0.30 |
| Workers の CPU | 1回10ミリ秒 | 月3,000万CPUミリ秒込み、超過は100万ミリ秒あたり$0.02 |
| 静的ファイル（Static Assets） | 無料・無制限（Workerを通さない場合） | 同じ |
| DO のリクエスト | 1日10万 | 月100万込み、超過は100万あたり$0.15 |
| DO の時間（GB秒） | 1日1.3万 | 月40万込み、超過は100万あたり$12.50 |
| DO の保存（SQLite） | 合計5GB、1日に読み500万行・書き10万行 | 月に読み250億行・書き5,000万行・5GB込み |
| DO の保存方式 | SQLite 型のみ（2025-04-07から無料プランで利用可） | SQLite 型と、既存ならキー値型 |

- 出典 ［確認済み 10/16］：https://developers.cloudflare.com/workers/platform/pricing/ （2026-10-02更新）／ https://developers.cloudflare.com/durable-objects/platform/pricing/ （2026-09-30更新）／ https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/
- WebSocket の数え方：接続の確立は1リクエスト。DOが受け取るメッセージは「20通＝1リクエスト」で課金計算する。DOからの送信と制御用 ping は無料。Worker を素通りするだけのメッセージは数えない ［確認済み 10/16］ 同上
- ただし「20通＝1件」は「課金計算のみ」と書かれている。無料枠（1日10万）の消費にも同じ比率を使うかは書かれていない ［未確認］
- 時間課金：DOは実時間で課金し、実際の使用量に関係なく128MBで計算する。メッセージが流れ続けて休止できない間はずっと課金される ［確認済み 10/16］ DO pricing
- 公式の計算例：100部屋×各100接続、休止API使用、1部屋あたり毎分100通で月$20.65 ［確認済み 10/16］ DO pricing

### 3-3 無料枠を超えたとき・有料の上限
- 無料の Workers：1日10万を超えるとエラー1027。ルートごとに「Workerを飛ばして素通し」か「エラーページ」を選べる ［確認済み 10/16］ https://developers.cloudflare.com/workers/platform/limits/ （2026-10-12更新）
- 無料のDO：どれか1つの枠を超えると、その種類の操作がエラーになる。UTC 0時（日本時間9時）に戻る ［確認済み 10/16］ DO pricing
- 無料の Static Assets：Worker を先に通す設定（`run_worker_first`）にした要求は、枠を超えると429を返し、静的配信には切り替わらない ［確認済み 10/16］ https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- 有料：超過分はそのまま課金される。自動で止める上限の設定は公式文書に見当たらない ［未確認：「無い」と明記した文書も見つからない］
- 予算アラートは「情報提供のみで、利用を止めず上限もかけない」と明記。対象は従量課金の全製品の合計 ［確認済み 10/16］ https://developers.cloudflare.com/billing/manage/budget-alerts/ （2026-05-29更新）
- 1回の実行あたりのCPU上限は Worker ごとに設定できる（アカウント全体の上限ではない）［確認済み 10/16］ Workers pricing

### 3-4 そのほかの部品
- Workers Static Assets：1版あたりのファイル数は Free 2万・Paid 10万、1ファイル25MiBまで。保存の追加料金はない ［確認済み 10/16］ Workers limits ／ static-assets billing
- HTMLRewriter：HTMLを流しながら書き換えるAPI（例：manifest からタイトルやOGPを差し込む）。プランの制限は文書に書かれていない ［確認済み 10/16（Freeで使えるかは未確認）］ https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
- Rate Limiting binding：2025-09-19に正式版。期間は10秒か60秒。数え方は拠点ごとで、最終的に揃う程度の精度（会計用ではない）。Wrangler 4.36.0 以上が必要。Freeで使えるか・料金は書かれていない ［確認済み 10/16（プラン可否は未確認）］ https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- 後で WebRTC を足すとき：Cloudflare の TURN（中継）は 1GBあたり$0.05、SFU と合わせて毎月1,000GBまで無料 ［確認済み 10/16］ https://developers.cloudflare.com/realtime/pricing/ 。stun.cloudflare.com の料金は書かれていない ［未確認］

### 3-5 `wrangler dev` を家のスマホで試す
- 既定では localhost でしか待ち受けない。`--ip 0.0.0.0`（または PC の LAN 内 IP）で、同じWi-Fiのスマホから開ける。`--local-protocol https` でHTTPS、`--https-cert-path`／`--https-key-path` で自前の証明書を使う ［確認済み 10/16］ https://developers.cloudflare.com/workers/wrangler/commands/workers/ （2026-10-09更新）
- 証明書を指定しないHTTPSは自己署名なので、スマホは警告を出す ［確認済み 10/16］ https://developers.cloudflare.com/pages/functions/local-development/ 。警告を押し切った状態で iPhone がセンサーを許すかは ［未確認］
- 確実な方法①：mkcert のルート証明書を iPhone に入れ、「プロファイル」をインストールしたうえで「完全な信頼」をオンにする ［確認済み 10/16］ https://github.com/FiloSottile/mkcert#mobile-devices
- 確実な方法②：cloudflared の Quick Tunnel で本物のHTTPSのURLを得る。アカウント不要、同時200リクエストまで、SSE非対応、試験用。WebSocket の可否は書かれていない ［確認済み 10/16（WebSocketは未確認）］ https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- HTTPのまま LAN 内 IP で開くと「安全な文脈」にならない。MDN は傾きセンサーと画面維持を「HTTPSでのみ使える（対応ブラウザの一部または全部で）」と書いているので、使えない前提で準備する ［確認済み 10/16］ https://developer.mozilla.org/en-US/docs/Web/API/Window/deviceorientation_event

### 3-6 ざっくり試算 ［推測：公式単価からの計算］
- 前提：4人がそれぞれ毎秒20通、大画面が毎秒10通、1回20分（1,200秒）。DOが受ける通数は (4×20＋10)×1,200＝108,000通。
- 無料枠にも「20通＝1件」が効く場合は5,400件で、1日約18回遊べる。効かない場合は1回で10.8万件となり、1回目の途中で枠が切れる。
- 時間：0.125GB×1,200秒＝150GB秒。無料（1日1.3万）で約86回。
- 有料：月1,000回なら、要求540万件のうち込み分を超える440万件で約$0.66。時間は15万GB秒で込み分（40万）の内側。合計は基本料$5＋約$0.66。
- 結論：通数を減らすのが最も効く。入力は「変わったときだけ送る」「まとめて送る」を既定にする。

## 4. 未確認のまま残ったこと
- 無料枠での「20通＝1件」の扱い。無料アカウントで実際に送り、エラーが出る通数を測るのが確実。
- `setWebSocketAutoResponse` による心拍が課金対象になるか。
- iOS の画面ロック時の WebSocket 切断の公式な仕様。
- 自己署名の証明書を押し切った iPhone で、傾きセンサーが使えるか。
- TV内蔵ブラウザ（webOS・Tizen・Silk）での WebGL の実際の性能。
- Playroom Kit の通信方式とライセンス。HTMLRewriter と Rate Limiting binding を Free で使えるか。
- 特許と商標：AirConsole（N-Dream）の関連特許は検索で見つからなかった。「AIRCONSOLE」は N-Dream の登録商標とする検索結果があるが、登録簿は開けなかった。J-PlatPat と Google Patents での確認が残る。

## 5. 設計への示唆
1. センサー・振動・画面維持・音の解禁は、ゲームの iframe ではなく操作器の本体ページが受け持ち、SDK経由で中継する。
2. スマホは最初に「タップして開始」を1回挟み、その中で音の解禁・センサー許可・画面維持をまとめて行う。
3. iPhone で全画面・向きの固定・振動は使えない前提で、操作画面を縦横どちらでも成り立たせる。
4. 切断は日常として扱う。心拍・再接続・席の復元をSDKの基本機能にし、デプロイ時の全切断にも耐えさせる。
5. 入力は「変化時のみ・最大で毎秒20通前後・まとめ送り」を既定とし、SDKで上限をかける（AirConsole は毎秒25通）。
6. 1部屋＝1DO＋休止API＋`locationHint`。無料プランの「超えたら止まる」を費用の上限として使い、有料化の際は予算アラートでは止まらないことを明記する。
7. 大画面・スマホ・ゲーム本体の静的ファイルは Static Assets で配る（Worker を通さなければ無料・無制限）。
8. 開発中の実機確認は Quick Tunnel か mkcert で本物のHTTPSを使う。HTTPではセンサーが使えず、HappyFunTimes はこれで行き詰まった。
9. ゲーム登録は rocketcrab 型の「設定ファイルをPR」にし、AirConsole の内容方針を審査基準の下敷きにする。名前と見た目は Jackbox や AirConsole に寄せない。
10. 大画面はPCのブラウザを正式対応にし、TV内蔵ブラウザとタブキャストは「動けば可」から始める。
