# poker-fix-3：第3周の独立採点（合格）で見つかった実在の不具合3件と小さな改善2件

担当の Codex は、会社用アカウントのクレジット切れ（`Your workspace is out of credits`）で、最後の確認と報告の前に止まった。変更と変異の確認は終わっていたので、親（メイン）が変更を読み、試験・型検査・規則の検査・画像を自分で確かめて、この報告を書いた。

## 直したこと
- 履歴の言葉：「上限まで920」の札を押したのに、卓の便りが「ぜんぶ920」と出ていた。行動したときの持ち点と比べた区別（`capLabel`）を記録し、札のラベルと同じ基準にそろえた。CPU も同じ。精算後も文言が変わらない。
- 勝負待ち：「ぜんぶ」で持ち点が一時的に0になっただけの席に「見るだけ」と出ていた。勝負に残っている（おりておらず手札がある）あいだは、大画面の席の補足もスマホの `note` も「勝負待ち」。精算後も0点の席だけ「見るだけ」と役の早見。
- 早見の重なり：3人のとき、役の早見の2行目が下の席に隠れた。早見を卓の外の独立した帯（卓と卓の便りの間）に移し、人数による席の位置と分けた。
- 勝者の印：勝負で勝った席（同順位は全員）の名前の横に「勝者」。色だけに頼らない。
- スマホの目安：行動を選ぶ画面の `hint` に「25秒以内に決めよう」を固定で出す（1秒ごとの再送はしない）。

## 変更したファイル
`games/poker/logic.js`・`view.js`・`style.css`、新しい `games/poker/fix-third.test.js`、`tools/tests/poker-clock-css.test.mjs`（早見の帯の構造）、`.kiro/specs/game-pack-3/game-poker.md`、この報告。

## 確認（親が実行）
- `npx vitest run --config vitest.games.config.ts games/poker --maxWorkers=2`：9ファイル130件成功（120件＋新規10件）。
- `cd packages/protocol && npx vitest run tests/poker-end-contract.test.ts tests/cpu-end-contract.test.ts`：18件成功。`node --test tools/tests/poker-clock-css.test.mjs`：3件成功。
- `npm run typecheck`（全体）：エラーなし。`npm run check`：すべて OK。
- 壊すと赤（担当が実行・`.probe-tmp/poker4-mutations.json`）：履歴・勝負待ちの`note`・勝負待ちの席・勝者の印・`hint`・早見の位置・早見のCSSの7件すべて検知。
- 画像：`.probe-tmp/shots-poker4/gallery-{2〜8}-{1024,1280,1920}.png`（導入・配札・手番・勝負・結果）。3人と8人を見て、早見が席・札・便りと重ならないことを確かめた。
- 未確認：担当が測る予定だった全人数×局面×3サイズの外接矩形の機械測定は、クレジット切れで実行されていない（画像の目視のみ）。実機・人どうし・WebKit・独立再採点は未実施。
