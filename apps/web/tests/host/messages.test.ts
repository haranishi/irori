import { countGraphemes, LIMITS } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { HOST_EN, HOST_JA } from '../../src/host/messages';

describe('ホストの文言', () => {
  it('日本語と英語で、キーがそろっている。キーはすべて host.*', () => {
    expect(Object.keys(HOST_EN).sort()).toEqual(Object.keys(HOST_JA).sort());
    for (const k of Object.keys(HOST_JA)) expect(k.startsWith('host.')).toBe(true);
  });

  it('文言にHTMLの記号を入れない（すべて文字として描く）', () => {
    for (const v of [...Object.values(HOST_JA), ...Object.values(HOST_EN)]) expect(v).not.toMatch(/[<>]/);
  });

  it('スマホへ送る文言は、画面の指定の上限に収まる（12文字の名前を入れても）', () => {
    const name = 'あ'.repeat(LIMITS.NAME_MAX_GRAPHEMES);
    for (const dict of [HOST_JA, HOST_EN]) {
      const fill = (k: string) => (dict[k] ?? '').replace('{name}', name);
      expect(countGraphemes(fill('host.pad.remoteHint'))).toBeLessThanOrEqual(LIMITS.HINT_MAX_GRAPHEMES);
      // 一時停止中は、同じ文がリモコンの案内（ヒントの上限）と待機の見出し（見出しの上限）の両方に入る。
      expect(countGraphemes(fill('host.pad.menu'))).toBeLessThanOrEqual(Math.min(LIMITS.HINT_MAX_GRAPHEMES, LIMITS.TITLE_MAX_GRAPHEMES));
      for (const k of ['host.pad.choosing', 'host.pad.lateTitle', 'host.pad.starting', 'host.pad.waiting']) {
        expect(countGraphemes(fill(k)), k).toBeLessThanOrEqual(LIMITS.TITLE_MAX_GRAPHEMES);
      }
      for (const k of ['host.pad.choosingBody', 'host.pad.lateBody']) expect(countGraphemes(fill(k)), k).toBeLessThanOrEqual(LIMITS.BODY_MAX_GRAPHEMES);
    }
  });

  it('使う置き換えの名前が、両方の言語で同じ', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(HOST_JA)) expect(vars(HOST_EN[k] ?? ''), k).toEqual(vars(HOST_JA[k] ?? ''));
  });
});
