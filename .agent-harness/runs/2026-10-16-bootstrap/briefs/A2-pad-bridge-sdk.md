# 指示書 A2：pad-ui・host-bridge・sdk（スマホ画面の部品、隔離枠、ゲーム側SDK）

あなたは実装担当。設計は固定済みで、この指示書と `docs/` が契約。設計を変えたくなったら、変えずに報告へ書く。

## 目的

ゲームを隔離した枠で動かし、スマホの画面を6種の定型で描き、制作者が1ファイルのSDKだけで遊べる状態にする。**本物のブラウザで、ホスト側とゲーム側を実際につないだ試験**まで作る（スタブだけの試験は、契約の欠落を隠す）。

## 先に読む（読み取りのみ）

- `docs/sdk.md`、`docs/pad.md`、`docs/identity.md`（席の色と形・文字と部品の大きさ）、`docs/architecture.md`、`docs/decisions/0001-games-in-sandboxed-iframes.md`、`docs/decisions/0004-fixed-pad-kinds.md`
- `packages/protocol/src/{types,limits,bridge}.ts`（**変更禁止**。直したい点は報告に書く）
- `apps/web/src/shared/dom.ts`（`h()`/`svg()` は pad-ui の中に自分の小さな版を持つこと。apps への依存は禁止）

## 触ってよい場所

`packages/pad-ui/**`、`packages/host-bridge/**`、`packages/sdk/**`、`tools/sync-sdk.mjs`、`tests/e2e/playwright.config.ts` と `tests/e2e/bridge/**`。それ以外は触らない。`git` の書き込み系コマンド、`npm install`（新しい依存が要るなら、入れずに報告）、デプロイ、外部送信は禁止。ポートは 5190〜5199 を使う。

## 作るもの

### 1. `packages/pad-ui`

- `mountPad(container, { send, strings? }) → { setSpec(spec), releaseAll(), destroy() }`。`PadSpec` の7種（6種＋コンソール専用の `remote`）を描く。`remote` は十字・決定・戻るで、`btn` の id は `up` `down` `left` `right` `ok` `back`。
- 入力：Pointer Events とポインタキャプチャで、マルチタッチを `pointerId` ごとに扱う。`touch-action: none`、選択・長押しメニュー・ダブルタップ拡大を止める。ボタンは `btn` を、押した瞬間に `d:1`、離す・キャンセル・キャプチャ喪失で `d:0`。十字は `axis`（id `dpad`、x/y は -1・0・1）。スティックは円の中の位置を -1〜1 に（不感帯0.1、id `stick`）。`choices` は `pick`（押した瞬間、`disabled` のときと二重は無視）。`touch` は枠の内側の相対座標0〜1で `ptr`（`s`/`m`/`e`）。`tilt` は、`DeviceOrientationEvent.requestPermission` があれば「許可する」ボタンを出し、許可後に `deviceorientation` を購読する。頻度は `SEND_RATE_HZ` で間引く（最後の値は必ず送る）。
- `setSpec` と `releaseAll` は、押したままの入力を終わらせる（`btn` は `d:0`、`axis` は `x:0,y:0`、`ptr` は `e`）。
- 見た目：`docs/identity.md` の色の変数（`var(--bg-card)` など）を使う。ボタンは48px以上。文字は `textContent` で入れる。ボタンは `<button>`、`aria-label` を付ける。
- `look(id)`：席番号 → `{ color, shape, label }`（例 `{ color:'#E69F00', shape:'circle', label:'橙の丸' }`）。形は丸・四角・三角・ひし形・星・十字・六角形・輪の8つ。`shapeSvg(shape, size, color)` も出す。これは SDK の仮想プレイヤーと、`apps/web` の両方が使う。
- 試験（happy-dom、`vitest`）：各種類の構造、入力の出力、`setSpec` での離し、上限の超過、`look` の8席で色と形が重ならないこと。

### 2. `packages/host-bridge`

- `resolveEntry(entry, consoleOrigin, opts)`：登録情報の `entry` を、枠のURLと属性に変える。同梱は `/games/<id>/index.html`、`sandbox="allow-scripts"`（`allow-same-origin` なし）。外部は https のみ（`opts.allowLocalhost` のときだけ `http://localhost` `http://127.0.0.1` も可）、**コンソールと同じオリジンは拒否**、`sandbox="allow-scripts allow-same-origin"`。URLに認証情報（`user:pass@`）があれば拒否。どちらも `allow="autoplay"`（音の再生だけ。カメラ・マイク・位置情報などは渡さない）、`referrerpolicy="no-referrer"`、`loading="eager"`。
- `parseDevParam(location)`：`?dev=<URL>` を、コンソールのオリジンがループバック・プライベートIP・`.local` のときだけ有効にする。それ以外は null。
- `GameFrame`：`start()` で枠を作る。握手（`BridgeHello` を受ける。`event.source` が自分の枠のとき**だけ**。それ以外は無視）→ `MessageChannel` を作り、`BridgePort` と一緒に `port2` を渡す → `HostToGame` の `init` を送る。`post(msg)`、`on('ready'|'setPad'|'vibrate'|'end'|'store'|'timeout'|'error', fn)`、`destroy()`（枠を外し、ポートを閉じる）。握手から10秒以内に `ready` が来なければ `timeout`。握手が3秒以内に来なければ `error`。
- `validateGameToHost(msg: unknown)`：ゲームから来るメッセージの検証（信用しない）。`setPad` の `spec` は `GamePadSpec` として `LIMITS` で検査（`remote` は拒否）、`vibrate` の `ms` は個数と値の上限、`end` の `results` は最大8件・有限の数・席番号が整数、`store.*` は鍵の長さと値の大きさ。通らないものは捨てて数える。1秒に100件を超えたら、枠を止めて `error`。
- `createGameStorage(gameId, backend)`：`irori:game:<id>:<key>` の名前空間、1つ16KB、合計64KB（`STORAGE_LIMITS`）。
- 登録情報の実行時の検査 `validateManifestEntry(json)`（スキーマの主要な条件だけ。完全な検査はビルドの道具が `ajv` で行う）。
- 試験：検証・解決・保存は単体で。**握手と枠は実ブラウザで**（次の節）。

### 3. `packages/sdk`（1ファイルのESM）

- `connect(options?) → Promise<Irori>`。枠の中（`window.parent !== window`）なら握手して本物のコンソールにつなぐ。握手が3秒以内に完了しなければ `IroriError('handshake-timeout')` で失敗する。最上位のページ（単体で開いた）なら、開発用の**仮想プレイヤー**になる（既定2人、`?mock=N` で1〜8人）。仮想プレイヤーは、キーボード（1人目はWASD・Space・E、2人目は矢印・Enter・Shift）と、画面脇に出す折りたたみのパネル（各プレイヤーの `pad-ui`、名前の横に `look` の形）で操作できる。`end()` では結果の簡易オーバーレイと「もう一度」を出す。保存は `localStorage`（`irori-mock:` の名前空間）。上部に「開発モード（仮想プレイヤー）」の小さな表示を出し、閉じられるようにする。
- `Irori`：`players`・`leader`・`on('players'|'input'|'pause'|'resume', fn)`（解除関数を返す）・`setPad(spec, to?)`・`vibrate(ms, to?)`・`look(id)`・`ready()`・`end(results?)`・`storage.get/set`（Promise）。API の契約は `docs/sdk.md`。入力の頻度は `SEND_RATE_HZ` を超えない（SDK 側で間引く必要はない。スマホ側の `pad-ui` が間引く）。
- ビルド：`vite build`（ライブラリモード）で `packages/sdk/dist/irori.js` の**1ファイル**に（外部の import が残らない、読める形＝minify しない）。60KB以下。`packages/sdk/irori.d.ts` を手で書き、公開APIと一致することを、`tsc` で型付きの例を通す試験で確かめる。
- `tools/sync-sdk.mjs`：`dist/irori.js` と `irori.d.ts` を `games/*/irori.js` と `apps/web/public/sdk/v1/irori.js` に写す。`--check` で、ずれがあれば終了コード1（同梱ゲームがまだ無ければ、そこは飛ばす）。

### 4. 実ブラウザの契約試験（Playwright、`tests/e2e/bridge/`）

`tests/e2e/playwright.config.ts` を作る（Chromium、ワーカー1、`reporter: list`）。小さな Node の静的サーバー2つ（別オリジン：`127.0.0.1:5191` と `localhost:5192`）で、ホスト用の簡易ページと試験用ゲームを配る。本物の `host-bridge` と本物の `sdk/dist/irori.js` を使い、モックにしない。確かめること：

1. 同梱方式（オリジンが空の枠、CORSヘッダーつき）と外部方式（別オリジン、`allow-same-origin`）の両方で、握手 → `init` → `ready` → `players` 更新 → `input` → `setPad`（検証つき）→ `pause`/`resume` → `end` が通る。
2. **悪意のあるゲーム**が、次を試みて、すべて失敗または無効になること：`parent.document` への到達、`top.location` の書き換え、`window.open`、フォームの送信、`alert`、`localStorage` と `document.cookie`（同梱方式）、ホストが渡していない `MessagePort` の取得、巨大・不正な形のメッセージの連投（枠が止まる）、カメラの要求。それでもホストは操作を続けられる。
3. なりすまし：別のウィンドウや別の枠が、ホストへ握手を送っても無視される。
4. 外部方式でコンソールと同じオリジンのURLを渡すと拒否される。`ready` を返さないゲームは10秒で `timeout`（試験用に短くできること）。
5. 単体で開いた SDK が、仮想プレイヤーとして動く（`?mock=3`、キーボード、`end`）。

## 受け入れ条件（あなたがコマンドを実行して確かめる）

1. `npm run typecheck`（ルート）が通る。
2. `npm test -w @irori/pad-ui -w @irori/host-bridge -w @irori/sdk` が通り、件数を報告できる。`npm run build -w @irori/sdk` が60KB以下の1ファイルを作る（`import` 文が残っていないことも試験で確かめる）。
3. `npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/bridge` が通る。
4. 変異に対する門番の確認：次の6つを、一時的にコードへ入れて試験が落ちることを確かめ、元に戻す（報告に、変異と落ちた試験名を書く）。(a) `sandbox` 属性の撤去 (b) 同梱方式への `allow-same-origin` の付与 (c) `event.source` の検査の撤去 (d) `validateGameToHost` の `setPad` の検査を素通りにする (e) 外部方式のコンソールと同じオリジンの拒否を外す (f) `setSpec` での離し（`d:0` の補い）を外す。

## 落とし穴（過去の実害）

- 実ブラウザの試験は、画面がロックされた状態だとChromiumが起動しないことがある。起動できなければ、止まって報告する（別の手段へ勝手に切り替えない）。
- 押すタイミングに関わる試験は、等速で数回通っただけで安定としない。押下と差し替えの間隔を0〜500msで振る試験を1本入れる。
- 試験用のサーバーのポートと一時フォルダは、並列で重ならない名前にする（`mkdtemp`）。
- 待機は、状態の照会かプロセスの終了で行う。出力の文字列を待つループは書かない。
- 「通った」だけを報告しない。コマンドと出力（件数）を貼る。

## 報告

`.agent-harness/runs/2026-10-16-bootstrap/reports/A2-report.md` に100行以内で：作ったもの、実行したコマンドと結果、契約からのずれ、未確認のこと、次の担当への注意。終わったら、結論を5行で返す。
