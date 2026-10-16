// 設定の読み方（純粋な関数）。運営者の値 MAX_ROOMS_PER_DAY はいつも読み、試験用の上書きは ALLOW_TEST_OVERRIDES が "1" のときだけ。
import { LIMITS } from '@irori/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_ROOMS_PER_DAY_CEILING, WS_PER_MINUTE_CEILING, readSettings } from '../src/config';

const daily = (env: object) => readSettings(env).limiter.maxRoomsPerDay;

describe('MAX_ROOMS_PER_DAY（運営者の値）', () => {
  it('ALLOW_TEST_OVERRIDES がなくても読む', () => {
    expect(daily({ MAX_ROOMS_PER_DAY: '3' })).toBe(3);
    expect(daily({ MAX_ROOMS_PER_DAY: '2000' })).toBe(2000);
  });

  it.each(['', 'abc', '-5', '0', '00', '1.5', ' 3', '3 ', '1e3', '+3'])('不正な値 %j は既定（2000）に戻す', (v) => {
    expect(daily({ MAX_ROOMS_PER_DAY: v })).toBe(LIMITS.DEFAULT_MAX_ROOMS_PER_DAY);
  });

  it('値がない・文字列でないときも既定', () => {
    expect(daily({})).toBe(LIMITS.DEFAULT_MAX_ROOMS_PER_DAY);
    expect(daily({ MAX_ROOMS_PER_DAY: 5 })).toBe(LIMITS.DEFAULT_MAX_ROOMS_PER_DAY);
  });

  it('上限（1,000,000）で丸める', () => {
    expect(daily({ MAX_ROOMS_PER_DAY: '1000000' })).toBe(MAX_ROOMS_PER_DAY_CEILING);
    expect(daily({ MAX_ROOMS_PER_DAY: '1000001' })).toBe(MAX_ROOMS_PER_DAY_CEILING);
    expect(daily({ MAX_ROOMS_PER_DAY: '99999999999999999999' })).toBe(MAX_ROOMS_PER_DAY_CEILING);
  });
});

describe('WS_CONNECT_PER_IP_PER_MINUTE（運営者の値）', () => {
  const ws = (env: object) => readSettings(env).limiter.wsPerMinute;
  it('ALLOW_TEST_OVERRIDES がなくても読み、不正な値は既定（60）、上限で丸める', () => {
    expect(ws({})).toBe(LIMITS.WS_CONNECT_PER_IP.perMinute);
    expect(ws({ WS_CONNECT_PER_IP_PER_MINUTE: '120' })).toBe(120);
    for (const v of ['', '0', '-1', 'x', '1.5']) expect(ws({ WS_CONNECT_PER_IP_PER_MINUTE: v })).toBe(LIMITS.WS_CONNECT_PER_IP.perMinute);
    expect(ws({ WS_CONNECT_PER_IP_PER_MINUTE: '99999999' })).toBe(WS_PER_MINUTE_CEILING);
  });
});

describe('試験用の上書き', () => {
  const env = { PAD_GRACE_MS: '100', HELLO_TIMEOUT_MS: '200', CREATE_PER_IP_PER_MINUTE: '1', LOOKUP_PER_IP_PER_MINUTE: '2', MAX_PLAYERS: '20' };

  it('ALLOW_TEST_OVERRIDES が "1" でなければ読まない（"true" も不可）', () => {
    for (const flag of [undefined, '', 'true', '0', ' 1']) {
      const s = readSettings(flag === undefined ? env : { ...env, ALLOW_TEST_OVERRIDES: flag });
      expect(s.room).toEqual({ MAX_PLAYERS: LIMITS.MAX_PLAYERS });
      expect(s.limiter.createPerMinute).toBe(LIMITS.CREATE_PER_IP.perMinute);
      expect(s.limiter.lookupPerMinute).toBe(LIMITS.LOOKUP_PER_IP.perMinute);
    }
  });

  it('"1" なら読み、席の数は8で頭打ちにする', () => {
    const s = readSettings({ ...env, ALLOW_TEST_OVERRIDES: '1' });
    expect(s.room).toEqual({ PAD_GRACE_MS: 100, HELLO_TIMEOUT_MS: 200, MAX_PLAYERS: 8 });
    expect(s.limiter.createPerMinute).toBe(1);
    expect(s.limiter.lookupPerMinute).toBe(2);
  });
});
