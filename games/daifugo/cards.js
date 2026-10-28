// @ts-check
/** @typedef {{n:number, rank:string, jokers:number}} CardSet */
/** @typedef {{cards:readonly string[]}} Table */

const RANKS = ['3','4','5','6','7','8','9','10','j','q','k','a','2'];
const CARD = /^(?:[shdc](?:[3-9]|10|j|q|k|a|2)|jk[12])$/;

/** Mulberry32。状態を保存すれば同じ続きから乱数を再開できる。 @param {number} seed */
export function makeRng(seed) {
  let value = seed >>> 0;
  const rng = () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let x = Math.imul(value ^ value >>> 15, value | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
  rng.state = () => value;
  return rng;
}

/** 入力を変更せず、未確定の全範囲から交換先を選ぶ。 @template T @param {readonly T[]} cards @param {()=>number} rng @returns {T[]} */
export function shuffle(cards, rng) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = /** @type {T} */ (result[i]);
    result[i] = /** @type {T} */ (result[j]);
    result[j] = a;
  }
  return result;
}

/** @returns {string[]} */
export function buildDeck() {
  return ['s','h','d','c'].flatMap((s) => RANKS.map((rank) => s + rank)).concat(['jk1','jk2']);
}

/** @param {string} card @param {boolean} revolution */
export function strength(card, revolution) {
  if (!CARD.test(card)) return -1;
  if (card.startsWith('jk')) return 13;
  const rank = RANKS.indexOf(card.slice(1));
  return revolution ? 12 - rank : rank;
}

/** @param {readonly string[]} cards @returns {CardSet|null} */
export function classify(cards) {
  if (cards.length < 1 || cards.length > 4 || new Set(cards).size !== cards.length || cards.some((c) => !CARD.test(c))) return null;
  const ordinary = cards.filter((c) => !c.startsWith('jk'));
  const rank = ordinary[0]?.slice(1) ?? 'joker';
  if (ordinary.some((c) => c.slice(1) !== rank)) return null;
  return {n:cards.length, rank, jokers:cards.length - ordinary.length};
}

/** @param {readonly string[]} play @param {Table|null} table @param {boolean} revolution */
export function isLegal(play, table, revolution) {
  const set = classify(play);
  if (!set) return false;
  if (!table) return true;
  const previous = classify(table.cards);
  if (!previous || set.n !== previous.n) return false;
  const power = (/** @type {CardSet} */ s) => s.rank === 'joker' ? 13 : strength('s' + s.rank, revolution);
  return power(set) > power(previous);
}

/** @param {readonly string[]} cards @param {number} n @returns {string[][]} */
function combinations(cards, n) {
  if (n === 0) return [[]];
  return cards.flatMap((card, i) => combinations(cards.slice(i + 1), n - 1).map((rest) => [card,...rest]));
}

/** 同じ数のグループごとに組合せを作り、ジョーカーだけの組を一度だけ追加する。
 * @param {readonly string[]} hand @param {Table|null} table @param {boolean} revolution @returns {string[][]} */
export function legalPlays(hand, table, revolution) {
  const jokers = hand.filter((c) => c === 'jk1' || c === 'jk2');
  /** @type {string[][]} */
  const plays = [];
  for (const rank of RANKS) {
    const group = hand.filter((c) => CARD.test(c) && !c.startsWith('jk') && c.slice(1) === rank);
    for (let n = 1; n <= Math.min(4, group.length); n++) {
      for (let j = 0; j <= Math.min(jokers.length, 4 - n); j++) {
        for (const ordinary of combinations(group,n)) for (const wild of combinations(jokers,j)) plays.push([...ordinary,...wild]);
      }
    }
  }
  for (let n = 1; n <= jokers.length; n++) plays.push(...combinations(jokers,n));
  return plays.filter((play) => isLegal(play,table,revolution));
}
