// 実Worker・ホスト・個別スマホで、秘密選択から判定・結果・再戦を通す。
import { expect, test, type Pad, type Host } from './fixtures';
import { HOST, ONLY_DC } from './lib/tags';
import AxeBuilder from '@axe-core/playwright';

async function action(pad: Pad, label?: string): Promise<void> {
  await pad.expectKind('pad');
  const button = pad.page.locator('.irori-pad__btn');
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();
  if (label) await expect(button).toHaveText(label);
  await button.tap();
}

async function choose(pad: Pad, suffix: string, keyboard = false): Promise<string> {
  await pad.expectKind('choices');
  const choice = pad.page.locator(`.irori-pad__choice[data-id$="_${suffix}"]`);
  await expect(choice).toHaveCount(1);
  const id = (await choice.getAttribute('data-id'))!;
  if (keyboard) {
    await pad.page.keyboard.press('Tab');
    await choice.focus();
    await expect(choice).toBeFocused();
    const outline = await choice.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await choice.press('Enter');
  } else await pad.choose(id);
  return id;
}

async function duelRound(host: Host, pads: Pad[], a: string, b: string): Promise<void> {
  await host.expectPhase('choose');
  await choose(pads[0]!, a);
  await choose(pads[1]!, b);
  await host.expectPhase('reveal');
}

test('火花の間合い：気力を溜め、大技で受けを貫く。秘密選択・決着・再戦', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['つばき', 'あさぎ']);
  await host.choose('blade-duel', pads[0]);
  await host.expectPhase('intro');
  await action(pads[0]!);
  await host.expectPhase('choose');
  const frame = (await host.gameFrame())!;
  const before = await frame.locator('body').innerText();
  const otherPad = await pads[1]!.page.locator('.irori-pad').innerText();
  await choose(pads[0]!, 'focus', true);
  await pads[0]!.expectKind('wait');
  expect(await frame.locator('body').innerText()).toBe(before);
  expect(await pads[1]!.page.locator('.irori-pad').innerText()).toBe(otherPad);
  await choose(pads[1]!, 'guard');
  await host.expectPhase('reveal');
  await action(pads[0]!);
  await duelRound(host, pads, 'focus', 'guard');
  await action(pads[0]!);
  await duelRound(host, pads, 'burst', 'guard');
  for (let i = 0; i < 3; i++) {
    await action(pads[0]!);
    await duelRound(host, pads, 'focus', 'guard');
  }
  await action(pads[0]!);
  await duelRound(host, pads, 'burst', 'guard');
  await action(pads[0]!);
  expect((await host.results()).map(({ seat, rank, label }) => ({ seat, rank, label }))).toEqual([
    { seat: 1, rank: 1, label: '体力4' }, { seat: 2, rank: 2, label: '体力0' },
  ]);
  await pads[0]!.tap('ok');
  await host.expectPhase('intro');
  await action(pads[0]!);
  await duelRound(host, pads, 'slash', 'slash');
  await expect((await host.gameFrame())!.locator('body')).not.toContainText('総合結果へ');
});

test('火花の間合い：10手の同体力と同時決着を、それぞれ同順位にする', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['つばき', 'あさぎ']);
  await host.choose('blade-duel', pads[0]);
  await action(pads[0]!);
  for (let i = 0; i < 10; i++) {
    await duelRound(host, pads, 'guard', 'guard');
    await action(pads[0]!);
  }
  expect((await host.results()).map(({ rank }) => rank)).toEqual([1, 1]);
  await pads[0]!.tap('ok');
  await host.expectPhase('intro');
  await action(pads[0]!);
  for (let i = 0; i < 7; i++) {
    await duelRound(host, pads, i % 2 === 0 ? 'slash' : 'focus', i % 2 === 0 ? 'slash' : 'focus');
    await action(pads[0]!);
  }
  const results = await host.results();
  expect(results.map(({ rank }) => rank)).toEqual([1, 1]);
  expect(results.map(({ label }) => label)).toEqual(['体力0', '体力0']);
});

test('灯市：重複札を除き、最大の一意札が灯を得る。6市・最後の自動公開・再戦', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['つばき', 'あさぎ', 'こはく']);
  await host.choose('lantern-market', pads[0]);
  await host.expectPhase('intro');
  await action(pads[0]!);
  const bids = [[6, 6, 5], [5, 4, 6], [4, 5, 4], [3, 2, 3], [2, 3, 2]];
  for (let round = 0; round < bids.length; round++) {
    await host.expectPhase('choose');
    const frame = (await host.gameFrame())!;
    const before = await frame.locator('body').innerText();
    await choose(pads[0]!, String(bids[round]![0]), round === 0);
    await pads[0]!.expectKind('wait');
    expect(await frame.locator('body').innerText()).toBe(before);
    for (let i = 1; i < pads.length; i++) await choose(pads[i]!, String(bids[round]![i]));
    await host.expectPhase('reveal');
    await action(pads[0]!);
  }
  // 最後の札は全員1。選択操作なしで第6市の公開に進む。
  await host.expectPhase('reveal');
  expect(await host.inGame(() => document.documentElement.dataset.round)).toBe('6');
  await action(pads[0]!);
  expect((await host.results()).map(({ seat, rank, score }) => ({ seat, rank, score }))).toEqual([
    { seat: 2, rank: 1, score: 14 }, { seat: 3, rank: 2, score: 9 }, { seat: 1, rank: 3, score: 0 },
  ]);
  await pads[0]!.tap('ok');
  await host.expectPhase('intro');
  await action(pads[0]!);
  for (const pad of pads) await expect(pad.page.locator('.irori-pad__choice')).toHaveCount(6);
});

test('灯市8人：全札が重なる市の持ち越しと、同点の総合結果。遅い入力でも失点しない', ONLY_DC, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, ['一', '二', '三', '四', '五', '六', '七', '八']);
  await host.choose('lantern-market', pads[0]);
  await action(pads[0]!);
  const cdp = await host.context.newCDPSession(host.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let card = 1; card <= 5; card++) {
    await host.expectPhase('choose');
    for (const [index, pad] of pads.entries()) {
      if (card === 1) await pad.page.waitForTimeout([0, 125, 500][index % 3]!);
      await choose(pad, String(card));
    }
    await host.expectPhase('reveal');
    await action(pads[0]!);
  }
  await host.expectPhase('reveal');
  await action(pads[0]!, '総合結果へ');
  const rows = await host.results();
  expect(rows).toHaveLength(8);
  expect(rows.map(({ rank, score }) => [rank, score])).toEqual(Array.from({ length: 8 }, () => [1, 0]));
  await expect(host.page.locator('.results')).toContainText('33点');
  await cdp.detach();
});

for (const game of ['blade-duel', 'lantern-market']) {
  test(`${game}：説明・秘密選択・公開のアクセシビリティと短いホスト画面`, HOST, async ({ rig }) => {
    const host = await rig.openHost();
    for (const watch of rig.watches) watch.blankPagesOk = true;
    const pads = await rig.join(host, ['つばき', 'あさぎ']);
    await host.choose(game, pads[0]);
    for (const phase of ['intro', 'choose', 'reveal']) {
      await host.expectPhase(phase);
      const audit = await new AxeBuilder({ page: host.page }).include('.stage')
        .options({ preload: false, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }).analyze();
      expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
      expect(audit.passes.length).toBeGreaterThan(5);
      const layout = await host.inGame(() => ({ height: innerHeight, scrollHeight: document.documentElement.scrollHeight }));
      expect(layout!.scrollHeight).toBeLessThanOrEqual(layout!.height + 1);
      if (phase === 'intro') await action(pads[0]!);
      if (phase === 'choose') {
        await choose(pads[0]!, game === 'blade-duel' ? 'slash' : '6');
        await choose(pads[1]!, game === 'blade-duel' ? 'guard' : '5');
      }
    }
  });

  test(`${game}：確定前の中断は明示的にやり直し、退出は全員の未成立結果へ`, ONLY_DC, async ({ rig }) => {
    const host = await rig.openHost();
    const pads = await rig.join(host, ['つばき', 'あさぎ']);
    await host.choose(game, pads[0]);
    await action(pads[0]!);
    await host.expectPhase('choose');
    const first = await choose(pads[0]!, game === 'blade-duel' ? 'slash' : '6');
    await host.key('Escape');
    await host.expectState('paused');
    await host.key('Escape');
    await host.expectState('playing');
    await host.expectPhase('recover');
    await action(pads[0]!);
    await host.expectPhase('choose');
    const fresh = await choose(pads[0]!, game === 'blade-duel' ? 'slash' : '6');
    expect(fresh).not.toBe(first);
    await pads[1]!.leave();
    await host.expectState('results');
    const rows = await host.results();
    expect(rows.map(({ seat }) => seat).sort()).toEqual([1, 2]);
    await expect(host.page.locator('.results')).toContainText('勝敗なし');
    await expect(host.page.locator('.results [data-seat][data-rank="null"]')).toHaveCount(2);
  });
}
