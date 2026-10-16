import { describe, expect, it } from 'vitest';
import { keyAction, padHeld, PadRepeater, pickNext, remoteAction, type Box } from '../../src/host/input';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
const pad = (pressed: number[], axes: number[] = [0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });

describe('3つの入口を同じ操作にそろえる', () => {
  it('キーボード：矢印・Enter・Esc・M。修飾キーつきは拾わない。スペースはボタン自身に任せる', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'm', 'M'].map((k) => keyAction(key(k)))).toEqual(['up', 'down', 'left', 'right', 'ok', 'back', 'mute', 'mute']);
    expect(keyAction(key('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(keyAction(key('m', { metaKey: true }))).toBeNull();
    expect(keyAction(key(' '))).toBeNull();
    expect(keyAction(key('a'))).toBeNull();
  });

  it('リーダーのスマホ：remote の btn を押した瞬間（d:1）だけ。離しと知らない id は無視', () => {
    for (const id of ['up', 'down', 'left', 'right', 'ok', 'back']) expect(remoteAction({ k: 'btn', id, d: 1 })).toBe(id);
    expect(remoteAction({ k: 'btn', id: 'ok', d: 0 })).toBeNull();
    expect(remoteAction({ k: 'btn', id: 'jump', d: 1 })).toBeNull();
    expect(remoteAction({ k: 'axis', id: 'stick', x: 1, y: 0 })).toBeNull();
    expect(remoteAction({ k: 'menu' })).toBeNull();
  });

  it('ゲームパッド：十字（12〜15）・左スティック・A（0）・B（1）とスタート（9）', () => {
    expect([...padHeld(pad([12]))]).toEqual(['up']);
    expect([...padHeld(pad([15, 0]))].sort()).toEqual(['ok', 'right']);
    expect([...padHeld(pad([1]))]).toEqual(['back']);
    expect([...padHeld(pad([9]))]).toEqual(['back']);
    expect([...padHeld(pad([], [-0.9, 0]))]).toEqual(['left']);
    expect([...padHeld(pad([], [0.3, 0.3]))]).toEqual([]);
    expect([...padHeld(pad([], [0, 0.8]))]).toEqual(['down']);
  });

  it('押した瞬間に1回。向きは押し続けると繰り返し、ボタンは繰り返さない', () => {
    const r = new PadRepeater();
    expect(r.step(new Set(['right', 'ok']), 0)).toEqual(['right', 'ok']);
    expect(r.step(new Set(['right', 'ok']), 100)).toEqual([]);
    expect(r.step(new Set(['right', 'ok']), 450)).toEqual(['right']);
    expect(r.step(new Set(['right', 'ok']), 500)).toEqual([]);
    expect(r.step(new Set(['right', 'ok']), 600)).toEqual(['right']);
    expect(r.step(new Set([]), 700)).toEqual([]);
    expect(r.step(new Set(['ok']), 710)).toEqual(['ok']);
  });
});

describe('空間の上で次の場所を選ぶ', () => {
  const box = (left: number, top: number, width = 100, height = 75): Box => ({ left, top, width, height });
  // 棚：横に4枚。その下に参加者が2人。上に道具が2つ。
  const items = [
    { id: 'game:a', box: box(0, 200) },
    { id: 'game:b', box: box(120, 200) },
    { id: 'game:c', box: box(240, 200) },
    { id: 'game:d', box: box(360, 200) },
    { id: 'seat:1', box: box(0, 320, 140, 40) },
    { id: 'seat:2', box: box(160, 320, 140, 40) },
    { id: 'tool:sound', box: box(300, 20, 80, 40) },
    { id: 'tool:share', box: box(400, 20, 80, 40) },
  ];
  const from = (id: string) => items.find((x) => x.id === id)?.box as Box;
  const others = (id: string) => items.filter((x) => x.id !== id);

  it('左右は同じ行の中を動く', () => {
    expect(pickNext(from('game:b'), others('game:b'), 'right')).toBe('game:c');
    expect(pickNext(from('game:b'), others('game:b'), 'left')).toBe('game:a');
    expect(pickNext(from('game:a'), others('game:a'), 'left')).toBeNull();
  });

  it('上下は、横の位置が近いものへ', () => {
    expect(pickNext(from('game:c'), others('game:c'), 'down')).toBe('seat:2');
    expect(pickNext(from('game:a'), others('game:a'), 'down')).toBe('seat:1');
    expect(pickNext(from('game:d'), others('game:d'), 'up')).toBe('tool:share');
    expect(pickNext(from('seat:2'), others('seat:2'), 'up')).toBe('game:b');
  });

  it('縦に並んだ一覧（メニュー）', () => {
    const list = [0, 1, 2].map((i) => ({ id: `m${i}`, box: box(0, i * 60, 400, 50) }));
    expect(pickNext(list[0]!.box, list.slice(1), 'down')).toBe('m1');
    expect(pickNext(list[2]!.box, list.slice(0, 2), 'up')).toBe('m1');
    expect(pickNext(list[1]!.box, [list[0]!, list[2]!], 'right')).toBeNull();
  });
});
