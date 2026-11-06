import { step as genericStep } from './driver.mjs';
export const players = 5;
export const warmupSteps = 11;
export const captureSteps = 42;
const phases = new WeakMap();

export async function step(page, rng, tick) {
  const phase = await page.locator('html').getAttribute('data-phase');
  if (phases.get(page)?.phase !== phase) {
    phases.set(page, { phase, since: performance.now() });
    console.log('moon-village 場面', phase);
  }
  const elapsed = performance.now() - phases.get(page).since;
  // 夜明けは短く読み、話し合いは投票へ進める。役の中身は参照しない。
  if (phase === 'dawn' && elapsed < 650 || phase === 'day' && elapsed < 450) return;
  return genericStep(page, rng, tick, { singleSeat: true, passChance: 0, prefer: ['投票へ'] });
}
