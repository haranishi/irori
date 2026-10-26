# 火花の間合い / Blade and Breath

2人で、スマホに出る手を1つ選ぶ同時選択のチャンバラです。時間制限はありません。
両者が決めるまで手は秘密。公開を見てから、進行役のスマホで次の手へ進みます。

| 手 | 消費 | 効果 |
|---|---|---|
| 斬る | 気力1 | 1ダメージ。受けるには防がれる |
| 受ける | なし | 斬るを防ぐ。大技は防げない |
| 溜める | なし | 気力を1回復。上限3 |
| 大技 | 気力3 | 防御を貫いて2ダメージ |

体力4・気力1から開始します。両者の手は同時に解決し、体力0で決着。
最大10手で、残り体力が多い人の勝ちです。同じ体力なら引き分けで、気力は順位に使いません。

切断・一時停止・大画面の非表示では、未確定の手だけを取り消して待ちます。
戻ったら進行役が「やり直す」を押します。公開済みの体力・気力は変わりません。
参加者が退出した場合は、全員の記録を残して勝敗なしで終了します。

開発サーバーの `/games/blade-duel/?mock=2` で、PC1台から仮想端末を操作できます。
最初の「はじめる」は1人目のSpace。手の選択は画面右の仮想端末をクリックします。
単体試験は `npx vitest run --config vitest.games.config.ts games/blade-duel/logic.test.js`。

ルール・文章・刀の抽象図形・画面は、このプロジェクトのために作成しました。
外部のゲームのコード・絵・文章・音は取り込んでいません。

## English

A simultaneous-choice duel for two players. Start with 4 health and 1 energy (maximum 3).
Slash costs 1 energy and deals 1 damage unless guarded. Guard blocks a slash for free.
Focus restores 1 energy. Burst costs 3 energy and deals 2 damage through a guard.
Both moves resolve together. A knockout ends the duel; after 10 rounds, remaining health wins.
Equal health is a draw. Choices stay private until both players lock in, with no time limit.
The leader advances each reveal. Reconnecting lets the leader replay only an unresolved round.
If someone leaves the room, the match ends without a winner and keeps everyone's record.
