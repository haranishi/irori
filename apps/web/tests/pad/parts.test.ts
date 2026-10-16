// 部品ごとの試験：長押し・コードの入力・コードと存在確認・名前・語の切れ目。
import { describe, expect, it } from 'vitest';
import { codeInput } from '../../src/pad/code-input';
import { LONG_PRESS_MS, longPress } from '../../src/pad/long-press';
import { registerPadMessages } from '../../src/pad/messages';
import { chunks, clauses, phrase, softBreaks } from '../../src/pad/phrase';
import { codeChars, codeFromHash, fitName, lookupRoom, openStorage, readItem, writeItem } from '../../src/pad/room';
import { FakeClock, pointer } from './helpers';

registerPadMessages();

describe('長押し（メニューの入口）', () => {
  function setup() {
    const clock = new FakeClock();
    const el = document.createElement('button');
    document.body.append(el);
    let opened = 0;
    let hints = 0;
    longPress(el, { timers: clock, onLongPress: () => opened++, onShortTap: () => hints++ });
    const tap = () => {
      pointer(el, 'pointerdown');
      clock.advance(120);
      pointer(el, 'pointerup');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    };
    return { clock, el, tap, opened: () => opened, hints: () => hints };
  }

  it('短いタップでは開かない（案内だけ）', () => {
    const s = setup();
    s.tap();
    s.tap();
    expect(s.opened()).toBe(0);
    expect(s.hints()).toBe(2);
  });

  it(`${LONG_PRESS_MS}ms 押し続けると開く。押している間は data-holding を付ける`, () => {
    const s = setup();
    pointer(s.el, 'pointerdown');
    expect(s.el.hasAttribute('data-holding')).toBe(true);
    s.clock.advance(LONG_PRESS_MS - 1);
    expect(s.opened()).toBe(0);
    s.clock.advance(1);
    expect(s.opened()).toBe(1);
    expect(s.el.hasAttribute('data-holding')).toBe(false);
    // 開いたあとに離しても、短いタップの扱いにはならない。
    pointer(s.el, 'pointerup');
    s.el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(s.opened()).toBe(1);
    expect(s.hints()).toBe(0);
  });

  it('途中で指がずれる・取り消されると開かない', () => {
    const s = setup();
    pointer(s.el, 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(s.el, 'pointermove', { clientX: 40, clientY: 10 });
    s.clock.advance(LONG_PRESS_MS * 2);
    pointer(s.el, 'pointerdown');
    pointer(s.el, 'pointercancel');
    s.clock.advance(LONG_PRESS_MS * 2);
    expect(s.opened()).toBe(0);
  });

  it('キーボード・読み上げの決定（detail 0 の click）は、そのまま開く', () => {
    const s = setup();
    s.el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(s.opened()).toBe(1);
  });
});

describe('コードの入力（4つの枠）', () => {
  function setup(prefill = '') {
    const done: string[] = [];
    let bad = 0;
    const input = codeInput({ prefill, onComplete: (c) => done.push(c), onBadChar: () => bad++ });
    document.body.replaceChildren(input.el);
    const boxes = [...input.el.querySelectorAll<HTMLInputElement>('input')];
    const type = (i: number, text: string) => {
      boxes[i]!.value = text;
      boxes[i]!.dispatchEvent(new Event('input', { bubbles: true }));
    };
    return { input, boxes, type, done, bad: () => bad };
  }

  it('小文字・全角は大文字の半角にし、打つと次の枠へ進む。4文字そろうと知らせる', () => {
    const s = setup();
    s.type(0, 'b');
    expect(s.boxes[0]!.value).toBe('B');
    expect(document.activeElement).toBe(s.boxes[1]);
    s.type(1, 'Ｃ');
    s.type(2, 'd');
    s.type(3, 'f');
    expect(s.done).toEqual(['BCDF']);
  });

  it('使えない文字（母音・0・1など）は入れず、案内を出す', () => {
    const s = setup();
    s.type(0, 'a');
    s.type(0, '0');
    expect(s.boxes[0]!.value).toBe('');
    expect(s.bad()).toBe(2);
  });

  it('貼り付けは枠に振り分ける。4文字なら最初の枠から。URL なら # の後ろ', () => {
    const s = setup();
    const paste = (i: number, text: string) => {
      const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } };
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
      s.boxes[i]!.dispatchEvent(ev);
    };
    paste(2, 'https://irori.example/pad#bc-df');
    expect(s.boxes.map((b) => b.value)).toEqual(['B', 'C', 'D', 'F']);
    expect(s.done).toEqual(['BCDF']);
  });

  it('空の枠で Backspace を押すと、前の枠を消してそこへ戻る', () => {
    const s = setup('BCD');
    s.boxes[3]!.focus();
    s.boxes[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(s.boxes[2]!.value).toBe('');
    expect(document.activeElement).toBe(s.boxes[2]);
  });
});

describe('コード・存在確認・名前・保存', () => {
  it('URL の # からコードを取る（大文字・全角・横棒・URL の %）', () => {
    expect(codeFromHash('#bcdf').code).toBe('BCDF');
    expect(codeFromHash('#ＢＣＤＦ').code).toBe('BCDF');
    expect(codeFromHash('#B-C-D-F').code).toBe('BCDF');
    expect(codeFromHash('#%42CDF').code).toBe('BCDF');
    expect(codeFromHash('#AEIO')).toEqual({ code: null, raw: 'AEIO' });
    expect(codeFromHash('')).toEqual({ code: null, raw: '' });
    expect(codeChars('a0b1c')).toBe('BC');
  });

  it('存在確認の応答を形で確かめ、理由に分ける', async () => {
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;
    expect(await lookupRoom('BCDF', reply(200, { exists: true, locked: false, players: 1, max: 8 }))).toEqual({ kind: 'open', players: 1, max: 8 });
    expect(await lookupRoom('BCDF', reply(200, { exists: false, locked: false, players: 0, max: 8 }))).toEqual({ kind: 'missing' });
    expect(await lookupRoom('BCDF', reply(200, { exists: true, locked: true, players: 1, max: 8 }))).toEqual({ kind: 'locked' });
    expect(await lookupRoom('BCDF', reply(200, { exists: true, locked: false, players: 8, max: 8 }))).toEqual({ kind: 'full', max: 8 });
    expect(await lookupRoom('BCDF', reply(429, {}, { 'Retry-After': '17' }))).toEqual({ kind: 'rate', retryAfterSec: 17 });
    expect(await lookupRoom('BCDF', reply(503, {}))).toEqual({ kind: 'busy', retryAfterSec: 10 });
    expect(await lookupRoom('BCDF', reply(200, { exists: 'yes' }))).toEqual({ kind: 'network' });
    expect(await lookupRoom('BCDF', (async () => Promise.reject(new TypeError('x'))) as unknown as typeof fetch)).toEqual({ kind: 'network' });
  });

  it('送る名前は掃除して、200バイトに収める', () => {
    expect(fitName('  た‮ろう  ')).toBe('たろう');
    expect(fitName('')).toBe('');
    const heavy = fitName(`e${'́'.repeat(40)}`.repeat(12));
    expect(new TextEncoder().encode(heavy).length).toBeLessThanOrEqual(200);
    expect(heavy.length).toBeGreaterThan(0);
  });

  it('保存が例外を投げても止まらない', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(openStorage(() => broken)).toBeNull();
    expect(readItem(broken, 'k')).toBeNull();
    expect(() => writeItem(broken, 'k', 'v')).not.toThrow();
  });
});

describe('語の切れ目（日本語の折り返し）', () => {
  it('文節の切れ目で切り、つなげると元の文になる。語の途中では切らない', () => {
    expect(chunks('このゲームは、スマホを横にすると遊びやすくなります。')).toEqual(['この', 'ゲームは、', 'スマホを', '横に', 'すると', '遊びやすくなります。']);
    expect(chunks('部屋「BCDF」は見つかりませんでした。')).toEqual(['部屋', '「BCDF」は', '見つかりませんでした。']);
    expect(chunks('空のままなら「プレイヤー3」のように呼ばれます。')).toEqual(['空の', 'ままなら', '「プレイヤー3」のように', '呼ばれます。']);
    // 画面で「ふくら／ませる」「確か／めて」「45／秒」と折れていた語は、1つの塊のまま。
    for (const word of ['ふくらませる', '確かめて', '入ってくる', '待っています', '45秒', 'コピー']) expect(chunks(word)).toEqual([word]);
    const s = 'ニックネームで大丈夫です。本名や連絡先は入れないでください';
    expect(chunks(s).join('')).toBe(s);
  });

  it('塊は折らない span にし、あいだに <wbr> を置く。英語はそのまま', () => {
    const nodes = phrase('部屋を確かめています…');
    const div = document.createElement('div');
    div.append(...nodes);
    expect(div.textContent).toBe('部屋を確かめています…');
    expect(div.querySelectorAll('wbr').length).toBe(1);
    expect(div.querySelectorAll('.pp-nw').length).toBe(2);
    expect(phrase('Checking the room…').map((n) => n.textContent)).toEqual(['Checking the room…']);
    expect(softBreaks('許可してください。センサー')).toBe('許可してください。​センサー');
  });

  it('本文は句読点までの節ごとに包む（閉じかっこは前の節へ）。つなげると元の文になり、句読点のない文は塊だけ', () => {
    const at = (text: string) => {
      const div = document.createElement('div');
      div.append(...clauses(text));
      return { text: div.textContent, parts: [...div.querySelectorAll('.pp-cl')].map((e) => e.textContent) };
    };
    expect(at('もう一度入るときは、大きな画面の人に声をかけてください。')).toEqual({
      text: 'もう一度入るときは、大きな画面の人に声をかけてください。',
      parts: ['もう一度入るときは、', '大きな画面の人に声をかけてください。'],
    });
    expect(at('退出は、右上の「…」からできます。').parts).toEqual(['退出は、', '右上の「…」からできます。']);
    expect(at('部屋「BCDF」が見つかりません。コードを確かめてください。').parts).toEqual(['部屋「BCDF」が見つかりません。', 'コードを確かめてください。']);
    expect(at('（はい。）つぎ').parts).toEqual(['（はい。）', 'つぎ']);
    // 句読点のない文・英語は、節に分けない。
    expect(at('大きな画面にメニューが出ます').parts).toEqual([]);
    expect(at('This is taking a while. Please check your connection.')).toEqual({ text: 'This is taking a while. Please check your connection.', parts: [] });
  });
});
