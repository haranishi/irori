import { describe, expect, it } from 'vitest';
import { STORAGE_LIMITS } from '@irori/protocol';
import { createGameStorage, validateManifestEntry } from '../src/index';
import type { StorageBackend } from '../src/index';

class MemoryStorage implements StorageBackend {
  readonly map = new Map<string, string>();
  failOnSet = false;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failOnSet) throw new DOMException('full', 'QuotaExceededError');
    this.map.set(k, v);
  }
}

describe('createGameStorage', () => {
  it('irori:game:<id>:<key> の名前で分け、ほかのゲームの値は見えない', () => {
    const mem = new MemoryStorage();
    const a = createGameStorage('a1', mem);
    const ab = createGameStorage('a1-b', mem);
    expect(a.set('best', '42')).toEqual({ ok: true, value: null });
    expect(mem.map.get('irori:game:a1:best')).toBe('42');
    expect(ab.get('best')).toEqual({ ok: true, value: null });
    expect(a.get('best')).toEqual({ ok: true, value: '42' });
    mem.map.set('irori:session:key', 'secret');
    expect(a.get('../session:key')).toEqual({ ok: true, value: null });
  });

  it('1つ16KB、合計64KB。上書きは古い分を差し引いて数える', () => {
    const mem = new MemoryStorage();
    const s = createGameStorage('quiz', mem);
    const full = 'x'.repeat(STORAGE_LIMITS.VALUE_MAX_BYTES);
    expect(s.set('a', `${full}y`)).toEqual({ ok: false, error: 'too-large' });
    expect(s.set('a', 'あ'.repeat(5462))).toEqual({ ok: false, error: 'too-large' });
    expect(s.set('a', full).ok).toBe(true);
    expect(s.set('b', full).ok).toBe(true);
    expect(s.set('c', full).ok).toBe(true);
    expect(s.set('d', full)).toEqual({ ok: false, error: 'quota' });
    expect(s.set('a', full).ok).toBe(true);
    expect(s.usage()).toBe(3 * (1 + STORAGE_LIMITS.VALUE_MAX_BYTES));
    expect(s.set('d', 'x'.repeat(STORAGE_LIMITS.TOTAL_MAX_BYTES - s.usage() - 1)).ok).toBe(true);
    expect(s.usage()).toBe(STORAGE_LIMITS.TOTAL_MAX_BYTES);
    expect(s.set('e', '')).toEqual({ ok: false, error: 'quota' });
  });

  it('鍵の形・保存の失敗・ゲームの id', () => {
    const mem = new MemoryStorage();
    const s = createGameStorage('g', mem);
    expect(s.get('')).toEqual({ ok: false, error: 'key' });
    expect(s.set('k'.repeat(65), 'v')).toEqual({ ok: false, error: 'key' });
    mem.failOnSet = true;
    expect(s.set('k', 'v')).toEqual({ ok: false, error: 'unavailable' });
    for (const bad of ['', 'A', 'a:b', '-a', 'a'.repeat(41), '../x']) expect(() => createGameStorage(bad, mem)).toThrow(RangeError);
  });
});

const good = () => ({
  schema: 1,
  id: 'hello-pad',
  title: { ja: 'ハローパッド', en: 'Hello Pad' },
  summary: { ja: 'スティックで動く最小の見本' },
  authors: [{ name: 'irori contributors' }],
  license: { code: 'MIT OR Apache-2.0', assets: 'original' },
  players: { min: 1, max: 8 },
  pads: ['pad'],
  entry: { bundled: 'games/hello-pad/' },
  thumbnail: 'hello-pad.png',
  sdk: 1,
  rating: 'all',
  added: '2026-10-16',
});

describe('validateManifestEntry', () => {
  it('正しい登録情報を通す。棚の表示用に足したキーは拒まない', () => {
    expect(validateManifestEntry(good()).ok).toBe(true);
    expect(validateManifestEntry({ ...good(), pads: ['tiles', 'wait'] }).ok).toBe(true);
    expect(validateManifestEntry({ ...good(), thumbUrl: '/registry/thumbs/hello-pad.png' }).ok).toBe(true);
    expect(validateManifestEntry({ ...good(), entry: { url: 'https://games.example/party/' }, links: { source: 'https://github.com/x/y' } }).ok).toBe(true);
  });

  it.each([
    ['schema', { schema: 2 }],
    ['id', { id: 'Hello' }],
    ['id の長さ', { id: 'ab' }],
    ['title が長い', { title: { ja: 'あ'.repeat(25) } }],
    ['title の言語', { title: { fr: 'bonjour' } }],
    ['summary がない', { summary: {} }],
    ['作者がいない', { authors: [] }],
    ['作者のURLが http', { authors: [{ name: 'a', url: 'http://x.example' }] }],
    ['ライセンス', { license: { code: 'MIT' } }],
    ['人数の逆転', { players: { min: 4, max: 2 } }],
    ['人数が9', { players: { min: 1, max: 9 } }],
    ['知らないパッド', { pads: ['html'] }],
    ['パッドの重複', { pads: ['pad', 'pad'] }],
    ['パッドが空', { pads: [] }],
    ['外部URLが http', { entry: { url: 'http://games.example/' } }],
    ['外部URLに認証情報', { entry: { url: 'https://u:p@games.example/' } }],
    ['entry が2つ', { entry: { bundled: 'games/x/', url: 'https://games.example/' } }],
    ['bundled の形', { entry: { bundled: '../x/' } }],
    ['サムネイル', { thumbnail: 'https://cdn.example/x.png' }],
    ['sdk', { sdk: 2 }],
    ['rating', { rating: 'adult' }],
    ['日付', { added: '2026/10/16' }],
    ['links が http', { links: { source: 'http://x.example' } }],
  ])('%s が違えば拒む', (_name, patch) => {
    expect(validateManifestEntry({ ...good(), ...patch }).ok).toBe(false);
  });

  it('オブジェクトでなければ拒む', () => {
    for (const bad of [null, 'x', [], 1]) expect(validateManifestEntry(bad).ok).toBe(false);
  });
});
