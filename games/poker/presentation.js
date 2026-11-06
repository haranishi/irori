// @ts-check
import { evaluate, compareHands } from './cards.js';
/** @typedef {import('./cards.js').HandRank} HandRank */
/** @param {number} n */
export const rankText = n => ({11: 'J', 12: 'Q', 13: 'K', 14: 'A'})[n] ?? String(n);
/** 役を作る数字だけを比べ、残りの札による差を表示で区別する。 @param {HandRank} hand */
export function primaryKey(hand) {
    const count = hand.category === 2 || hand.category === 6 ? 2 : 1;
    return hand.value.slice(0, count + 1).join(':');
}
/** @param {HandRank} hand */
export function roleText(hand) {
    const first = rankText(hand.value[1] ?? 0);
    if (hand.category === 9) return hand.name;
    if (hand.category === 2 || hand.category === 6)
        return `${hand.name}・${first}・${rankText(hand.value[2] ?? 0)}`;
    const until = [0, 4, 5, 8].includes(hand.category) ? 'まで' : '';
    return `${hand.name}・${first}${until}`;
}
/** 本人の2枚と公開札だけから案内を作る。 @param {readonly string[]} hand @param {readonly string[]} board */
export function currentRole(hand, board) {
    if (hand.length !== 2) return 'なし';
    const cards = [...hand, ...board];
    if (cards.length < 5) return hand[0]?.slice(1) === hand[1]?.slice(1) ? 'ペア' : 'なし';
    const rank = evaluate(cards);
    return rank.category === 0 ? `なし（${rankText(rank.value[1] ?? 0)}が最高）` : roleText(rank);
}

/** 同じ役の最も強い相手と比べ、最初に差が出る数を説明する。
 * @param {HandRank} rank @param {HandRank[]} ranks */
export function kickerText(rank, ranks) {
    const others = ranks.filter(other => primaryKey(rank) === primaryKey(other) && compareHands(rank, other) > 0);
    others.sort((a, b) => compareHands(b, a));
    const other = others[0];
    if (!other) return '';
    const i = rank.value.findIndex((n, i) => n !== other.value[i]);
    return rankText(rank.value[i] ?? 0);
}
