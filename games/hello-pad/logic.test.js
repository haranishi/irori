// ハローパッドの規則の試験。終わり方は2つ（リーダーの「おわる」・全員退出）で、どちらも end まで通す。
// リーダー以外の「おわる」が効かないこと、リーダーが替わった瞬間から新しいリーダーの「おわる」だけが効くことも確かめる。
// 切断の扱い：online が偽なのは「いま動かせない」だけ。四角を止めて保ち、席が全部消えたときだけ終わる。
import { describe, expect, it } from 'vitest';
import {
  BOUNDS, FLOOR, H, HOP_MS, HOP_SCALE, NAME_H, PAD_LEADER, PAD_PLAYER, SIZE, SPEED, TOP_TEXT, W,
  boxRect, createWorld, handleInput, handlePlayers, hopScale, leaderOf, padsFor, placeNames, step,
} from './logic.js';

const seats = (n, offline = []) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, online: !offline.includes(i + 1) }));
const without = (list, ...gone) => list.filter((s) => !gone.includes(s.id));
const btn = (id, d = 1) => ({ k: 'btn', id, d });
/** 矩形どうしが重なる面積。 */
const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** 札が床の中、上の説明より下にあるか。 */
const insideFloor = (r) => r.x >= FLOOR.left && r.x + r.w <= FLOOR.right && r.y >= TOP_TEXT && r.y + r.h <= FLOOR.bottom;

describe('置き方と動き', () => {
  it('始めた時点の席に、切れている席も含めて四角を置き、横一列に並べる（切れている四角は薄く、戻れば動かせる）', () => {
    const world = createWorld(seats(3, [2]));
    expect([...world.boxes.keys()]).toEqual([1, 2, 3]);
    expect(world.boxes.get(2)?.online).toBe(false);
    expect(world.boxes.get(1)?.x).toBe(W / 4);
    expect(world.boxes.get(3)?.x).toBe((W * 3) / 4);
    expect(handlePlayers(world, seats(3, [2]))).toEqual([]);
    for (const b of createWorld(seats(8)).boxes.values()) {
      expect(b.x).toBeGreaterThanOrEqual(BOUNDS.left);
      expect(b.x).toBeLessThanOrEqual(BOUNDS.right);
    }
  });

  it('スティックの向きに、dt 秒ぶん動く。離す（0,0）と止まる', () => {
    const world = createWorld(seats(1));
    const box = world.boxes.get(1);
    const x0 = box.x;
    handleInput(world, 1, { k: 'axis', id: 'stick', x: 1, y: 0 }, 0);
    step(world, 0.5);
    expect(box.x).toBeCloseTo(x0 + SPEED * 0.5);
    handleInput(world, 1, { k: 'axis', id: 'stick', x: 0, y: 0 }, 600);
    step(world, 0.5);
    expect(box.x).toBeCloseTo(x0 + SPEED * 0.5);
  });

  it('四隅まで倒し続けても、ふくらんだ四角と、その下の名前が床の中に収まる（左上・右上・左下・右下）', () => {
    const half = (SIZE / 2) * HOP_SCALE;
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const world = createWorld(seats(1));
      handleInput(world, 1, { k: 'axis', id: 'stick', x, y }, 0);
      step(world, 60);
      const b = world.boxes.get(1);
      expect([b.x, b.y]).toEqual([x < 0 ? BOUNDS.left : BOUNDS.right, y < 0 ? BOUNDS.top : BOUNDS.bottom]);
      expect(b.x - half).toBeGreaterThanOrEqual(FLOOR.left);
      expect(b.x + half).toBeLessThanOrEqual(FLOOR.right);
      expect(b.y - half).toBeGreaterThanOrEqual(TOP_TEXT);
      const [name] = placeNames([{ p: 1, x: b.x, y: b.y }], () => 140).values();
      expect(insideFloor(name), JSON.stringify(name)).toBe(true);
      expect(overlapArea(name, boxRect(b.x, b.y))).toBe(0);
    }
    // 下の端：名前の下端が、床の下端の内側（境目ちょうどまで）。
    expect(BOUNDS.bottom + SIZE / 2 + 6 + NAME_H).toBeLessThanOrEqual(FLOOR.bottom);
    expect(H - FLOOR.bottom).toBeGreaterThanOrEqual(0);
  });

  it('「ぴょん」で一瞬ふくらみ、HOP_MS で元に戻る。数を覚える', () => {
    const world = createWorld(seats(1));
    const box = world.boxes.get(1);
    expect(hopScale(box, 0)).toBe(1);
    handleInput(world, 1, btn('hop'), 1000);
    handleInput(world, 1, btn('hop', 0), 1010);
    expect(box.hops).toBe(1);
    expect(hopScale(box, 1000 + HOP_MS / 2)).toBeCloseTo(1.35);
    expect(hopScale(box, 1000 + HOP_MS)).toBe(1);
  });

  it('あとから来た席・知らない入力は無視する', () => {
    const world = createWorld(seats(2));
    expect(handleInput(world, 5, btn('end'), 0)).toEqual([]);
    expect(handleInput(world, 1, { k: 'pick', id: 'end' }, 0)).toEqual([]);
    expect(world.over).toBe(false);
  });
});

describe('終わり方', () => {
  it('1：リーダーの「おわる」で end。結果は「ぴょん」の回数', () => {
    const world = createWorld(seats(2), 1);
    handleInput(world, 2, btn('hop'), 0);
    handleInput(world, 2, btn('hop'), 400);
    const fx = handleInput(world, 1, btn('end'), 800);
    expect(fx).toEqual([
      {
        t: 'end',
        why: 'button',
        results: [
          { p: 1, score: 0, label: 'ぴょん0回' },
          { p: 2, score: 2, label: 'ぴょん2回' },
        ],
      },
    ]);
    // 二度目の「おわる」や、そのあとの入力・席の変化では何も起きない。
    expect(handleInput(world, 1, btn('end'), 900)).toEqual([]);
    expect(handlePlayers(world, [], null)).toEqual([]);
  });

  it('2：全員の席が消えたら end。切れているだけなら止めて待ち、戻れば回数を保って続く', () => {
    const world = createWorld(seats(2), 1);
    handleInput(world, 2, btn('hop'), 0);
    handleInput(world, 1, { k: 'axis', id: 'stick', x: 1, y: 0 }, 0);
    expect(handlePlayers(world, seats(2, [1]), 2)).toEqual([]);
    expect(world.boxes.get(1)).toMatchObject({ online: false, ax: 0, ay: 0 });
    expect(handlePlayers(world, seats(2, [1, 2]), null)).toEqual([]); // 全員が切れても、まだ終わらない
    expect(handlePlayers(world, seats(2), 1)).toEqual([]); // 戻った
    expect(world.boxes.get(2)).toMatchObject({ online: true, hops: 1 });
    expect(handlePlayers(world, without(seats(2), 2), 1)).toEqual([]);
    const fx = handlePlayers(world, [], null);
    expect(fx).toEqual([{ t: 'end', why: 'left', results: [] }]);
  });

  it('2の続き：始めた時点で誰もいなければ、最初の handlePlayers で end。全員が切れているだけなら続く', () => {
    expect(handlePlayers(createWorld([], null), [], null)).toEqual([{ t: 'end', why: 'left', results: [] }]);
    const away = createWorld(seats(2, [1, 2]), null);
    expect(handlePlayers(away, seats(2, [1, 2]), null)).toEqual([]);
  });
});

describe('「おわる」はリーダーだけ', () => {
  it('リーダー以外の「おわる」と、リーダーが離す動き（d:0）では終わらない。リーダーが押した瞬間（d:1）に終わる', () => {
    const world = createWorld(seats(3), 2);
    expect(handleInput(world, 1, btn('end'), 0)).toEqual([]);
    expect(handleInput(world, 3, btn('end'), 0)).toEqual([]);
    expect(handleInput(world, 2, btn('end', 0), 0)).toEqual([]);
    expect(world.over).toBe(false);
    expect(handleInput(world, 2, btn('end'), 10)[0]).toMatchObject({ t: 'end', why: 'button' });
  });

  it('リーダーが替わったら、その瞬間から新しいリーダーの「おわる」だけが効く', () => {
    const world = createWorld(seats(3), 1);
    expect(handlePlayers(world, seats(3, [1]), 2)).toEqual([]);
    expect(handleInput(world, 1, btn('end'), 0)).toEqual([]);
    expect(handleInput(world, 3, btn('end'), 0)).toEqual([]);
    expect(handlePlayers(world, seats(3, [1]), 3)).toEqual([]);
    expect(handleInput(world, 2, btn('end'), 0)).toEqual([]);
    expect(world.over).toBe(false);
    expect(handleInput(world, 3, btn('end'), 0)[0]).toMatchObject({ t: 'end', why: 'button' });
  });

  it('リーダーが分からない（null）か、このゲームにいない席なら、誰の「おわる」でも終わる', () => {
    const unknown = createWorld(seats(2), null);
    expect(leaderOf(unknown)).toBe(null);
    expect(handleInput(unknown, 2, btn('end'), 0)[0]).toMatchObject({ t: 'end', why: 'button' });
    // あとから来た席（5）がリーダーになっても、このゲームでは押せる人がいなくならない。
    const outsider = createWorld(seats(2), 1);
    handlePlayers(outsider, [...seats(2), { id: 5, name: 'P5', online: true }], 5);
    expect(leaderOf(outsider)).toBe(null);
    expect(handleInput(outsider, 2, btn('end'), 0)[0]).toMatchObject({ t: 'end', why: 'button' });
  });

  it('スマホの画面：全員に「ぴょん」、続けてリーダーにだけ「おわる」。リーダーがいなければ全員に「おわる」', () => {
    const world = createWorld(seats(3), 2);
    expect(padsFor(world)).toEqual([{ spec: PAD_PLAYER, to: 'all' }, { spec: PAD_LEADER, to: 2 }]);
    handlePlayers(world, seats(3, [2]), 3);
    expect(padsFor(world)).toEqual([{ spec: PAD_PLAYER, to: 'all' }, { spec: PAD_LEADER, to: 3 }]);
    expect(padsFor(createWorld(seats(3), null))).toEqual([{ spec: PAD_LEADER, to: 'all' }]);
    expect(padsFor(createWorld(seats(3), 7))).toEqual([{ spec: PAD_LEADER, to: 'all' }]);
    // リーダーの席が消えたら（コンソールが次のリーダーを決める前でも）、ボタンで終われなくならない。
    const gone = createWorld(seats(2), 1);
    handlePlayers(gone, without(seats(2), 1), 1);
    expect(leaderOf(gone)).toBe(null);
  });
});

describe('名前の札は、ほかの四角に乗らない', () => {
  it('四角の下が第一。真下に別の四角があれば上へ、上下ともふさがれば横へずらす', () => {
    const one = placeNames([{ p: 1, x: 480, y: 300 }], () => 90).get(1);
    expect(one).toEqual({ x: 435, y: 338, w: 90, h: NAME_H });
    const stacked = placeNames([{ p: 1, x: 480, y: 300 }, { p: 2, x: 480, y: 380 }], () => 90);
    expect(stacked.get(1)?.y).toBeLessThan(300 - SIZE / 2);
    const boxed = [{ p: 1, x: 480, y: 300 }, { p: 2, x: 480, y: 380 }, { p: 3, x: 480, y: 220 }];
    const sides = placeNames(boxed, () => 90).get(1);
    expect(sides && (sides.x >= 480 + SIZE / 2 || sides.x + sides.w <= 480 - SIZE / 2)).toBe(true);
    for (const b of boxed.slice(1)) expect(overlapArea(sides, boxRect(b.x, b.y))).toBe(0);
  });

  it('8人：横一列でも、2段に重なっていても、札はほかの四角と、ほかの札に重ならず、床に収まる', () => {
    const world = createWorld(seats(8));
    const row = placeNames([...world.boxes].map(([p, b]) => ({ p, x: b.x, y: b.y })), () => 94);
    const pile = Array.from({ length: 8 }, (_, i) => ({ p: i + 1, x: 300 + (i % 4) * 110, y: i < 4 ? 220 : 360 }));
    for (const [items, spots] of [[[...world.boxes].map(([p, b]) => ({ p, x: b.x, y: b.y })), row], [pile, placeNames(pile, () => 94)]]) {
      for (const it of items) {
        const r = spots.get(it.p);
        expect(insideFloor(r), `札${it.p}`).toBe(true);
        for (const other of items) if (other.p !== it.p) expect(overlapArea(r, boxRect(other.x, other.y)), `札${it.p}と四角${other.p}`).toBe(0);
        for (const [q, o] of spots) if (q !== it.p) expect(overlapArea(r, o), `札${it.p}と札${q}`).toBe(0);
      }
    }
  });

  it('どこに置いても重なるときは、重なりのいちばん小さい場所（8人が1か所に固まっても、床の外には出ない）', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ p: i + 1, x: BOUNDS.right, y: BOUNDS.bottom }));
    for (const r of placeNames(items, () => 140).values()) expect(insideFloor(r)).toBe(true);
  });
});

describe('コンソールに渡す形', () => {
  it('全員の画面は「ぴょん」だけ、リーダーの画面は「ぴょん」と「おわる」。文字は上限内で、id は英小文字', () => {
    const graphemes = (s) => [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)].length;
    expect(PAD_PLAYER.buttons.map((b) => b.id)).toEqual(['hop']);
    expect(PAD_LEADER.buttons.map((b) => b.id)).toEqual(['hop', 'end']);
    expect(PAD_PLAYER.hint).toContain('ぴょんの回数で順位');
    for (const pad of [PAD_PLAYER, PAD_LEADER]) {
      expect(pad).toMatchObject({ k: 'pad', stick: 'stick' });
      for (const b of pad.buttons) {
        expect(graphemes(b.label)).toBeLessThanOrEqual(12);
        expect(b.id).toMatch(/^[a-z0-9_-]{1,24}$/);
      }
      expect(graphemes(pad.hint)).toBeLessThanOrEqual(40);
    }
  });
});
