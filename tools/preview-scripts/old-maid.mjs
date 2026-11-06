import { step as genericStep } from './driver.mjs';

export const players = 3;
// 引く→ペアが流れる動きを見せ、パスや結果のやり直しを選ばない。
export const options = { passChance: 0, singleSeat: true };
export const warmupSteps = 2;
export async function step(page, rng, tick) {
  if (tick % 3 === 0) return genericStep(page, rng, tick, options);
}
