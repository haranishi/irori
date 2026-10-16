# 指示書 P：100日チャレンジ Day058「名所くみたて早押し」の移植（公開後のPR用）

あなたは実装担当。設計は固定済みで、この指示書と `docs/` が契約。設計を変えたくなったら、変えずに報告へ書く。前提：本体（A1・A2・G・B1・B2・C1）が `main` に載り、公開されている。この作業は、`feat/game-meisho-kumitate` のブランチで行い、PRにする（commit・push・PR作成は、メインループが行う）。

## 目的

保守者が作ったゲーム「名所くみたて早押し」（組み上がる名所の3Dミニチュアを見て、早押しの4択で当てる。Day058）を、スマホで早押し・回答する、最大8人の対戦として移植する。元のゲームは、1台の画面を2人で囲む形（キーボードのFとJ）までしかなく、ネット対戦は、サーバーが要るために外されていた。irori の `buzzer` と `choices` で、素直に載る。

## 元のソース（読み取りのみ）

`https://github.com/haranishi/hundred-days` の `day-058-meisho-kumitate/source/`（MIT、保守者の自作）。手元にクローンして、`git show origin/main:day-058-meisho-kumitate/source/...` で読める（クローン側の作業中の変更には触らない）。規則は `src/shared/rules.ts`、名所の一覧は `src/shared/landmarks.ts`、名所の模型は `src/client/landmarks/*`、描画は `src/client/render/*`。依存は three.js（MIT）、world-atlas（ISC。元データは Natural Earth＝パブリックドメイン）。

## 触ってよい場所

`games/meisho-kumitate/**`、`registry/games/meisho-kumitate.json`、`registry/thumbs/meisho-kumitate.png`、`THIRD_PARTY_NOTICES.md`（このゲームの分の追記）、`tools/mutations/specs/game-meisho-*.json`。それ以外は触らない。`git` の書き込み系コマンド、`npm install`（依存はゲームの `package.json` に書き、導入は報告してメインループが行う）、デプロイは禁止。

## 作るもの

- `games/meisho-kumitate/`：ビルドして `dist/` を `index.html` と一緒に配る形（他の同梱ゲームと違い、ビルドが要る）。`source/`（TypeScript）と、ビルドの設定と、`README.md`（40行以内：元のゲームとの違い、ビルドの方法、出典と権利）。ビルド結果の置き場所と、`tools/build-registry.mjs` が配布へ写す範囲は、他のゲームと揃える（必要なら報告）。
- **遊びの流れ（irori 版）**：全員の `buzzer`（「わかった!」）→ 早く押した人から、その人のスマホだけが `choices`（4択、各12文字以内）に切り替わる（`setPad` の `to` に席番号）→ 答える。正解は早いほど高得点（1000点から200点）、誤答と時間切れは −200点で、その問題はもう押せない。ほかの人は、押し続けられる。全8問。最後に `end(results)`。元のゲームの単体の規則（`rules.ts`）を、人数をN人に広げる形で再利用し、画面（タイトル、ひとり・ふたりの選択、ネット対戦の部屋）は、使わない。
- 席の表示は `irori.look(id)` の色と形。ホストの画面に、押した人・回答中・正解・誤答を、色と形つきで出す。`pause`/`resume` を守る。席が切れたら、その人は、その問題の誤答として扱う。
- 名所は、元の68か所のうち、**権利の方針を満たすものだけ**（README の「権利と出典」の方針のとおり：運営者が外観の利用に許可を求めている名所、題材として重い名所は入れない）。名所の追加はしない。豆知識の出典の一覧は、ゲームの「クレジット」から読めるように、元のまま持ってくる。
- 3Dの描画は、元のコードのまま使ってよい（保守者の自作）。ただし、外部ドメインからの読み込みがないこと（`tools/check-rights.mjs`）。音は、元のゲームの合成音だけを使い、音声ファイルを入れない。

## 受け入れ条件（あなたがコマンドを実行して確かめる）

1. `npm run typecheck`、`npm test`（ゲームの規則の単体試験を含む。0件の成功は成功でない）、`npm run check`、`npm run build` が通る。
2. 実ブラウザ（ホスト1・スマホ3）で、1ゲームを最後まで遊べる（全員の押す順、誤答の脱落、時間切れ、全員退出の終わり方を、すべて通す）。`page.clock` で時計を進められること。
3. 3Dの初回表示の重さ（読み込み時間、モデルの遅延読み込み）と、低速CPU（6倍遅く）での動作を、数値で報告する。
4. 変異に対する門番の確認：(a) 誤答の −200点の撤去 (b) 押した人以外のスマホにも `choices` を出す (c) 時間切れを誤答として扱わない、を仕様にして、全件が KILLED になること。

## 報告

`.agent-harness/runs/2026-10-16-bootstrap/reports/P-report.md` に100行以内で。終わったら、結論を5行で返す。
