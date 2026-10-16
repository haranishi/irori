// @ts-check
// ハローパッドの規則。画面にも通信にも触れない純粋な関数だけを置き、logic.test.js で試験する。
// 関数は「やること」（効果）の配列を返す。main.js がそれを irori に渡す。
// 切断の扱い（4本でそろえている）：players の online が偽なのは「いま動かせない」だけ。四角を止めて保ち、戻れば続きから。
// 席が players から消えたとき（猶予切れ・退出・外された）だけ、いない人として扱う。
// 遊ぶのは30秒。ぴょんの回数で順位がつき、時間切れかリーダーの「おわる」で終わる。時刻は一時停止で止まる時計で測る。

/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {import('./irori.js').GameResult} GameResult */
/** @typedef {{ t: 'end', why: 'button' | 'time' | 'left', results: GameResult[] }} Effect */
/** @typedef {{ x: number, y: number, ax: number, ay: number, hopAt: number, hops: number, online: boolean, seated: boolean }} Box */
/** @typedef {{ boxes: Map<number, Box>, leader: number | null, endAt: number, over: boolean }} World */

export const W = 960;
export const H = 540;
/** 四角の一辺（px）。 */
export const SIZE = 64;
/** スティックを倒しきったときの速さ（px/秒）。 */
export const SPEED = 280;
/** 「ぴょん」でふくらんでいる時間。 */
export const HOP_MS = 320;
/** 遊ぶ時間。終わりをリーダーの手だけに任せず、毎回の目標（30秒でたくさんぴょん）を作る。 */
export const GAME_MS = 30000;
/** ふくらんだときの倍率の最大。 */
export const HOP_SCALE = 1.35;
/** 床（描く枠）。 */
export const FLOOR = { left: 8, top: 8, right: W - 8, bottom: H - 8 };
/** 上の説明の2行が使う高さ。名前と四角は、ここより下に置く。 */
export const TOP_TEXT = 72;
/** 名前の札の高さと、四角との間。 */
export const NAME_H = 24;
export const NAME_GAP = 6;
/**
 * 四角の中心が動ける範囲。ふくらんだ四角が床と上の説明にかからず、四角の下の名前が床に収まるようにとる。
 * 左右と上は、ふくらんだ大きさの半分を空け、下は、名前の札ぶんを空ける。
 */
const HALF_MAX = Math.ceil((SIZE / 2) * HOP_SCALE);
export const BOUNDS = {
  left: FLOOR.left + 4 + HALF_MAX,
  right: FLOOR.right - 4 - HALF_MAX,
  top: TOP_TEXT + HALF_MAX,
  bottom: FLOOR.bottom - 4 - SIZE / 2 - NAME_GAP - NAME_H,
};

/**
 * 全員の画面：スティックと「ぴょん」。
 * @type {PadSpec}
 */
export const PAD_PLAYER = { k: 'pad', stick: 'stick', hint: '30秒のあいだのぴょんの回数で順位がつく', buttons: [{ id: 'hop', label: 'ぴょん' }] };

/**
 * リーダーの画面：「おわる」も出す。全員に出すと、連打の最中の押し間違いで、全員のゲームが終わってしまうため。
 * @type {PadSpec}
 */
export const PAD_LEADER = {
  k: 'pad',
  stick: 'stick',
  hint: '30秒で終わる。「おわる」でも全員のゲームが終わる',
  buttons: [
    { id: 'hop', label: 'ぴょん' },
    { id: 'end', label: 'おわる', color: 'gray' },
  ],
};

/**
 * 始めた時点の席に、四角を1つずつ置く（横一列。切れている席も置き、戻れば動かせる）。あとから来た席は、このゲームには入れない。
 * 置いたあと、同じ一覧を handlePlayers にも渡す（誰もいなければ、そこで終わる）。
 * @param {readonly PlayerInfo[]} players
 * @param {number | null} [leader] リーダーの席（irori.leader）。「おわる」を押せるのは、この席だけ
 * @param {number} [now] ゲームの時計（ミリ秒）。ここから GAME_MS で時間切れ
 * @returns {World}
 */
export function createWorld(players, leader = null, now = 0) {
  /** @type {Map<number, Box>} */
  const boxes = new Map();
  players.forEach((p, i) => {
    const x = (W * (i + 1)) / (players.length + 1);
    boxes.set(p.id, { x, y: H / 2, ax: 0, ay: 0, hopAt: Number.NEGATIVE_INFINITY, hops: 0, online: p.online, seated: true });
  });
  return { boxes, leader, endAt: now + GAME_MS, over: false };
}

/**
 * 時間で進むこと（時間切れ）。毎フレーム呼ぶ。締切ちょうどで終える。
 * @param {World} world
 * @param {number} now
 * @returns {Effect[]}
 */
export function tick(world, now) {
  if (world.over) return [];
  if (now >= world.endAt) return finish(world, 'time');
  return [];
}

/** 残りの時間（ミリ秒）。 */
export function timeLeft(/** @type {World} */ world, /** @type {number} */ now) {
  return Math.max(0, world.endAt - now);
}

/**
 * 「おわる」を押せる席。リーダーが分からない（null）か、このゲームにいない席（あとから来た席）なら null で、
 * そのときは誰の「おわる」でも終わる（押せる人がいなくなって、ボタンで終われなくなるのを防ぐ）。
 * @param {World} world
 */
export function leaderOf(world) {
  const box = world.leader === null ? undefined : world.boxes.get(world.leader);
  return box?.seated ? world.leader : null;
}

/**
 * スマホに送る画面。全員に PAD_PLAYER、リーダーにだけ席番号を付けて PAD_LEADER（この順で送る）。
 * リーダーがいなければ、全員に PAD_LEADER。
 * @param {World} world
 * @returns {{ spec: PadSpec, to: number | 'all' }[]}
 */
export function padsFor(world) {
  const lead = leaderOf(world);
  return lead === null ? [{ spec: PAD_LEADER, to: 'all' }] : [{ spec: PAD_PLAYER, to: 'all' }, { spec: PAD_LEADER, to: lead }];
}

/**
 * スマホからの入力。スティックは向きを覚え、「ぴょん」は時刻を覚え、リーダーの「おわる」で終える。
 * @param {World} world
 * @param {number} p
 * @param {GameInput} input
 * @param {number} now
 * @returns {Effect[]}
 */
export function handleInput(world, p, input, now) {
  const box = world.boxes.get(p);
  if (world.over || !box) return [];
  if (input.k === 'axis') {
    box.ax = input.x;
    box.ay = input.y;
  } else if (input.k === 'btn' && input.d === 1 && input.id === 'hop') {
    box.hopAt = now;
    box.hops += 1;
  } else if (input.k === 'btn' && input.d === 1 && input.id === 'end') {
    const lead = leaderOf(world);
    if (lead !== null && p !== lead) return [];
    return finish(world, 'button');
  }
  return [];
}

/**
 * 席の一覧が変わった（irori の players の通知）。リーダーを覚え直し、切れた席の四角は止めて薄くする。
 * 全員の席が消えたら終える（切れているだけなら、戻るのを待つ）。
 * @param {World} world
 * @param {readonly PlayerInfo[]} players
 * @param {number | null} [leader] 通知の2つ目の引数（リーダーの席）
 * @returns {Effect[]}
 */
export function handlePlayers(world, players, leader = null) {
  if (world.over) return [];
  world.leader = leader;
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const [p, box] of world.boxes) {
    box.seated = byId.has(p);
    box.online = byId.get(p)?.online === true;
    if (!box.online) box.ax = box.ay = 0;
  }
  if ([...world.boxes.values()].some((b) => b.seated)) return [];
  return finish(world, 'left');
}

/**
 * 前のフレームからの時間 dt（秒）だけ動かす。四角も名前も床の外へ出ないよう、BOUNDS の中に止める。
 * @param {World} world
 * @param {number} dt
 */
export function step(world, dt) {
  for (const box of world.boxes.values()) {
    box.x = Math.min(BOUNDS.right, Math.max(BOUNDS.left, box.x + box.ax * SPEED * dt));
    box.y = Math.min(BOUNDS.bottom, Math.max(BOUNDS.top, box.y + box.ay * SPEED * dt));
  }
}

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect 左上と大きさ */

/** 回数の印の中心（四角の右上の角）と半径。main.js も同じ値で描く。 */
export const BADGE = { dx: SIZE / 2 - 4, dy: -(SIZE / 2 - 4), r: 11 };

/** 四角（右上の回数の印を含む）が占める範囲。 */
export function boxRect(/** @type {number} */ x, /** @type {number} */ y) {
  const left = x - SIZE / 2 - 2;
  const top = y + BADGE.dy - BADGE.r - 2;
  return { x: left, y: top, w: x + BADGE.dx + BADGE.r + 2 - left, h: y + SIZE / 2 + 2 - top };
}

/** 重なりの面積。1px² に満たない重なり（隣り合って触れているだけ・小数の誤差）は数えない。 */
const overlap = (/** @type {Rect} */ a, /** @type {Rect} */ b) => {
  const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return area < 1 ? 0 : area;
};

/**
 * 名前の札を置く場所を決める。四角の下を第一に、上・右・左の順で、ほかの四角と先に置いた札に重ならない場所を探す。
 * どこも重なるときは、重なりのいちばん小さい場所。札は床の中、上の説明より下に収める。
 * @param {{ p: number, x: number, y: number }[]} items 四角の中心（席の順）
 * @param {(p: number) => number} widthOf 札の幅
 * @returns {Map<number, Rect>}
 */
export function placeNames(items, widthOf) {
  const margin = 4;
  const boxes = items.map((it) => ({ p: it.p, r: boxRect(it.x, it.y) }));
  /** @type {Map<number, Rect>} */
  const placed = new Map();
  for (const it of items) {
    const w = widthOf(it.p);
    const own = boxRect(it.x, it.y);
    const candidates = [
      { x: it.x - w / 2, y: it.y + SIZE / 2 + NAME_GAP },
      { x: it.x - w / 2, y: own.y - NAME_GAP / 2 - NAME_H },
      { x: own.x + own.w + NAME_GAP / 2, y: it.y - NAME_H / 2 },
      { x: own.x - NAME_GAP / 2 - w, y: it.y - NAME_H / 2 },
    ].map((c) => ({
      x: Math.min(FLOOR.right - margin - w, Math.max(FLOOR.left + margin, c.x)),
      y: Math.min(FLOOR.bottom - margin - NAME_H, Math.max(TOP_TEXT, c.y)),
      w,
      h: NAME_H,
    }));
    let best = /** @type {Rect} */ (candidates[0]);
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      let cost = 0;
      for (const b of boxes) cost += overlap(c, b.r);
      for (const r of placed.values()) cost += overlap(c, r);
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
      }
      if (cost === 0) break;
    }
    placed.set(it.p, best);
  }
  return placed;
}

/** ふくらみの倍率。押した直後が最大で、HOP_MS で元に戻る。 */
export function hopScale(/** @type {Box} */ box, /** @type {number} */ now) {
  const t = (now - box.hopAt) / HOP_MS;
  return t >= 0 && t < 1 ? 1 + 0.35 * Math.sin(Math.PI * t) : 1;
}

/** @returns {Effect[]} */
function finish(/** @type {World} */ world, /** @type {'button' | 'time' | 'left'} */ why) {
  if (world.over) return [];
  world.over = true;
  // 途中で席が消えた人も、そのときの回数のまま載せる（4本でそろえている）。名前はコンソールが控えて「退出」の印を付ける。
  const everyone = [...world.boxes];
  /** @type {GameResult[]} */
  const results = everyone.map(([p, b]) => ({ p, score: b.hops, label: `ぴょん${b.hops}回` }));
  return [{ t: 'end', why, results }];
}

/**
 * 一時停止のあいだ止まる時計。ゲームの時刻はすべてこれで測る（pause のあいだ、締切も進まない）。
 * @param {() => number} realNow
 */
export function createClock(realNow) {
  /** @type {number | null} */
  let pausedAt = null;
  let lost = 0;
  return {
    now: () => (pausedAt ?? realNow()) - lost,
    get paused() {
      return pausedAt !== null;
    },
    pause() {
      if (pausedAt === null) pausedAt = realNow();
    },
    resume() {
      if (pausedAt === null) return;
      lost += realNow() - pausedAt;
      pausedAt = null;
    },
  };
}
