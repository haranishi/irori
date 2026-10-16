# 指示書 B1：ホストの画面（コンソール）

あなたは実装担当。設計は固定済みで、この指示書と `docs/` が契約。設計を変えたくなったら、変えずに報告へ書く。前提：A1（`packages/room-client`・`apps/edge`）、A2（`packages/pad-ui`・`packages/host-bridge`・`packages/sdk`）、G（`registry/` と同梱ゲーム）が作り終えている（Gがまだなら、`apps/web/public/registry/index.json` は、`registry/games/*.json` を使う `tools/build-registry.mjs` で作る）。

## 目的

大画面のブラウザで開く `/`。QRと4文字のコード、ゲームの棚、結果、メニュー、共有を持つ。見た目は `docs/identity.md` の独自のもの。基準は「開いてから15秒で最初のゲーム」。

## 先に読む（読み取りのみ）

`docs/ux.md`（ユーザーストーリー・5階層・変わった12か所＝**すべて実装すること**）、`docs/identity.md`、`docs/protocol.md`、`docs/sdk.md`、`docs/pad.md`、`docs/architecture.md`、`docs/decisions/0005-no-ui-framework.md`、`packages/protocol/src/*`、各パッケージの公開API（`packages/room-client`・`packages/host-bridge`・`packages/pad-ui`）、`apps/web/src/shared/{dom,i18n}.ts`、`apps/web/src/styles/tokens.css`。

## 触ってよい場所

`apps/web/index.html`、`apps/web/src/host/**`、`apps/web/src/shared/**`（`dom.ts` と `i18n.ts` は直してよい。公開の形を変えるときは報告）、`apps/web/src/styles/**`、`apps/web/public/{favicon.svg,og.png}`、`apps/web/og/**`、`tools/make-og.mjs`。`apps/web/src/pad/**` と `apps/web/pad.html` は別の担当（B2）の場所なので触らない。`git` の書き込み系コマンド、`npm install`（要る依存は報告）、デプロイは禁止。ポートは 5220〜5239 と 8800〜8819（`wrangler dev` 用）。

## 作るもの

### 状態と部屋

`boot → connecting → home ⇄ detail → launching → playing ⇄ paused → results → home`、異常は `offline` `busy` `closed`。部屋は `POST /api/rooms` で作り、コードと鍵を `sessionStorage` に持つ。再読み込みでは、同じ鍵で同じ部屋に戻る（部屋が消えていたら新しく作る）。`503 busy` では理由と「あとで試す」を出す。サーバーからのフレームは `parseToHostFrame` を通す。状態遷移は、画面に依存しない純粋な関数に分け、単体で試験する。

### ホーム

主役は、選択中のゲームのカード1枚（サムネイル、題名、一言、人数、使うコントローラーのアイコン、作者、ライセンス、外部ゲームならホスト名の注意）。その下に、棚（4:3のカードの横並び）。QRとコードは右下の1か所：QRは `qrcode-generator` で、**明るい地に暗いモジュール**のSVGにし、静かな余白を取る。URLは `${location.origin}/pad#${code}`、コードは等幅の大きな文字。下に参加者の帯（色と形の印・名前・接続中かどうか・リーダーの印）。人数が足りない・多すぎるゲームは灰色にし、理由を1行（例「あと1人で遊べます」「最大4人です」）。最初の1人が入るまで、3手順の案内を出す。ロックの切り替え（誰も新しく入れない）、音のオン/オフ、共有の入口を持つ。

### 操作

キーボード（矢印・Enter・Esc・M）、ゲームパッド（Gamepad API：十字・左スティック・A・B）、リーダーのスマホ（`remote` の `btn` id：`up` `down` `left` `right` `ok` `back`）のどれでも、同じ操作。フォーカスの輪は `--glow` 3px、選択のカードは1.06倍（`prefers-reduced-motion` で止める）。リーダーは最初に入った席。離れたら、接続中の最小の席へ移る。ホームと結果とメニューでは、リーダーに `remote`、ほかの席に `wait`（「{名前}が選んでいます」）を送る。ゲーム中はゲームの指定に従う。

### ゲームの実行

`host-bridge` の `resolveEntry` と `GameFrame` を使う。`?dev=` は `parseDevParam` に従う。外部ゲームは、開く前に「{ホスト名} のサーバーに接続します」の確認を出す（同じホスト名は、そのタブでは1回だけ）。席の増減は `players` として渡す（`pad?` を受けたら、その席に最後の画面を再送する。ホスト側で、席ごとに最後の `PadSpec` を覚えておく）。スマホの `menu` 入力で一時停止（メニュー：続ける・ホームへ・音・ロック・QRの再表示）。`ready` が来ないとき、`end` が来たときの画面。`end` の `results` は、順位・色と形・名前・点数・ラベルで結果の画面に出し、「もう一度」を最初の選択にする。

### 共有

`share.ts`：端末の共有シート（`navigator.share` があるときだけ）・X（`https://x.com/intent/post?text=&url=`）・LINE（`https://social-plugins.line.me/lineit/share?url=`）・リンクのコピー（`navigator.clipboard`、失敗時は `textarea` と `execCommand`）。共有するのは**サイトのURL（`location.origin + '/'`）**であって、部屋のURLではない（知らない人が入ってくるため）。InstagramとYouTubeには、Webから投稿画面を開く公式の仕組みがないので、ボタンを作らず、画面に一行で書く。ホームと結果に置く。ボタンは44px以上。

### 画面の消灯とブラウザの前提

ホストの画面も、部屋があるあいだは `navigator.wakeLock` で消灯を防ぐ（取れないブラウザは何もしない。`visibilitychange` で取り直す）。ホストの正式な対応環境はPCのブラウザ（Chrome・Safari・Edge・Firefoxの最新版）。TVの内蔵ブラウザやタブキャストは「動けば可」で、動かなかったときの案内だけ出す。ブラウザが音を止めているあいだ（ホストの画面を一度もクリック・キー操作していない）は、小さな案内「音を出すには、この画面をクリックするかキーを押してください」を出す。

### OGP・アイコン・音

`index.html` のメタは、土台のとおり（相対パス。Workerが絶対URLに直す）。`favicon.svg` は「irori」の自作の形。`og.png`（1200×630）は、`apps/web/og/og.html` を描画して `tools/make-og.mjs`（Playwright）で作り、コミットする（再生成の手順を冒頭に書く）。文字は後乗せにしない：HTMLで描く。音は WebAudio の合成だけ（移動・決定・戻る・参加・開始・結果）。最初のキー・クリックのあとに有効化し、それまでは小さな案内を出す。音声ファイル・書体ファイル・外部ドメインの読み込みは、1つも入れない。

### ライセンスとクレジット

ホームの隅（共有の近く）とメニューに、「ライセンスとクレジット」のリンクを置く（新しいタブで `/licenses.txt` を開く。`tools/build-notices.mjs` が、ビルドで `THIRD_PARTY_NOTICES.md` から作る）。QRコードの登録商標の表記は、このファイルにある。

### 画面の文言

すべて `t()` を通す（日本語と英語）。スマホやゲームから来た文字列は、`textContent` で入れる（`innerHTML` の使用はゼロ）。

## 受け入れ条件（あなたがコマンドを実行して確かめる）

1. `npm run typecheck`、`npm test -w @irori/web`、`npm run build -w @irori/web` が通り、件数とビルドの容量を報告する。JSは gzip で80KB以下（ビルド後に測る。超えたら理由を報告）。
2. `npm run build` のあと、実Worker（`wrangler dev --local --port 88xx`）に対して、Playwright（Chromium）で、ホストの画面を開き、**スマホ役のページを `?`でなく実際の `/pad#CODE`（B2が作るまでは、`packages/room-client` を使う簡易のスクリプト）で3台つなぎ**、ホームの表示・参加者の帯・人数に合わないゲームの灰色・リーダーのリモコン・ゲームの起動と終了・結果と「もう一度」・メニュー・共有の4つを、操作して確かめる。
3. 画面の確認：1920×1080、1366×768、390×844 の3幅で、ホーム・ゲーム中のメニュー・結果・共有・初回の案内・エラー3種のスクリーンショットを `.agent-harness/runs/2026-10-16-bootstrap/review/shots-host/` に撮る。目視して、はみ出し・文字の重なり・小さすぎる文字・コントラスト不足がないか自分で点検し、直したことを報告する。
4. 権利の点検：`node tools/check-rights.mjs`（禁止語・音声と書体のファイル・外部ドメインの読み込み・私的なパスを拒む）と、`node tools/check-deps.mjs`、`node tools/check-docs.mjs` が通る（文書のリンク切れは、まだ無い文書への参照なら、報告に書く）。
5. 変異に対する門番の確認：(a) 席が足りないゲームを灰色にしない (b) 外部ゲームの確認を出さない (c) 共有URLを部屋のURLにする (d) `innerHTML` で名前を描く (e) リーダーの引き継ぎを外す、を一時的に入れて、試験が落ちることを確かめ、元に戻す。これらは手作業で終わらせず、`tools/mutations/specs/host-*.json` に仕様として残し（形は `tools/mutations/run.mjs` の冒頭）、`node tools/mutations/run.mjs --only host-` で全件が KILLED になることを確かめて、件数を報告する。`tools/mutations/` と `tools/tests/` は、`specs/` に自分のJSONを足す以外は触らない。

## 落とし穴（過去の実害）

- 画面がロックされた状態では、Chromiumが起動しないことがある。起動できなければ、止まって報告する。
- 画面の確認は、アニメーションが止まってから撮る（`document.getAnimations()` の完了を待つ）。撮影の都合で、色の遷移の途中を「不具合」と報告しない。
- 固定の帯・重なる要素は、全画面撮影で位置がずれて写る。固定要素の判定は、ビューポート撮影の別の画像で行う。
- 待機は、状態の照会で行う。出力の文字列を待つループは書かない。
- 「通った」だけを報告しない。コマンドと出力（件数）を貼る。

## 報告

`.agent-harness/runs/2026-10-16-bootstrap/reports/B1-report.md` に100行以内で：作ったもの、実行したコマンドと結果、`docs/ux.md` の12か所の実装の場所、契約からのずれ、未確認のこと（実機・音・TVのブラウザ）。終わったら、結論を5行で返す。

## 追加の連絡

先に `briefs/_common-web.md` を読む（共有の場所を壊さない決まり、試験の置き場所、通信、CSP、部品の使い方）。指示書と食い違うときは、そちらを優先する。

- 受け入れ条件2の確認に、ホストの `replaced`（同じ鍵で2つ目のホストをつなぐ：古い側に案内と「ここで続ける」が出て、自動では入り直さない。押すと入り直す）と、`visibilitychange` での `probe()`（死んだ接続が早く入り直される）を足す。
- 変異の(a)〜(e)に加えて、(f) `replaced` で自動の再接続を続ける、(g) 画面に戻っても `probe()` を呼ばない、も仕様にする（`host-*.json`）。
- 同梱ゲームの一覧は `apps/web/public/registry/index.json`（G が `tools/build-registry.mjs` で作る）。まだ無いあいだは、単体試験用の固定データを `apps/web/tests/fixtures/` に置く。通しの確認の前に、本物を使う。
