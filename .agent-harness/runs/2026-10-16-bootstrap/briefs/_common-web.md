# B1・B2・C1 に共通の連絡（A1・A2 の完了後に確定した事実）

指示書と食い違うときは、こちらを優先する。

## 共有の場所を壊さない（B1・B2・G が同時に動く）

- `apps/web/dist` は共有。作らない・消さない。ビルドは `tools/lib/edge-server.mjs` の `buildWeb()` で、自分専用の出力先に作る（中身は `vite build --outDir <mkdtemp> --emptyOutDir`）。容量の計測もそこで行う。指示書の「`npm run build -w @irori/web` が通る」は、これで満たしたことにしてよい。
- 実 Worker は、同じファイルの `startEdge({ name, assetsDir, port, inspectorPort, vars })` で起動・停止する。ポートは自分の範囲から `pickPorts` で選ぶ。`wrangler dev` を素手で起動しない（既定の設定は `apps/web/dist` を配るので、ほかの担当と衝突する）。
- 単体の試験は `apps/web/tests/**/*.test.ts`（`apps/web/vitest.config.ts` が拾う。happy-dom）。実ブラウザの試験は `*.e2e.ts`（vitest には入れない）。置き場所：B1 は `apps/web/tests/host/`、B2 は `apps/web/tests/pad/`。Playwright の設定：B1 は `apps/web/playwright.host.config.ts`、B2 は `apps/web/playwright.pad.config.ts`。`apps/web/package.json` には、自分の scripts（`test:e2e:host` / `test:e2e:pad`）だけを足してよい。
- `apps/web/public/{sdk,registry,games}/` と `licenses.txt` は生成物（A2 と G の道具が書く）。読むだけ。
- 日本語の文書は、書いたあとに出る lint の指摘を1件ずつ「直す／残す（理由）」で判断する。

## 通信（`packages/room-client`）

- `RoomSocket` の状態は `connecting | open | reconnecting | replaced | closed`。`open` になるのは welcome を受けたあと。`send` は `open` 以外では何も送らず `false` を返す（古い入力を後から届けないため）。スマホは welcome の `resume` を `sessionStorage` に置き、`resume: () => …` で渡す。
- **`replaced`（別の画面に取って代わられた。4009）は、自動で入り直さない。** 「ほかの画面で開かれました」と、押したときだけ `reconnect()` を呼ぶボタンを出す（スマホもホストも）。`kicked` `closed` `no-room` `auth` `full` `locked` も自動では入り直さない（`error` イベントの `fatal: true`）。
- `probe(timeoutMs = 3000)`：`visibilitychange`（見えるようになったとき）・`pageshow`・`online` で呼ぶ。画面ロックのあとの死んだ接続を、30秒待たずに捨てて入り直す。
- スマホの `hello` は512バイトを超えると 4002 で閉じる。名前は `sanitizeName` で切ってから送る。
- `frame` の購読関数が例外を投げると、ほかの購読者に届かない。購読関数の中は `try/catch` で守る。

## 配信と CSP（試験は実 Worker を通すので、本番と同じものが効く）

- HTML の CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' と同じホストの ws/wss; frame-src 'self' https:`。**インラインの `style` 属性・`<style>`・インラインの `<script>`・`eval` は動かない。** 見た目は CSS ファイルのクラスで書き、動的な値は CSSOM（`el.style.setProperty('--x', v)`、`el.style.transform = …`）で入れる。`setAttribute('style', …)` と、`innerHTML` の中の `style=` は不可。SVG の `fill` `stroke` などの属性は使える。
- `?dev=http://…` のゲームが枠に入るのは、環境変数 `DEV_FRAMES=1` の開発用サーバー（`npm run dev`）だけ。本番では `https:` のみ。
- 同梱ゲームは `/games/<id>/`（末尾のスラッシュつき）で開く（`/games/<id>/index.html` は 307 で転送される）。
- 自分のブラウザ試験で、`securitypolicyviolation` イベントと、コンソールのエラー・警告が **ゼロ** であることを確かめる。

## 文言

`addMessages(locale, messages)` で、自分の画面の文言を登録する（ホストは `host.*`、スマホは `pad.*` のキー）。`apps/web/src/shared/i18n.ts` の形は変えない。

## 部品（A2）

- `@irori/pad-ui`：`mountPad({ send, strings? })`（`wait` `pad` `buzzer` `choices` `touch` `tilt` と、コンソール専用の `remote`）、`look(id, locale?)`、`shapeSvg(shape, size, color)`、`SHAPES`。CSS は `@irori/pad-ui/pad.css`。押している最中に画面が差し替わると、離し（`btn` の `d:0`・`axis` の 0,0・`ptr` の `e`）を自動で送る。傾き（`tilt`）は、HTTP の文脈では案内を出し、購読だけ行う。
- `@irori/host-bridge`：`resolveEntry(entry, consoleOrigin, { allowLocalhost })`、`parseDevParam(location)`、`GameFrame`、`createGameStorage`、`validateManifestEntry`。`new GameFrame({ container, source, init: { players, leader, locale, paused }, storage?, title? })` を作って `start()`。イベント：`ready` `setPad` `vibrate` `end` `store` `timeout` `error`。ホストからは `post({ m: 'players' | 'pause' | 'resume' | 'input', … })`、片付けは `destroy()`。握手の既定の待ち時間は、同梱3秒・外部10秒。`error { reason: 'handshake' | 'rate' }` は枠が止まる（「ゲームを始められませんでした」と、ホームへ戻る手段を出す）。`timeout`（`ready` が10秒来ない）は枠を止めない（「応答がありません。待つ／ホームへ」）。`end` のあと、枠は `setPad` と `vibrate` を受け付けない（結果のあいだのリモコンと待機画面は、コンソールが送る）。
