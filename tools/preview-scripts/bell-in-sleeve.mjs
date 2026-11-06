import { step as genericStep } from './driver.mjs';
// 6席なら全種類が配られる。操作の種は共通道具の20261106を使う。
export const players = 6;
export const query = 'mock=6';
export const duration = 10;

export async function capture(page, rng, clock) {
  const effects = ['のぞき見', 'すりかえ', 'ひそひそ話', 'かばう', 'つかまえる'];
  const clips = new Map();
  const deadline = clock() + 150;
  let tick = 0;
  while (clock() < deadline) {
    const phase = await page.locator('html').getAttribute('data-phase');
    if (phase === 'result') {
      if (effects.some((name) => !clips.has(name))) throw new Error(`見せ場が不足: ${effects.filter((name) => !clips.has(name)).join('・')}`);
      // 最後の札の区間と重ならない位置から、結果を2.5秒以上読む。
      const from = Math.max(clock(), ...[...clips.values()].map((clip) => clip[1]));
      await page.waitForTimeout(Math.max(0, (from + 3 - clock()) * 1000));
      const segments = [...clips.values(), [from, from + 2.5]].sort((a, b) => a[0] - b[0]);
      console.log('bell-in-sleeve 撮影区間', JSON.stringify(segments));
      return { segments };
    }
    // 直前の効果を見せ終わるまで次の札を出さず、区間の重複を防ぐ。
    if ((await page.locator('#stage').getAttribute('data-scene'))?.includes(':pickCard:')) {
      const until = Math.max(0, ...[...clips.values()].map((clip) => clip[1]));
      if (clock() < until) await page.waitForTimeout((until - clock()) * 1000);
    }
    const from = clock();
    const selected = await page.evaluate(({ preferred, random }) => {
      if (!document.querySelector('#stage')?.getAttribute('data-scene')?.includes(':pickCard:')) return null;
      for (const pad of document.querySelectorAll('.irori-mock__seat .irori-pad[data-kind="tiles"]')) {
        const choices = [...pad.querySelectorAll('.irori-pad__tile')].filter((e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true');
        if (!choices.length) continue;
        const candidates = preferred.flatMap((name) => choices.filter((e) => e.querySelector('.irori-pad__tile-label')?.textContent === name || e.textContent.startsWith(name)));
        const tile = candidates[0] ?? choices[Math.floor(random * choices.length)];
        const name = tile.textContent;
        tile.click();pad.querySelector('[data-action="ok"]')?.click();return name;
      }
      return null;
    }, { preferred: [...effects.filter((name) => !clips.has(name) && name !== 'つかまえる'), 'かばう', 'すりかえ', 'のぞき見', 'ひそひそ話', 'つかまえる'], random: rng() });
    const name = effects.find((effect) => selected?.startsWith(effect));
    if (name && !clips.has(name)) {
      clips.set(name, [from, from + 1.6]);
      console.log('bell-in-sleeve 札', name, from.toFixed(3));
    }
    if (!selected) await genericStep(page, rng, tick++, { singleSeat: true, passChance: 0 });
    await page.waitForTimeout(220);
  }
  throw new Error('鈴の撮影が結果まで進みませんでした');
}
