# V：イメージ動画の実装・検証

## 初回の要約

- 要件6と動画仕様を引き継ぎ、8787番のゲーム画面だけから全11本を録画・編集した。
- 専用ブラウザ文脈は終了時に閉じた。サーバーは起動・停止していない。
- 1280×720の全画面を録画し、仮想パッドの帯を隠した。外部素材は追加していない。
- 640×360・30fps・H.264・無音・1MB以下。末尾0.5秒を冒頭へ重ねた。
- 変更：`tools/make-previews.mjs`、`tools/preview-scripts/`、`tools/tests/make-previews.test.mjs`。
- 変更：`registry/previews/`全11本、`REUSE.toml`の動画注釈、`tools/check-budgets.mjs`の動画上限、`docs/previews.md`、この報告。
- 初回最終検査：動画11本合格、動画試験9件合格、容量すべて上限内、9コマ画像全11枚に空白・文字欠けなし。
- 初回checkはSDK準備中のため同期1項目失敗。第2回で全項目の成功を確認した。
- 音声検査を外す変異試験は当時8件中2件失敗。コピーは削除済み。
- Gitの変更操作・依存追加・担当外編集はなし。実機・公開配信・独立レビューは未確認。
- 録画は `.probe-tmp/previews/`、9コマ画像は `.probe-tmp/sheets/`。
- nice指定は環境が拒否するが処理は実行。映像変換は2スレッドに制限。

## 第2回：preview-videos-2（未達あり）

- 活動率を追加。0.5秒ごとの代表コマで輝度差8以上が32画素以上、平均差0.01以上なら活動と数える。
- 基準用の測定：strike-alley 17/19=0.895、old-maid 19/19=1.000、dot-grab 19/19=1.000、daifugo 12/19=0.632。
- 合格基準は0.6。基準用4本を通しつつ、圧縮雑音と先頭だけの画面切替を拒む。
- tap-race：種つきの±30%間隔、実測平均95・102・131ms。反応開始をずらし、首位交代と全員40回の完走を収録。
- ten-seconds：3人が9.5〜10.4秒で押す3回分を撮影。静止区間を省き、カウント・せーの・3人の結果を残した。
- moon-village：夜→夜明け→短い話し合い→投票→結果を収録。役の内容・時計は変更していない。
- 他7本ではquiz-4=0.263、blade-duel=0.368が未達だったため、静止区間の編集と操作間隔を修正して再撮影。
- lantern-market：1席ずつ選ぶ初回候補は0.421。3席で異なる札を素早く選ぶ2回目候補も9/16=0.563で未達。
- 同じ活動率検査で2回不合格のため、共通ハーネスの停止条件で追加修正を停止。合格済みの正式動画への置換は行っていない。
- 候補は複数の市で一斉公開と得点変化が見える。末尾の総合結果待ちを含むため、活動率が不足した。
- 候補：`.probe-tmp/previews/lantern-market.mp4`、画像：`.probe-tmp/sheets/lantern-market-candidate.png`。

### 変更と検証の証拠

- 変更：`tools/make-previews.mjs`、`tools/tests/make-previews.test.mjs`、`docs/previews.md`。
- 台本：`tools/preview-scripts/` のtap-race・lantern-market・ten-seconds・moon-village・quiz-4・blade-duel。
- 正式MP4：上記からlantern-marketを除く5本。この報告へ追記。所有外・依存・Gitの変更操作はなし。
- 道具は残す区間の指定に対応。短い動画でも9コマ埋まるよう、画像抽出の間隔を実際の動画長に合わせた。
- `nice -n 10 node tools/make-previews.mjs --only <id>`：対象4本は3本合格・lantern-marketは2回不合格。他2本は各1本合格。
- `nice -n 10 node tools/make-previews.mjs --verify-only`：全11本中10本合格・1本不合格（正式lantern-market=0.316）。
- 活動率：hello-pad=1.000、tap-race=0.789、dot-grab=1.000、quiz-4=0.895、ten-seconds=0.647、blade-duel=0.789。
- 活動率：strike-alley=0.895、daifugo=0.632、old-maid=1.000、moon-village=0.947。正式動画はすべて容量・形式・長さ・無音を満たす。
- `nice -n 10 node --test tools/tests/make-previews.test.mjs`：10件合格・失敗0件。ほぼ静止した実MP4の拒否と動く実MP4の合格を含む。
- `TMPDIR="$PWD/.probe-tmp" nice -n 10 node tools/check-budgets.mjs`：画面2種・SDK・動画11本すべて上限内。
- `nice -n 10 npm run check`：7項目すべて合格（登録11件・SDK12本）。
- 撮り直した4本の9コマを自分で確認。3人の進み方・計測結果の違い、複数市の得点変化、夜から投票への変化が見える。文字欠け・空白なし。
- 実機再生・人による評価・独立レビュー・公開配信は未確認。サーバーは起動・停止せず、専用文脈は閉じた。
- メインへの申し送り：lantern-marketの正式動画は旧版のまま。候補末尾の静止を削るなど、基準0.6を維持した仕上げが残る。全11本合格の終了条件には未達。

## 第3回：preview-videos-3（未達・停止）

- 28秒の撮影に変更。各席は0.3・0.61・0.98秒で札を選び、公開後は進行役の操作を確認する周期で次へ進めた。
- 待機・再開画面を除く撮影範囲を記録し、0.5秒の代表コマで活動が多い区間を選ぶ編集を追加。接続は0.4秒のクロスフェード。
- 最初の3区間候補：活動率0.706（12/17）、8.966秒、96,404バイトで機械検査合格。
- ただし9コマ画像で別対戦への切替による得点の巻き戻りを発見。目視不合格で採用不可。
- **注意：道具が機械検査直後に正式MP4へ置換したため、第3回終了時点の `registry/previews/lantern-market.mp4` はこの目視不合格の候補。前回の正式動画のバックアップは作っていなかった。**
- 同じ対戦内の2区間だけを時系列で選ぶ方式へ修正。候補選択不能1回、出力7.966秒で長さ不足1回があり、開始位置の刻みと指定秒数を修正した。
- 同じ録画を8.1秒指定で再編集した最終候補：8.066秒・61,064バイト、活動率0.533（8/15）。基準0.6未達のため追加修正を停止。
- 理由：札選択中は大画面が変わらず、公開と市の切替が短い。得点と使用札の連続性を保つと、静止を十分削れない。
- 最終候補は `.probe-tmp/previews/lantern-market.mp4`。9コマは `.probe-tmp/sheets/lantern-market-candidate.png`。
- 9コマを自分で確認：得点増加と市の順序、文字欠けなしを確認。一斉公開は9コマ中1回だけで、要求の2回以上も未達。
- 変更：`tools/make-previews.mjs`、`tools/preview-scripts/lantern-market.mjs`、`registry/previews/lantern-market.mp4`、`docs/previews.md`、この報告。ほかの10本は変更なし。
- `nice -n 10 node tools/make-previews.mjs --only lantern-market`：計3回。初回機械検査1本合格、後2回は区間選択と長さで各1本失敗。最終再編集は活動率で1本失敗。
- `nice -n 10 node tools/make-previews.mjs --verify-only`：正式ファイル全11本の機械検査合格・失敗0本。目視不合格の灯市を含むため完了の根拠にはならない。
- `nice -n 10 node --test tools/tests/make-previews.test.mjs`：最終10件合格・失敗0件。
- `TMPDIR="$PWD/.probe-tmp" nice -n 10 node tools/check-budgets.mjs`：画面2種・SDK・動画11本すべて上限内。
- `nice -n 10 npm run check`：最初は並走した試験の一時リンクにSDK検査が反応。試験終了後の再実行で7項目すべて合格（登録11件・SDK12本）。
- `git diff --check`：成功。サーバー操作・Git変更操作・依存追加なし。専用ブラウザ文脈はすべて閉じた。
- nice優先度の設定は環境に拒否されるが処理自体は実行。実機再生・人による評価・独立レビュー・公開配信は未確認。
- メインへの質問：目視不合格の正式MP4の扱いと、活動率0.533の連続性を保った候補の次の方針を判断してほしい。終了条件は未達。


## 第4回：preview-videos-4（動画の終了条件達成）

- 正式版の置換を専用処理に集約。候補を全機械検査に通し、旧版を時刻つきで退避してから置換する。
- 検査・退避に失敗した場合は正式ファイルを変更しない。候補は一時領域に残す。
- 不合格候補で正式版が変わらない試験と、合格時に旧版が退避される試験を追加。
- 灯市は約32秒撮影。札選択は3席が0.2・0.35・0.5秒、公開後の進行役操作は0.8秒。
- 途中の区間結合を廃止。同じ対戦の連続窓だけを選び、今回は端のクロスフェードも使わない。
- 初回は活動率0.722でも先頭の動きで不合格。正式版は変わらなかった。
- 再撮影版は録画の0.1〜9.6秒を連続で使用。9.47秒・70,124バイト・活動率0.667（12/18）、先頭差3.621。
- 9コマを自分で確認：第1〜6市が順に進み、異なる5市の一斉公開が見える。文字欠け・空白なし。
- 公開DOMの記録でも6回の公開を確認。得点は[0,3,0]→[0,3,6]→[0,3,8]→[0,3,16]→[0,3,20]→[10,3,20]。
- 最終公開後は約3秒の結果待ち。途中は切らず、静止時間を含めて活動率基準0.6を満たした。
- 旧版（得点が巻き戻る版）は `.probe-tmp/previews/_backup/lantern-market-2026-11-06T04-21-26-387Z.mp4` に退避済み。
- 変更：`tools/make-previews.mjs`、`tools/preview-scripts/lantern-market.mjs`、`tools/tests/make-previews.test.mjs`。
- 変更：`registry/previews/lantern-market.mp4`、`docs/previews.md`、この報告。ほかの10本は変更なし。
- `nice -n 10 node --test tools/tests/make-previews.test.mjs`：12件合格・失敗0件。
- 一時コピーで検査と退避をそれぞれ外す変異を実行。対応する試験が各1件失敗し、2種類とも検出。コピーは削除済み。
- `nice -n 10 node tools/make-previews.mjs --only lantern-market`：初回1本不合格、再撮影1本合格。
- `nice -n 10 node tools/make-previews.mjs --verify-only`：全11本合格・失敗0本。
- `TMPDIR="$PWD/.probe-tmp" nice -n 10 node tools/check-budgets.mjs`：画面2種・SDK・動画11本すべて上限内。
- `nice -n 10 npm run check`：7項目中6項目合格。登録検査だけ、新作のサムネイル未配置で1件失敗（所有外のため未修正）。
- 追記後の文書検査・権利検査と `git diff --check`：すべて成功。
- 証拠：`.probe-tmp/preview-videos-4-*.log`、9コマは `.probe-tmp/sheets/lantern-market.png`。
- サーバー操作・Git変更操作・依存追加なし。専用ブラウザ文脈は閉じた。niceの優先度設定は環境が拒否したが処理は実行。
- 未確認：実機再生・人による評価・独立レビュー・公開配信。メインへの依頼：新作のサムネイル配置後に登録検査を再確認してほしい。
