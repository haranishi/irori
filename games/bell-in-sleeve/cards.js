// @ts-check
/** @typedef {'bell'|'peek'|'swap'|'whisper'|'catch'|'guard'} Card */
/** @typedef {number|string} SeatId */
/** @typedef {(() => number) & {state:number}} Rng */
export const CARD_NAMES = Object.freeze({bell:'金の鈴',peek:'のぞき見',swap:'すりかえ',whisper:'ひそひそ話',catch:'つかまえる',guard:'かばう'});
/** 表の順は鈴・のぞき見・すりかえ・ひそひそ話・つかまえる・かばう。 */
export const COMPOSITIONS = Object.freeze({3:[1,1,4,1,1,4],4:[1,0,6,1,2,6],5:[1,1,7,2,2,7],6:[1,5,4,2,3,3],7:[1,6,4,3,4,3],8:[1,7,5,3,4,4]});
/** @param {number} n */
export function handSize(n) {
  if (!Number.isInteger(n) || n < 3 || n > 8) throw new RangeError('席は3〜8人です');
  return n <= 5 ? 4 : 3;
}
/** @param {number} seed @returns {Rng} */
export function makeRng(seed) {
  const rng = Object.assign(() => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0;
    let n = rng.state;
    n = Math.imul(n ^ n >>> 15,n | 1);
    n ^= n + Math.imul(n ^ n >>> 7,n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  },{state:seed >>> 0});
  return rng;
}
/** @template T @param {readonly T[]} values @param {()=>number} rng @returns {T[]} */
export function shuffle(values,rng) {
  const out = [...values];
  for (let i=out.length-1;i>0;i--) {
    const j=Math.floor(rng()*(i+1));
    [out[i],out[j]]=[/** @type {T} */ (out[j]),/** @type {T} */ (out[i])];
  }
  return out;
}
/** @param {number} n @returns {Card[]} */
export function buildDeck(n) {
  handSize(n);
  const counts=COMPOSITIONS[/** @type {3|4|5|6|7|8} */ (n)];
  return /** @type {Card[]} */ (Object.keys(CARD_NAMES)).flatMap((card,i)=>Array(counts[i]).fill(card));
}
/** @param {SeatId} a @param {SeatId} b */
export function compareSeats(a,b) {
  return typeof a === 'number' && typeof b === 'number' ? a-b : typeof a === 'number' ? -1 : typeof b === 'number' ? 1 : Number(a.replace('cpu',''))-Number(b.replace('cpu',''));
}
/** @param {readonly SeatId[]} ids @param {number} seed */
export function deal(ids,seed) {
  const h=handSize(ids.length);
  if (new Set(ids).size !== ids.length || ids.some((id)=>typeof id === 'number' ? !Number.isSafeInteger(id) || id < 1 : !/^cpu[1-9]\d*$/.test(id))) throw new RangeError('席IDが不正です');
  const order=[...ids].sort(compareSeats),rng=makeRng(seed);
  /** @type {Record<SeatId,Card[]>} */
  const hands=Object.fromEntries(order.map((id)=>[id,[]]));
  shuffle(buildDeck(ids.length),rng).forEach((card,i)=>hands[/** @type {SeatId} */ (order[i%order.length])]?.push(card));
  // 最初の一周に出せる札を最低1枚残す。交換元には必ず2枚以上残っている。
  const early=/** @param {Card} c */ (c)=>c !== 'bell' && c !== 'catch';
  for (const id of order) {
    const hand=/** @type {Card[]} */ (hands[id]);
    if (hand.some(early)) continue;
    const donor=/** @type {Card[]} */ (order.map((p)=>hands[p]).find((cards)=>cards && cards.filter(early).length > 1));
    const at=donor.findIndex(early),give=hand.findIndex((c)=>c === 'catch');
    [hand[give],donor[at]]=[/** @type {Card} */ (donor[at]),'catch'];
  }
  return {hands,h,first:/** @type {SeatId} */ (order[Math.floor(rng()*order.length)]),rngState:rng.state};
}
