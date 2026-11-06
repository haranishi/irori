import { step as genericStep } from './driver.mjs';

export const players = 2;
export const warmupSteps = 2;
// 選ぶ・公開・次の手の間隔を空け、勝負中の手と体力の変化を見せる。
export async function step(page, rng, tick) {
  return genericStep(page, rng, tick, { singleSeat: true });
}
