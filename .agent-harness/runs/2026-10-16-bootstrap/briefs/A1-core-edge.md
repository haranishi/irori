# 指示書 A1：中継の核と Worker（protocol の検証・room・room-client・edge）

あなたは実装担当。設計は固定済みで、この指示書と `docs/` が契約。設計を変えたくなったら、変えずに報告へ書く。

## 目的

ホストとスマホの間でフレームを運ぶ「部屋」を、テストで確かめられる形で作る。サーバーは配管で、ゲームの内容を解釈しない。

## 先に読む（読み取りのみ）

- `docs/protocol.md`（意味と理由）、`docs/architecture.md`、`docs/decisions/0002-websocket-first.md`
- `packages/protocol/src/{types,limits,bridge,index}.ts`（型と上限値の正本。**変更禁止**。直したい点は報告に書く）
- `apps/edge/wrangler.jsonc`（バインディング名・クラス名は固定）、`apps/edge/package.json`

## 触ってよい場所

`packages/protocol/src/`（新規ファイルの追加のみ）と `packages/protocol/tests/`、`packages/room/**`、`packages/room-client/**`、`apps/edge/**`、`tools/dev.mjs`、`tools/smoke-edge.mjs`。

触らない：上記以外のすべて（`docs/` は読むだけ）。`git` の書き込み系コマンド、`npm install`（新しい依存が要るなら、入れずに報告へ理由つきで書く）、デプロイ、外部への送信は禁止。ポートは 8787〜8799 の範囲を使う（ほかの担当と重ならないため）。

## 作るもの

### 1. `packages/protocol`：検証

- `validate.ts`：`parseHostFrame(raw: string)` `parsePadFrame(raw: string)` → `{ ok: true; frame } | { ok: false; reason }`。未知のキーは拒否（特に `p` を持つ `in` は拒否＝席番号のなりすまし防止）。数値は範囲に丸める（axis -1〜1・小数2桁、ptr 0〜1、tilt の a は0〜360・b は-180〜180・g は-90〜90）。`PadSpec` は `LIMITS` の文字数・個数・色名・id の文字種（`[a-z0-9_-]{1,24}`）を検査し、HTMLらしい文字列も文字として通す（描画側が `textContent` で入れる）。サーバー → クライアントのフレームを検査する `parseToHostFrame` `parseToPadFrame` も作る（クライアント側で使う）。
- `names.ts`：`sanitizeName(raw, fallback)`。書記素（`Intl.Segmenter`）で12まで、制御文字・双方向制御文字・ゼロ幅の連続を除き、空白を畳む。空なら fallback。
- `code.ts`：`generateCode(rand)`・`normalizeCode(raw)`（大文字化・空白と `-` の除去）・`isValidCode`。乱数は引数で受ける。
- 試験：表形式の試験と、ランダムな入力（500通り以上、固定シード）で「例外を投げない・通ったものは上限を超えない」を確かめる。

### 2. `packages/room`：状態機械（純粋）

`RoomCore`。入出力・時計・乱数・ハッシュを持たず、`now` と注入された `rand` `hash` `timingSafeEqual` を使う。

- `handle(event: RoomEvent): Effect[]`。イベントは `open`（接続を受けた）・`frame`（テキスト受信。`raw` と受信バイト数）・`close`・`tick`。効果は `send`（接続ID・フレーム）・`close`（接続ID・コード・理由）・`persist`（保存する最小の状態）・`alarm`（次に起こす時刻か null）・`destroy`。
- 仕様は `docs/protocol.md` のとおり。細部：席は1〜`MAX_PLAYERS` の最小の空き。名前の重複は後ろに番号。`hello` 前の他フレームは `bad-frame`。ホスト専用フレームをスマホが送ったら違反。違反は5秒の窓で数え、`VIOLATIONS_BEFORE_CLOSE` で `rate` を送って切る。レートは接続ごとのトークンバケット。ホストの二重接続は新しいほうが勝つ（古いほうは `replaced`）。ホストの（再）接続時は、接続中の全席について `{t:'pad?'}` を送る。スマホの再接続時は、本人に `welcome`、ホストに `online`（と `pad?`）。`kick` は本人に `kicked` を送って閉じ、席を即座に空ける。`bye` も同じ。猶予が切れた席は `left`（`timeout`）。ホスト不在90秒・無操作20分・作成から12時間・作成後60秒でホスト未接続、のいずれでも部屋を閉じる（スマホには `closed`、コード4010）。
- 保存する状態（`persist` の中身）は、コード・ホスト鍵のハッシュ・作成時刻・最終操作・ロック・席の一覧（番号・名前・再開の札のハッシュ・接続中か・切断時刻）だけ。入力は保存しない。`RoomCore.restore(state, sockets)` で、休止からの復帰（接続の付属情報と保存状態から組み直す）を再現できること。
- 上限値は `LIMITS` を既定にし、コンストラクタで上書きできる（試験用）。
- 試験：時間を進めながらの状態遷移を、網羅的に。少なくとも：入室・退室・再接続・二重接続・満員・ロック・ホスト交代・猶予切れ・休止からの復帰・過大フレーム・速すぎるフレーム・なりすまし・不正なフレームの連続・ホストの `pad` が存在しない席宛て・`fx` の上限。

### 3. `packages/room-client`：再接続つきクライアント

ブラウザとNode（グローバルの `WebSocket`）の両方で動く。`RoomSocket`：`connect()`、`send(frame)`、`on('frame'|'state'|'error')`。状態は `connecting` `open` `reconnecting` `closed`。切れたら指数バックオフ（0.5秒から最大8秒、ゆらぎ付き）で入り直し、入り直すたびに `hello` を送り直す（再開の札と鍵は呼び出し側が渡す関数から取る）。4001〜4012のコードのうち、再試行しても無駄なもの（`no-room` `kicked` `closed` `auth` `version` `full` `locked`）では再接続しない。15秒ごとに `{"t":"ping"}` を送り、30秒、`{"t":"pong"}` が来なければ切って入り直す。受信は `parseToHostFrame` / `parseToPadFrame` を通す。時計とタイマーは注入できること（試験用）。

### 4. `apps/edge`：Worker と Durable Object

- `src/index.ts`：ルーティング（`docs/protocol.md` の表）と、静的ファイル（`env.ASSETS`）。`/` → `index.html`、`/pad` → `pad.html`。`/api/rooms` の作成は `Limiter` を通す。コードの衝突は最大8回やり直す。
- `src/room.ts`：`Room` クラス。Hibernation API（`ctx.acceptWebSocket`・`serializeAttachment`・`webSocketMessage` ほか）、`ctx.setWebSocketAutoResponse` で `{"t":"ping"}` → `{"t":"pong"}`、`alarm()`、`RoomCore` の効果の実行。休止から起きたときは `blockConcurrencyWhile` で復元。保存の書き込みは、`persist` が出たときだけ。
- `src/limiter.ts`：`Limiter` クラス。同じIPの作成回数（分・時）と、1日（UTC）の総数。IPは保存せず、日ごとに変わる塩つきのハッシュだけを数える。超えたら 429（IP）か 503 `{"error":"busy","retryAfterSec":…}`（日次）。
- ヘッダー：`Set-Cookie` を返さない。`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy`（スマホの `/pad` は accelerometer と gyroscope を自分に許可、ほかは拒否）。HTMLの CSP は `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws://<host> wss://<host>; frame-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`（Safari は `'self'` が ws を含まないことがあるので、ホストを明示）。`/games/*` は `Content-Security-Policy: sandbox allow-scripts; default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'` と `Access-Control-Allow-Origin: *`。`/sdk/*` も `Access-Control-Allow-Origin: *`。HTMLは `no-cache`、ハッシュ付きのアセットは長期キャッシュ、`/api/*` は `no-store`。
- HTMLRewriter：HTML応答の `link[rel=canonical]` の href、`meta[property=og:url]`・`og:image`・`meta[name=twitter:image]` の content が `/` で始まる相対なら、`PUBLIC_URL`（http/https として正しければ）かリクエストのオリジンを基にした絶対URLに書き換える。
- 時間などの上書き：`ALLOW_TEST_OVERRIDES` が `"1"` のときだけ、環境変数 `PAD_GRACE_MS` `HOST_GRACE_MS` `HELLO_TIMEOUT_MS` `ROOM_IDLE_MS` `CREATE_TTL_S` `CREATE_PER_IP_PER_MINUTE` `MAX_ROOMS_PER_DAY` `MAX_PLAYERS`（8まで）を読む。それ以外では無視する。
- 試験：`wrangler dev --local --persist-to <一時フォルダ> --port <空きポート> --var ALLOW_TEST_OVERRIDES:1 …` を試験の前処理で起動し、Nodeのグローバル `WebSocket` と `fetch` で通す（`apps/edge/tests/`、`vitest`）。ホスト1・スマホ3が、作成 → 参加 → 入力 → 画面の指定 → 再接続 → 退出まで通ること。鍵の誤り（4007）・hello なし（4011）・過大フレーム（4002）・連打（4003）・満員（4005）・ロック（4006）・存在しない部屋（4004、`GET` は `exists:false`）・IPの上限（429）・日次の上限（503）・ホストの二重接続（4009）・ホストの再接続で `pad?` が届くこと・HTMLの書き換え・各ヘッダー（`Set-Cookie` がないことを含む）を確かめる。上書きが `ALLOW_TEST_OVERRIDES` なしでは効かないことも試験する。

### 5. 道具

- `tools/dev.mjs`：LANのIPv4を見つけ（`os.networkInterfaces()`）、`apps/web` を `vite build --watch` で、`apps/edge` を `wrangler dev --local --ip 0.0.0.0 --port 8787 --var PUBLIC_URL:http://<LAN-IP>:8787` で起動し、「大画面で開くURL」を表示する。終了時に子プロセスを残さない。
- `tools/smoke-edge.mjs`：起動済みのWorkerのURLを引数に取り、部屋の作成・ホスト・スマホ・入力の往復を1回通して、成功なら `OK`、失敗なら終了コード1。CIと実機の確認に使う。

## 受け入れ条件（すべて、あなたがコマンドを実行して確かめる）

1. `npm run typecheck`（ルート）が通る。
2. `npm test -w @irori/protocol -w @irori/room -w @irori/room-client -w @irori/edge` が通り、件数を報告できる。
3. 変異に対する門番の確認：次の7つを、一時的にコードへ入れて試験が落ちることを確かめ、元に戻す（報告に、変異・落ちた試験名を書く）。(a) レート制限の撤去 (b) フレームの大きさの検査の撤去 (c) 役割の検査の撤去（スマホがホスト専用フレームを通せる） (d) ホスト鍵の比較を常に成功にする (e) 二重の再開の札を置き換えない (f) 猶予後に席を空けない (g) 満員・ロック中の入室を通す (h) 転送時の `p` を、フレームの値から取る（なりすまし）。
4. `node tools/smoke-edge.mjs http://127.0.0.1:<port>` が `OK` を出す（`wrangler dev` を起動して実行）。

## 落とし穴（過去の実害）

- 「テストが0本でも成功」にならないよう、各パッケージで実行された件数を報告する。
- 待機は、プロセスの終了か状態の照会で行う。出力の文字列を待つループは書かない。
- 時刻に頼る試験は、実時間を待たず、注入した時計を進める。実サーバーを使う試験だけ、上書きした短い猶予（1〜2秒）を使う。
- 一時ファイルの名前に時刻だけを使わない（並列で重なる）。`mkdtemp` を使う。
- 「通った」だけを報告しない。コマンドと出力（件数）を貼る。

## 報告

`.agent-harness/runs/2026-10-16-bootstrap/reports/A1-report.md` に100行以内で：作ったもの、実行したコマンドと結果、契約からのずれ、未確認のこと、次の担当への注意。終わったら、結論を5行で返す。
