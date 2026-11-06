# 担当A：poker-logic

## 実装と変更したファイル
- `games/poker/cards.js`：52枚・種つき配札・5〜7枚の役判定。A低、キッカー、完全な同点と最強5枚を返す。
- `games/poker/logic.js`：6ハンド、親・ブラインド、合法手、25秒、停止・退出、点の保存、秘匿、結果を実装。
- `games/poker/cpu.js`：本人情報だけで手の強さと未完成の並びを見て重みを付ける。7.5%で強気になる。
- 同所の `cards.test.js`・`logic.test.js`・`cpu.test.js`・`sim.test.js`、`packages/protocol/tests/poker-end-contract.test.ts`、この報告。
- 作業中に追記された cpu-seats.md の結果表示にも対応：CPU入りのendは順位の付け直しを止め、ゲーム内順位をラベルに残す。
- 画面・登録・共有設定は未編集。git add・commit・push・ブランチ操作・依存追加・サーバー起動は行っていない。

## 検証（コマンドには nice -n 10 を付けた）
- `npx vitest run --config vitest.games.config.ts games/poker --maxWorkers=1 --disableConsoleIntercept`：4ファイル76件成功、82.27秒。
- 内訳：札21件・判定31件・CPU16件・対戦8件。2〜8席×2000局、人1＋CPU3と人4席を各2000局、計18,000局を検証。
- 全局終了・全手合法・持ち点の保存・札の保存・pad上限・秘匿・同じ種の再現を確認。人/CPUの印とIDだけを変えた2000組は点と順位が完全一致。
- `cd packages/protocol && npx vitest run tests/poker-end-contract.test.ts`：1ファイル10件成功。人0〜5、通常終了・1席退出・全人退出・CPU入りの順位表示を検証。
- `npm run typecheck:games`：終了0。既存includeにpokerがないため、下の直接検査も実施。
- `npx tsc -p .probe-tmp/tsconfig.poker.json`：既存の厳密設定を継承して担当3ファイルを直接検査、終了0。
- `npm run check`：3項目失敗。文書4件と権利47件は担当外の一時成果物が検査対象に入るため。SDK同期はpokerの2ファイル未作成。境界・依存方向・ライセンス・登録12件は成功。
- 担当ソース・試験の禁止用語と私的なパスを `rg` で確認、該当0件。
- 環境がniceの優先度変更を拒否したため、試験は1ワーカー。ログ・一時設定・変異スクリプトは `.probe-tmp/poker-*` と `.probe-tmp/tsconfig.poker.json`。
- 型検査と契約10件は最後のend表示修正後にも再実行。76件の対戦検証後の変更は、そのend表示だけ。

## 試験を壊す確認とレビュー
- `node .probe-tmp/poker-mutations.mjs`：endの余分な項目・手札の常時公開・A低の除去・支出1点過多の4変異が全て終了1（赤）。finallyで戻し、SHA-256一致を確認。
- 最後の復元SHA-256：logic `42e93b6ce4a681c832c6ca100cbaf96084a3051875c4aefe6c37429ced77f0c4`、cards `3354f8c0ff98e3543df4ba2d70083b29b52adc60d87127acd82c725c90e8337a`。
- 別担当の読み取りレビューで、開始前に親が退出したときの支出を発見。初回でも退出した親を移すよう修正し、回帰試験成功。
- レビュー担当が独立した5枚判定で21組を比較し、無作為2000組の7枚判定が全件一致。追加の重大な指摘なし。

## 勝率・席の偏り（種0〜1999、全席が同じCPU方針）
同率1位も1勝として数えるため、各席の勝ちの合計は2000を超える場合がある。勝率は勝ち/2000。

| 席数 | 席順ごとの1位回数（各2000局） |
|---|---|
| 2 | 976, 1092 |
| 3 | 650, 709, 650 |
| 4 | 519, 492, 517, 475 |
| 5 | 360, 401, 417, 388, 436 |
| 6 | 336, 315, 338, 327, 330, 354 |
| 7 | 292, 301, 277, 257, 253, 323, 298 |
| 8 | 266, 264, 247, 233, 241, 279, 232, 242 |

人1＋CPU3の人席は平均2.4575位、1位519/2000（25.95%）。親はCPUの印・IDを使わず、種から等確率で選ぶ。

| 人4席の位置 | 平均順位 | 1位の割合 | 人1＋CPU3との差 |
|---|---|---|---|
| 1 | 2.4575 | 25.95% | 0.0000 |
| 2 | 2.4600 | 24.60% | -0.0025 |
| 3 | 2.4395 | 25.85% | +0.0180 |
| 4 | 2.4815 | 23.75% | -0.0240 |

全席で指定の±0.15位以内。ただし人の入力の強さ・実際の楽しさを測ったものではない。

## 画面担当への引き継ぎ
- `createGame(init)`・`updateGame(state,event)` は `{state,effects}`。initは `players,leader,seed,nonce,environment,paused?`。nonceは小文字英数1〜8字。
- 人IDは1〜8の数値、CPUは `fillSeats(h)` の `cpu1` …、`cpu:true`。人2人未満で4席まで補う。CPU一覧は局の最初に固定し、名簿イベントにも同じ一覧を結合する。
- players配列の順が席順。最初の親は種で選び、以後は点がある席へ移す。補充席のIDを数値へ変換しない。
- イベントは `input:{p,input}`、`tick:{ms}`、`players:{players,leader}`、`menu:{paused}`、`environment:{value}`（種類はt）。tickは経過差分だけ。停止中の時間を再開後へ持ち越さない。
- 段階は `intro→deal→turn→flop→turn→fourth→turn→river→turn→showdown` を繰り返して `result`。fourthは4枚目公開、turnは行動段階。deal1200ms・公開1000ms・勝負3500ms・結果8000ms。
- introの進行役だけに「はじめる」を出す。CPUだけのデモではCPUの1席をleaderに指定すればdecideで開始する。
- 大画面は `publicView(state)` だけを描画。seatsの `points,street,paid,folded,left,cpu,count`、親dealer、番turn、場board、たまりpot、直近4件eventsを使う。
- 勝負で残り2席以上なら該当席だけ `hand,role` が公開される。おりた席は公開しない。`winners` は勝負の勝者。`results` はresultだけに全席の `p,score,rank,cpu,label,ranked`。
- `viewFor(state,p)` は公開モデル＋本人hand・pad・actions。山札や乱数状態は含まない。受け取ったビューの編集はstateへ戻らない。
- padは判定の席別 `pad` 効果をそのまま渡す。待機中もdisabledのtilesに手札と要約を残す。入力は `{k:'tiles',ids:[tile.id],t:pad.token}`。
- tokenは画面変更で全席更新、拒否では本人だけ更新。拒否のpadも送る。tickの残秒だけではpadを送り直さない。
- CPUは本人viewForだけを渡し、thinkMs(rng)後に最新ビューでdecideする。返り値を通常のinputへ渡す。変更・停止・終了で古い予約を破棄する。
- CPUの乱数はmainで種つきの列を保持する。decideがnullなら予約しない。CPU宛てpadをSDKへ送らず、CPU IDをSDKのlookにも渡さない。
- 点の上限は、残った席の「残り点＋この周の支出」の最小値。累積の支出が同じなので、あわせるたびに上限が縮むことを防ぐ。
- `endRows(state)` は人だけの `p,score,label,ranked`。CPU入りの正常終了は `ranked:false,label:'N位(CPUこみ)'`。人だけはranked:true。全人退出は勝負なしで即時、通常は結果8秒後に1回だけend。

## 未確認・メインへの連絡
- ブラウザ・実機・画面・mainとの接続は担当外で未確認。SDKの2ファイル配置とtsconfig.games.jsonのinclude追加をお願いします。
- `.probe-tmp/` の別作業の成果物が全体checkを失敗させているため、統合時の検査対象の整理をお願いします。所有範囲外なので変更していない。仕様の判断が必要な質問はありません。
