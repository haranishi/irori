# U / ui-m2：ホーム M2

## 状態
- 試験・変異spec・文書を更新。製品側の390px幅の不整合を検出したため、終了条件は未達。
- 製品コード・登録・依存・所有外の仕様は未編集。git add・commit・push・ブランチ操作なし。

## 変更した試験と意図
- `apps/web/tests/host/host.e2e.ts`：横一列から格子の4方向へ。帯で選択を確かめ、決定1回で起動。QRの警告と公開URLは拡大表示で確認。
- 同ファイル：不足は0人時の暗い箱・理由・起動拒否、1人参加後はCPU対応の起動可能を確認。途中参加・席再利用拒否・メニュー一周・フォーカス復帰を維持。
- リモコンの次の操作は、前の入力でホストの選択が変わってから送る。回線を渡る入力をクリック完了だけで待たない。
- `shots.e2e.ts`：詳細の撮影を選択の帯に置換。狭い幅はページを送って箱を選ぶ。QR・上の帯・文字サイズの採寸を維持。
- `play-layout.e2e.ts`：直接起動。8人で遊べる同梱ゲームを3サイズで各10秒監視し、結果の1〜8人の収まりも維持。
- `link.e2e.ts`：直接起動でも外部接続の確かめと取り消しを維持。取り消し後の詳細は現存するため残した。
- `shelf.e2e.ts`：対象12本の登録を照合するfixtureを固定し、並行追加の別ゲームで結果を変えない。12本の箱と11本の動画を区別。動画なしの新作が先頭でも、最大12本と画面外停止を試す。
- 新規 `home-guards.e2e.ts`：1024×576の上の帯・押せる左下QR、1366幅の結果の記録17px以上を個別に実測。
- `tests/e2e/console/lib/host.ts`：格子の列数を読み、上下左右で選び、決定1回で起動する共通操作。
- consoleの `a11y,malicious,midgame,party-pack,playtest,ten-seconds`：旧詳細経由を直接起動へ。axeは選択の帯とQR拡大に引き継ぐ。
- 大富豪の旧2人不足はCPU補充と人の名簿維持へ、10秒ゲームの不足は0人時の帯と拒否へ置換。試験自体の削除なし。
- host/console/padのglobal-setup、consoleのfixtures/discipline、bridgeのharness/server、padのfixtures：ポートを8880〜8899に限定。
- hostの前処理は変異用に単一Workerを選べるprofileを追加。撮影先は `.probe-tmp/shots-m2/`。
- padはNodeのホスト役を直接用意する構造で、ホーム経由の選択箇所はなかった。

## 文書・変更ファイル
- `README.md`・`README.ja.md`：12本、ふところの鈴、1人時のCPU、箱の動画、左下QR。
- `docs/ux.md`：格子・直接起動・名前の帯・上の参加者・右上のスマホメニューへ整合。
- `docs/known-issues.md`：実機・WebKit・人どうし・鈴・CPU強さ・動画・新規ファイル時の再起動、今回の製品側残件を表で記録。
- 変異の変更は `tools/mutations/specs/host-b1.json` の下表12件だけ。run.mjs・guard.mjsは未編集。
- 文書はすべて100行以内。新しい製品素材の追加なし。

## コマンドと結果
- 以下は `nice -n 10` と `TMPDIR="$PWD/.probe-tmp"` で実行。優先度変更は環境に拒否されたがコマンド自体は動いた。
- `npm run typecheck`：成功。`npm run test -w @irori/web`：21ファイル・222件成功。
- `npm run check`：すべて成功（登録13件・SDK同期13本）。一時キャッシュの偶然の禁止語一致は、自分の生成した該当キャッシュを除去して再確認した。
- ブラウザには `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9333/pw` を指定。
- `npx playwright test -c tests/e2e/playwright.config.ts --project=bridge --project=desktop-chromium --project=phone-chromium --grep-invert '試遊サーバー：curl'`：初回104成功・2失敗、修正後その2件成功。計106件を成功確認（10・83・13件）。
- `npx playwright test -c apps/web/playwright.pad.config.ts --project=phone-chromium`：76成功・71既定スキップ・失敗0。71件は撮影専用でスイッチ未指定。
- `npx playwright test -c apps/web/playwright.host.config.ts --project=host-chromium --project=host-shots`：全58件を実行し初回51成功・7失敗。試験側3件を直して絞り直し成功、合算54成功確認・製品理由4失敗（Chromium本体52成功/3失敗、撮影2成功/1失敗）。
- 設定に `chromium` という名前の組はないため、既存のChromium用の組名を指定。設定ファイル自体は所有外で未編集。
- `node tools/mutations/run.mjs --only <下表id>`：12件すべてKILLED。全件実行なし。u/rは壊す前の失敗を合格に数えず、再実行で基準の緑と検知を確認。
- 一時置き場が作業ツリー内なので、変異の写しが自身を再帰コピーする。実行限定の一時preloadで列挙から `.probe-tmp` を除いた。製品・変異runnerは変更していない。
- ログ：`.probe-tmp/ui-m2-*.log`、`console-m2{,-recheck}.log`、`pad-m2.log`。差分検査は所有範囲で成功。

## 変えた変異spec（すべて基準は緑、変異は終了コード1で赤）
| id | 守る意図・対象 | 結果 |
|---|---|---|
| host-a-e2e-no-grey | 0人の箱の不足判定 | KILLED |
| host-h-e2e-origin-always-location | 公開URLのQR・手入力・共有 | KILLED |
| host-n-e2e-narrow-top-tall | 1024幅の上の帯が2割以下 | KILLED |
| host-q-e2e-narrow-join-last | 左下QRが最初の画面で押せる | KILLED |
| host-t-shots-small-caption-1366 | 結果の記録の補足17px以上 | KILLED |
| host-u-e2e-left-stays-participant | 席再利用後の待機・入力・結果の隔離 | KILLED |
| host-v-e2e-fallback-focus-stays | 遅い一覧後のフォーカス移動 | KILLED |
| host-w-e2e-shelf-grows-column | 格子の幅がQRと画面へ収まる | KILLED |
| host-y-e2e-header-down-geometric | 上の道具から選択中の箱へ戻る | KILLED |
| host-aa-e2e-menu-no-wrap | メニューの上下が一周する | KILLED |
| host-bb-e2e-lock-text-fixed-size | 小さいQRの締切の印が収まる | KILLED |
| host-r-unplayable-says-choose | 隠れた旧promptでなく名前の帯の不足理由 | KILLED |

## 製品側への修正依頼・未確認
- 390×844・参加者3人：上の帯の下端約215pxで2割の169pxを超える。期待値は緩めず残した。狭い幅の折返しと各領域の収まりを製品担当へ依頼する。
- 12本の棚を1920幅→1366幅：列数変更で箱を描き直すとフォーカスの印が消える。矢印で再開可能だが、選択中の箱へのフォーカス復元が必要。
- 試遊サーバーのHTTP通し1件は未実行。所有外の `tools/playtest-server.mjs` がブラウザ起動と範囲外ポートを固定するため。試験側の選択経路は更新済み。
- 公開URLなしのQR拡大：1280×720の戻る下端約747px、1024×576は約702px。500pxのQRと注意文を残し、戻るも画面内に収める必要がある。
- 撮影：`.probe-tmp/shots-m2/` の1920・1366・390を目視。390幅は道具の右へのはみ出しと箱の極端な縮小も確認。追加の8880番撮影はホーム到達待ちが30秒で2回失敗し、画像を得られず未確認（別ログ）。文脈とブラウザ接続はfinallyで閉じた。
- 追加撮影の8880サーバーは停止信号がEPERMで拒否され、起動元を中断しても応答が残った。メインで停止が必要（期限3000秒、起動したtimeoutのPID/プロセス群56430、記録は `.probe-tmp/ui-m2-dev.pid`）。8787は未操作。各e2eの前処理は停止処理まで終了したが、最終のポート確認では8897・8899の12本を配るWorker（検査口8896・8898）も応答が残った。帰属を断定せず、メインでプロセスを確認して停止してほしい。
- 同時作業で登録が13本へ増えた。READMEの12本は今回の指示範囲を維持したため、統合時の本数はメインで再整合してほしい。
- `home-shelf.md` の旧列数・不足の灰色帯・初回案内位置は所有外。M1.5の現物との整合をメインへ依頼する。
- WebKit・実機・実物のゲームパッド・人どうしの遊び・CPU強さ・実機での動画負荷は未確認。
- メインへの質問：上の製品側残件と、試遊サーバーの接続・ポート指定を引き取ってほしい。仕様変更の追加提案なし。
