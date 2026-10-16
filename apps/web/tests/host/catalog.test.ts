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
