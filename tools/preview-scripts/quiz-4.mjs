import { step as genericStep } from './driver.mjs';
export const players = 3;

export async function capture(page, rng, clock) {
  const segments = [];
  for (let round = 0; round < 5; round++) {
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'question');
    const question = clock();
    for (let seat = 0; seat < 3; seat++) {
      await page.waitForTimeout(450);
      await genericStep(page, rng, round * 3 + seat, { singleSeat: true });
    }
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'reveal');
    const reveal = clock();
    segments.push([question, reveal + 1]);
    await page.waitForTimeout(1100);
  }
  return { segments };
}
