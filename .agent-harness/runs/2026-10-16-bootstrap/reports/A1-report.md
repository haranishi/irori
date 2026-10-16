# A1 報告：中継の核と Worker（追補2で、セキュリティの指摘を再現してから直した）

設計は変えていない。指示書と食い違う点・書かれていなかった点は「契約からのずれ」に理由つきで挙げた。最新の件数と上限の一覧は、末尾の「追補2」にある。

## 初回：受け入れ条件の4つを、すべてコマンドで確かめた

型検査は終了コード0。試験は計309件（protocol 174・room 58・room-client 32・edge 45）。変異は room 8・protocol 5・edge 9 がすべて KILLED。煙試験は `wrangler dev --local` に対して `OK`、サーバーのない URL では終了コード1。指示書の (a)〜(i) の変異と、落ちた試験は次のとおり。

- (a) レート制限 → room「瞬間120個までは通し…4003 で閉じる」。(b) 大きさ → room「513バイトは 4002 で閉じて転送しない」。(c) 役割 → room「スマホがホスト専用のフレームを送っても、効かずに違反になる」。(d) 鍵の比較 → room「鍵が違えば 4007」
- (e) 二重の札 → room「古いほうを 4009 で閉じる」。(f) 猶予の後の席 → room「猶予の60秒が過ぎると席を空け…」。(g) 満員・ロック → room「4005」「4006」の各試験
- (h) `p` をフレームから取る → room「席番号と受信時刻を付けてホストへ運ぶ」と protocol「なりすまし」。(i) 存在確認の回数 → edge「…毎分の上限を超えると 429」「存在しない部屋への WebSocket も同じ枠で数える」

## 作ったもの

- `packages/protocol/src/`：`validate.ts`（4方向の検証・`validatePadSpec`・ping/pong の定数）、`names.ts`（`sanitizeName`・数える補助・`utf8Length`）、`code.ts`
- `packages/room/src/`：`RoomCore`。イベントを受けて send・close・persist・alarm・destroy を返す
- `packages/room-client/src/`：`RoomSocket` と `roomSocketUrl`
- `apps/edge/src/`：Worker と、Durable Object の `Room`・`Limiter`。Durable Object では setTimeout・setInterval を使わない
- `apps/edge/tests/`（wrangler dev を3つ起こす前処理と、試験8ファイル）、`tools/dev.mjs`・`tools/smoke-edge.mjs`、`tools/mutations/specs/{room,protocol,edge}-a1.json`

## 契約からのずれ

- `packages/protocol/src/index.ts` に export を3行足した（許可による例外）。`limits.ts` には追補2の定数を足した（許可済み）。
- 静的配信：`run_worker_first` を `["/", "/pad", "/pad/", "/api/*"]` にし、`/games/*`・`/sdk/*` のヘッダーは `apps/web/public/_headers` に書いた。`wrangler dev --local` でも効くことを実測した。HTML を直接開くと 307 で `/`・`/pad` へ移るので、HTML は必ず Worker を通る。vite の出力の形（`href="/" >`）も書き換わる。
- 保存する状態に `hostSeen` と `hostOffAt` を足した（休止をはさんでもホスト不在の90秒を数えるため）。上書きの変数に `LOOKUP_PER_IP_PER_MINUTE` を足した。
- 違反は5秒の窓で20回目に 4003 で閉じる。過大なフレームは数えず、その場で 4002（了承済み）。hello の前はスマホの上限（512バイト）で見る。
- 再開の札は入り直しで替えない（welcome を受け取る前に切れた端末が席を失わないため）。形の崩れた札は新しい参加として扱い、鍵は合わなければ 4007 にした。4001 は再試行の対象なので、壊れた値で入り直し続けるのを避けた。
- 名前の重複には空白なしで番号を付ける（「たろう2」）。空なら「プレイヤーN」。

## 未確認のこと

- 本番の Cloudflare では動かしていない。休止と課金の実際の振る舞い、実機（iOS の Safari）での切断と入り直しも見ていない。
- 一度も送信していない接続をサーバーが閉じると、相手の onclose が約10秒遅れて届く（ローカルの workerd で実測。誤りのフレームはすぐ届く）。本番で同じかは分からない。
- コードの衝突のやり直し（最大8回）は、衝突を起こせないため試験していない。IP を保存しないことは、コードを読んで確かめた（保存するのは日ごとの塩と、塩つきハッシュごとの回数で、仮名化にあたる）。
- 作成・存在確認・WebSocket の受け付けは、どれも1つの `Limiter` を通る。今の規模では問題ないと見ているが、負荷は測っていない。

## 次の担当への注意

- B1・B2：`RoomSocket` の状態は `connecting`・`open`・`reconnecting`・`replaced`・`closed`。4009 を受けた側は `replaced` になり、自動では入り直さない。人が押したら `reconnect()`、画面に戻ったら `probe(timeoutMs = 3000)` を呼ぶ。`send` は welcome の前は false を返す。ホストは `pad?` を受けたら、その席の画面を送り直す。
- スマホの hello は512バイトまで。名前は送る前に `sanitizeName` を通す（追補2で、12書記素・32符号位置・96バイトに収まる）。CSP の `style-src 'self'` で、HTML の style 属性は効かない。
- A2：同梱ゲームは `/games/<id>/` で開けば 307 の1往復が減る。結果の `label` の検査（`fitsGraphemes`）は書記素のままなので、受け手を符号位置で数える方針にそろえるかを相談してほしい。

## 追補：決まった3点と probe（済み）

4009 では自動で入り直さない（`replaced` の状態と `reconnect()`）。画面に戻ったときの `probe()` を足した。CSP は `DEV_FRAMES` が `"1"` のときだけ `frame-src` に `http:` を足し、dev.mjs がそれを渡す。`MAX_ROOMS_PER_DAY` は本番でも読む。当時の件数は、試験333件、変異 room 10・protocol 5・edge 11 がすべて KILLED、煙試験 `OK`。

## 追補2：セキュリティの指摘（高1・中1・低2）を、再現してから直した

**再現（直す前）**。状態機械では、hello→bye の100往復で保存が200回、ロックの切り替え80回で保存が80回出て、hello のない接続200本はどれも閉じなかった。実物の Worker でも、同じIPから hello のない接続200本がすべて開き、hello→bye の100往復が1.52秒ですべて通った。名前は、ミャンマー文字の結合子音13個を中継（workerd）が12個（36符号単位）残し、Node の `parseToHostFrame` は `joined` を「12より長い」として捨て、入り直したホストの `welcome` も捨てた。Node 24 は、4つの文字体系とも結合子音1つを2書記素と数えた。

**直した後（同じ条件で数え直した）**。同じIPからの hello のない接続200本は、握手が通るのが60本で、部屋が受け付けるのは16本。hello→bye の100往復は welcome 40回・断り60回。結合子音13個の名前は、Node でも `joined` を受け取れる。

**直したこと**。
- WebSocket の受け付けを、部屋に渡す前に IP ごとに数える（毎分60）。Origin がホストと違う WebSocket と部屋の作成は 403、`Sec-Fetch-Site: cross-site` の作成も 403。Origin のない curl・Node は通す。
- IPv6 は /64 に加えて /48 でも数える（上限は4倍）。作成と WebSocket に加え、存在確認にも当てた。
- 部屋ごとに、hello 前の接続を同時に16本まで（超えた新しい接続はすぐ 4003）、新しい席を1分に40まで（札での入り直しは数えない。超えた入室は 4003）、ロックの切り替えを1分に20まで（超えた分は無視して違反に数える）にした。
- 受け手は、名前を符号位置32・96バイトで、画面の文字を符号位置（上限の数は書記素のときと同じ）で数える。中継の `sanitizeName` は、12書記素・32符号位置・96バイトの先に届いたところで切る。最初の1書記素だけで超えるものは、空にせず符号位置で切る（画面側の既存の試験が求める）。room-client は名簿（welcome・joined）を、名前の長さだけでは捨てない（`parseToHostFrame(raw, { lenientNames: true })`）。
- 低2：最後の操作の時刻を、接続の付属情報に5秒刻みで載せ、復元のときに照らし合わせる。休止をはさんでも、無操作の20分が早く切れない。低4（塩の置き場）はコードを変えていない。

**上限の一覧**。運営者が `wrangler.jsonc` の vars で変える値（いつも読む）は、`MAX_ROOMS_PER_DAY`（既定2000、1〜1,000,000）と `WS_CONNECT_PER_IP_PER_MINUTE`（既定60、1〜10,000）。試験用の上書き（`ALLOW_TEST_OVERRIDES` が `"1"` のときだけ）は、`PAD_GRACE_MS`・`HOST_GRACE_MS`・`HELLO_TIMEOUT_MS`・`ROOM_IDLE_MS`・`CREATE_TTL_S`・`CREATE_PER_IP_PER_MINUTE`・`LOOKUP_PER_IP_PER_MINUTE`・`MAX_PLAYERS`。開発用は `DEV_FRAMES`。`limits.ts` に足した固定の値は、`NAME_MAX_CODEPOINTS` 32、`NAME_MAX_BYTES` 96、`WS_CONNECT_PER_IP` 毎分60、`IPV6_48_FACTOR` 4、`ROOM_MAX_PENDING` 16、`ROOM_NEW_SEATS_PER_MINUTE` 40、`ROOM_LOCKS_PER_MINUTE` 20。部屋ごとの3つは、`RoomLimits` で試験用に上書きできる。

| 条件 | 取り直した結果 |
|---|---|
| 1 型検査 | 終了コード0、`error TS` 0件 |
| 2 試験 | protocol 194件、room 66件、room-client 40件、edge 72件（8ファイル）。計372件が通過。ほかの部品の試験も通る（pad-ui 34・host-bridge 127・sdk 109・web 189） |
| 3 変異 | room 15件中15件、protocol 8件中8件、edge 15件中15件が KILLED |
| 4 煙試験 | `node tools/smoke-edge.mjs http://127.0.0.1:8796` が `OK` |

足した変異は12件。待ち中・新しい席・ロックの上限を外す、復元で付属情報の時刻を見ない、room-client が名簿の名前を長さで拒む、受け手が名前・画面の文字を書記素で縛る、中継が書記素だけで切る、WebSocket の栓と2つの Origin の確認と /48 を外す。コードが変わって効かなくなった3件（存在確認と作成の上限の行、書記素の上限）は、新しいコードに合わせて直した。

**ずれと残り**。
- 存在しない部屋への WebSocket は、部屋を起こす前に WebSocket の栓（毎分60）で数える。部屋の有無は起こさないと分からないので、存在確認の枠（毎分30）は、従来どおり部屋を起こした後に数える。
- 待ち中と新しい席の上限で閉じるときのコードは、専用のものがないので 4003（rate）にした。
- 札を持つ人が入り直しを繰り返すと、1回ごとに保存が2回出る。IP ごとの WebSocket の栓で毎分120回までに収まるが、保存を目覚ましでまとめる形は入れていない（休止の前に書き損じる危うさがあるため、測ってから決めたい）。
- 画面の文字を符号位置で数えるので、絵文字の多いラベル（家族の絵文字3つは15符号位置）は通らなくなった。
