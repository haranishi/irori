# bell-fix-6：結果を読んだ全員が早く次へ進む

- 結果の人のスマホに「次へ」1枚。押すと無効・「ほかの人を待っています」。
- 結果開始で同意をリセットし、CPU・退出済み以外の全員同意で即座にend。
- 同時入力は席ごとのtokenで扱い、未入力の人の画面は再送しない。古いtokenは拒否。
- 未入力があれば上限20秒。規則・得点・CPU・大画面・終了行の形は維持。
- 退出イベント自体は従来どおり勝負なしで即終了する規則を維持。

## 変更したファイル
- games/bell-in-sleeve/logic.js、新規fix6.test.js、memory.test.js、sim.test.js。
- packages/protocol/tests/game-end-contract.test.ts：実際の早期終了行も契約検査。
- .kiro/specs/game-pack-3/game-bell-in-sleeve.md：今回の操作・検証の追記。
- この報告。一時スクリプトとログは.probe-tmp/bell6-*。

## 検証の証拠
- 重い処理はnice -n 10付き。優先度変更自体は環境に拒否された。
- npx vitest run --config vitest.games.config.ts games/bell-in-sleeve --maxWorkers=2
  10ファイル150件成功（既存142件＋新規8件）。全人数×2000局を含む。
- cd packages/protocol && npx vitest run tests/game-end-contract.test.ts tests/cpu-end-contract.test.ts
  2ファイル15件成功。人0/1/2/3/5人の実終了行が検証器を通る。
- npm run typecheck：全体成功（終了0）。npm run check：7項目成功。
- python3 .probe-tmp/bell6-mutate.py：10変異すべて赤、毎回復元。
  早期終了なし3件・全員条件破壊4件・上限変更3件・退出席算入1件・CPU算入1件失敗。
  押した後も有効1件・note超過2件・ラベル超過2件・token不問1件・同意未初期化5件失敗。
  復元後150件成功。最後の停止中文言整理後も関連16件成功。担当差分のdiff --check成功。
- node .probe-tmp/bell6-browser.mjs：共通のヘッドレス接続でmock=5/1×早期/放置の4条件成功。
  通常の操作で結果へ到達。時計を止めたまま全員の次へで終了、応答待ちは1秒以内。
  未入力1人を残すと19.8秒では未終了、20.1秒で終了。仮想時計で経過を制御。
  人5人は押した後の無効・待つ案内も確認。pageerror全条件0件。専用文脈はfinallyで閉じた。

## 未確認・メインへの連絡
- 実機・WebKit・人同士の会話・独立再採点は未確認。機能の質問はなし。
- 起動：timeout 3000 env IRORI_DEV_PORT=8830 node tools/dev.mjs（nice付き）。
- 起動した全PGID 92261（timeout/dev）・92481（ビルド）・92482（配信）へのSIGTERMがEPERM。
  workerd PID 92548が8830/8831で待受継続。メイン側で上記グループの停止をお願いします。
  停止の証拠は.probe-tmp/bell6-stop.json。8787や他担当ポートには触れていない。
- 起動時に共有状態のSQLITE_BUSY警告あり。今回のmockの配信・4条件の操作は成功。
- Git操作・依存追加なし。担当外の並行変更は編集せず維持。
