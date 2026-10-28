import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_REPEAT_MS } from '@irori/protocol';
import type { InputEvent, PlayerInfo } from '@irori/protocol';
import { createMock, mockPlayerCount } from '../src/mock';
import { IroriError } from '../src/errors';

beforeEach(() => {
  Object.defineProperty(window.navigator, 'language', { get: () => 'ja-JP', configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  document.head.replaceChildren();
  document.body.replaceChildren();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

function start(n = 3) {
  const irori = createMock(window, { mockPlayers: n });
  const inputs: [number, InputEvent][] = [];
  irori.on('input', (p, i) => inputs.push([p, i]));
  const key = (type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }));
  const tap = (code: string) => {
    key('keydown', code);
    key('keyup', code);
  };
  const seat = (p: number) => document.querySelector(`.irori-mock__seat[data-p="${p}"]`) as HTMLElement;
  return { irori, inputs, key, tap, seat };
}

describe('仮想プレイヤーの人数', () => {
  it('?mock=N が優先され、1〜8に収める。指定がなければ2人', () => {
    expect(mockPlayerCount('?mock=3')).toBe(3);
    expect(mockPlayerCount('?mock=0')).toBe(1);
    expect(mockPlayerCount('?mock=99')).toBe(8);
    expect(mockPlayerCount('?mock=x', 5)).toBe(5);
    expect(mockPlayerCount('')).toBe(2);
    expect(mockPlayerCount('?other=1', 4)).toBe(4);
  });
});

describe('仮想プレイヤーの画面', () => {
  it('開発モードの表示（閉じられる）と、席ごとのパッド・名前・形を出す', () => {
    const { irori, seat } = start(3);
    expect(irori.mode).toBe('mock');
    expect(irori.players.map((p) => [p.id, p.name, p.online])).toEqual([
      [1, 'プレイヤー1', true],
      [2, 'プレイヤー2', true],
      [3, 'プレイヤー3', true],
    ]);
    expect(irori.leader).toBe(1);
    const banner = document.querySelector('.irori-mock__banner') as HTMLElement;
    expect(banner.textContent).toContain('開発モード（仮想プレイヤー）');
    (banner.querySelector('button') as HTMLButtonElement).click();
    expect(document.querySelector('.irori-mock__banner')).toBeNull();
    expect(seat(1).querySelector('svg[data-shape="circle"]')).not.toBeNull();
    expect(seat(3).querySelector('svg[data-shape="triangle"]')).not.toBeNull();
    expect(seat(2).querySelector('.irori-pad')).not.toBeNull();
    // Vitest は CSS の ?inline を空にするので、ここでは置き場所だけを見る（中身は tests/build.test.ts）。
    expect(document.head.querySelector('style')).not.toBeNull();
  });

  it('setPad は検査を通してから、宛先の席のパッドに出す。検査を通らない指定は投げて、画面は変えない', () => {
    const { irori, seat } = start(2);
    irori.setPad({ k: 'buzzer', label: '押せ' });
    expect(seat(1).querySelector('[data-id="buzzer"]')?.textContent).toBe('押せ');
    expect(seat(2).querySelector('[data-id="buzzer"]')).not.toBeNull();
    irori.setPad({ k: 'wait', title: '2人目だけ' }, 2);
    expect(seat(2).querySelector('.irori-pad__title')?.textContent).toBe('2人目だけ');
    expect(seat(1).querySelector('[data-id="buzzer"]')).not.toBeNull();
    expect(() => irori.setPad({ k: 'remote' } as never)).toThrow(IroriError);
    expect(() => irori.setPad({ k: 'pad', buttons: [1, 2, 3, 4, 5].map((n) => ({ id: `b${n}`, label: 'x' })) })).toThrow(/bad-pad/);
    expect(() => irori.setPad({ k: 'wait' }, 9)).toThrow(/bad-target/);
    expect(seat(1).querySelector('[data-id="buzzer"]')).not.toBeNull();
  });

  it('パネルのパッドを押すと、その席の入力になる', () => {
    const { irori, inputs, seat } = start(2);
    irori.setPad({ k: 'buzzer', label: 'x' });
    const b = seat(2).querySelector('[data-id="buzzer"]') as HTMLElement;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    expect(inputs).toEqual([
      [2, { k: 'btn', id: 'buzzer', d: 1 }],
      [2, { k: 'btn', id: 'buzzer', d: 0 }],
    ]);
  });
});

describe('キーボード', () => {
  it('1人目は WASD・Space・E、2人目は矢印・Enter・Shift', () => {
    const { irori, inputs, key } = start(3);
    irori.setPad({ k: 'pad', buttons: [{ id: 'jump', label: 'ぴょん' }, { id: 'end', label: 'おわる' }] });
    key('keydown', 'KeyD');
    key('keydown', 'KeyW');
    key('keyup', 'KeyD');
    key('keyup', 'KeyW');
    key('keydown', 'ArrowLeft');
    key('keyup', 'ArrowLeft');
    key('keydown', 'Space');
    key('keydown', 'Space', { repeat: true });
    key('keyup', 'Space');
    key('keydown', 'KeyE');
    key('keyup', 'KeyE');
    key('keydown', 'Enter');
    key('keyup', 'Enter');
    key('keydown', 'ShiftRight');
    key('keyup', 'ShiftRight');
    expect(inputs).toEqual([
      [1, { k: 'axis', id: 'dpad', x: 1, y: 0 }],
      [1, { k: 'axis', id: 'dpad', x: 1, y: -1 }],
      [1, { k: 'axis', id: 'dpad', x: 0, y: -1 }],
      [1, { k: 'axis', id: 'dpad', x: 0, y: 0 }],
      [2, { k: 'axis', id: 'dpad', x: -1, y: 0 }],
      [2, { k: 'axis', id: 'dpad', x: 0, y: 0 }],
      [1, { k: 'btn', id: 'jump', d: 1 }],
      [1, { k: 'btn', id: 'jump', d: 0 }],
      [1, { k: 'btn', id: 'end', d: 1 }],
      [1, { k: 'btn', id: 'end', d: 0 }],
      [2, { k: 'btn', id: 'jump', d: 1 }],
      [2, { k: 'btn', id: 'jump', d: 0 }],
      [2, { k: 'btn', id: 'end', d: 1 }],
      [2, { k: 'btn', id: 'end', d: 0 }],
    ]);
  });

  it('スティックの斜めは円に収める。傾きの画面では矢印で傾きを真似る', () => {
    const { irori, inputs, key } = start(1);
    irori.setPad({ k: 'pad', stick: 'stick' });
    key('keydown', 'KeyS');
    key('keydown', 'KeyA');
    expect(inputs.at(-1)).toEqual([1, { k: 'axis', id: 'stick', x: -0.71, y: 0.71 }]);
    irori.setPad({ k: 'tilt' });
    key('keydown', 'KeyW');
    expect(inputs.at(-1)).toEqual([1, { k: 'tilt', a: 0, b: -30, g: 0 }]);
  });

  it('押したまま画面が変わったら、離しを補い、そのあとの離しでは何も出さない', () => {
    const { irori, inputs, key } = start(1);
    irori.setPad({ k: 'pad', buttons: [{ id: 'a', label: 'A' }] });
    key('keydown', 'Space');
    key('keydown', 'KeyD');
    irori.setPad({ k: 'pad', buttons: [{ id: 'b', label: 'B' }] });
    key('keyup', 'Space');
    key('keyup', 'KeyD');
    expect(inputs).toEqual([
      [1, { k: 'btn', id: 'a', d: 1 }],
      [1, { k: 'axis', id: 'dpad', x: 1, y: 0 }],
      [1, { k: 'btn', id: 'a', d: 0 }],
      [1, { k: 'axis', id: 'dpad', x: 0, y: 0 }],
    ]);
  });

  it('選択肢は向きのキーで選んで Space で決める（2回目は無視）。早押しは Space', () => {
    const { irori, inputs, tap, seat } = start(1);
    irori.setPad({ k: 'choices', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] });
    expect(seat(1).querySelector('[data-id="a"]')?.hasAttribute('data-cursor')).toBe(true);
    tap('KeyS');
    tap('KeyS');
    tap('KeyW');
    expect(seat(1).querySelector('[data-id="b"]')?.hasAttribute('data-cursor')).toBe(true);
    tap('Space');
    tap('Space');
    expect(inputs).toEqual([[1, { k: 'pick', id: 'b' }]]);
    irori.setPad({ k: 'buzzer', label: '押せ' });
    tap('Space');
    expect(inputs.slice(1)).toEqual([
      [1, { k: 'btn', id: 'buzzer', d: 1 }],
      [1, { k: 'btn', id: 'buzzer', d: 0 }],
    ]);
  });

  it('入力欄で打った文字は、仮想プレイヤーの操作にしない', () => {
    const { irori, inputs } = start(1);
    irori.setPad({ k: 'pad' });
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    expect(inputs).toEqual([]);
  });
});

describe('席・一時停止・振動・終わり・保存', () => {
  it('両能力とconnected=trueを示し、documentの表示変化をpause/resumeと別に知らせる', () => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    const { irori } = start(1);
    expect(irori.capabilities).toEqual(['result-options-v1', 'host-environment-v1', 'pad-tiles-v1', 'cue-v1']);
    expect(irori.environment).toEqual({ connected: true, visible: false });
    const log: unknown[] = [];
    irori.on('environment', (env) => log.push(env));
    irori.on('pause', () => log.push('pause'));
    irori.on('resume', () => log.push('resume'));
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(log).toEqual([{ connected: true, visible: true }]);
    expect(irori.paused).toBe(false);
    irori.receive({ m: 'environment', environment: { connected: false, visible: true } });
    expect(irori.environment).toEqual({ connected: false, visible: true });
  });

  it('切断のボタンで players が変わり、リーダーは接続中の最小の席へ移る', () => {
    const { irori, seat, inputs, key } = start(2);
    const seen: [readonly PlayerInfo[], number | null][] = [];
    irori.on('players', (list, leader) => seen.push([list, leader]));
    irori.setPad({ k: 'pad' });
    (seat(1).querySelector('.irori-mock__online') as HTMLButtonElement).click();
    expect(seen.at(-1)?.[0].map((p) => p.online)).toEqual([false, true]);
    expect(seen.at(-1)?.[1]).toBe(2);
    key('keydown', 'KeyD');
    expect(inputs).toEqual([]);
    (seat(1).querySelector('.irori-mock__online') as HTMLButtonElement).click();
    expect(irori.players.every((p) => p.online)).toBe(true);
    expect(irori.leader).toBe(1);
  });

  it('一時停止のボタンで pause と resume が届く', () => {
    const { irori } = start(1);
    const log: string[] = [];
    irori.on('pause', () => log.push('pause'));
    irori.on('resume', () => log.push('resume'));
    const btn = document.querySelector('.irori-mock__pause') as HTMLButtonElement;
    btn.click();
    expect(irori.paused).toBe(true);
    btn.click();
    expect(log).toEqual(['pause', 'resume']);
  });

  it('振動は席の枠を揺らし、検査を通らない並びは投げる', () => {
    vi.useFakeTimers();
    const { irori, seat } = start(2);
    irori.vibrate([100, 50], 2);
    expect(seat(2).hasAttribute('data-buzz')).toBe(true);
    expect(seat(1).hasAttribute('data-buzz')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(seat(2).hasAttribute('data-buzz')).toBe(false);
    expect(() => irori.vibrate([])).toThrow(/bad-vibrate/);
    expect(() => irori.vibrate(Array(9).fill(10))).toThrow(/bad-vibrate/);
    expect(() => irori.vibrate(5000)).toThrow(/bad-vibrate/);
  });

  it('end で結果（同点は同じ順位）と「もう一度」を出す。2回目の end は無視', () => {
    const { irori } = start(3);
    irori.end([{ p: 2, score: 5 }, { p: 1, score: 9, label: '1位' }, { p: 3, score: 5 }]);
    const rows = [...document.querySelectorAll('.irori-mock__results li')] as HTMLElement[];
    expect(rows.map((r) => [r.dataset.rank, r.dataset.p])).toEqual([
      ['1', '1'],
      ['2', '2'],
      ['2', '3'],
    ]);
    expect(rows[0]?.textContent).toContain('9（1位）');
    expect(document.querySelector('.irori-mock__again')?.textContent).toBe('もう一度');
    irori.end([{ p: 1, score: 1 }]);
    expect(document.querySelectorAll('.irori-mock__results')).toHaveLength(1);
    expect(() => createMock(window, { mockPlayers: 1 }).end([{ p: 1, score: Number.NaN }])).toThrow(/bad-results/);
  });

  it('recordはlabelだけを主記録にし、退出行を最後に席順・順位なしで示す', () => {
    const { irori } = start(4);
    irori.end([
      { p: 4, score: 999, label: '退出4', ranked: false },
      { p: 3, score: -12, label: 'ズレ1.2秒' },
      { p: 2, score: 888, label: '退出2', ranked: false },
      { p: 1, score: -12, label: 'ズレ1.2秒' },
    ], { display: 'record', note: '<b>通信の遅れを含む目安です</b>' });
    const rows = [...document.querySelectorAll('.irori-mock__results li')] as HTMLElement[];
    expect(rows.map((r) => [r.dataset.p, r.dataset.rank, r.querySelector('.irori-mock__rank')?.textContent])).toEqual([
      ['1', '1', '1'], ['3', '1', '1'], ['2', '', '—'], ['4', '', '—'],
    ]);
    expect(rows.map((r) => r.querySelector('.irori-mock__score')?.textContent)).toEqual(['ズレ1.2秒', 'ズレ1.2秒', '退出2', '退出4']);
    const dialog = document.querySelector('.irori-mock__results') as HTMLElement;
    expect(dialog.textContent).toContain('<b>通信の遅れを含む目安です</b>');
    expect(dialog.querySelector('b')).toBeNull();
    expect(dialog.textContent).not.toMatch(/999|888|-12|点/);
  });

  it('incompleteは全員の順位をなくし、勝敗なしと理由を示す。記録は保存しない', () => {
    const { irori } = start(2);
    irori.end([{ p: 2, score: -5, label: 'ズレ0.5秒' }, { p: 1, score: -2, label: 'ズレ0.2秒' }], {
      display: 'record', outcome: 'incomplete', note: '人数が足りなくなりました',
    });
    const rows = [...document.querySelectorAll('.irori-mock__results li')] as HTMLElement[];
    expect(rows.map((r) => [r.dataset.p, r.dataset.rank, r.querySelector('.irori-mock__rank')?.textContent])).toEqual([
      ['1', '', '—'], ['2', '', '—'],
    ]);
    expect(document.querySelector('.irori-mock__results')?.textContent).toContain('勝敗なし');
    expect(document.querySelector('.irori-mock__results')?.textContent).toContain('人数が足りなくなりました');
    expect(localStorage.length).toBe(0);
  });

  it('保存は localStorage の irori-mock: の名前で分け、上限を守る', async () => {
    const { irori } = start(1);
    await irori.storage.set('best', '42');
    expect(await irori.storage.get('best')).toBe('42');
    expect(await irori.storage.get('none')).toBeNull();
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^irori-mock:.*:best$/);
    await expect(irori.storage.set('big', 'x'.repeat(16_385))).rejects.toMatchObject({ code: 'storage-too-large' });
    await expect(irori.storage.get('')).rejects.toMatchObject({ code: 'storage-key' });
    const full = 'x'.repeat(16_384);
    for (const k of ['a', 'b', 'c']) await irori.storage.set(k, full);
    await expect(irori.storage.set('d', full)).rejects.toMatchObject({ code: 'storage-quota' });
  });
});

describe(`(f) 仮想プレイヤーの方向キーも、押したままなら HELD_REPEAT_MS（${HELD_REPEAT_MS}ms）ごとに送り直す`, () => {
  const R = HELD_REPEAT_MS;

  it('保てば3.5間隔で3回。向きが変われば数え直し、離すと止まる', () => {
    vi.useFakeTimers();
    const { irori, inputs, key } = start(1);
    irori.setPad({ k: 'pad' });
    key('keydown', 'KeyD');
    vi.advanceTimersByTime(R * 3.5);
    expect(inputs).toEqual(Array(4).fill([1, { k: 'axis', id: 'dpad', x: 1, y: 0 }]));

    key('keydown', 'KeyW');
    vi.advanceTimersByTime(R - 1);
    expect(inputs).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(inputs.slice(4)).toEqual([
      [1, { k: 'axis', id: 'dpad', x: 1, y: -1 }],
      [1, { k: 'axis', id: 'dpad', x: 1, y: -1 }],
    ]);

    key('keyup', 'KeyW');
    key('keyup', 'KeyD');
    const n = inputs.length;
    expect(inputs.at(-1)).toEqual([1, { k: 'axis', id: 'dpad', x: 0, y: 0 }]);
    vi.advanceTimersByTime(R * 5);
    expect(inputs).toHaveLength(n);
  });

  it('押したまま画面が変わったら止まる。傾き（矢印で真似る）とボタンは送り直さない', () => {
    vi.useFakeTimers();
    const { irori, inputs, key } = start(1);
    irori.setPad({ k: 'pad', buttons: [{ id: 'a', label: 'A' }] });
    key('keydown', 'KeyD');
    key('keydown', 'Space');
    vi.advanceTimersByTime(R * 1.5);
    irori.setPad({ k: 'tilt' });
    const afterSwap = inputs.length;
    vi.advanceTimersByTime(R * 5);
    expect(inputs).toHaveLength(afterSwap);
    expect(inputs.filter(([, i]) => i.k === 'btn')).toEqual([
      [1, { k: 'btn', id: 'a', d: 1 }],
      [1, { k: 'btn', id: 'a', d: 0 }],
    ]);

    key('keydown', 'KeyW');
    vi.advanceTimersByTime(R * 5);
    expect(inputs.filter(([, i]) => i.k === 'tilt')).toEqual([[1, { k: 'tilt', a: 0, b: -30, g: 0 }]]);
  });
});

describe('仮想プレイヤーのtiles', () => {
  it('別席がtilesに変わっても、押していた移動キーとボタンの離しを失わない', () => {
    vi.useFakeTimers();
    const { irori, inputs, key } = start(2);
    irori.setPad({ k: 'pad', buttons: [{ id: 'a', label: 'A' }] });
    key('keydown', 'ArrowRight'); key('keydown', 'Enter');
    irori.setPad({ k: 'tiles', tiles: [], ok: '確認' }, 1);
    // tilesへの分岐がkeyupまで奪い、2人目の移動が繰り返されていた。
    key('keyup', 'ArrowRight'); key('keyup', 'Enter');
    expect(inputs).toEqual([
      [2, { k: 'axis', id: 'dpad', x: 1, y: 0 }],
      [2, { k: 'btn', id: 'a', d: 1 }],
      [2, { k: 'axis', id: 'dpad', x: 0, y: 0 }],
      [2, { k: 'btn', id: 'a', d: 0 }],
    ]);
    vi.advanceTimersByTime(HELD_REPEAT_MS * 3);
    expect(inputs).toHaveLength(4);
  });
  it('接続切替ボタン上のEnterとSpaceは札の操作にせず、ボタンの標準操作を保つ', () => {
    const { irori, inputs, seat } = start(1);
    irori.setPad({ k: 'tiles', tiles: [], ok: '確認' });
    const toggle = seat(1).querySelector<HTMLButtonElement>('.irori-mock__online')!;
    toggle.focus();
    for (const code of ['Enter', 'Space']) {
      const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
      toggle.dispatchEvent(event);
      // 管理用ボタンのキーが席のtilesへ渡り、空の確認まで送っていた。
      expect(inputs).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    }
    toggle.click();
    expect(irori.players[0]!.online).toBe(false);
  });
  it('矢印・Space・Enterで選び、クリックとの混在でも1回だけ送る。再設定で初期化する', () => {
    const { irori, inputs, tap, seat } = start(2);
    const spec = { k: 'tiles' as const, tiles: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', off: true }], ok: '出す', pass: 'パス', max: 2 };
    irori.setPad(spec);
    tap('Space'); tap('ArrowRight'); tap('Space'); tap('Enter'); tap('Enter'); tap('KeyP');
    expect(inputs).toEqual([[1, { k: 'tiles', ids: ['a', 'b'] }]]);
    irori.setPad(spec, 1);
    const card = seat(1);
    (card.querySelector('[data-id="b"]') as HTMLButtonElement).click();
    tap('KeyP');
    expect(inputs.at(-1)).toEqual([1, { k: 'tiles', ids: [], pass: true }]);
    // フォーカスした席を操作する。矢印の従来の2人目割り当てと二重送信しない。
    (seat(2).querySelector('[data-id="a"]') as HTMLButtonElement).focus();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
    expect(inputs.at(-1)).toEqual([2, { k: 'tiles', ids: ['a'] }]);
  });
  it('offを飛ばし、disabledと空札と切断席を安全に扱う', () => {
    const { irori, inputs, tap, seat } = start(1);
    const spec = { k: 'tiles' as const, tiles: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', off: true }, { id: 'c', label: 'C' }], ok: '出す' };
    irori.setPad(spec); tap('ArrowRight'); tap('Space'); tap('Enter');
    expect(inputs).toEqual([[1, { k: 'tiles', ids: ['c'] }]]);
    irori.setPad({ ...spec, disabled: true }); tap('Space'); tap('Enter'); tap('KeyP');
    expect(inputs).toHaveLength(1);
    irori.setPad({ k: 'tiles', tiles: [], ok: '確認' }); tap('ArrowRight'); tap('Enter');
    expect(inputs.at(-1)).toEqual([1, { k: 'tiles', ids: [] }]);
    irori.setPad(spec);
    (seat(1).querySelector('.irori-mock__online') as HTMLButtonElement).click();
    (seat(1).querySelector('[data-id="a"]') as HTMLButtonElement).click();
    (seat(1).querySelector('[data-action="ok"]') as HTMLButtonElement).click();
    expect(inputs).toHaveLength(2);
  });
});


it('仮想プレイヤーはtokenを決定・パスへ戻し、cueは何も起こさない', () => {
  const { irori, inputs, tap } = start(1);
  const spec = { k: 'tiles' as const, tiles: [{ id: 'a', label: 'A' }], ok: '出す', pass: 'パス', token: 'round_1' };
  irori.setPad(spec); tap('Space'); tap('Enter');
  expect(inputs).toEqual([[1, { k: 'tiles', ids: ['a'], t: 'round_1' }]]);
  irori.setPad({ ...spec, token: 'round_2' }); tap('KeyP');
  expect(inputs.at(-1)).toEqual([1, { k: 'tiles', ids: [], pass: true, t: 'round_2' }]);
  expect(() => irori.cue('strike', 1)).not.toThrow();
  expect(inputs).toHaveLength(2);
});
