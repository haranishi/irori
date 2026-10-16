// 書記素の数え方が違う実行環境をまたいでも、中継が整えた名前を受け手が拒まないこと。
// Node 24（ICU 77.1）はミャンマー・クメール・ジャワ・バリ文字の結合子音を2書記素と数え、Chromium・WebKit・workerd は
// 1書記素と数える。ここでは「1書記素と数える」偽物の Intl.Segmenter で、中継の側の環境をまねる。
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONJUNCTS: Record<string, string> = {
  ミャンマー文字: '\u{1000}\u{1039}\u{1000}',
  クメール文字: '\u{1780}\u{17d2}\u{1780}',
  ジャワ文字: '\u{a98f}\u{a9c0}\u{a98f}',
  バリ文字: '\u{1b13}\u{1b44}\u{1b13}',
};
const VIRAMA_AT_END = /[\u{1039}\u{17d2}\u{a9c0}\u{1b44}]$/u;
const RealSegmenter = Intl.Segmenter;

/** 結合子音を1書記素にまとめる偽物（ブラウザ・workerd の数え方）。 */
class JoiningSegmenter {
  private readonly inner = new RealSegmenter(undefined, { granularity: 'grapheme' });
  segment(s: string): Array<{ segment: string }> {
    const out: Array<{ segment: string }> = [];
    for (const { segment } of this.inner.segment(s)) {
      const last = out.at(-1);
      if (last && VIRAMA_AT_END.test(last.segment)) last.segment += segment;
      else out.push({ segment });
    }
    return out;
  }
}

/** 新しく読み込んだ protocol。Segmenter を渡すと、その環境として振る舞う（書記素の数えは最初の使用時に作られる）。 */
async function protocolIn(Segmenter?: unknown): Promise<typeof import('../src/index')> {
  vi.resetModules();
  vi.unstubAllGlobals();
  if (Segmenter) vi.stubGlobal('Intl', Object.create(Intl, { Segmenter: { value: Segmenter } }));
  const p = await import('../src/index');
  p.countGraphemes('a'); // ここで書記素の数えを作らせ、この環境に固定する
  vi.unstubAllGlobals();
  return p;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('書記素の数え方の違いをまたぐ', () => {
  it('Node の数え方は、ブラウザ・workerd と違う（この試験の前提）', async () => {
    const node = await protocolIn();
    const joining = await protocolIn(JoiningSegmenter);
    for (const c of Object.values(CONJUNCTS)) {
      expect(node.countGraphemes(c)).toBe(2);
      expect(joining.countGraphemes(c)).toBe(1);
    }
  });

  it.each(Object.entries(CONJUNCTS))('%s を13個：1書記素と数える中継が切った名前を、2書記素と数える受け手が拒まない', async (_script, c) => {
    const relay = await protocolIn(JoiningSegmenter);
    const name = relay.sanitizeName(c.repeat(13), 'プレイヤー1');
    expect(name.length).toBeGreaterThan(0);
    expect(relay.countCodePoints(name)).toBeLessThanOrEqual(32);
    const host = await protocolIn();
    // 受け手（Node）で数えると12書記素を超える。書記素で縛っていたら、ここで名簿を捨てていた
    expect(host.countGraphemes(name)).toBeGreaterThan(12);
    const joined = JSON.stringify({ t: 'joined', p: { id: 1, name, online: true } });
    expect(host.parseToHostFrame(joined).ok).toBe(true);
    const welcome = JSON.stringify({ t: 'welcome', role: 'host', code: 'BCDF', players: [{ id: 1, name, online: true }], max: 8, locked: false });
    expect(host.parseToHostFrame(welcome).ok).toBe(true);
    const you = JSON.stringify({ t: 'welcome', role: 'pad', you: { id: 1, name, online: true }, resume: 'r', host: true });
    expect(host.parseToPadFrame(you).ok).toBe(true);
  });

  it.each(Object.entries(CONJUNCTS))('%s を13個：逆向き（2書記素と数える中継、1書記素と数える受け手）でも通る', async (_script, c) => {
    const relay = await protocolIn();
    const name = relay.sanitizeName(c.repeat(13), 'プレイヤー1');
    const pad = await protocolIn(JoiningSegmenter);
    expect(pad.parseToPadFrame(JSON.stringify({ t: 'welcome', role: 'pad', you: { id: 1, name, online: true }, resume: 'r', host: true })).ok).toBe(true);
  });

  it('画面の文字も、環境に依らず同じ判定になる（結合子音4つ＝12符号位置は、どちらでも通る）', async () => {
    const label = CONJUNCTS['ミャンマー文字']!.repeat(4);
    for (const p of [await protocolIn(), await protocolIn(JoiningSegmenter)]) {
      expect(p.validatePadSpec({ k: 'buzzer', label }).ok).toBe(true);
      expect(p.validatePadSpec({ k: 'buzzer', label: label + CONJUNCTS['ミャンマー文字']! }).ok).toBe(false);
    }
  });
});
