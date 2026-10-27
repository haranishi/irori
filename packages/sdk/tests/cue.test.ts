// @ts-check
import { CUES, type GameToHost } from '@irori/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IroriCore } from '../src/core';

function setup(capabilities: string[] = ['cue-v1'], mode: 'host' | 'mock' = 'host') {
  const sent: GameToHost[] = [];
  const core = new IroriCore(mode, { players: [], leader: null, paused: false, locale: 'ja', capabilities }, { send: (m) => sent.push(m) });
  return { core, sent };
}
afterEach(() => vi.restoreAllMocks());

describe('cue-v1 の送信', () => {
  it('旧ホストと仮想プレイヤーでは例外も送信もない', () => {
    for (const s of [setup([]), setup(['cue-v1'], 'mock')]) {
      expect(() => s.core.cue('confirm')).not.toThrow();
      expect(s.sent).toEqual([]);
    }
  });
  it('既定0.7、0〜1への丸め、NaN・未知名・数以外の無視', () => {
    const { core, sent } = setup();
    core.cue('tick'); core.cue('confirm', -4); core.cue('deny', 4);
    core.cue('turn', Infinity); core.cue('win', -Infinity);
    core.cue('lose', NaN); core.cue('unknown' as never); core.cue('go', '1' as never);
    expect(sent).toEqual([
      { m: 'cue', name: 'tick', v: 0.7 }, { m: 'cue', name: 'confirm', v: 0 },
      { m: 'cue', name: 'deny', v: 1 }, { m: 'cue', name: 'turn', v: 1 }, { m: 'cue', name: 'win', v: 0 },
    ]);
  });
  it('同じ名前の49msを捨て、50msで受ける。別名は重ねられる', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { core, sent } = setup();
    core.cue('tick'); now = 49; core.cue('tick'); core.cue('confirm');
    now = 50; core.cue('tick');
    expect(sent.map((m) => m.m === 'cue' && m.name)).toEqual(['tick', 'confirm', 'tick']);
  });
  it('移動する1秒窓で20件まで。捨てた依頼は窓を延長しない', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { core, sent } = setup();
    CUES.forEach((name) => core.cue(name));
    expect(sent).toHaveLength(20);
    now = 999; core.cue('reveal'); expect(sent).toHaveLength(20);
    now = 1000; core.cue('reveal'); expect(sent).toHaveLength(21);
  });
  it('固定種の入力2000件で50ms間隔と任意の1秒窓の上限を守る', () => {
    let now = 0;
    let seed = 27;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const times: { at: number; name: string }[] = [];
    const { core, sent } = setup();
    for (let i = 0; i < 2000; i++) {
      now += Math.floor(random() * 30);
      const before = sent.length;
      const name = CUES[Math.floor(random() * CUES.length)]!;
      core.cue(name);
      if (sent.length > before) {
        const last = times.findLast((t) => t.name === name);
        expect(now - (last?.at ?? -Infinity)).toBeGreaterThanOrEqual(50);
        expect(times.filter((t) => now - t.at < 1000).length).toBeLessThan(20);
        times.push({ at: now, name });
      }
    }
    expect(times.length).toBeGreaterThan(100);
  });
});
