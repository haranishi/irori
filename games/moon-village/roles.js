// @ts-check
/** @typedef {'villager'|'wolf'|'seer'|'knight'|'madman'} Role */

/** 状態を取り出して保存できる種つき乱数。 @param {number} seed */
export function makeRng(seed) {
  if (!Number.isFinite(seed)) throw new RangeError('Invalid seed');
  const random = () => {
    random.state = (random.state + 0x6d2b79f5) >>> 0;
    let x = random.state;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
  random.state = seed >>> 0;
  return random;
}

/** @param {number} n @returns {Role[]} */
export function rolesFor(n) {
  if (!Number.isInteger(n) || n < 4 || n > 8) throw new RangeError('Expected 4 to 8 seats');
  return [
    ...Array(n >= 6 ? 2 : 1).fill('wolf'), 'seer',
    ...(n >= 5 ? ['knight'] : []), ...(n >= 7 ? ['madman'] : []),
    ...Array(n === 8 ? 3 : 2).fill('villager'),
  ];
}

/** @param {readonly number[]} seatIds @param {number} seed @returns {Record<number,Role>} */
export function assignRoles(seatIds, seed) {
  if (new Set(seatIds).size !== seatIds.length || seatIds.some((id)=>!Number.isSafeInteger(id) || id < 1)) throw new RangeError('Invalid seats');
  const roles = rolesFor(seatIds.length);
  const random = makeRng(seed);
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [roles[i], roles[j]] = [/** @type {Role} */ (roles[j]), /** @type {Role} */ (roles[i])];
  }
  return Object.fromEntries(seatIds.map((id,i)=>[id, /** @type {Role} */ (roles[i])]));
}
