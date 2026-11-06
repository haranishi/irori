export const players = 3;

export async function capture(page, rng, clock) {
  const start = clock();
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'race');
  const intervals = [95, 110, 125].map((mean) => Array.from({ length: 40 }, () => mean * (0.7 + rng() * 0.6)));
  // 反応の早い席を、連打の速い席が追い越す。時計・得点・描画には触れない。
  const evidence = await page.evaluate(async (intervals) => {
    const counts = [0, 0, 0], leaders = [], delays = [800, 350, 0];
    await Promise.all(intervals.map(async (times, i) => {
      await new Promise((resolve) => setTimeout(resolve, delays[i]));
      for (const ms of times) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        const button = document.querySelector(`.irori-mock__seat[data-p="${i + 1}"] .irori-pad button`);
        if (button && !button.disabled) { button.click(); counts[i]++; }
        const top = counts.indexOf(Math.max(...counts));
        if (leaders.at(-1) !== top) leaders.push(top);
      }
    }));
    return { counts, leaders: leaders.map((i) => i + 1) };
  }, intervals);
  console.log('tap-race 操作記録', JSON.stringify({ ...evidence, means: intervals.map((xs) => Math.round(xs.reduce((a, b) => a + b) / xs.length)) }));
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'over');
  await page.waitForTimeout(Math.max(1500, (start + 12 - clock()) * 1000));
  return { start };
}
