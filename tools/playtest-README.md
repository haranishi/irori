# 試遊サーバー：curl だけで、本物のホストとスマホを操作して遊ぶ

遊んで採点する人のための道具です。`tools/playtest-server.mjs` が実 Worker を自分専用に起動します。開くのは本物のホストの画面（1280×720）と、本物のスマホの画面（390×844・タッチ）。採点する人は HTTP で、スマホのボタンやホストのキーを押し、いま見えている状態を読みます。前もって `npm run build` は要りません（Playwright の Chromium は要ります）。

```sh
URL_FILE=$(mktemp)
node tools/playtest-server.mjs --port-file "$URL_FILE" &   # 1行目に {"playtest":"http://127.0.0.1:PORT"}
U=$(cat "$URL_FILE")
curl -s -X POST $U/start -d '{}'                     # Worker を起こし、ホストを開く（数秒）
curl -s -X POST $U/pad/1/join -d '{"name":"たろう"}'  # スマホを1台ずつ入れる（1〜8）
curl -s -X POST $U/stop                              # 全部止めて、サーバーも終わる
```

| 操作 | 本文の例 | すること |
|---|---|---|
| `POST /pad/:n/tap` | `{"id":"ok"}`・`{"id":"buzzer","count":40,"intervalMs":80}` | ボタンを押す。id はリモコンの up・down・left・right・ok・back か、ゲームのボタン |
| `POST /pad/:n/hold` | `{"id":"hop","ms":800}` | 押し続けて離す |
| `POST /pad/:n/stick` | `{"x":1,"y":0,"ms":1500}` | スティック（か十字キー）を倒し続ける。x・y は -1〜1 |
| `POST /pad/:n/choose` | `{"index":0}` | 選択肢を選ぶ（0から数える。`{"id":"c2"}` でも可） |
| `POST /pad/:n/tiles` | `{"ids":["a","b"]}`・`{"pass":true}` | 札（タイル）の選択をそろえて「決定」する。`pass` は「パス」。手札や人を選ぶ画面で使う |
| `POST /pad/:n/swipe` | `{"x0":0.5,"y0":0.3,"x1":0.5,"y1":0.8,"ms":400}` | 触る枠の中で、指を置いて動かして離す。座標は枠の中の0〜1（ボウリングは下へ引いてはなす） |
| `POST /pad/:n/menu` | `{"item":"leave"}` | 名前の長押しのメニュー。pause（一時停止を頼む）か leave（退出） |
| `POST /pad/:n/disconnect`・`/reconnect` | なし | スマホの回線を切る・戻す |
| `POST /host/key` | `{"key":"Escape"}` | ホストのキー（ArrowRight・Enter・Escape・m） |
| `POST /host/viewport` | `{"width":768,"height":1024}` | ホストの画面の大きさを変える（幅320〜2560・高さ320〜1600。既定は1280×720） |
| `POST /clock/advance` | `{"ms":30000}` | ホストの時計を進める |
| `GET /state` | なし | 状態を JSON で読む |
| `POST /shot` | `{"target":"host"}`・`{"target":1}` | 撮って、画像のパスを返す |

## 時計は止まっている

ホストの時計（ゲームの中の時計も同じ）は、最初から止めてあります。次の操作を何分考えても、時間切れになりません。時計が進むのは3つの場合だけです。操作の最中（連打の間隔・押し続け・倒し続けの時間）、操作のあとの約0.1秒、そして `/clock/advance`。「よーい」のカウントダウンや出題の締切は、`/clock/advance` で進めます。

停止処理は、Playwright 1.64.1で過去時刻の `pauseAt` が例外前に時計を停止する挙動に依存します。これは[公開API](https://playwright.dev/docs/api/class-clock)が保証する例外後状態ではありません。Playwright更新時は、`tests/e2e/console/playtest.spec.ts` の実HTTP・「試遊時計」回帰（時刻の単調性・新しい枠・例外の伝播）を確認してください。

## /state の読み方と注意

- `host.state` はホストの画面（home・detail・playing・paused・results など）、`host.focused` はいま選んでいる場所、`host.text` は見えている文字、`host.sockets` はホストがつないだ回数（1なら一度も切れていない）
- `host.game.phase`・`host.game.text` はゲームの段階と中の文字、`host.results` は結果。`pads[]` は各スマホの `kind`・`buttons`・`choices`・`text`
- キャンバスに描くゲーム（連打レース・あつめて点・ハローパッド）の絵の中の文字は、JSON に出ません。`/shot` で見てください
- 操作は届いた順に1つずつ処理します。返事を待ってから次を送ります。受けるのは 127.0.0.1 からだけです
- 何も操作しない時間が20分続くと、部屋は閉じます。画像は一時フォルダ（`/start` の返事の `shots`）に置くので、消える前提で扱ってください
