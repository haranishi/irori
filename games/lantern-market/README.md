# 灯市のかけひき / Lanterns Unclaimed

2〜8人で、同じ画面を囲んで遊ぶ札の読み合いです。スマホで札を1枚伏せ、全員が選んだら一斉に公開します。

## 遊び方

1. 進行役がスマホの「はじめる」を押します。
2. 全員が手元で1〜6の札から1枚を選びます。同じ数字が出た札は、すべて失格です。
3. 残った札のうち、最大の数字を出した人がその市の灯を獲得します。
4. 進行役が「次の市へ」を押して続けます。札は各1回だけ使えます。最後の1枚は自動で出します。
5. 6市の合計点が多い人の勝ち。同点は同順位です。

灯の価値は順に **3・6・2・8・4・10点**。全員の札が重なったら灯は次の市へ持ち越します。
最後の市で残った灯は誰も獲得しません。金銭や賭けは扱いません。

## 中断とやり直し

切断・一時停止・大画面の非表示では、未公開の選択だけを戻します。公開済みの得点と使った札は保持します。
接続が戻ったら、進行役の「やり直す」で同じ市を再開します。公開後に中断した場合は「結果に戻る」です。
参加者が退出すると、確定済みの記録を残して勝敗なしで終了します。途中参加者は次の勝負からです。
時間制限はありません。通信速度で得点を決めません。ホスト所有者に対する秘密情報の保護はありません。

## 1台で試す

開発サーバーの `/games/lantern-market/?mock=3` を開くと、仮想プレイヤーのパネルで操作できます。
選択肢は各プレイヤーのパネルに表示され、公開前の札は共用画面に出ません。

## 表現と出どころ

同時選択と数字の重複排除という抽象的な仕組みをもとに、ルール・文章・画面・CSSの灯と札を独自に作っています。
外部画像・音・書体・既存商品のカード文面は使っていません。個別の商標・特許の網羅調査は未実施です。
コードはMIT OR Apache-2.0、文書と画像はCC BY 4.0、登録情報はCC0です。

## English

A simultaneous card battle for 2–8 players. Each player uses cards 1–6 once over six markets.
Matching bids cancel out; the highest remaining unique card wins the lanterns.
Prizes are 3, 6, 2, 8, 4 and 10 points. Unclaimed lanterns carry forward; the last unclaimed pot is discarded.
The final card plays automatically. Most points wins, with equal scores sharing a rank.
Reconnect and let the leader retry an unresolved market; committed scores and used cards stay intact.
Leaving ends the match without a winner. There is no timer, money or gambling.
