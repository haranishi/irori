# poker-fix-1：第2回の仕上げ

## 修正と理由
- 指摘1〜12を修正。規則・役の比較結果・点の配分・保存・CPUの判断は変更していない。
- 先にCSSとmain/view/logicを整形。整形前後とも87件成功、画像36組のSHA-256が一致。
- 行動札のsubに今回出す総額を表示。「ふやす +40」は「合計60点」、あわせるも「出す20点」。
- 役に決め手の数を添え、同じ役と数の差を残りの札で破った勝者には「残りの札で勝ち」。
- 精算前のたまりと実受取額を表示用に記録。実際のpotは従来どおり0へ精算し、次の配札で表示記録を消す。
- 1人残りは受取人を見出しで案内し、手札を公開しない。配札の見出しも人数に依らない文に修正。
- 本人の手札と公開札だけから現在役を案内。120字を超える場合は長い場の一覧から省く。
- 0点で手札がない席には見るだけの案内と役の早見。救済の規則は追加していない。
- 8席の公開札は数字と柄を横に並べ、太さ・対比・大きさを改善。時計は無地の文字と独立した輪へ分離。
- 結果だけ20秒へ延長。「もう一度／ホームへ」の画面への遷移を案内。ほかの局面の時間は維持。
- 同率を含む全1位の順位・名前・点をstrongとCSSで強調。CPUの共通説明を一覧の外へ移動。
- SDKへ送るendの4項目・ranked:false・CPU入りのlabelは維持。

## 変更ファイル
- `games/poker/logic.js`・`view.js`・`main.js`・`style.css`
- `games/poker/presentation.js`（表示用の役説明だけを分離）
- `games/poker/feedback.test.js`・`view.test.js`
- `packages/protocol/tests/poker-end-contract.test.ts`（既存契約を維持し時計CSSの検査1件を追加）
- `.kiro/specs/game-pack-3/game-poker.md`、この報告。
- SDKの写し・依存・登録・サムネイルを編集せず、Gitの書き込み操作も行っていない。
- 開発サーバーの既存生成手順による配信物の生成は実行した。ほかの担当のソース変更には触れていない。

## コマンドと結果
重いコマンドはnice -n 10を付けた。優先度変更は環境に拒否されたが、処理は継続。試験は1ワーカー。
- `npx vitest run --config vitest.games.config.ts games/poker --maxWorkers=1`：最終7ファイル104件成功、140.51秒。
- 内訳は既存87件＋回帰17件。2〜8席各2000局と人1＋CPU3／人4各2000局の計18,000局を含む。
- 全局終了・合法手・点と札の保存・秘匿・pad上限・CPUの印による結果の不変を維持。
- `cd packages/protocol && npx vitest run tests/poker-end-contract.test.ts tests/cpu-end-contract.test.ts`：2ファイル18件成功。
- `npm run typecheck:games`：終了0。`npm run check`：全7項目成功、登録13件・SDK13本。
- `git diff --check -- games/poker packages/protocol/tests/poker-end-contract.test.ts .kiro/specs/game-pack-3/game-poker.md`：終了0。
- 最終整形後にも回帰17件成功。試験でCSSを読む処理はゲームの依存制約に合わせ契約試験側へ置いた。
- `.probe-tmp/poker-fix-mutations.mjs`：17種類すべて故障時に終了1、失敗した試験あり。finallyで原本へ復元・ハッシュ照合。
- 対象：結果文・20秒・1位強調・CPU説明の位置・時計構造/無地・総額・役の数・キッカー・受取額・たまり・次配札で消去・両見出し・現在役の秘匿・120字・観戦早見。
- 時計CSSを契約側へ移した後も `.probe-tmp/poker-fix-clock-mutation.mjs` で故障時の赤を再確認し、復元後に契約18件の緑を確認。
- 詳細ログは `.probe-tmp/poker-fix-*.log`、変異一覧は `.probe-tmp/poker-fix-mutations.json`。

## ブラウザと画像
- 指定の接続先Chromiumに専用contextで接続し、すべてfinallyでclose。新規ブラウザは起動していない。
- `timeout 3000 env IRORI_DEV_PORT=8832 node tools/dev.mjs` 相当で起動。配信が古い場合があり、通常のvite build後に再起動した。
- `.probe-tmp/poker-fix-play.mjs`：mock=1/4/8/5すべて6ハンド→結果→コンソール結果、CPUデモの次局を確認。
- 4構成とも本人の手札が他席padに混ざらず、ページエラー0件。結果の待ち時間は20500ms進めて確認。
- `.probe-tmp/shots-poker2/before/`：修正前36枚。`formatted/`：整形のみ36枚（原本から作ったソースを撮影用に差し替えて照合）。全組一致。
- `after/`：修正後36枚＋1人残り・キッカー・観戦padの3枚。通常のWorker配信で撮影。
- `final/`：最後の整形後ソースを撮影用に差し替え36枚。afterとのSHA-256が全組一致。
- `play/`：実操作の途中/結果24枚。`compare.html`・`compare.png`：修正前後を横並びにした比較。
- 8席勝負1024/1920、CPU入り結果1024、8席結果、1人残り・キッカー・観戦padと比較画像を実際に閲覧。
- 4構成×3局面×3サイズの座標検査で席間は最小9.75px。卓の便りとの重なり0件。
- 自分が起動した開発サーバーを割り込みで終了。8832・8833は最後に両方ECONNREFUSED。8787には触れていない。

## 未確認・メインへの質問
- 実機、人同士、WebKit、第2回の独立採点は未実施。今回の画像確認は実装者の自己点検。
- 0点席に救済の規則を足すかは本人の判断事項。今回は依頼どおり見るだけを維持した。ほかに判断待ちはない。
- サムネイルは撮り直していない。今回の修正はゲーム中の説明と読みやすさで、登録変更を要しないため。
