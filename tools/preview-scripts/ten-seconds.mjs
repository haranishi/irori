import { step as genericStep } from './driver.mjs';
export const players = 3;

export async function capture(page, rng, clock) {
  const segments = [];
  for (let round = 0; round < 3; round++) {
    await genericStep(page, rng, round);
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'countdown');
    const countdown = clock();
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'counting');
    const counting = clock();
    // 各数字の静止部分を少し切る。「せーの」は残し、実際の計測は待つ。
    for (let n = 0; n < 3; n++) segments.push([countdown + n + 0.25, countdown + n + 1]);
    segments.push([counting, counting + 0.4]);
    const offsets = [9520, 9960, 10400].map((t, i) => t + (round - 1) * (i === 1 ? -40 : 30));
    await page.evaluate(async (offsets) => {
      await Promise.all(offsets.map(async (ms, i) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        const button = [...document.querySelectorAll(`.irori-mock__seat[data-p="${i + 1}"] .irori-pad button`)]
          .find((b) => !b.disabled && b.textContent === '10秒！');
        if (!button) throw new Error('計測ボタンがありません');
        button.click();
      }));
    }, offsets);
    await page.waitForFunction(() => document.documentElement.dataset.phase === 'reveal');
    const reveal = clock();
    console.log('ten-seconds 結果', await page.locator('.results').innerText());
    segments.push([reveal, reveal + 1.15]);
    await page.waitForTimeout(1200);
  }
  return { segments };
}
