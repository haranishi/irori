import { describe, expect, it } from 'vitest';
import type { GameEntry } from '../../src/host/catalog';
import { frameSource, hostToConfirm, loadTrusted, saveTrusted } from '../../src/host/launch';

const ORIGIN = 'https://irori.example';

function game(over: Partial<GameEntry>): GameEntry {
  return {
    id: 'g',
    title: 'g',
    summary: '',
    players: { min: 1, max: 8 },
    pads: [],
    authors: [],
    license: 'MIT',
    assets: 'original',
    entry: { bundled: 'games/g/' },
    thumb: null,
    host: null,
    dev: false,
    ...over,
  };
}

describe('ゲームを開く前の決まり', () => {
  it('同梱のゲームは、末尾のスラッシュの道で、オリジンを持たない枠に入れる。確かめは要らない', () => {
    const r = frameSource(game({}), ORIGIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toMatchObject({ kind: 'bundled', src: `${ORIGIN}/games/g/`, sandbox: 'allow-scripts' });
    expect(hostToConfirm(r.source, new Set())).toBeNull();
  });

  it('外部のゲームは、開く前にホスト名の確かめが要る。そのタブで確かめた後は要らない', () => {
    const r = frameSource(game({ entry: { url: 'https://games.example.org/far/' }, host: 'games.example.org' }), ORIGIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(hostToConfirm(r.source, new Set())).toBe('games.example.org');
    expect(hostToConfirm(r.source, new Set(['games.example.org']))).toBeNull();
    expect(hostToConfirm(r.source, new Set(['other.example.org']))).toBe('games.example.org');
  });

  it('http の外部ゲームは開けない。開発用（?dev=）の localhost だけは http を許す', () => {
    expect(frameSource(game({ entry: { url: 'http://games.example.org/' } }), ORIGIN).ok).toBe(false);
    const dev = frameSource(game({ entry: { url: 'http://localhost:5173/' }, dev: true }), 'http://127.0.0.1:8787');
    expect(dev.ok).toBe(true);
    if (dev.ok) expect(hostToConfirm(dev.source, new Set())).toBe('localhost:5173');
  });

  it('確かめたホスト名は sessionStorage に置き、壊れた値は無視する', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveTrusted(s, new Set(['a.example', 'b.example']));
    expect([...loadTrusted(s)]).toEqual(['a.example', 'b.example']);
    store.set('irori:host:trusted', '{"not":"a list"}');
    expect(loadTrusted(s).size).toBe(0);
    store.set('irori:host:trusted', 'broken');
    expect(loadTrusted(s).size).toBe(0);
    expect(loadTrusted(null).size).toBe(0);
  });
});
