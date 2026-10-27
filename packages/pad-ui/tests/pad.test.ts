import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_REPEAT_MS, LIMITS, SEND_RATE_HZ } from '@irori/protocol';
import type { InputEvent, PadSpec } from '@irori/protocol';
import { mountPad, PAD_STRINGS_EN } from '../src/index';
import { box, pointer, seeded, setup } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});
afterEach(() => {
  vi.useRealTimers();
});

const btns = (sent: InputEvent[], id: string) => sent.filter((i) => i.k === 'btn' && i.id === id);
const axes = (sent: InputEvent[], id: string) => sent.filter((i) => i.k === 'axis' && i.id === id);

describe('種類ごとの構造', () => {
  it('最初は待ちの画面で、wait は見出しと本文を文字として出す', () => {
    const { q, pad, container } = setup();
    expect(q('.irori-pad').dataset.kind).toBe('wait');
    expect(q('.irori-pad__title').textContent).toBe('待っています');
    pad.setSpec({ k: 'wait', title: 'よーい', body: '<b>まもなく</b>始まります' });
    expect(q('.irori-pad__title').textContent).toBe('よーい');
    expect(q('.irori-pad__text').textContent).toBe('<b>まもなく</b>始まります');
    expect(container.querySelector('b')).toBeNull();
  });

  it('pad は既定で十字、stick でスティック、none で方向なし。ボタンは button 要素で aria-label つき', () => {
    const { q, qa, pad } = setup({ k: 'pad', buttons: [{ id: 'jump', label: 'ジャンプ', color: 'red' }], hint: '動いてジャンプ', orient: 'landscape' });
    expect(q('.irori-pad').dataset.kind).toBe('pad');
    expect(q('.irori-pad').dataset.orient).toBe('landscape');
    expect(q('.irori-pad__dpad')).not.toBeNull();
    expect(qa('.irori-pad__dpad button')).toHaveLength(4);
    expect(q('.irori-pad__hint').textContent).toBe('動いてジャンプ');
    const b = q<HTMLButtonElement>('[data-id="jump"]');
    expect(b.tagName).toBe('BUTTON');
    expect(b.type).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('ジャンプ');
    expect(b.dataset.color).toBe('red');
    pad.setSpec({ k: 'pad', stick: 'stick' });
    expect(q('.irori-pad__stick')).not.toBeNull();
    expect(q('.irori-pad__dpad')).toBeNull();
    pad.setSpec({ k: 'pad', stick: 'none', buttons: [{ id: 'a', label: 'A' }] });
    expect(q('.irori-pad__stick')).toBeNull();
    expect(q('.irori-pad__dpad')).toBeNull();
    expect(q('.irori-pad').dataset.orient).toBe('any');
  });

  it('buzzer は大きなボタン1つ（id は buzzer）、choices は選択肢、touch は面、remote は6つのボタン', () => {
    const { q, qa, pad } = setup({ k: 'buzzer', label: '押せ!', color: 'yellow' });
    expect(qa('button')).toHaveLength(1);
    expect(q('[data-id="buzzer"]').textContent).toBe('押せ!');
    pad.setSpec({ k: 'choices', options: [{ id: 'a', label: '東京' }, { id: 'b', label: '大阪' }, { id: 'c', label: '名古屋' }] });
    expect(qa('.irori-pad__choice').map((b) => b.textContent)).toEqual(['東京', '大阪', '名古屋']);
    pad.setSpec({ k: 'touch', mode: 'swipe' });
    expect(q('.irori-pad__touch').dataset.mode).toBe('swipe');
    pad.setSpec({ k: 'remote' });
    expect(qa('button').map((b) => b.dataset.id).sort()).toEqual(['back', 'down', 'left', 'ok', 'right', 'up']);
    for (const b of qa('button')) expect(b.getAttribute('aria-label')).toBeTruthy();
  });

  it('文字は HTML として解釈しない', () => {
    const { container } = setup({ k: 'buzzer', label: '<img src=x>', hint: '<script>x</script>' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x>');
  });

  it('長押しのメニュー・選択・ダブルタップを止める', () => {
    const { q } = setup({ k: 'buzzer', label: 'x' });
    for (const t of ['contextmenu', 'selectstart', 'dblclick']) {
      const e = new Event(t, { bubbles: true, cancelable: true });
      q('[data-id="buzzer"]').dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
  });
});

describe('ボタン', () => {
  it('押した瞬間に d:1、離す・キャンセル・捕捉の喪失で d:0', () => {
    const { q, sent } = setup({ k: 'pad', stick: 'none', buttons: [{ id: 'a', label: 'A' }] });
    const a = q('[data-id="a"]');
    for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      sent.length = 0;
      pointer(a, 'pointerdown');
      expect(sent).toEqual([{ k: 'btn', id: 'a', d: 1 }]);
      expect(a.hasAttribute('data-pressed')).toBe(true);
      pointer(a, end);
      expect(sent).toEqual([{ k: 'btn', id: 'a', d: 1 }, { k: 'btn', id: 'a', d: 0 }]);
      expect(a.hasAttribute('data-pressed')).toBe(false);
    }
  });

  it('マルチタッチ：別の指で別のボタンを同時に押せる。同じボタンに2本目の指は再発火しない', () => {
    const { q, sent } = setup({ k: 'pad', stick: 'none', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    const a = q('[data-id="a"]');
    const b = q('[data-id="b"]');
    pointer(a, 'pointerdown', { pointerId: 1 });
    pointer(b, 'pointerdown', { pointerId: 2 });
    pointer(a, 'pointerdown', { pointerId: 3 });
    pointer(a, 'pointerup', { pointerId: 1 });
    expect(btns(sent, 'a')).toEqual([{ k: 'btn', id: 'a', d: 1 }]);
    pointer(a, 'pointerup', { pointerId: 3 });
    pointer(b, 'pointerup', { pointerId: 2 });
    pointer(b, 'lostpointercapture', { pointerId: 2 });
    expect(sent).toEqual([
      { k: 'btn', id: 'a', d: 1 },
      { k: 'btn', id: 'b', d: 1 },
      { k: 'btn', id: 'a', d: 0 },
      { k: 'btn', id: 'b', d: 0 },
    ]);
  });

  it('無効のボタンは何も出さない。ポインタを伴わないクリック（キーボード・読み上げ）は押して離すとして扱う', () => {
    const { q, sent, pad } = setup({ k: 'buzzer', label: 'x', disabled: true });
    pointer(q('[data-id="buzzer"]'), 'pointerdown');
    q('[data-id="buzzer"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(sent).toEqual([]);
    pad.setSpec({ k: 'buzzer', label: 'x' });
    const z = q('[data-id="buzzer"]');
    z.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(sent).toEqual([{ k: 'btn', id: 'buzzer', d: 1 }, { k: 'btn', id: 'buzzer', d: 0 }]);
    sent.length = 0;
    pointer(z, 'pointerdown');
    pointer(z, 'pointerup');
    z.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(sent).toEqual([{ k: 'btn', id: 'buzzer', d: 1 }, { k: 'btn', id: 'buzzer', d: 0 }]);
  });
});

describe('選択肢', () => {
  it('押した瞬間に pick。2回目と無効のときは無視。差し替えると、また選べる', () => {
    const spec: PadSpec = { k: 'choices', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    const { q, sent, pad } = setup(spec);
    pointer(q('[data-id="b"]'), 'pointerdown');
    pointer(q('[data-id="a"]'), 'pointerdown');
    pointer(q('[data-id="b"]'), 'pointerdown');
    expect(sent).toEqual([{ k: 'pick', id: 'b' }]);
    expect(q('[data-id="b"]').hasAttribute('data-picked')).toBe(true);
    pad.setSpec({ ...spec, disabled: true });
    pointer(q('[data-id="a"]'), 'pointerdown');
    expect(sent).toHaveLength(1);
    pad.setSpec(spec);
    pointer(q('[data-id="a"]'), 'pointerdown');
    expect(sent).toEqual([{ k: 'pick', id: 'b' }, { k: 'pick', id: 'a' }]);
  });
});

describe('十字とスティック', () => {
  it('十字は8方向の -1・0・1。中心の遊びでは動かない。離すと 0,0', () => {
    const { q, sent } = setup({ k: 'pad' });
    const d = q('.irori-pad__dpad');
    box(d);
    pointer(d, 'pointerdown', { clientX: 100, clientY: 100 });
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(100);
    pointer(d, 'pointermove', { clientX: 100, clientY: 5 });
    vi.advanceTimersByTime(100);
    pointer(d, 'pointermove', { clientX: 190, clientY: 190 });
    vi.advanceTimersByTime(100);
    pointer(d, 'pointermove', { clientX: 10, clientY: 100 });
    vi.advanceTimersByTime(100);
    expect(q('.irori-pad__arrow--left').hasAttribute('data-pressed')).toBe(true);
    pointer(d, 'pointerup', { clientX: 10, clientY: 100 });
    vi.advanceTimersByTime(100);
    expect(axes(sent, 'dpad').map((i) => i.k === 'axis' && [i.x, i.y])).toEqual([[0, -1], [1, 1], [-1, 0], [0, 0]]);
  });

  it('スティックは円の中の位置を -1〜1 に。不感帯0.1、円の外は縁に丸める', () => {
    const { q, sent } = setup({ k: 'pad', stick: 'stick' });
    const s = q('.irori-pad__stick');
    box(s);
    pointer(s, 'pointerdown', { clientX: 105, clientY: 105 });
    vi.advanceTimersByTime(100);
    pointer(s, 'pointermove', { clientX: 150, clientY: 100 });
    vi.advanceTimersByTime(100);
    pointer(s, 'pointermove', { clientX: 400, clientY: 100 });
    vi.advanceTimersByTime(100);
    pointer(s, 'pointermove', { clientX: 100, clientY: -300 });
    vi.advanceTimersByTime(100);
    pointer(s, 'pointercancel');
    vi.advanceTimersByTime(100);
    expect(axes(sent, 'stick').map((i) => i.k === 'axis' && [i.x, i.y])).toEqual([[0.5, 0], [1, 0], [0, -1], [0, 0]]);
  });

  it(`頻度は SEND_RATE_HZ.axis（${SEND_RATE_HZ.axis}回/秒）以下。変わらない値は送らず、最後の値は必ず送る`, () => {
    const { q, sent, at } = setup({ k: 'pad', stick: 'stick' });
    const s = q('.irori-pad__stick');
    box(s);
    pointer(s, 'pointerdown', { clientX: 100, clientY: 100 });
    for (let t = 0; t < 1000; t += 4) {
      pointer(s, 'pointermove', { clientX: 100 + Math.round(90 * Math.sin(t / 60)), clientY: 100 });
      vi.advanceTimersByTime(4);
    }
    pointer(s, 'pointermove', { clientX: 177, clientY: 100 });
    pointer(s, 'pointermove', { clientX: 177, clientY: 100 });
    vi.advanceTimersByTime(200);
    const gaps = at.slice(1).map((t, i) => t - (at[i] as number));
    expect(sent.length).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / SEND_RATE_HZ.axis - 0.001);
    expect(sent.at(-1)).toEqual({ k: 'axis', id: 'stick', x: 0.77, y: 0 });
    for (let i = 1; i < sent.length; i++) expect(sent[i]).not.toEqual(sent[i - 1]);
  });
});

describe('なぞる面', () => {
  it('枠の内側を0〜1にした座標で s・m・e。枠の外へ出た指は終端にする', () => {
    const { q, sent } = setup({ k: 'touch' });
    const t = q('.irori-pad__touch');
    box(t, 400, 200, 10, 20);
    pointer(t, 'pointerdown', { clientX: 110, clientY: 70 });
    vi.advanceTimersByTime(60);
    pointer(t, 'pointermove', { clientX: 210, clientY: 120 });
    vi.advanceTimersByTime(60);
    pointer(t, 'pointermove', { clientX: 500, clientY: 120 });
    pointer(t, 'pointermove', { clientX: 300, clientY: 120 });
    pointer(t, 'pointerup', { clientX: 300, clientY: 120 });
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([
      { k: 'ptr', id: 'touch', x: 0.25, y: 0.25, ph: 's' },
      { k: 'ptr', id: 'touch', x: 0.5, y: 0.5, ph: 'm' },
      { k: 'ptr', id: 'touch', x: 1, y: 0.5, ph: 'e' },
    ]);
  });

  it(`なぞりの途中は SEND_RATE_HZ.ptr（${SEND_RATE_HZ.ptr}回/秒）以下に間引く`, () => {
    const { q, sent, at } = setup({ k: 'touch' });
    const t = q('.irori-pad__touch');
    box(t, 1000, 1000);
    pointer(t, 'pointerdown', { clientX: 0, clientY: 500 });
    for (let x = 1; x <= 1000; x++) {
      pointer(t, 'pointermove', { clientX: x * 0.999, clientY: 500 });
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(100);
    const moves = sent.filter((i) => i.k === 'ptr' && i.ph === 'm');
    const gaps = at.slice(1).map((v, i) => v - (at[i] as number));
    expect(moves.length).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / SEND_RATE_HZ.ptr - 0.001);
    expect(moves.at(-1)).toMatchObject({ x: 0.999 });
  });
});

describe('傾き', () => {
  const orient = (alpha: number | null, beta: number | null, gamma: number | null) =>
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha, beta, gamma }));

  it(`deviceorientation を SEND_RATE_HZ.tilt（${SEND_RATE_HZ.tilt}回/秒）以下で送る。値が欠けた通知は捨てる`, () => {
    const { sent, at, pad, q } = setup({ k: 'tilt', buttons: [{ id: 'fire', label: '撃つ' }] });
    expect(q('[data-id="fire"]')).not.toBeNull();
    orient(null, 10, 10);
    for (let i = 0; i < 100; i++) {
      orient(i, 10 + i / 10, -5);
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(200);
    const tilts = sent.filter((i) => i.k === 'tilt');
    const gaps = at.slice(1).map((t, i) => t - (at[i] as number));
    expect(tilts.length).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000 / SEND_RATE_HZ.tilt - 0.001);
    expect(tilts.at(-1)).toEqual({ k: 'tilt', a: 99, b: 19.9, g: -5 });
    pad.setSpec({ k: 'wait' });
    orient(5, 5, 5);
    vi.advanceTimersByTime(200);
    expect(sent.filter((i) => i.k === 'tilt')).toHaveLength(tilts.length);
  });

  it('requestPermission がある端末では「許可する」を出し、許可されてから購読する', async () => {
    const api = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    let answer = 'denied';
    api.requestPermission = vi.fn(async () => answer);
    try {
      const { q, sent, pad } = setup({ k: 'tilt' });
      const allow = q<HTMLButtonElement>('.irori-pad__allow');
      expect(allow.textContent).toBe('許可する');
      orient(1, 2, 3);
      allow.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(q('.irori-pad__status').textContent).toContain('許可されませんでした');
      answer = 'granted';
      allow.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(q('.irori-pad__allow')).toBeNull();
      orient(1, 2, 3);
      expect(sent).toEqual([{ k: 'tilt', a: 1, b: 2, g: 3 }]);
      pad.setSpec({ k: 'tilt' });
      expect(q('.irori-pad__allow')).toBeNull();
    } finally {
      delete api.requestPermission;
    }
  });
});

describe('差し替えと releaseAll で、押したままの入力を終わらせる', () => {
  it('btn は d:0、axis は 0,0、ptr は e を補い、そのあとの離しでは何も出さない', () => {
    const { q, sent, pad } = setup({ k: 'pad', stick: 'stick', buttons: [{ id: 'a', label: 'A' }] });
    const s = q('.irori-pad__stick');
    box(s);
    pointer(q('[data-id="a"]'), 'pointerdown', { pointerId: 1 });
    pointer(s, 'pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    pad.setSpec({ k: 'touch' });
    expect(sent).toEqual([
      { k: 'btn', id: 'a', d: 1 },
      { k: 'axis', id: 'stick', x: 1, y: 0 },
      { k: 'axis', id: 'stick', x: 0, y: 0 },
      { k: 'btn', id: 'a', d: 0 },
    ]);
    const t = q('.irori-pad__touch');
    box(t);
    pointer(t, 'pointerdown', { pointerId: 3, clientX: 50, clientY: 50 });
    pad.releaseAll();
    pointer(t, 'pointerup', { pointerId: 3, clientX: 60, clientY: 60 });
    pointer(t, 'pointerup', { pointerId: 1 });
    vi.advanceTimersByTime(500);
    expect(sent.slice(4)).toEqual([
      { k: 'ptr', id: 'touch', x: 0.25, y: 0.25, ph: 's' },
      { k: 'ptr', id: 'touch', x: 0.25, y: 0.25, ph: 'e' },
    ]);
  });

  it('destroy も離しを補い、要素を外す', () => {
    const { q, sent, pad, container } = setup({ k: 'buzzer', label: 'x' });
    pointer(q('[data-id="buzzer"]'), 'pointerdown');
    pad.destroy();
    expect(sent).toEqual([{ k: 'btn', id: 'buzzer', d: 1 }, { k: 'btn', id: 'buzzer', d: 0 }]);
    expect(container.children).toHaveLength(0);
    pad.setSpec({ k: 'wait' });
    expect(container.children).toHaveLength(0);
  });

  it('押下から差し替えまでの間隔を0〜500msで振っても、d:1 と d:0 がちょうど1回ずつ', () => {
    const rand = seeded(20261016);
    const delays = [0, 1, 16, 49, 50, 51, 120, 250, 499, 500, ...Array.from({ length: 30 }, () => Math.floor(rand() * 501))];
    for (const delay of delays) {
      const { q, sent, pad } = setup({ k: 'pad', stick: 'stick', buttons: [{ id: 'a', label: 'A' }] });
      const s = q('.irori-pad__stick');
      box(s);
      pointer(q('[data-id="a"]'), 'pointerdown', { pointerId: 1 });
      pointer(s, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 100 });
      for (let t = 0; t < delay; t += 7) {
        pointer(s, 'pointermove', { pointerId: 2, clientX: 100 + ((t * 13) % 100), clientY: 100 });
        vi.advanceTimersByTime(Math.min(7, delay - t));
      }
      pad.setSpec({ k: 'pad', stick: 'stick', buttons: [{ id: 'a', label: 'A' }] });
      pointer(q('[data-id="a"]'), 'pointerup', { pointerId: 1 });
      pointer(q('.irori-pad__stick'), 'pointerup', { pointerId: 2 });
      vi.advanceTimersByTime(600);
      expect(btns(sent, 'a'), `delay ${delay}`).toEqual([{ k: 'btn', id: 'a', d: 1 }, { k: 'btn', id: 'a', d: 0 }]);
      const ax = axes(sent, 'stick');
      if (ax.length > 0) expect(ax.at(-1), `delay ${delay}`).toEqual({ k: 'axis', id: 'stick', x: 0, y: 0 });
      pad.destroy();
    }
  });
});

describe('上限の超過', () => {
  it('ボタンは4つ、選択肢は6つまで描き、形の違う id と重複は描かない。色の名前以外は無視する', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, label: `B${i}` }));
    const { qa, pad } = setup({ k: 'pad', buttons: many });
    expect(qa('.irori-pad__btns .irori-pad__btn')).toHaveLength(LIMITS.BUTTONS_MAX);
    pad.setSpec({ k: 'choices', options: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: `C${i}` })) });
    expect(qa('.irori-pad__choice')).toHaveLength(LIMITS.CHOICES_MAX);
    const odd = [
      { id: 'OK', label: 'x' },
      { id: 'a'.repeat(25), label: 'x' },
      { id: 'good', label: 'x', color: 'url(javascript:1)' },
      { id: 'good', label: 'x' },
    ] as never;
    pad.setSpec({ k: 'pad', buttons: odd });
    const shown = qa('.irori-pad__btns .irori-pad__btn');
    expect(shown.map((b) => b.dataset.id)).toEqual(['good']);
    expect(shown[0]?.hasAttribute('data-color')).toBe(false);
  });

  it('文字は書記素で切る（ボタン12・ヒント40・見出し24・本文120）', () => {
    const family = '👨‍👩‍👧‍👦';
    const { q, pad } = setup({ k: 'buzzer', label: family.repeat(20), hint: 'あ'.repeat(60) });
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(q('[data-id="buzzer"]').textContent ?? '')]).toHaveLength(
      LIMITS.LABEL_MAX_GRAPHEMES,
    );
    expect(q('.irori-pad__hint').textContent).toHaveLength(LIMITS.HINT_MAX_GRAPHEMES);
    pad.setSpec({ k: 'wait', title: 'い'.repeat(30), body: 'う'.repeat(200) });
    expect(q('.irori-pad__title').textContent).toHaveLength(LIMITS.TITLE_MAX_GRAPHEMES);
    expect(q('.irori-pad__text').textContent).toHaveLength(LIMITS.BODY_MAX_GRAPHEMES);
  });

  it('知らない種類は待ちの画面にする', () => {
    const { q, pad } = setup();
    pad.setSpec({ k: 'unknown' } as never);
    expect(q('.irori-pad').dataset.kind).toBe('wait');
  });
});

describe(`押したままの送り直し（HELD_REPEAT_MS＝${HELD_REPEAT_MS}ms）`, () => {
  const R = HELD_REPEAT_MS;
  const right = { k: 'axis', id: 'stick', x: 1, y: 0 } as const;

  function holdStick() {
    const t = setup({ k: 'pad', stick: 'stick', buttons: [{ id: 'a', label: 'A' }] });
    const s = t.q('.irori-pad__stick');
    box(s);
    pointer(s, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 100 });
    return { ...t, s };
  }

  it('(a) 動かさずに3.5間隔ぶん保つと、同じ値の送り直しがちょうど3回', () => {
    const { sent } = holdStick();
    vi.advanceTimersByTime(R * 3.5);
    expect(axes(sent, 'stick')).toEqual([right, right, right, right]);
  });

  it('(b) 値が変わった送信で、次の送り直しまでの時間を数え直す', () => {
    const { sent, s } = holdStick();
    vi.advanceTimersByTime(R * 0.8);
    pointer(s, 'pointermove', { pointerId: 1, clientX: 150, clientY: 100 });
    expect(axes(sent, 'stick')).toHaveLength(2);
    vi.advanceTimersByTime(R - 1);
    expect(axes(sent, 'stick')).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(axes(sent, 'stick').at(-1)).toEqual({ k: 'axis', id: 'stick', x: 0.5, y: 0 });
    expect(axes(sent, 'stick')).toHaveLength(3);
  });

  it('(c) 中立に戻すと止まる。離しても止まる', () => {
    const a = holdStick();
    vi.advanceTimersByTime(R * 1.5);
    pointer(a.s, 'pointermove', { pointerId: 1, clientX: 105, clientY: 105 });
    const n = axes(a.sent, 'stick').length;
    expect(axes(a.sent, 'stick').at(-1)).toEqual({ k: 'axis', id: 'stick', x: 0, y: 0 });
    vi.advanceTimersByTime(R * 5);
    expect(axes(a.sent, 'stick')).toHaveLength(n);
    a.pad.destroy();

    const b = holdStick();
    pointer(b.s, 'pointerup', { pointerId: 1, clientX: 200, clientY: 100 });
    vi.advanceTimersByTime(R * 5);
    expect(axes(b.sent, 'stick')).toEqual([right, { k: 'axis', id: 'stick', x: 0, y: 0 }]);
  });

  it('(d) setSpec・releaseAll・destroy で止まる', () => {
    for (const stop of ['setSpec', 'releaseAll', 'destroy'] as const) {
      const { sent, pad } = holdStick();
      vi.advanceTimersByTime(R * 1.5);
      if (stop === 'setSpec') pad.setSpec({ k: 'wait' });
      else if (stop === 'releaseAll') pad.releaseAll();
      else pad.destroy();
      vi.advanceTimersByTime(R * 5);
      expect(axes(sent, 'stick'), stop).toEqual([right, right, { k: 'axis', id: 'stick', x: 0, y: 0 }]);
      pad.destroy();
    }
  });

  it('(e) btn と tilt は送り直さない（タップを数えるゲームが数え間違えないように）', () => {
    const b = setup({ k: 'buzzer', label: 'x' });
    pointer(b.q('[data-id="buzzer"]'), 'pointerdown');
    vi.advanceTimersByTime(R * 5);
    expect(b.sent).toEqual([{ k: 'btn', id: 'buzzer', d: 1 }]);
    b.pad.destroy();

    const t = setup({ k: 'tilt' });
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 10, beta: 20, gamma: 30 }));
    vi.advanceTimersByTime(R * 5);
    expect(t.sent).toEqual([{ k: 'tilt', a: 10, b: 20, g: 30 }]);
  });

  it('十字も axis なので、倒している間は同じ規則で送り直す', () => {
    const { q, sent } = setup({ k: 'pad' });
    const d = q('.irori-pad__dpad');
    box(d);
    pointer(d, 'pointerdown', { clientX: 100, clientY: 5 });
    vi.advanceTimersByTime(R * 2.5);
    expect(axes(sent, 'dpad')).toEqual(Array(3).fill({ k: 'axis', id: 'dpad', x: 0, y: -1 }));
  });

  it('なぞる面は、触れている間は最後の位置を m として送り直し、離すと止まる', () => {
    const { q, sent } = setup({ k: 'touch' });
    const t = q('.irori-pad__touch');
    box(t);
    pointer(t, 'pointerdown', { clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(R * 2.5);
    expect(sent).toEqual([
      { k: 'ptr', id: 'touch', x: 0.25, y: 0.25, ph: 's' },
      { k: 'ptr', id: 'touch', x: 0.25, y: 0.25, ph: 'm' },
      { k: 'ptr', id: 'touch', x: 0.25, y: 0.25, ph: 'm' },
    ]);
    pointer(t, 'pointermove', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(R * 0.5);
    pointer(t, 'pointerup', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(R * 5);
    expect(sent.slice(3)).toEqual([
      { k: 'ptr', id: 'touch', x: 0.5, y: 0.5, ph: 'm' },
      { k: 'ptr', id: 'touch', x: 0.5, y: 0.5, ph: 'e' },
    ]);
  });
});

describe('tiles：画面内で選び、確定時だけ送る', () => {
  const tiles = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, label: `${i}`, sub: '札' }));
  it('選択・解除・上限拒否は送信せず、決定で1回だけ送って画面をロックする', () => {
    const { q, qa, sent } = setup({ k: 'tiles', tiles, min: 2, max: 2, ok: '出す', pass: 'パス', note: '手札', hint: '2枚' });
    const click = (id: string) => q<HTMLButtonElement>(`[data-id="${id}"]`).click();
    const ok = q<HTMLButtonElement>('[data-action="ok"]');
    expect(qa('.irori-pad__tile')).toHaveLength(20);
    expect(q('.irori-pad__text').textContent).toBe('手札');
    expect(ok.disabled).toBe(true);
    click('t0'); click('t1'); click('t2');
    expect(q('[data-id="t2"]').getAttribute('aria-pressed')).toBe('false');
    expect(q('[role="status"]').textContent).toBe('これ以上選べません');
    expect(q('[data-id="t2"]').hasAttribute('data-limit')).toBe(true);
    expect(ok.disabled).toBe(false);
    expect(ok.getAttribute('aria-disabled')).toBe('false');
    click('t0'); expect(ok.disabled).toBe(true); click('t2');
    expect(sent).toEqual([]);
    ok.click(); ok.click(); click('t3'); q<HTMLButtonElement>('[data-action="pass"]').click();
    expect(sent).toEqual([{ k: 'tiles', ids: ['t1', 't2'] }]);
    expect(q('[role="status"]').textContent).toBe('送りました');
    expect(qa('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
  it('既定の1枚選択は入れ替え。パスは選択中も空で送り、同じ画面の再設定は空に戻す', () => {
    const spec: PadSpec = { k: 'tiles', tiles, ok: '決定', pass: 'パス' };
    const { q, pad, sent } = setup(spec);
    q<HTMLButtonElement>('[data-id="t0"]').click(); q<HTMLButtonElement>('[data-id="t1"]').click();
    expect(q('[data-id="t0"]').getAttribute('aria-pressed')).toBe('false');
    expect(q('[data-id="t1"]').getAttribute('aria-pressed')).toBe('true');
    q<HTMLButtonElement>('[data-action="pass"]').click();
    expect(sent).toEqual([{ k: 'tiles', ids: [], pass: true }]);
    const old = q<HTMLButtonElement>('[data-id="t1"]');
    pad.setSpec(spec); old.click();
    expect(q('[data-id="t1"]').getAttribute('aria-pressed')).toBe('false');
    expect(q<HTMLButtonElement>('[data-action="ok"]').disabled).toBe(true);
    expect(sent).toHaveLength(1);
  });
  it('offは押せず、disabledは文と札だけ。空札と全offの既定は空の決定を送れる', () => {
    for (const list of [[], [{ id: 'x', label: '不可', off: true }]]) {
      const { q, sent } = setup({ k: 'tiles', tiles: list, ok: '確認' });
      q<HTMLButtonElement>('[data-id="x"]')?.click();
      expect(sent).toEqual([]);
      if (list.length) expect(q('[data-id="x"]').getAttribute('aria-disabled')).toBe('true');
      q<HTMLButtonElement>('[data-action="ok"]').click();
      expect(sent).toEqual([{ k: 'tiles', ids: [] }]);
    }
    const { q, qa, sent } = setup({ k: 'tiles', tiles, ok: '確認', pass: 'パス', disabled: true, note: '見るだけ', hint: '待機' });
    expect(q('[data-action]')).toBeNull();
    expect(q('.irori-pad__hint').textContent).toBe('待機');
    for (const b of qa('button')) { expect(b.getAttribute('aria-disabled')).toBe('true'); (b as HTMLButtonElement).click(); }
    expect(sent).toEqual([]);
  });
  it('札の欄はキーボードの停止位置になる：見るだけの画面でも、押せる札がなくても、スクロール領域に届く', () => {
    // 以前の不具合：札がすべて押せない画面は、中にフォーカスできるものがなく、WebKit で axe の scrollable-region-focusable に当たった。
    const view = setup({ k: 'tiles', tiles, ok: '確認', disabled: true, note: '見るだけ' });
    expect(view.q('.irori-pad__tiles-grid')?.getAttribute('tabindex')).toBe('0');
    const live = setup({ k: 'tiles', tiles, ok: '出す' });
    expect(live.q('.irori-pad__tiles-grid')?.getAttribute('tabindex')).toBe('0');
  });
  it('文と補助文字はHTMLとして解釈せず、破棄後の古い決定は送らない', () => {
    const { q, pad, container, sent } = setup({ k: 'tiles', tiles: [{ id: 'a', label: '<b>x</b>', sub: '<img src=x>' }], ok: '出す', min: 0 });
    expect(container.querySelector('b, img')).toBeNull();
    const ok = q<HTMLButtonElement>('[data-action="ok"]');
    pad.destroy(); ok.click(); expect(sent).toEqual([]);
  });
  it('全選択パターンで下限・上限を守る（4枚、16パターン）', () => {
    for (let mask = 0; mask < 16; mask++) {
      const { q, sent, pad } = setup({ k: 'tiles', tiles: tiles.slice(0, 4), min: 1, max: 2, ok: '出す' });
      for (let i = 0; i < 4; i++) if (mask & (1 << i)) q<HTMLButtonElement>(`[data-id="t${i}"]`).click();
      q<HTMLButtonElement>('[data-action="ok"]').click();
      const expected = tiles.slice(0, 4).filter((_, i) => mask & (1 << i)).slice(0, 2).map((t) => t.id);
      expect(sent).toEqual(expected.length ? [{ k: 'tiles', ids: expected }] : []);
      pad.destroy();
    }
  });
});


it('tilesのoffは選べる札があるときも選択せず、英語の通知を出して短時間で枠を戻す', () => {
  const container = document.createElement('div'); document.body.append(container);
  const sent: InputEvent[] = [];
  const pad = mountPad(container, { strings: PAD_STRINGS_EN, send: (i) => sent.push(i) });
  pad.setSpec({ k: 'tiles', tiles: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'off', label: 'Off', off: true }], max: 0, ok: 'Confirm' });
  const off = container.querySelector<HTMLButtonElement>('[data-id="off"]')!;
  expect(off.disabled).toBe(true); off.click();
  expect(off.getAttribute('aria-pressed')).toBe('false');
  const a = container.querySelector<HTMLButtonElement>('[data-id="a"]')!; a.click();
  expect(container.querySelector('[role="status"]')!.textContent).toBe('You cannot select any more');
  expect(a.hasAttribute('data-limit')).toBe(true);
  vi.advanceTimersByTime(301);
  expect(a.hasAttribute('data-limit')).toBe(false);
  container.querySelector<HTMLButtonElement>('[data-action="ok"]')!.click();
  expect(container.querySelector('[role="status"]')!.textContent).toBe('Sent');
  expect(sent).toEqual([{ k: 'tiles', ids: [] }]); pad.destroy();
});


it('tokenは決定とパスのtに戻す。変更で選択を捨て、取り替え前のボタンは送れない', () => {
  const spec = { k: 'tiles' as const, tiles: [{ id: 'a', label: 'A' }], ok: '出す', pass: 'パス', token: 'r1' };
  const { pad, q, sent } = setup(spec);
  q<HTMLButtonElement>('[data-id="a"]').click();
  q<HTMLButtonElement>('[data-action="ok"]').click();
  expect(sent).toEqual([{ k: 'tiles', ids: ['a'], t: 'r1' }]);
  pad.setSpec(spec);
  const oldPass = q<HTMLButtonElement>('[data-action="pass"]');
  q<HTMLButtonElement>('[data-id="a"]').click();
  pad.setSpec({ ...spec, token: 'r2' });
  oldPass.click();
  expect(sent).toHaveLength(1);
  expect(q<HTMLButtonElement>('[data-action="ok"]').disabled).toBe(true);
  q<HTMLButtonElement>('[data-action="pass"]').click();
  expect(sent.at(-1)).toEqual({ k: 'tiles', ids: [], pass: true, t: 'r2' });
  const { token: _, ...legacy } = spec;
  pad.setSpec(legacy);
  q<HTMLButtonElement>('[data-action="pass"]').click();
  expect(sent.at(-1)).toEqual({ k: 'tiles', ids: [], pass: true });
});
