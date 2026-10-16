# 指示書 G-fix-experience2：実際に遊んだ採点（2周目）への対応（ゲーム側・範囲を絞る）

採点（2周目）：連打レース18・4択クイズ17（合格）、あつめて点15・ハローパッド14（飽き耐性0・不合格）。全文は `review/scoring-experience.md`（先に読む。再現の手順は「バグと気になる点」）。直す前に、試遊サーバー（`tools/playtest-README.md`）で再現する。終わったら、必ず `POST /stop`。再現できなければ、報告に「再現せず」と書く。触ってよい場所は G と同じ。**次の5つだけ直す。ほかは直さない。**

## 直すこと

1. **抜けた人の結果を、4本でそろえる**（バグ3）。席が `players` から消えた人も、結果に載せる（点・回数はそのまま。連打レースと同じ形）。名前はコンソールが控えていて「退出」の印を付ける（`apps/web/src/host/lineup.ts`。ゲームは名前を持たなくてよい）。4択クイズ・ハローパッド・あつめて点の `results` から、席が消えた人を外している所を直す。全員が抜けたときの終わり方も試験する。
2. **4択クイズ**（バグ4・6）：(a) 席が消えた人の札は「切断」でなく「退出」にする（点はそのまま見せる）。(b) 8人が同じ長い答え（例：「青森県と秋田県」）を選んでも、答え合わせの印と文字が、枠の上下にはみ出さない（多いときは印を答えの下の行へ回す、など）。1280×720 と 1920×1080 で撮り、Read で開いて確かめる。
3. **連打レース**（バグ8）：完走の秒を0.01秒まで出す（「11.63秒」）。同じ表示で順位が分かれる場面を減らす。順位の決め方（サーバーの受信時刻 `T`）は変えない。
4. **あつめて点**（バグ9）：点の光の輪（描いている輪の縁）に体が触れたら取れるように、当たりを広げる。いまは `MOVER_R + DOT_R`（32）で取れるが、描いている輪の縁は `MOVER_R + DOT_R * 2`（42）。描く半径と当たりの半径は、同じ定数から決めて、ずれないようにする。輪の縁で取れる・その外では取れない、の境界の試験を足す。
5. **ハローパッド**（飽き耐性0）：30秒の時間制限を足す。残り秒数を画面の上に出し、時間切れで `end` する。リーダーの「おわる」は残す。結果は今まで通り、ぴょんの回数順。README と、ホスト・スマホの1行の説明に「30秒」を書く。

直さない（記録だけ）：始める前から切れていた人が走者に入る件、ホストの読み込み直しでゲームが消える件、バグ5・7・10の小さなもの。

## 試験・変異・報告

- 規則の試験（`logic.test.js`。境界を含める：抜けた人が結果に載る・光の輪の縁・時間切れ・全員退出）。C1 の試験（`tests/e2e/console/` の該当ファイル）の期待は、あなたが直した挙動に限って、書き換えてよい。
- 変異を `tools/mutations/specs/games-g.json` に足す：抜けた人を結果から外す → 赤、当たりを元の大きさに戻す → 赤、ハローパッドの時間切れを外す → 赤。
- hello-pad の画面が変わるので、サムネイルを撮り直す（`tools/make-thumbs.mjs hello-pad`。書体の環境変数は依頼文にある）。SDK の写しが古くなったら `npm run build -w @irori/sdk && npm run sync:sdk`。
- `npm run test:games`、`node tools/sync-sdk.mjs --check`、`node tools/check-registry.mjs`、`node tools/build-registry.mjs`、`node tools/mutations/run.mjs --only games-`、`npx playwright test -c tests/e2e/playwright.config.ts --project=desktop-chromium tests/e2e/console/tap-race.spec.ts tests/e2e/console/quiz.spec.ts tests/e2e/console/hello-pad.spec.ts tests/e2e/console/dot-grab.spec.ts tests/e2e/console/midgame.spec.ts tests/e2e/console/timing.spec.ts` を流し、件数を報告する。
- `reports/G-report.md` の末尾に「追補3」を足す（全体で100行以内に縮める）。結論を5行で返す。
