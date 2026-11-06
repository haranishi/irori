import { step as genericStep } from './driver.mjs';
export const players = 3;
export const duration = 9.5;

export async function capture(page, rng, clock) {
  const windows = [];
  const until = clock() + 30;
  let tick = 0;
  while (clock() < until) {
    const from = clock();
    await genericStep(page, rng, tick++);
    for (;;) {
      const phase = await page.locator('html').getAttribute('data-phase');
      if (phase === 'choose') {
        // 手元の選択肢だけを使い、各人が0.2〜0.5秒で決める。
        await page.evaluate(async () => {
          await Promise.all([...document.querySelectorAll('.irori-mock__seat')].map(async (seat, i) => {
            await new Promise((resolve) => setTimeout(resolve, [200, 350, 500][i]));
            const choices = [...seat.querySelectorAll('.irori-pad[data-kind="choices"] button')].filter((b) => !b.disabled);
            choices[Math.min(i, choices.length - 1)]?.click();
          }));
        });
      } else if (phase === 'reveal') {
        console.log('一斉公開', JSON.stringify(await page.evaluate(() => ({
          round: document.documentElement.dataset.round,
          scores: [...document.querySelectorAll('.score-value')].map((e) => Number(e.textContent)),
        }))), clock().toFixed(3));
        // 最終市は結果を残して窓の長さを確保する。対戦の再開は窓へ含めない。
        if (await page.locator('html').getAttribute('data-round') === '6') break;
        await page.waitForTimeout(800);
        await genericStep(page, rng, tick++, { singleSeat: true, prefer: ['次の市へ'] });
      } else throw new Error(`撮影中に予期しない段階です: ${phase}`);
    }
    await page.waitForTimeout(Math.max(0, (from + 10.5 - clock()) * 1000));
    windows.push([from, clock()]);
    if (clock() >= until) break;
    await page.reload();
    await page.locator('.irori-mock[data-ready]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: '.irori-mock__banner,.irori-mock__panel,.irori-mock__results { opacity:0!important; pointer-events:none!important } body { cursor:none!important }' });
  }
  console.log('lantern-market 撮影区間', JSON.stringify(windows));
  return { windows };
}
