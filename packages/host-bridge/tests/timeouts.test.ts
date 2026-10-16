import { describe, expect, it } from 'vitest';
import { EXTERNAL_HANDSHAKE_TIMEOUT_MS, HANDSHAKE_TIMEOUT_MS, handshakeTimeoutFor } from '../src/index';

describe('握手の既定の待ち時間', () => {
  it('同梱は同じ配信元から読むので短く、外部は遠いサーバーを見込んで登録の検査と同じ10秒まで待つ', () => {
    expect(handshakeTimeoutFor('bundled')).toBe(HANDSHAKE_TIMEOUT_MS);
    expect(handshakeTimeoutFor('external')).toBe(EXTERNAL_HANDSHAKE_TIMEOUT_MS);
    expect(EXTERNAL_HANDSHAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(HANDSHAKE_TIMEOUT_MS).toBeLessThan(EXTERNAL_HANDSHAKE_TIMEOUT_MS);
  });
});
