export const players = 4;
export const query = 'mock=4';
export const duration = 10;

export async function capture(page, rng, clock) {
  const deadline = clock() + 60;
  let phase = '', start = 0, raised = false;
  while (clock() < deadline) {
    const next = await page.locator('html').getAttribute('data-phase');
    if (phase !== next) {
      if (phase === 'showdown') {
        console.log('poker 連続撮影区間', JSON.stringify([start, clock()]));
        return { start };
      }
      phase = next;
      if (phase === 'deal') start = clock();
      console.log('poker 場面', phase, clock().toFixed(3));
    }
    const action = await page.evaluate(({ raise, random }) => {
      for (const pad of document.querySelectorAll('.irori-mock__seat .irori-pad[data-kind="tiles"]')) {
        const choices = [...pad.querySelectorAll('.irori-pad__tile')].filter((e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true');
        const tile = raise && choices.find((e) => e.textContent.startsWith('ふやす'))
          || choices.find((e) => /^(はじめる|あわせる|そのまま)/.test(e.textContent))
          || choices.find((e) => e.textContent.startsWith('ぜんぶ'));
        if (!tile) continue;
        const name = tile.textContent;
        // 同じ候補なら種つきで選ぶ。手札の強さやモデルは読まない。
        const same = choices.filter((e) => e.textContent === name);
        same[Math.floor(random * same.length)].click();pad.querySelector('[data-action="ok"]')?.click();return name;
      }
      return '';
    }, { raise: !raised && phase === 'turn', random: rng() });
    if (action.startsWith('ふやす')) raised = true;
    await page.waitForTimeout(240);
  }
  throw new Error('ポーカーの撮影が手札公開まで進みませんでした');
}
