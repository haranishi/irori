import { describe, expect, it } from 'vitest';
import { devEntry, loadCatalog, parseCatalog } from '../../src/host/catalog';
import { registerHostMessages } from '../../src/host/messages';
import registry from '../fixtures/host/registry.json';
import { useJapanese } from './fakes';

useJapanese();
registerHostMessages();
const fixture: unknown = registry;

describe('棚の一覧', () => {
  it('検査を通るものだけを、一覧の順で出す（形の違う id と、二重の id は出さない）', () => {
    const games = parseCatalog(fixture, 'ja');
    expect(games.map((g) => g.id)).toEqual(['fixture-race', 'fixture-solo', 'fixture-far']);
    expect(games[0]).toMatchObject({ title: 'はやおしレース', players: { min: 2, max: 8 }, pads: ['buzzer', 'wait'], license: 'MIT OR Apache-2.0', assets: 'original', host: null, dev: false });
  });

  it('言語を選び、無ければもう一方の言語にする', () => {
    const en = parseCatalog(fixture, 'en');
    expect(en[0]?.title).toBe('Buzzer Race');
    expect(en[2]?.title).toBe('とおくのゲーム');
  });

  it('サムネイルは /registry/thumbs/ の公開パス（一覧が足したパスがあれば、それ）', () => {
    const games = parseCatalog(fixture, 'ja');
    expect(games.map((g) => g.thumb)).toEqual(['/registry/thumbs/fixture-race.png', '/registry/thumbs/fixture-solo.png', '/registry/thumbs/fixture-far.webp']);
  });

  it('外部のゲームはホスト名を持つ', () => {
    expect(parseCatalog(fixture, 'ja')[2]).toMatchObject({ host: 'games.example.invalid', entry: { url: 'https://games.example.invalid/far/' } });
  });

  it('配列そのものの形でも読む。形の違うものは空', () => {
    const list = (fixture as { games: unknown[] }).games;
    expect(parseCatalog(list, 'ja')).toHaveLength(3);
    expect(parseCatalog({ nope: true }, 'ja')).toEqual([]);
    expect(parseCatalog(null, 'ja')).toEqual([]);
  });

  it('?dev= のゲームは1〜8人、外部扱い（ホスト名つき）', () => {
    const d = devEntry('http://localhost:5173/');
    expect(d).toMatchObject({ id: 'dev', dev: true, host: 'localhost:5173', players: { min: 1, max: 8 }, pads: [] });
  });

  it('読み込み：失敗の応答は例外にする', async () => {
    const ok = (async () => new Response(JSON.stringify(fixture), { status: 200 })) as typeof fetch;
    expect(await loadCatalog(ok, 'ja')).toHaveLength(3);
    const ng = (async () => new Response('x', { status: 404 })) as typeof fetch;
    await expect(loadCatalog(ng, 'ja')).rejects.toThrow();
  });
});

it('追加のジャンルと動画は安全な値だけを表示し、旧登録も読める', () => {
  const entry = { ...registry.games[0], kind: { ja: '連打', en: 'Tapping' }, preview: 'fixture-race.mp4' };
  const parsed = parseCatalog([entry], 'en')[0]!;
  expect(parsed.kind).toBe('Tapping');
  expect(parsed.preview).toBe('/registry/previews/fixture-race.mp4');
  expect(parseCatalog([{ ...entry, kind: { ja: '長'.repeat(13) }, preview: '../escape.mp4' }], 'ja')[0]?.kind).toBeUndefined();
  expect(parseCatalog([{ ...entry, preview: 'https://other.invalid/file.mp4' }], 'ja')[0]?.preview).toBeUndefined();
});


it('時間は省略でき、整数1〜120の順序が正しい範囲だけを読む', () => {
  for (const minutes of [{ min: 1, max: 1 }, { min: 3, max: 120 }]) {
    expect(parseCatalog([{ ...registry.games[0], minutes }], 'ja')[0]?.minutes).toEqual(minutes);
  }
  for (const minutes of [null, {}, { min: 0, max: 1 }, { min: 5, max: 3 }, { min: 1.5, max: 2 }, { min: 1, max: 121 }, { min: 1, max: 2, extra: true }]) {
    expect(parseCatalog([{ ...registry.games[0], minutes }], 'ja')[0]?.minutes).toBeUndefined();
  }
});
