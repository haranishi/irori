// @ts-check
/** @typedef {(() => number) & {state:number}} Rng */

/** mulberry32。呼出後の状態を保存すれば同じ続きから再生できる。 @param {number} seed @returns {Rng} */
export function makeRng(seed) {
  const rng = Object.assign(() => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0;
    let value = rng.state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }, {state:seed >>> 0});
  return rng;
}

/** @template T @param {readonly T[]} cards @param {() => number} rng @returns {T[]} */
export function shuffle(cards, rng) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const atI = /** @type {T} */ (result[i]);
    result[i] = /** @type {T} */ (result[j]);
    result[j] = atI;
  }
  return result;
}

export function buildDeck() {
  return ['s','h','d','c'].flatMap((suit) => ['3','4','5','6','7','8','9','10','j','q','k','a','2'].map((rank) => suit + rank)).concat('jk');
}

/** @param {readonly string[]} hand */
export function pairOff(hand) {
  /** @type {string[]} */
  const remaining = [];
  /** @type {string[]} */
  const discard = [];
  for (const card of hand) {
    const index = remaining.findIndex((other) => card !== 'jk' && other !== 'jk' && other.slice(1) === card.slice(1));
    if (index < 0) remaining.push(card);
    else discard.push(/** @type {string} */ (remaining.splice(index, 1)[0]), card);
  }
  return {hand:remaining, discard};
}

/** @param {readonly number[]} seatIds @param {number} seed */
export function dealAndPair(seatIds, seed) {
  if (seatIds.length < 2 || seatIds.length > 8 || new Set(seatIds).size !== seatIds.length) throw new RangeError('Invalid seats');
  const ids = [...seatIds].sort((a,b) => a-b);
  const rng = makeRng(seed);
  /** @type {Record<number,string[]>} */
  const hands = Object.fromEntries(ids.map((id) => [id, []]));
  shuffle(buildDeck(), rng).forEach((card, index) => {
    const hand = hands[/** @type {number} */ (ids[index % ids.length])];
    if (hand) hand.push(card);
  });
  /** @type {string[]} */
  const discard = [];
  const out = ids.filter((id) => {
    const paired = pairOff(/** @type {string[]} */ (hands[id]));
    hands[id] = paired.hand;
    discard.push(...paired.discard);
    return paired.hand.length === 0;
  });
  return {hands, discard, out, rngState:rng.state};
}

/** @param {string} card */
export function cardText(card) {
  if (card === 'jk') return 'JK';
  const suit = /** @type {Record<string,string>} */ ({s:'♠',h:'♥',d:'♦',c:'♣'});
  return (suit[card.charAt(0)] ?? '') + card.slice(1).toUpperCase();
}
