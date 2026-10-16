import { describe, expect, it, vi } from 'vitest';
import { canNativeShare, copyText, nativeShare, shareLinks } from '../../src/host/share';

describe('共有', () => {
  it('共有するのはサイトのURL（origin + /）。部屋のURL（/pad#CODE）ではない', () => {
    const s = shareLinks('https://irori.example', 'みんなで遊ぼう');
    expect(s.url).toBe('https://irori.example/');
    expect(s.url).not.toContain('/pad');
    expect(s.url).not.toContain('#');
  });

  it('X と LINE の投稿画面の形', () => {
    const s = shareLinks('https://irori.example', 'みんなで 遊ぼう&');
    const x = new URL(s.x);
    expect(`${x.origin}${x.pathname}`).toBe('https://x.com/intent/post');
    expect(x.searchParams.get('url')).toBe('https://irori.example/');
    expect(x.searchParams.get('text')).toBe('みんなで 遊ぼう&');
    const line = new URL(s.line);
    expect(`${line.origin}${line.pathname}`).toBe('https://social-plugins.line.me/lineit/share');
    expect(line.searchParams.get('url')).toBe('https://irori.example/');
    expect([...line.searchParams.keys()]).toEqual(['url']);
  });

  it('端末の共有シートは、navigator.share があるときだけ', async () => {
    expect(canNativeShare({})).toBe(false);
    expect(canNativeShare(undefined)).toBe(false);
    const share = vi.fn(async () => undefined);
    expect(canNativeShare({ share })).toBe(true);
    expect(await nativeShare({ share }, { url: 'https://irori.example/' })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ url: 'https://irori.example/' });
    const cancel = async () => {
      throw new DOMException('closed', 'AbortError');
    };
    expect(await nativeShare({ share: cancel }, {})).toBe('cancelled');
    expect(await nativeShare({ share: async () => Promise.reject(new Error('x')) }, {})).toBe('failed');
  });

  it('リンクのコピー：クリップボードが使えれば、それで書く', async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyText('https://irori.example/', { clipboard: { writeText }, document })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://irori.example/');
  });

  it('リンクのコピー：断られたら textarea と execCommand で試し、後片付けする', async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error('denied')));
    const exec = vi.fn(() => true);
    const doc = document as Document & { execCommand: (c: string) => boolean };
    const original = doc.execCommand;
    doc.execCommand = exec;
    try {
      expect(await copyText('https://irori.example/', { clipboard: { writeText }, document })).toBe(true);
      expect(exec).toHaveBeenCalledWith('copy');
      expect(document.querySelector('textarea')).toBeNull();
      exec.mockReturnValue(false);
      expect(await copyText('x', { clipboard: undefined, document })).toBe(false);
    } finally {
      doc.execCommand = original;
    }
  });
});
