import { LIMITS } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, World } from './world';

const MENU = JSON.stringify({ t: 'in', i: { k: 'menu' } });
/** 形は正しいまま、空白で大きさだけ増やしたフレーム（大きさの検査だけが止められる）。 */
const padded = (json: string, bytes: number) => json.slice(0, -1) + ' '.repeat(bytes - json.length) + '}';

function setup() {
  const w = new World();
  const h = w.host();
  const p = w.pad();
  w.take(h);
  w.take(p.conn);
  // hello で使った分のトークンを満たしておく（瞬間の上限をちょうどで確かめるため）
  w.advance(2_000);
  return { w, h, p: p.conn };
}

describe('大きさ', () => {
  it('スマホの512バイトちょうどは通り、513バイトは 4002 で閉じて転送しない', () => {
    const { w, h, p } = setup();
    w.raw(p, padded(MENU, LIMITS.FRAME_MAX_BYTES.pad));
    expect(w.take(h)).toHaveLength(1);
    w.raw(p, padded(MENU, LIMITS.FRAME_MAX_BYTES.pad + 1));
    expect(w.take(p)).toEqual([{ t: 'err', code: 'too-large' }]);
    expect(w.closeCode(p)).toBe(CLOSE_CODES['too-large']);
    expect(w.take(h)).toEqual([{ t: 'online', p: 1, on: false }]);
  });

  it('ホストは16KiBまで', () => {
    const { w, h, p } = setup();
    const lock = JSON.stringify({ t: 'lock', on: true });
    w.raw(h, padded(lock, LIMITS.FRAME_MAX_BYTES.host));
    expect(w.closeCode(h)).toBeUndefined();
    w.raw(h, padded(lock, LIMITS.FRAME_MAX_BYTES.host + 1));
    expect(w.closeCode(h)).toBe(CLOSE_CODES['too-large']);
    expect(w.take(p)).toEqual([{ t: 'host', on: false }]);
  });

  it('役割が決まる前は、スマホの上限で見る', () => {
    const w = new World();
    const c = w.open();
    w.raw(c, padded(JSON.stringify({ t: 'hello', v: 1, role: 'host', key: w.key }), LIMITS.FRAME_MAX_BYTES.pad + 1));
    expect(w.closeCode(c)).toBe(CLOSE_CODES['too-large']);
  });

  it('大きさは文字数ではなく、受信バイト数で見る', () => {
    const { w, p } = setup();
    // 「あ」は3バイト。200文字なら600バイトで、文字数では上限に届かなくても超える
    w.raw(p, JSON.stringify({ t: 'hello', v: 1, role: 'pad', name: 'あ'.repeat(200) }));
    expect(w.closeCode(p)).toBe(CLOSE_CODES['too-large']);
  });
});

describe('速さ', () => {
  it('瞬間120個までは通し、超えた分は捨てる。続けば 4003 で閉じる', () => {
    const { w, h, p } = setup();
    for (let i = 0; i < LIMITS.RATE.pad.burst; i++) w.raw(p, MENU);
    expect(w.take(h)).toHaveLength(LIMITS.RATE.pad.burst);
    w.raw(p, MENU);
    expect(w.take(h)).toEqual([]);
    expect(w.take(p)).toEqual([{ t: 'err', code: 'rate' }]);
    for (let i = 1; i < LIMITS.VIOLATIONS_BEFORE_CLOSE - 1; i++) w.raw(p, MENU);
    expect(w.closeCode(p)).toBeUndefined();
    w.raw(p, MENU);
    expect(w.closeCode(p)).toBe(CLOSE_CODES.rate);
    expect(w.take(p).at(-1)).toEqual({ t: 'err', code: 'rate' });
  });

  it('毎秒60個を10秒続けても、1つも捨てない', () => {
    const { w, h, p } = setup();
    let forwarded = 0;
    for (let i = 0; i < 600; i++) {
      w.advance(1000 / LIMITS.RATE.pad.perSec);
      w.raw(p, MENU);
      forwarded += w.take(h).length;
    }
    expect(forwarded).toBe(600);
    expect(w.take(p)).toEqual([]);
  });

  it('ホストは瞬間80個まで', () => {
    const { w, h, p } = setup();
    const fx = JSON.stringify({ t: 'fx', to: 1, ms: [1] });
    for (let i = 0; i < LIMITS.RATE.host.burst; i++) w.raw(h, fx);
    expect(w.take(p)).toHaveLength(LIMITS.RATE.host.burst);
    w.raw(h, fx);
    expect(w.take(p)).toEqual([]);
    expect(w.take(h)).toEqual([{ t: 'err', code: 'rate' }]);
  });
});

describe('違反の連続', () => {
  it('不正なフレームは捨てて知らせ、5秒の窓で20回目に 4003 で閉じる', () => {
    const { w, h, p } = setup();
    for (let i = 1; i < LIMITS.VIOLATIONS_BEFORE_CLOSE; i++) w.raw(p, '{"t":"nope"}');
    expect(w.take(p)).toHaveLength(LIMITS.VIOLATIONS_BEFORE_CLOSE - 1);
    expect(w.closeCode(p)).toBeUndefined();
    w.raw(p, 'garbage');
    expect(w.take(p)).toEqual([{ t: 'err', code: 'rate' }]);
    expect(w.closeCode(p)).toBe(CLOSE_CODES.rate);
    // 席は残る（札で入り直せる）。ホストには「切れた」と知らせる
    expect(w.take(h)).toEqual([{ t: 'online', p: 1, on: false }]);
  });

  it('窓を過ぎた違反は数えない', () => {
    const { w, p } = setup();
    for (let i = 1; i < LIMITS.VIOLATIONS_BEFORE_CLOSE; i++) w.raw(p, '{}');
    w.advance(5_001);
    for (let i = 1; i < LIMITS.VIOLATIONS_BEFORE_CLOSE; i++) w.raw(p, '{}');
    expect(w.closeCode(p)).toBeUndefined();
  });

  it('バイナリも違反として数える', () => {
    const { w, p } = setup();
    w.binary(p, 4);
    expect(w.take(p)).toEqual([{ t: 'err', code: 'bad-frame' }]);
  });
});
