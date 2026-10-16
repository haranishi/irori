# 権利と事実の独立レビュー（R-rights）：要対応は5件。最も重いのは、サムネイル3枚の文字がOSの書体で描かれていること

2026-10-16に、読み取りだけで確かめた記録で、法的助言ではない。対象は、最初のコミットで公開される453ファイル（`git ls-files --others --exclude-standard`。コミットはまだ無い）。実行した検査は `npm run check`・`reuse lint`・`gitleaks dir`・`node tools/check-overlap.mjs`・`npm audit --omit=dev` と、道具の単体試験20件。調べていないことは、末尾の「確認できなかったこと」に分けた。レビューの最中にも、並行の作業でコードと文書が変わった（07:50〜08:08）ため、下に引いた行番号と件数は08:12時点の中身で確かめ直した。

## 要対応（5件）：公開前に直す

1. **サムネイル3枚（hello-pad・tap-race・dot-grab）の文字が、OSの書体（ヒラギノ丸ゴシック）で描かれている。**
   - 場所：`registry/thumbs/` の3枚。文字はすべて canvas に描かれ、書体は `games/*/main.js` の固定値 `FONT`（先頭が `ui-rounded, "Hiragino Maru Gothic ProN"`）で決まる。`tools/make-thumbs.mjs` 119行の差し替えはCSSなので、canvas には効かない。
   - 証拠：手元の Chromium で、`FONT` とヒラギノ丸ゴシック単独は、同じ文字列の幅が一致した（168.30px）。拡大した字形も端が丸い（Noto Sans JP は角ばる）。`apps/web/public/og.png` と `quiz-4.png` は DOM の文字で、字形は Noto だった。
   - 直し方：`THIRD_PARTY_NOTICES.md` 12行・`docs/identity.md` 27行・`docs/legal/rights-check.md` 11行の「Noto Sans（OFL）で描いた」が、この3枚では事実と違う。canvas の書体も OFL の書体に替えて撮り直すか、記述を直す。`waitForOflFonts` は読み込みしか見ないので、描いた字の書体を確かめる試験も足す。
2. **参考サイトのタイルを「縦長」と書いているが、実際は横長だった。文書が挙げる「違い」が成り立たない。**
   - 場所：`docs/research/reference-observations.md` 15行、`docs/decisions/0006-original-identity.md` 12行（借りないもの「縦長で角の丸い一覧のタイル」）、`docs/identity.md` 21行。
   - 証拠：参考サイトを1920×1080と1366×768で開くと、角丸タイルの幅と高さの比は約1.9対1と1.7対1だった。iroriのカードも横長4:3の角丸である。
   - 直し方：観察を直し、実際の違い（下の「確認できたこと」の比較）で書き直す。形の一致は、ありふれた構成の側として記録すればよい。
3. **権利確認の記録が空欄のまま。重なりの検査は、既定の設定で終了コード1になる。**
   - 場所：`docs/legal/rights-check.md` 末尾の「機械検査の結果」が空欄。一方で README は英日とも67行で、権利の確認を通したと書いている。
   - 証拠：`node tools/check-overlap.mjs --corpus <参考サイトの配信コード2ファイル>` で、照合用179,868並びに対し155件（13ファイルの65行）が一致した。中身はすべて定型だった（`flex-direction:column;align-items:center;gap`、`grid-template-columns:repeat(2,minmax(0,1fr))`、`user-select:none`、`prefers-reduced-motion`、`for (let i = 0; i < n; i++)`、`AbortError` の判定、qrcode-generator の呼び方）。
   - 直し方：表に、各検査の結果と、155件の分類を書く。値は下の「確認できたこと」を使ってよい。
4. **文書の数字と、まだ無い仕組みの記述を、事実に合わせる。**
   - `README.md`・`README.ja.md` 59行の「30行の見本」は、`docs/sdk.md` では html 3行と js 12行の計15行。
   - `docs/registry.md` 38行の「外部ゲームは、月に1回、握手の検査をCIで流し」は未実装。`.github/workflows/ci.yml` に該当するジョブが無く、`tools/check-registry.mjs` 6行も「握手の検査はここではしない」と書く。
   - `THIRD_PARTY_NOTICES.md` 8行の「下に全文を添える」の全文は、このファイルには無い（`licenses.txt` を作るときに足される）。11行の MPL-2.0 の開発依存から lightningcss 1.33.0（vite 経由）が漏れ、LGPL-3.0-or-later の sharp/libvips（wrangler→miniflare 経由、任意）も書かれていない。
   - `apps/web/og/og.html` 3行の「書体はOSのもの」は古い。`tools/make-og.mjs` は Noto に替えて撮る。
5. **公開と同時に、GitHub の非公開の脆弱性報告を有効にする。** 権利者の申立て（`docs/legal/reference-policy.md` 29行、`docs/registry.md` 38行）と行動規範の報告（`CODE_OF_CONDUCT.md` 7行）は、どれも「Report a vulnerability」を窓口にしている。この機能は、リポジトリごとに有効にしないと画面に出ない。

## 要判断（保守者が決める）

- **名前「irori」：記録に無い同名のゲームが1つある。** 記録の2件は事実だった。株式会社イロリ（東京都千代田区、「Crafty」、2022年12月設立）と、情報メディアのアプリ「irori」（企業紹介では運営は株式会社アスクリード、irori.link）。ほかに itch.io のゲーム「irori」がある（https://pomepomelo.itch.io/irori ）。同じゲームの分野なので、J-PlatPat の結果とあわせて決める。
- **着想元の記録を、そのまま公開するか。** `.agent-harness/runs/2026-10-16-bootstrap/research/legal-facts.md` には任天堂と Wii U への言及が43か所あり、32行に「Wii U のような雰囲気」とある。`docs/research/reference-observations.md` と `tools/check-rights.mjs` 9行には、参考サイトの識別子（vvii・itsu.dev・驚額・んぽたそ）が載る。どれも事実の言及だが、着想の経緯を公開することになる。
- **実名の著作権表示。** 「Ikki Nishihara」が `LICENSE-MIT` 3行、`REUSE.toml` の4か所、`docs/legal/license-policy.md` 17行などにある。コミットの作者は noreply に設定ずみ。意図どおりなら直さなくてよい。
- **小さな帰属表示を足すか。** Vite の modulepreload の補助（MIT、約670バイト）が `phrase-*.js` に入るが、表示に無い。スマホの画面は BudouX の重みを受け取るのに、`/licenses.txt` への導線が無い。
- **IPの消え方の書き方。** `docs/legal/data-handling.md` 12行の「日次で消える」は、正確には「UTCの日が変わって最初の作成・照会のときに消える」（`apps/edge/src/limiter.ts` 87行）。その日のうちは塩も同じ保存領域にあるので、ハッシュは仮名化にとどまる。
- **重なりの検査の閾値。** 既定のままでは、定型のCSSで必ず落ちる。定型の並びを除く表を持つか、人が分類して記録する運用にするかを決める。

## 確認できたこと（方法つき）

- **配布物に入る依存は qrcode-generator 2.0.4（MIT）だけ。** `npm run check` の6点検はすべてOK。ロックの179件のうち、MPL-2.0 は14件（axe-core・@axe-core/playwright と lightningcss 系12件）、LGPL-3.0-or-later を含むものは14件（sharp/libvips、任意）で、ロック上はどれも開発用。GPL・AGPL・SSPL・独自条項は0件。`apps/web/dist/assets` を検索すると、中身は自前のコード、qrcode-generator、BudouX の重み、Vite の補助だけだった。axe-core を使うのは試験の2ファイルだけで、束の中の「axe」は Gamepad の `axes`。lightningcss の出力に残るのは、生成した変数名（`--lightningcss-dark`）だけ。`npm audit --omit=dev` は0件。
- **配る表示は最新で、元の表示とも一致する。** `licenses.txt` は、一時フォルダで作り直した結果と、`public`・`dist` のどちらとも同じ。ホストの「ライセンスとクレジット」から開ける。qrcode-generator の表示（2009 Kazuhiko Arase、MIT）は、取り込むファイルの見出しと上流の LICENSE に一致した。
- **BudouX の写しは、値が完全に一致する。** `apps/web/src/shared/phrase-model-ja.ts` を、budoux@0.9.3 の `module/data/models/ja.js`（jsDelivr から取得）と比べると、13群・1619値がすべて同じで、違いは型注釈だけだった。上流に NOTICE は無い。ファイル先頭の SPDX（2021 Google LLC、Apache-2.0）を、REUSE も採っている。
- **REUSE・秘密・衛生で、問題は見つからなかった。** `reuse lint` は仕様3.3に適合（コミットが無いため、無視されるファイルまで数えた結果）。`gitleaks dir . --redact` は0件。公開対象453件の走査では、私的な絶対パスは試験の架空の1件だけ、メールは example ドメインだけ、鍵らしい文字列は無し。採点用の画像は `.gitignore` で外れている。
- **参考サイトとの一致は、ありふれた構成にとどまると判断した。** 2026-10-16に chrome-devtools で1回開き、`review/shots-host`・`shots-pad` と比べた。一致は、角丸の横長タイルにゲームの絵を並べること、QRを右側に置くこと、選択を枠で示すこと、丸い和文書体の雰囲気。違うのは、配色（明るい灰の横じまと水色に対し、暖かい暗い茶と琥珀）、下の曲線の帯と時計・日付、4×3の一覧と送りボタン、ロゴとアイコン。文言の重なりも無い（参考は「はじめての vvii」「次のページ」「技術同人誌の案内」など）。
- **画面に出る他社名は、共有先とブラウザを示す文字だけ。** X・LINE・Instagram・YouTube・Chrome・Safari・Edge・Firefox を文字で出し、ロゴは使わない（`apps/web/src/host/icons.ts` 1行）。LINE の公式の設計ガイドは独自のボタンを認め、日本語の表記に「LINEで送る」を勧めている。QRコードの商標の表示は、README と `licenses.txt` にある。文書の中の任天堂・Jackbox・AirConsole は、比較と出典としての事実の言及で、名前・ロゴ・見出し・宣伝には使っていない。
- **quiz-4 は26問すべてを確かめ、食い違いは0。** 日本の12問は、文化庁「日本の世界遺産一覧」の所在地と一致した。自由の女神の島（ニューヨーク州）とグランドキャニオン（アリゾナ州）は、米国国立公園局の原文が README の引用どおり。タージ・マハルはウッタル・プラデーシュ州観光局の公式サイトで、マチュ・ピチュ・ペトラ・ギザはコトバンクの引用で確かめた。残る8問は、ユネスコ世界遺産センターの登録名と国で照らした。問題文に、企業名・個人名・商標は無い。
- **同梱の4本に、外から持ち込んだ素材は無い。** `games/` にあるのは HTML・JS・CSS・Markdown・型定義だけで、画像・音声・書体のファイルは0件。絵はコードで描き、音は出さない。axe-core を含む依存を書き換える仕組み（patch-package など）も無い。
- **子ども向けの注意は、実装でそろっている。** 本名を入れない案内、全年齢だけの登録、チャットが無いこと、共有するのは部屋でなくサイトのURLであること、参加の締め切りと退出させる操作。名前の不適切な語を止める仕組みは無く、ホストの退出操作に頼っている。
- **情報の扱いの表は、実装と合う。** ホストは sessionStorage に `irori:host:room` と `irori:host:trusted`、localStorage にゲームの保存を置く。スマホは localStorage に `irori:name`、sessionStorage に `irori:resume:<コード>` を置く。Cookie は消して返し（`apps/edge/src/index.ts` 94行）、ログは無効（`apps/edge/wrangler.jsonc` の `observability`）、部屋は最長12時間（`ROOM_MAX_MS`）。外部からの読み込みは無い。参加画面に「本名や連絡先は入れないでください」とあり、登録は `rating: "all"` だけ。
- **README の数字は、「30行」（要対応4）以外は合う。** 8席・60秒・4文字・操作盤6種・同梱4本・Node 24以上・呼び出し約10（connect を含めて9）を、定数とスキーマで確かめた。
- **運営の宿題6つは、実装と合う。** 1（PRのひな形の権利の確認欄と、取り下げの手順）、2（解析と外部の読み込みが無い）、4（ニックネームの案内と全年齢）、5（課金のコードが無い）、6（ひな形を置かない）。3（届出）は文書だけの宿題。
- **法令資料は、抜き取りで一次資料と合った。** 個人情報保護委員会 Q&A 1-62、総務省の外部送信規律 FAQ 問2-8・問1-11、東京地判平成26年7月30日（平成25(ワ)28434）の存在を確かめた。AirConsole の親会社の記述（KPIT が約9割、2025年10月）も報道と合う。

## 確認できなかったこと

- J-PlatPat での商標・意匠・特許の登録（「irori」、任天堂の名称とメニューの画面、操作盤とQR参加）。このレビューでも検索していない。
- 参考サイトのスマホ側の画面、音、動き。部屋には入らなかった。
- ユネスコの各ページの本文。取得を拒まれた（403）ため、検索結果の登録名で代えた。東京地判平成26年7月30日の判決本文も読んでいない。
- 全体の単体試験と通しの試験。流したのは、道具の単体試験20件（権利と書体）だけ。
- 履歴を含めた gitleaks の走査。コミットが無いため、最初のコミットの後に流す必要がある。
- ヒラギノ丸ゴシックで描いた画像を CC BY 4.0 で配ることが、書体の使用許諾の上で問題になるか。ここでは、文書の主張と方針に反する点を要対応にした。
