// @ts-check
// 球とピンの決定的な物理。固定刻みで進め、60Hzの再生データを返す。純粋関数で、DOM と SDK を読まない。
// 乱数・時計・三角関数を使わない（四則と平方根と丸めだけ）。同じ入力は、どの端末・どのフレームレートでも同じ出力になる。
// 単位はメートルと秒。x は投げる人から見て右が正、z はファウルラインから奥が正。

export const LANE = Object.freeze({
  width: 1.05,
  /** 球の中心がこれを越えるとガター。 */
  gutterX: 0.51,
  headPinZ: 18.29,
  spacing: 0.305,
  /** ピンを置く台の奥の端。越えたものは奥へ落ちる。 */
  pitZ: 19.16,
  /** 画面のための溝の幅。 */
  gutterWidth: 0.235,
});

export const BODY = Object.freeze({
  ballR: 0.109,
  ballM: 6.35,
  pinR: 0.05,
  pinM: 1.5,
  /** 倒れて滑るピンの当たり半径。 */
  fallenR: 0.09,
  restitution: 0.5,
  /** 立っているピンの高さ（画面用）。 */
  pinH: 0.38,
});

/**
 * 調整の数値。試験（physics.test.js の調整の目標）で、この表のままの結果を固定する。
 * 直したら、調整の道具で全組を数え直して、目標（ストライク5〜30%・連続する幅0.12以上・縁へ向かう曲がりで0本）に入れる。
 */
export const TUNING = Object.freeze({
  /** 固定の刻み（秒）。 */
  dt: 1 / 240,
  /** 何刻みごとに再生データを1つ残すか（240 / 4 = 60Hz）。 */
  frameEvery: 4,
  /** 速さの上限。刻みあたりの移動を当たり半径より小さく保ち、すり抜けを防ぐ。 */
  maxSpeed: 10,
  /** 強さ0と1の球速。 */
  minSpeed: 5,
  topSpeed: 9,
  /** 曲がりの横の加速（hook=1、油の切れたところで、m/s²）。 */
  hook: 0.5,
  /** ここまでは油で滑って曲がらない（z）。 */
  oilEnd: 4,
  /** ここから先は最大の曲がり（z）。間はなめらかに強くなる。 */
  hookFull: 12,
  /** 転がる球の減速（m/s²）。 */
  ballDrag: 0.15,
  /** 倒れて滑るピンの減速（m/s²）。 */
  pinDrag: 2,
  /** これ以上の衝撃（N·s）で、立っているピンが倒れ始める。 */
  knock: 0.9,
  /** 倒れきるまでの時間（秒・見た目）。 */
  fallTime: 0.22,
  /** 当たり半径が、倒れたピンの大きさへ広がるまでの時間（秒）。連鎖は数十ミリ秒で起きるので短く。 */
  reachTime: 0.01,
  /** 台の横の壁のはね返り（0で壁なし）。 */
  kickback: 0.5,
  /** 壁がある範囲：ヘッドピンの手前この長さ（m）から奥。 */
  deckBack: 0.6,
  /** 台から落ちたものが見えなくなるまでの時間（秒）。 */
  dropTime: 0.25,
  /** 動きが止まってから再生を続ける時間（秒）。 */
  tail: 0.4,
  /** 再生の上限（秒）。6秒以内。 */
  maxTime: 5.9,
});

const ROW_DZ = (LANE.spacing * Math.sqrt(3)) / 2;
/** ピンの置き場所（1番がヘッド、2〜3、4〜6、7〜10）。 */
export const PIN_SPOTS = Object.freeze(
  [[0, 0], [-0.5, 1], [0.5, 1], [-1, 2], [0, 2], [1, 2], [-1.5, 3], [-0.5, 3], [0.5, 3], [1.5, 3]].map(([c, r]) =>
    Object.freeze({ x: /** @type {number} */ (c) * LANE.spacing, z: LANE.headPinZ + /** @type {number} */ (r) * ROW_DZ })),
);

export const ALL_STANDING = Object.freeze(Array.from({ length: 10 }, () => true));

/** @typedef {{startX: number, hook: number, power: number}} Shot */
/** @typedef {{pin: number, ms: number, x: number, z: number}} FallEvent */
/**
 * 再生データの1コマ：[球x, 球z, ピン0のx, z, 傾き, ピン1の…]。
 * 傾きは 0＝立っている、0〜1＝倒れていく、1〜2＝台から落ちていく（2で見えない）、−1＝はじめから無い。
 * @typedef {number[]} Frame
 */
/**
 * @typedef {{down: boolean[], knocked: number, gutter: boolean, durationMs: number, frames: Frame[],
 *   hitMs: number|null, gutterMs: number|null, falls: FallEvent[], dirs: number[], present: boolean[]}} RollResult
 */

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {number} v */
function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** @param {number} v */
function r4(v) {
  return Math.round(v * 10000) / 10000;
}

/** 強さ（0〜1）から球速（m/s）。 @param {number} power */
export function speedOf(power) {
  return TUNING.minSpeed + (TUNING.topSpeed - TUNING.minSpeed) * clamp(finite(power), 0, 1);
}

/** 置く位置（レーンの半幅を1）から、x（m）。 @param {number} startX */
export function releaseX(startX) {
  return clamp(finite(startX), -0.85, 0.85) * (LANE.width / 2);
}

/** 油の切れ方。z が oilEnd までは0、hookFull から先は1、間はなめらかに上がる。 @param {number} z */
export function hookRamp(z) {
  if (z <= TUNING.oilEnd) return 0;
  if (z >= TUNING.hookFull) return 1;
  const s = (z - TUNING.oilEnd) / (TUNING.hookFull - TUNING.oilEnd);
  return s * s * (3 - 2 * s);
}

/** @typedef {{x: number, z: number, vx: number, vz: number, gutter: boolean, gone: boolean}} Ball */

/** @param {Shot} shot @returns {Ball} */
function makeBall(shot) {
  return { x: releaseX(shot.startX), z: 0, vx: 0, vz: Math.min(speedOf(shot.power), TUNING.maxSpeed), gutter: false, gone: false };
}

/** 球だけを1刻み進める（曲がり・減速・ガター）。ピンとの当たりは別。 @param {Ball} b @param {number} hook */
function moveBall(b, hook) {
  const dt = TUNING.dt;
  if (b.gone) {
    // 奥へ落ちた球は、もう当たらない。再生のために、奥の暗がりへ少しだけ転がし続ける。
    if (b.z < LANE.pitZ + 0.8) b.z += b.vz * dt;
    return;
  }
  if (!b.gutter) b.vx += hook * TUNING.hook * hookRamp(b.z) * dt;
  b.vz = Math.max(0, b.vz - TUNING.ballDrag * dt);
  limit(b);
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  if (!b.gutter && Math.abs(b.x) > LANE.gutterX) {
    // 溝に落ちたら、横には動かず、ピンにも当たらない。
    b.gutter = true;
    b.vx = 0;
  }
  if (b.z > LANE.pitZ + BODY.ballR) b.gone = true;
}

/** 速さを上限で切る。 @param {{vx: number, vz: number}} o */
function limit(o) {
  const s2 = o.vx * o.vx + o.vz * o.vz;
  if (s2 > TUNING.maxSpeed * TUNING.maxSpeed) {
    const k = TUNING.maxSpeed / Math.sqrt(s2);
    o.vx *= k;
    o.vz *= k;
  }
}

/**
 * 狙いの予想線：ピンが無いとしたときの球の通り道。投げたあとの球と同じ式で進めるので、当たるまでは同じ線になる。
 * @param {Shot} shot @param {number} [stepZ] 点の間隔（m） @returns {{points: number[][], gutterAt: number|null}}
 */
export function ballPath(shot, stepZ = 0.5) {
  const b = makeBall(shot);
  const hook = clamp(finite(shot.hook), -1, 1);
  const points = [[b.x, b.z]];
  let next = stepZ;
  /** @type {number|null} */
  let gutterAt = null;
  for (let k = 0; k < Math.round(TUNING.maxTime / TUNING.dt) && b.z < LANE.pitZ && !b.gone; k++) {
    moveBall(b, hook);
    if (b.gutter && gutterAt === null) {
      gutterAt = b.z;
      points.push([b.x, b.z]);
    }
    if (b.z >= next) {
      points.push([b.x, b.z]);
      next += stepZ;
    }
  }
  if (gutterAt === null) points.push([b.x, b.z]);
  return { points, gutterAt };
}

/** @typedef {{x: number, z: number, vx: number, vz: number, state: 0|1|2|3, tilt: number, reach: number, r: number, dx: number, dz: number}} Pin */

/**
 * 1投を最後まで進める。standing は投げる前に立っているピン（1投目は全部）。
 * @param {Shot} shot @param {readonly boolean[]} [standing] @returns {RollResult}
 */
export function simulate(shot, standing = ALL_STANDING) {
  const { dt, frameEvery } = TUNING;
  const hook = clamp(finite(shot.hook), -1, 1);
  const ball = makeBall(shot);
  const present = PIN_SPOTS.map((_, i) => standing[i] === true);
  /** @type {Pin[]} */
  const pins = PIN_SPOTS.map((s, i) => ({ x: s.x, z: s.z, vx: 0, vz: 0, state: present[i] ? 1 : 0, tilt: 0, reach: 0, r: BODY.pinR, dx: 0, dz: 0 }));
  /** @type {FallEvent[]} */
  const falls = [];
  /** @type {number|null} */
  let hitStep = null;
  /** @type {number|null} */
  let gutterStep = null;
  /** @type {Frame[]} */
  const frames = [];
  const invB = 1 / BODY.ballM;
  const invP = 1 / BODY.pinM;
  const e1 = 1 + BODY.restitution;
  const halfW = LANE.width / 2;
  /** 横の壁がある範囲（ピンを置く台）の手前の端。 */
  const deckZ = LANE.headPinZ - TUNING.deckBack;

  /** @param {Pin} p @param {number} i @param {number} nx @param {number} nz @param {number} step */
  const fall = (p, i, nx, nz, step) => {
    p.state = 2;
    // 倒れた刻みから傾きを0より大きくする（最後のコマで倒れても、再生データで倒れて見える）。
    p.tilt = dt / TUNING.fallTime;
    p.dx = nx;
    p.dz = nz;
    falls.push({ pin: i, ms: Math.round(step * dt * 1000), x: r4(p.x), z: r4(p.z) });
  };

  const snapshot = () => {
    /** @type {Frame} */
    const f = [r4(ball.x), r4(ball.z)];
    for (const p of pins) {
      const t = p.state === 0 ? -1 : p.state === 3 ? 1 + p.tilt : p.tilt;
      f.push(r4(p.x), r4(p.z), r4(t));
    }
    return f;
  };

  frames.push(snapshot());
  const maxSteps = Math.round(TUNING.maxTime / dt);
  let quietAt = -1;
  for (let k = 1; k <= maxSteps; k++) {
    const wasGutter = ball.gutter;
    moveBall(ball, hook);
    if (ball.gutter && !wasGutter) gutterStep = k;

    for (const p of pins) {
      if (p.state === 2) {
        const s = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        if (s > 0) {
          const ns = Math.max(0, s - TUNING.pinDrag * dt);
          p.vx *= ns / s;
          p.vz *= ns / s;
        }
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.tilt = Math.min(1, p.tilt + dt / TUNING.fallTime);
        p.reach = Math.min(1, p.reach + dt / TUNING.reachTime);
        p.r = BODY.pinR + (BODY.fallenR - BODY.pinR) * p.reach;
        const wall = LANE.width / 2 + LANE.gutterWidth;
        if (TUNING.kickback > 0 && p.z >= deckZ && Math.abs(p.x) + p.r > wall && p.x * p.vx > 0) {
          // 台の横の壁。外へ飛んだピンは、はね返って台へ戻る（倒れたピンなので、当たれば立っているピンを倒す）。
          p.vx = -p.vx * TUNING.kickback;
          p.x = Math.sign(p.x) * (wall - p.r);
        }
        if (p.z > LANE.pitZ || (Math.abs(p.x) > halfW && p.z < deckZ)) {
          // 台の外へ出た。もう当たらない。見た目のために、しばらく同じ向きに動かして消す。
          p.state = 3;
          p.tilt = 0;
        }
      } else if (p.state === 3) {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.tilt = Math.min(1, p.tilt + dt / TUNING.dropTime);
      }
    }

    // 球とピン。溝に落ちた球と、台から落ちた球は当たらない。
    if (!ball.gutter && !ball.gone) {
      pins.forEach((p, i) => {
        if (p.state !== 1 && p.state !== 2) return;
        const dx = p.x - ball.x;
        const dz = p.z - ball.z;
        const rr = BODY.ballR + p.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) return;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const vrel = (ball.vx - p.vx) * nx + (ball.vz - p.vz) * nz;
        if (hitStep === null) hitStep = k;
        if (vrel > 0) {
          const j = (e1 * vrel) / (invB + invP);
          if (p.state === 1 && j < TUNING.knock) {
            // 弱い当たり。ピンは立ったまま動かず、球だけがそれる。
            ball.vx -= e1 * vrel * nx;
            ball.vz -= e1 * vrel * nz;
          } else {
            if (p.state === 1) fall(p, i, nx, nz, k);
            ball.vx -= j * invB * nx;
            ball.vz -= j * invB * nz;
            p.vx += j * invP * nx;
            p.vz += j * invP * nz;
            limit(p);
          }
          limit(ball);
        }
        const overlap = rr - d;
        if (p.state === 1) {
          ball.x -= nx * overlap;
          ball.z -= nz * overlap;
        } else {
          const wb = invB / (invB + invP);
          ball.x -= nx * overlap * wb;
          ball.z -= nz * overlap * wb;
          p.x += nx * overlap * (1 - wb);
          p.z += nz * overlap * (1 - wb);
        }
      });
    }

    // ピンどうし。立っているピンどうしは動かない。倒れたピンが当てたら、立っていたピンも倒れる。
    for (let i = 0; i < pins.length; i++) {
      const a = /** @type {Pin} */ (pins[i]);
      if (a.state !== 1 && a.state !== 2) continue;
      for (let j = i + 1; j < pins.length; j++) {
        const b = /** @type {Pin} */ (pins[j]);
        if (b.state !== 1 && b.state !== 2) continue;
        if (a.state === 1 && b.state === 1) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const rr = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vrel > 0) {
          const jn = (e1 * vrel) / (invP + invP);
          if (a.state === 1) fall(a, i, -nx, -nz, k);
          if (b.state === 1) fall(b, j, nx, nz, k);
          a.vx -= jn * invP * nx;
          a.vz -= jn * invP * nz;
          b.vx += jn * invP * nx;
          b.vz += jn * invP * nz;
          limit(a);
          limit(b);
        }
        const half = (rr - d) / 2;
        a.x -= nx * half;
        a.z -= nz * half;
        b.x += nx * half;
        b.z += nz * half;
      }
    }

    const record = k % frameEvery === 0;
    if (record) frames.push(snapshot());
    const ballDone = ball.gone || ball.vx * ball.vx + ball.vz * ball.vz < 0.0025;
    const allDown = pins.every((p) => p.state !== 1);
    const moving = pins.some((p) => p.state === 2 && p.vx * p.vx + p.vz * p.vz > 0.0009);
    if (ballDone && (allDown || !moving)) {
      if (quietAt < 0) quietAt = k;
      if (record && (k - quietAt) * dt >= TUNING.tail) break;
    } else {
      quietAt = -1;
    }
  }

  const down = pins.map((p) => p.state !== 1);
  const knocked = pins.filter((p, i) => present[i] && p.state !== 1).length;
  const hitMs = hitStep === null ? null : Math.round(hitStep * dt * 1000);
  const gutterMs = gutterStep === null ? null : Math.round(gutterStep * dt * 1000);
  return {
    down,
    knocked,
    gutter: gutterMs !== null && (hitMs === null || hitMs > gutterMs),
    durationMs: Math.round(((frames.length - 1) * 1000) / 60),
    frames,
    hitMs,
    gutterMs,
    falls,
    dirs: pins.flatMap((p) => [r4(p.dx), r4(p.dz)]),
    present,
  };
}
