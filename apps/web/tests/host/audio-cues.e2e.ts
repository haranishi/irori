// @ts-check
// 実ブラウザでだけ測れる波形の検査。メインが実行する（この担当は起動しない）。
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { CUES } from '@irori/protocol';
import { build } from 'vite';
import type { synthesizeCue } from '../../src/host/audio-cues';

let code = '';
test.beforeAll(async () => {
  // 本物の合成器を同じ既存ビルダーで1ファイル化。試験用の実装の写しは持たない。
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: fileURLToPath(new URL('../../src/host/audio-cues.ts', import.meta.url)), name: 'CueAudio', formats: ['iife'] },
  } });
  if (Array.isArray(result) || !('output' in result)) throw new Error('音のビルド結果がありません');
  code = result.output.filter((o) => o.type === 'chunk').map((o) => o.code).join('\n');
});

for (const name of CUES) {
  test(`cue ${name} は非無音・ピーク0.7以下・1.5秒以内`, async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: code });
    const rendered = await page.evaluate(async ({ name }) => {
      const synth = (globalThis as unknown as { CueAudio: { synthesizeCue: typeof synthesizeCue } }).CueAudio.synthesizeCue;
      const results: { v: number; peak: number; last: number; rms: number }[] = [];
      for (const v of [0, 0.25, 0.7, 1]) {
        const sampleRate = 48_000;
        const ctx = new OfflineAudioContext(1, sampleRate * 2, sampleRate);
        // 同じ乱数列なら強さによる振幅の比較もできる。
        const originalRandom = Math.random;
        let seed = 27;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
        try { synth(ctx, ctx.destination, name, v); } finally { Math.random = originalRandom; }
        const buffer = await ctx.startRendering();
        const samples = buffer.getChannelData(0);
        let peak = 0; let last = 0; let square = 0;
        for (let i = 0; i < samples.length; i++) {
          const value = Math.abs(samples[i]!);
          if (!Number.isFinite(value)) throw new Error('有限でない音');
          peak = Math.max(peak, value); square += value * value;
          if (value > 0.000001) last = i / sampleRate;
        }
        results.push({ v, peak, last, rms: Math.sqrt(square / samples.length) });
      }
      return results;
    }, { name });
    expect(rendered[0]!.peak).toBe(0);
    for (const sound of rendered.slice(1)) {
      expect(sound.peak).toBeGreaterThan(0.0001);
      expect(sound.peak).toBeLessThanOrEqual(0.7);
      expect(sound.last).toBeLessThanOrEqual(1.5);
    }
    expect(rendered[3]!.rms).toBeGreaterThan(rendered[1]!.rms);
    if (name === 'pins') expect(rendered[3]!.last).toBeGreaterThan(rendered[1]!.last);
  });
}
