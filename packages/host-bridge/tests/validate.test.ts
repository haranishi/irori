import { describe, expect, it } from 'vitest';
import { LIMITS, STORAGE_LIMITS } from '@irori/protocol';
import { validateGameToHost } from '../src/index';

const ok = (msg: unknown) => {
  const r = validateGameToHost(msg);
  if (!r.ok) throw new Error(`拒まれた: ${r.reason}`);
  return r.msg;
};
const rejected = (msg: unknown) => validateGameToHost(msg).ok === false;
const b = (id: string, label = 'ボタン') => ({ id, label });

describe('validateGameToHost：通すもの', () => {
  it('ready・6種の setPad・vibrate・end・store を通し、検証したキーだけで組み直す', () => {
    expect(ok({ m: 'ready' })).toEqual({ m: 'ready' });
    const specs = [
      { k: 'wait', title: 'よーい', body: '<b>まもなく</b>' },
      { k: 'pad', stick: 'stick', buttons: [b('jump'), b('fire', '撃つ')], hint: 'h', orient: 'landscape' },
      { k: 'pad' },
      { k: 'buzzer', label: '押せ', color: 'red', disabled: false },
      { k: 'choices', options: [b('a', 'A'), b('b', 'B')], disabled: true, hint: '選んで' },
      { k: 'touch', mode: 'swipe' },
      { k: 'tilt', buttons: [b('x')] },
    ];
    for (const spec of specs) expect(ok({ m: 'setPad', to: '*', spec })).toEqual({ m: 'setPad', to: '*', spec });
    expect(ok({ m: 'setPad', to: 8, spec: { k: 'wait' } })).toMatchObject({ to: 8 });
    expect(ok({ m: 'vibrate', to: 2, ms: [100.4, 0, 1000] })).toEqual({ m: 'vibrate', to: 2, ms: [100, 0, 1000] });
    expect(ok({ m: 'end' })).toEqual({ m: 'end' });
    expect(ok({ m: 'end', results: [{ p: 1, score: 10, label: '1位' }, { p: 2, score: -3.5 }] })).toEqual({
      m: 'end',
      results: [{ p: 1, score: 10, label: '1位' }, { p: 2, score: -3.5 }],
    });
    expect(ok({ m: 'store.get', id: 0, key: 'best' })).toEqual({ m: 'store.get', id: 0, key: 'best' });
    expect(ok({ m: 'store.set', id: 7, key: 'k'.repeat(64), value: 'x'.repeat(STORAGE_LIMITS.VALUE_MAX_BYTES) })).toMatchObject({ id: 7 });
  });
});

describe('validateGameToHost：捨てるもの', () => {
  const long = (n: number) => 'あ'.repeat(n);
  it.each([
    ['オブジェクトでない', null],
    ['数', 42],
    ['配列', [{ m: 'ready' }]],
    ['知らない種類', { m: 'hack' }],
    ['知らないキー', { m: 'ready', x: 1 }],
    ['to が 0', { m: 'setPad', to: 0, spec: { k: 'wait' } }],
    ['to が 9', { m: 'setPad', to: 9, spec: { k: 'wait' } }],
    ['to が小数', { m: 'setPad', to: 1.5, spec: { k: 'wait' } }],
    ['to が all', { m: 'setPad', to: 'all', spec: { k: 'wait' } }],
    ['remote', { m: 'setPad', to: '*', spec: { k: 'remote' } }],
    ['知らない画面', { m: 'setPad', to: '*', spec: { k: 'html', html: '<b>' } }],
    ['spec に知らないキー', { m: 'setPad', to: '*', spec: { k: 'wait', css: 'x' } }],
    ['ボタン5つ', { m: 'setPad', to: '*', spec: { k: 'pad', buttons: [b('a'), b('b'), b('c'), b('d'), b('e')] } }],
    ['ボタンの文字13', { m: 'setPad', to: '*', spec: { k: 'pad', buttons: [b('a', long(13))] } }],
    ['id が大文字', { m: 'setPad', to: '*', spec: { k: 'pad', buttons: [b('Jump')] } }],
    ['id が25文字', { m: 'setPad', to: '*', spec: { k: 'pad', buttons: [b('a'.repeat(25))] } }],
    ['色が名前でない', { m: 'setPad', to: '*', spec: { k: 'buzzer', label: 'x', color: '#f00' } }],
    ['ボタンに知らないキー', { m: 'setPad', to: '*', spec: { k: 'pad', buttons: [{ id: 'a', label: 'x', html: '<i>' }] } }],
    ['buzzer に label がない', { m: 'setPad', to: '*', spec: { k: 'buzzer' } }],
    ['disabled が文字', { m: 'setPad', to: '*', spec: { k: 'buzzer', label: 'x', disabled: 'yes' } }],
    ['選択肢1つ', { m: 'setPad', to: '*', spec: { k: 'choices', options: [b('a')] } }],
    ['選択肢7つ', { m: 'setPad', to: '*', spec: { k: 'choices', options: 'abcdefg'.split('').map((c) => b(c)) } }],
    ['ヒント41', { m: 'setPad', to: '*', spec: { k: 'touch', hint: long(41) } }],
    ['見出し25', { m: 'setPad', to: '*', spec: { k: 'wait', title: long(25) } }],
    ['本文121', { m: 'setPad', to: '*', spec: { k: 'wait', body: long(121) } }],
    ['stick の値', { m: 'setPad', to: '*', spec: { k: 'pad', stick: 'mouse' } }],
    ['orient の値', { m: 'setPad', to: '*', spec: { k: 'pad', orient: 'upside' } }],
    ['mode の値', { m: 'setPad', to: '*', spec: { k: 'touch', mode: 'draw' } }],
    ['振動が空', { m: 'vibrate', to: '*', ms: [] }],
    ['振動9個', { m: 'vibrate', to: '*', ms: Array(9).fill(10) }],
    ['振動が負', { m: 'vibrate', to: '*', ms: [-1] }],
    ['振動1001', { m: 'vibrate', to: '*', ms: [1001] }],
    ['振動 NaN', { m: 'vibrate', to: '*', ms: [Number.NaN] }],
    ['振動が文字', { m: 'vibrate', to: '*', ms: ['100'] }],
    ['結果9件', { m: 'end', results: Array.from({ length: 9 }, (_, i) => ({ p: (i % 8) + 1, score: 1 })) }],
    ['結果の席が0', { m: 'end', results: [{ p: 0, score: 1 }] }],
    ['結果の席が小数', { m: 'end', results: [{ p: 1.5, score: 1 }] }],
    ['結果の席の重複', { m: 'end', results: [{ p: 1, score: 1 }, { p: 1, score: 2 }] }],
    ['結果の点が無限', { m: 'end', results: [{ p: 1, score: Number.POSITIVE_INFINITY }] }],
    ['結果の点が文字', { m: 'end', results: [{ p: 1, score: '10' }] }],
    ['結果の文字13', { m: 'end', results: [{ p: 1, score: 1, label: long(13) }] }],
    ['保存の鍵が空', { m: 'store.get', id: 1, key: '' }],
    ['保存の鍵65', { m: 'store.get', id: 1, key: 'k'.repeat(65) }],
    ['保存の id が負', { m: 'store.get', id: -1, key: 'k' }],
    ['保存の値が16KB超', { m: 'store.set', id: 1, key: 'k', value: 'あ'.repeat(5462) }],
    ['保存の値が文字でない', { m: 'store.set', id: 1, key: 'k', value: 1 }],
  ])('%s', (_name, msg) => {
    expect(rejected(msg)).toBe(true);
  });

  it('巨大な文字列は、数え切らずにすぐ捨てる', () => {
    const huge = 'x'.repeat(5_000_000);
    const t0 = performance.now();
    expect(rejected({ m: 'setPad', to: '*', spec: { k: 'wait', title: huge } })).toBe(true);
    expect(rejected({ m: 'store.set', id: 1, key: 'k', value: huge })).toBe(true);
    expect(rejected({ m: 'vibrate', to: '*', ms: Array(1_000_000).fill(1) })).toBe(true);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('remote は、ゲームからは指定できない（理由つき）', () => {
    const r = validateGameToHost({ m: 'setPad', to: '*', spec: { k: 'remote' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/remote/);
  });

  it('画面の指定は、通ったものを知っているキーだけで組み直して返す（中継と同じ検査）', () => {
    const spec = { k: 'buzzer', label: '押せ', color: 'red' };
    const r = validateGameToHost({ m: 'setPad', to: 3, spec });
    expect(r.ok && r.msg.m === 'setPad' && r.msg.spec).toEqual(spec);
    expect(r.ok && r.msg.m === 'setPad' && r.msg.spec).not.toBe(spec);
  });
});

describe('validateGameToHost：でたらめな入力', () => {
  it('固定の種で2000通り。例外を投げず、通したものは上限を守っている', () => {
    let s = 12345;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const atoms: unknown[] = [null, undefined, 0, -1, 1, 8, 9, 1.5, Number.NaN, '', '*', 'a', 'x'.repeat(30), true, [], {}];
    const anyValue = (depth: number): unknown => {
      const r = rand();
      if (depth > 2 || r < 0.5) return pick(atoms);
      if (r < 0.75) return Array.from({ length: Math.floor(rand() * 6) }, () => anyValue(depth + 1));
      const o: Record<string, unknown> = {};
      for (const key of ['k', 'id', 'label', 'buttons', 'options', 'title', 'p', 'score'].filter(() => rand() < 0.4)) o[key] = anyValue(depth + 1);
      return o;
    };
    const keysOf: Record<string, string[]> = {
      ready: [],
      setPad: ['to', 'spec'],
      vibrate: ['to', 'ms'],
      end: ['results'],
      'store.get': ['id', 'key'],
      'store.set': ['id', 'key', 'value'],
      other: ['to'],
    };
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      const m = pick(Object.keys(keysOf));
      const msg: Record<string, unknown> = { m };
      for (const key of (keysOf[m] ?? []).filter(() => rand() < 0.8)) msg[key] = anyValue(0);
      if (rand() < 0.1) msg[pick(['x', 'p', 'spec', 'ms'])] = anyValue(0);
      if (m === 'setPad' && rand() < 0.6) msg.spec = { k: pick(['wait', 'pad', 'buzzer', 'choices', 'touch', 'tilt', 'remote']), ...(anyValue(1) as object) };
      if (m === 'vibrate' && rand() < 0.5) msg.ms = Array.from({ length: Math.floor(rand() * 10) }, () => pick(atoms));
      const r = validateGameToHost(msg);
      if (!r.ok) continue;
      accepted++;
      expect(validateGameToHost(r.msg).ok).toBe(true);
      if (r.msg.m === 'vibrate') expect(r.msg.ms.length).toBeLessThanOrEqual(LIMITS.FX_PATTERN_MAX);
      if (r.msg.m === 'end') expect((r.msg.results ?? []).length).toBeLessThanOrEqual(LIMITS.MAX_PLAYERS);
      if (r.msg.m === 'setPad') expect(r.msg.spec.k).not.toBe('remote');
    }
    expect(accepted).toBeGreaterThan(10);
  });
});
