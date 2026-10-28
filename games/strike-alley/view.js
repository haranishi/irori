// @ts-check
// 大画面の描画。publicView の値だけを受け取り、文字と得点表は DOM、レーン・ピン・球・演出は Canvas に描く。
// 結果は投げた時点で決まっている。ここは見せ方だけで、再生は物理が返した60Hzの再生データを時間で補う。
// 揺れ・火花・ピンの回転は、決まった式と種から作る（毎フレームの乱数は使わない）。
import { BODY, LANE, PIN_SPOTS, ballPath, releaseX, speedOf } from './physics.js';

/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {import('./irori.js').Look} Look */
/** @typedef {NonNullable<Model['roll']>} RollView */
/**
 * 画面の時計。now は一時停止で止まる時計（ミリ秒）、replayMs は再生の位置（打った瞬間の静止を除く）、
 * sinceHit は球が最初にピンに当たってからの実時間（まだなら null）。
 * @typedef {{now: number, replayMs: number, sinceHit: number|null}} Clock
 */

const COLOR = {
  bg: '#1a1411', text: '#f5ebe0', dim: '#c9b8a6', glow: '#ffd9a0', ember: '#ff8a3d', line: '#4a382c',
};
/** ピンの形：根元からの高さの割合 u と、そこでの半径 w（m）。 */
const PIN_PROFILE = [[0, 0.026], [0.08, 0.045], [0.2, 0.058], [0.32, 0.06], [0.45, 0.05], [0.58, 0.031], [0.66, 0.023],
  [0.74, 0.026], [0.84, 0.032], [0.93, 0.028], [1, 0.012]].map(([u, w]) => ({ u: /** @type {number} */ (u), w: /** @type {number} */ (w) }));
/** @param {number} u */
function pinRadius(u) {
  for (let k = 1; k < PIN_PROFILE.length; k++) {
    const a = /** @type {{u: number, w: number}} */ (PIN_PROFILE[k - 1]);
    const b = /** @type {{u: number, w: number}} */ (PIN_PROFILE[k]);
    if (u <= b.u) return a.w + ((b.w - a.w) * (u - a.u)) / (b.u - a.u);
  }
  return 0;
}
/** 字幕を出し続ける時間の目安は main.js（HOLD）。ここは見た目の強さ。 */
const IMPACT = { strike: 1, spare: 0.5, pins: 0.18, miss: 0, gutter: 0 };
const BLOCKERS = /** @type {Record<string, string>} */ ({
  menu: 'メニューを閉じると、続きから再開します',
  'host-offline': '大画面の接続を待っています',
  hidden: '大画面に戻ると、続きから再開します',
});

/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {Look|undefined} look @param {number} [size] */
function mark(look, size = 22) {
  const node = el('span', 'seat-mark');
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  if (!look) return node;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', look.label);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', look.path);
  path.setAttribute('fill', look.color);
  path.setAttribute('stroke', 'rgba(0,0,0,0.55)');
  path.setAttribute('stroke-width', '1.2');
  svg.append(path);
  node.append(svg);
  return node;
}

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** @param {number} t */
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
/** @param {number} t 行き過ぎてから戻る */
const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

/** 種つきの乱数（火花の向き。同じ投球なら同じ散り方）。 @param {number} seed */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 遠近の写し方 ----
// 画面のために、手前のレーンだけをなめらかに縮める（ピンの台は実寸のまま）。結果には関係しない。
const SQUEEZE = 0.4;
const SQUEEZE_END = 17;
/** @param {number} z */
function viewZ(z) {
  if (z <= 0) return z * SQUEEZE;
  const s = Math.min(z / SQUEEZE_END, 1);
  const base = SQUEEZE * Math.min(z, SQUEEZE_END) + (1 - SQUEEZE) * SQUEEZE_END * (s ** 3 - s ** 4 / 2);
  return z > SQUEEZE_END ? base + (z - SQUEEZE_END) : base;
}
const HEAD_VZ = viewZ(LANE.headPinZ);
/** @typedef {{x: number, y: number, z: number, pitch: number, f: number, cx: number, cy: number}} Cam */
const CAM_START = { x: 0, y: 1.4, z: -2.9, pitch: 0.085 };
const CAM_PINS = { x: 0, y: 1.0, z: HEAD_VZ - 3.4, pitch: 0.135 };

/** @param {Cam} cam @param {number} x @param {number} y @param {number} z 実寸の z */
function project(cam, x, y, z) {
  const X = x - cam.x;
  const Y = y - cam.y;
  const Z = viewZ(z) - cam.z;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const yc = Y * cp + Z * sp;
  const zc = -Y * sp + Z * cp;
  if (zc < 0.08) return null;
  return { x: cam.cx + (cam.f * X) / zc, y: cam.cy - (cam.f * yc) / zc, s: cam.f / zc, d: zc };
}

/**
 * 再生データの、ある時刻の値（コマの間は直線で補う）。
 * @param {number[][]} frames @param {number} ms
 */
function sampler(frames, ms) {
  const f = clamp((ms / 1000) * 60, 0, frames.length - 1);
  const i = Math.floor(f);
  const a = /** @type {number[]} */ (frames[i]);
  const b = /** @type {number[]} */ (frames[Math.min(i + 1, frames.length - 1)]);
  const w = f - i;
  /** @param {number} k */
  return (k) => {
    const va = /** @type {number} */ (a[k]);
    const vb = /** @type {number} */ (b[k]);
    // はじめから無いピン（−1）は補わない。
    return va === -1 || vb === -1 ? va : va + (vb - va) * w;
  };
}

/**
 * @typedef {{key: number, spins: number[][]}} RollCache
 * ピンの回転（滑った道のりに比例）をコマごとに先に数えておく。動きを減らす設定では使わない。
 * @param {RollView} roll @returns {RollCache}
 */
function cacheRoll(roll) {
  const frames = roll.result.frames;
  const spins = PIN_SPOTS.map((_, p) => {
    const out = [0];
    let len = 0;
    for (let k = 1; k < frames.length; k++) {
      const a = /** @type {number[]} */ (frames[k - 1]);
      const b = /** @type {number[]} */ (frames[k]);
      const t = /** @type {number} */ (b[2 + p * 3 + 2]);
      if (t > 0 && t <= 1) len += Math.hypot(/** @type {number} */ (b[2 + p * 3]) - /** @type {number} */ (a[2 + p * 3]), /** @type {number} */ (b[3 + p * 3]) - /** @type {number} */ (a[3 + p * 3]));
      out.push(len * (p % 2 ? 7 : -7));
    }
    return out;
  });
  return { key: roll.id, spins };
}

/** @param {HTMLCanvasElement} canvas */
function createLane(canvas) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  let W = 0;
  let H = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** @param {number} u 0＝投げる位置から、1＝ピンの近く（見た目の奥行きで直線） @param {number} pull 衝突で引く量 @param {number} sx @param {number} sy */
  function camera(u, pull, sx, sy) {
    const e = clamp(u, 0, 1);
    const f = Math.min(W * 1.62, H * 1.8);
    return {
      x: CAM_START.x + (CAM_PINS.x - CAM_START.x) * e,
      y: CAM_START.y + (CAM_PINS.y - CAM_START.y) * e + pull * 0.18,
      z: CAM_START.z + (CAM_PINS.z - CAM_START.z) * e - pull,
      pitch: CAM_START.pitch + (CAM_PINS.pitch - CAM_START.pitch) * e,
      f, cx: W / 2 + sx, cy: H * (0.2 + 0.1 * e) + sy,
    };
  }

  /**
   * 床の上の四角（x0〜x1, z0〜z1）を塗る。手前がカメラの後ろなら切る。
   * @param {Cam} cam @param {number} x0 @param {number} x1 @param {number} z0 @param {number} z1 @param {string|CanvasGradient} fill
   */
  function floor(cam, x0, x1, z0, z1, fill) {
    const near = Math.max(z0, nearZ(cam));
    if (near >= z1) return;
    const a = project(cam, x0, 0, near);
    const b = project(cam, x1, 0, near);
    const c = project(cam, x1, 0, z1);
    const d = project(cam, x0, 0, z1);
    if (!a || !b || !c || !d) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** カメラのすぐ前の、写せる一番手前の z（実寸）。 @param {Cam} cam */
  function nearZ(cam) {
    let lo = -6;
    /** @type {number} */
    let hi = LANE.pitZ;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (project(cam, 0, 0, mid)) hi = mid;
      else lo = mid;
    }
    return hi + 0.05;
  }

  /** @param {Cam} cam @param {number} glow 灯りの強さ（0〜1.6） */
  function backdrop(cam, glow) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#120c09');
    sky.addColorStop(0.5, '#1d1410');
    sky.addColorStop(1, COLOR.bg);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // 奥の壁（板張り）と、ピンの奥の暗がり。
    const wallZ = LANE.pitZ + 0.75;
    const tl = project(cam, -4, 2.6, wallZ);
    const br = project(cam, 4, 0, wallZ);
    if (tl && br) {
      const g = ctx.createLinearGradient(0, tl.y, 0, br.y);
      g.addColorStop(0, '#24170f');
      g.addColorStop(1, '#3a2617');
      ctx.fillStyle = g;
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.strokeStyle = 'rgba(20, 12, 8, 0.55)';
      ctx.lineWidth = Math.max(1, br.s * 0.012);
      for (let y = 0.3; y < 2.6; y += 0.32) {
        const l = project(cam, -4, y, wallZ);
        const r = project(cam, 4, y, wallZ);
        if (!l || !r) continue;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
      }
      // のれんのような幕（ピンの上）。
      const top = project(cam, -0.95, 1.02, LANE.pitZ + 0.45);
      const bottom = project(cam, 0.95, 0.5, LANE.pitZ + 0.45);
      if (top && bottom) {
        const w = (bottom.x - top.x) / 5;
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = k % 2 ? '#5b2a1a' : '#6a3220';
          ctx.fillRect(top.x + k * w + w * 0.04, top.y, w * 0.92, bottom.y - top.y);
        }
        ctx.fillStyle = 'rgba(255, 217, 160, 0.18)';
        ctx.fillRect(top.x, top.y, bottom.x - top.x, Math.max(2, (bottom.y - top.y) * 0.08));
      }
    }
    // 提灯。打ったあと（ストライク）は脈打つ。
    for (const lx of [-0.62, 0, 0.62]) {
      const p = project(cam, lx, 1.0, LANE.pitZ + 0.35);
      if (!p) continue;
      const r = 0.14 * p.s;
      const halo = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * (3.2 + glow * 1.6));
      halo.addColorStop(0, `rgba(255, 170, 90, ${0.32 * glow})`);
      halo.addColorStop(1, 'rgba(255, 140, 60, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (3.2 + glow * 1.6), 0, Math.PI * 2);
      ctx.fill();
      const body = ctx.createRadialGradient(p.x - r * 0.25, p.y - r * 0.3, r * 0.1, p.x, p.y, r);
      body.addColorStop(0, '#fff1d6');
      body.addColorStop(0.55, `rgba(255, ${Math.round(150 + 40 * Math.min(1, glow))}, 80, 1)`);
      body.addColorStop(1, '#a8431c');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 0.86, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2214';
      ctx.fillRect(p.x - r * 0.45, p.y - r * 1.1, r * 0.9, r * 0.22);
      ctx.fillRect(p.x - r * 0.45, p.y + r * 0.9, r * 0.9, r * 0.2);
      ctx.strokeStyle = 'rgba(90, 40, 20, 0.5)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      for (const k of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + k * r * 0.62, r * 0.85 * Math.sqrt(1 - k * k * 0.5), r * 0.1, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** @param {Cam} cam @param {number} glow 灯りの強さ（ストライクで脈打つ） */
  function lanes(cam, glow) {
    const half = LANE.width / 2;
    const gw = LANE.gutterWidth;
    const far = LANE.pitZ;
    // 隣のレーン（暗く、ピンは無い）。
    for (const off of [-1.72, 1.72]) {
      floor(cam, off - half - gw - 0.1, off + half + gw + 0.1, -6, far, '#1f1610');
      floor(cam, off - half, off + half, -6, far, 'rgba(120, 82, 46, 0.32)');
    }
    // 溝と縁。
    floor(cam, -half - gw - 0.09, half + gw + 0.09, -6, far + 0.6, '#140e0b');
    for (const s of [-1, 1]) {
      const n0 = project(cam, s * half, 0, 4);
      const n1 = project(cam, s * (half + gw), 0, 4);
      if (n0 && n1) {
        const g = ctx.createLinearGradient(n0.x, 0, n1.x, 0);
        g.addColorStop(0, '#2d211a');
        g.addColorStop(0.5, '#120d0a');
        g.addColorStop(1, '#2a1e17');
        floor(cam, s > 0 ? half : -half - gw, s > 0 ? half + gw : -half, -6, far, g);
      }
    }
    // 助走（暗い板）とレーン本体（手前から奥へ明るく）。
    floor(cam, -half, half, -6, 0, '#4a3220');
    const near = project(cam, 0, 0, Math.max(0, nearZ(cam)));
    const deep = project(cam, 0, 0, LANE.headPinZ);
    const wood = ctx.createLinearGradient(0, near ? near.y : H, 0, deep ? deep.y : 0);
    wood.addColorStop(0, '#8a5a30');
    wood.addColorStop(0.55, '#a9733d');
    wood.addColorStop(1, '#d39a55');
    floor(cam, -half, half, 0, far, wood);
    // 板の継ぎ目。
    ctx.strokeStyle = 'rgba(70, 40, 18, 0.32)';
    for (let k = 1; k < 10; k++) {
      const x = -half + (k * LANE.width) / 10;
      const a = project(cam, x, 0, Math.max(0, nearZ(cam)));
      const b = project(cam, x, 0, far);
      if (!a || !b) continue;
      ctx.lineWidth = Math.max(0.6, a.s * 0.004);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // ファウルライン。
    floor(cam, -half, half, -0.02, 0.02, '#2a1a10');
    // 目印の矢（7つ）。
    ctx.fillStyle = 'rgba(52, 28, 14, 0.85)';
    for (let k = -3; k <= 3; k++) {
      const x = k * 0.135;
      const z = 4.5 + (3 - Math.abs(k)) * 0.12;
      const tip = project(cam, x, 0, z + 0.22);
      const l = project(cam, x - 0.022, 0, z);
      const r = project(cam, x + 0.022, 0, z);
      if (!tip || !l || !r) continue;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
    }
    // ピンの台（明るい）と、奥の落とし穴。
    floor(cam, -half, half, LANE.headPinZ - 0.42, far, 'rgba(255, 226, 170, 0.16)');
    floor(cam, -half - gw - 0.09, half + gw + 0.09, far, far + 0.75, '#0b0806');
    ctx.fillStyle = 'rgba(40, 22, 10, 0.55)';
    for (const s of PIN_SPOTS) {
      const p = project(cam, s.x, 0, s.z);
      if (!p) continue;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 0.03 * p.s, 0.012 * p.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // ピンの上の灯り。
    const spot = project(cam, 0, 0, LANE.headPinZ + 0.4);
    if (spot) {
      const g = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, spot.s * 0.9);
      g.addColorStop(0, `rgba(255, 214, 150, ${clamp(0.12 + 0.13 * glow, 0, 0.5)})`);
      g.addColorStop(1, 'rgba(255, 214, 150, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(spot.x - spot.s, spot.y - spot.s, spot.s * 2, spot.s * 2);
    }
  }

  /**
   * ピン1本。傾き t（0〜1）で、倒れる向き（dx, dz）へ寝かせる。spin は寝たあとの回転。
   * @param {Cam} cam @param {{x: number, z: number, tilt: number, dx: number, dz: number, spin: number, drop: number, alpha: number}} pin
   */
  function drawPin(cam, pin) {
    const theta = clamp(pin.tilt, 0, 1) * (Math.PI / 2);
    let dx = pin.dx;
    let dz = pin.dz;
    if (pin.spin) {
      const c = Math.cos(pin.spin);
      const s = Math.sin(pin.spin);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
    }
    const h = BODY.pinH;
    const lift = Math.sin(theta) * 0.06;
    const base = { x: pin.x - dx * lift, y: -pin.drop, z: pin.z - dz * lift };
    const top = { x: base.x + Math.sin(theta) * dx * h, y: base.y + Math.cos(theta) * h, z: base.z + Math.sin(theta) * dz * h };
    const b = project(cam, base.x, base.y, base.z);
    const t = project(cam, top.x, top.y, top.z);
    if (!b || !t) return;
    const ax = t.x - b.x;
    const ay = t.y - b.y;
    const len = Math.hypot(ax, ay) || 1;
    const nx = -ay / len;
    const ny = ax / len;
    const scale = (b.s + t.s) / 2;
    ctx.save();
    ctx.globalAlpha = pin.alpha;
    // 影。
    if (pin.drop <= 0) {
      ctx.fillStyle = 'rgba(30, 16, 8, 0.32)';
      ctx.beginPath();
      ctx.ellipse(b.x + (t.x - b.x) * 0.35 * Math.sin(theta), b.y + 1, 0.08 * b.s * (1 + Math.sin(theta)), 0.03 * b.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    /** 軸に沿った位置 u の、片側（side）の縁。 @param {number} u @param {number} side */
    const at = (u, side) => {
      const w = pinRadius(u) * scale * side;
      return { x: b.x + ax * u + nx * w, y: b.y + ay * u + ny * w };
    };
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      const q = at(k / 20, 1);
      if (k === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    for (let k = 20; k >= 0; k--) {
      const q = at(k / 20, -1);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    const shade = ctx.createLinearGradient(b.x + nx * 0.06 * scale, b.y + ny * 0.06 * scale, b.x - nx * 0.06 * scale, b.y - ny * 0.06 * scale);
    shade.addColorStop(0, '#d8cbb8');
    shade.addColorStop(0.45, '#fffaf0');
    shade.addColorStop(1, '#bfae97');
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 36, 20, 0.45)';
    ctx.lineWidth = Math.max(0.6, scale * 0.004);
    ctx.stroke();
    // 首の2本の帯。
    for (const [u0, u1] of /** @type {[number, number][]} */ ([[0.6, 0.635], [0.665, 0.7]])) {
      const q0 = at(u0, 1);
      const q1 = at(u1, 1);
      const q2 = at(u1, -1);
      const q3 = at(u0, -1);
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.lineTo(q3.x, q3.y);
      ctx.closePath();
      ctx.fillStyle = '#c4462a';
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 球。席の色と形を描き、転がった道のりで模様を回す。
   * @param {Cam} cam @param {{x: number, y: number, z: number, alpha: number, look: {color: string, path: Path2D}|null, roll: number}} ball
   */
  function drawBall(cam, ball) {
    const r = BODY.ballR;
    const c = project(cam, ball.x, ball.y + r, ball.z);
    const g = project(cam, ball.x, Math.min(0, ball.y), ball.z);
    if (!c || !g) return;
    const R = r * c.s;
    ctx.save();
    ctx.globalAlpha = ball.alpha;
    ctx.fillStyle = 'rgba(20, 10, 6, 0.42)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, R * 1.05, R * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    const color = ball.look?.color ?? '#7a5ab8';
    const body = ctx.createRadialGradient(c.x - R * 0.35, c.y - R * 0.4, R * 0.1, c.x, c.y, R);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.18, color);
    body.addColorStop(1, '#140b07');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.clip();
    // 指の穴と席の印。前を向いている間だけ見える。
    const phase = ball.roll;
    const front = Math.cos(phase);
    if (front > 0.05) {
      const oy = c.y - Math.sin(phase) * R * 0.7;
      ctx.fillStyle = 'rgba(15, 8, 5, 0.85)';
      for (const [hx, hy] of [[-0.22, -0.18], [0.22, -0.18], [0, 0.22]]) {
        ctx.beginPath();
        ctx.ellipse(c.x + /** @type {number} */ (hx) * R, oy + /** @type {number} */ (hy) * R * front, R * 0.09, R * 0.09 * front, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ball.look) {
        const k = (R * 0.46) / 24;
        ctx.save();
        ctx.translate(c.x - 12 * k, oy + R * 0.52 * front - 12 * k * front);
        ctx.scale(k, k * front);
        ctx.fillStyle = 'rgba(255, 245, 230, 0.9)';
        ctx.fill(ball.look.path);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 217, 160, 0.35)';
    ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  return { ctx, resize, camera, backdrop, lanes, drawPin, drawBall, size: () => ({ W, H }) };
}

/** @param {{stage: HTMLElement, status: HTMLElement}} root */
export function createView(root) {
  const { stage, status } = root;
  const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  stage.className = 'game';
  const top = el('header', 'topbar');
  const brand = el('h1', 'brand', 'ストライク横丁');
  const turnLine = el('p', 'turn-line');
  const frameLine = el('p', 'frame-line');
  top.append(brand, turnLine, frameLine);
  const arena = el('section', 'arena');
  const laneBox = el('div', 'lane-box');
  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', 'lane'));
  canvas.setAttribute('aria-hidden', 'true');
  const readout = el('div', 'readout');
  readout.setAttribute('aria-hidden', 'true');
  const caption = el('div', 'caption');
  caption.setAttribute('aria-hidden', 'true');
  const captionMain = el('strong', 'caption-main');
  const captionSub = el('span', 'caption-sub');
  caption.append(captionMain, captionSub);
  const notice = el('div', 'notice');
  notice.hidden = true;
  readout.hidden = true;
  const hero = el('div', 'hero');
  laneBox.append(canvas, readout, caption, notice, hero);
  const board = el('section', 'board');
  board.setAttribute('aria-label', '得点表');
  arena.append(laneBox, board);
  const footer = el('footer', 'footer');
  const guide = el('p', 'guide');
  footer.append(guide);
  stage.replaceChildren(top, arena, footer);

  const lane = createLane(canvas);
  /** @type {Model|null} */
  let model = null;
  /** @type {Map<number, Look>} */
  let looks = new Map();
  /** @type {Map<number, {color: string, path: Path2D}>} */
  const balls = new Map();
  let boardKey = '';
  let heroKey = '';
  let topKey = '';
  let guideKey = '';
  let noticeKey = '';
  let captionKey = '';
  let said = '';
  /** @type {Map<string, string>} */
  let shownMarks = new Map();
  let boardDrawn = false;
  /** @type {RollCache|null} */
  let cache = null;
  let phaseKey = '';
  let phaseAt = 0;
  /** 直前の段階（狙いに戻るとき、ピンの近くからカメラを戻すかどうか）。 */
  let fromRoll = false;
  /** 見た目の予想（位置・強さ・曲がり）を、届いた値へなめらかに寄せる。 */
  const shown = { startX: 0, power: 0, hook: 0, ok: false, at: 0, active: false };
  /** @type {{key: string, path: ReturnType<typeof ballPath>}|null} */
  let aimPath = null;
  /** 投げる前の球の位置（最後に狙った位置を覚えておく）。 */
  let restX = 0;
  let lastFrameAt = 0;
  let slow = 0;
  let skip = false;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => lane.resize()) : null;
  ro?.observe(canvas);
  lane.resize();

  /** @param {Model} next @param {ReadonlyMap<number, Look>} nextLooks */
  function update(next, nextLooks) {
    model = next;
    looks = new Map(nextLooks);
    for (const [id, look] of looks) if (!balls.has(id)) balls.set(id, { color: look.color, path: new Path2D(look.path) });
    document.documentElement.dataset.phase = next.phase;
    stage.dataset.phase = next.phase;
    renderTop(next);
    renderBoard(next);
    renderHero(next);
    renderGuide(next);
    renderNotice(next);
    renderCaption(next);
    announce(next);
  }

  /** @param {Model} m */
  function renderTop(m) {
    const key = JSON.stringify([m.phase, m.turn, m.throwerName, m.frames]);
    if (key === topKey) return;
    topKey = key;
    if (!m.started || !m.turn) {
      turnLine.replaceChildren();
      frameLine.textContent = m.phase === 'ended' ? 'おしまい' : '1〜6人 · 交代で投げる';
      return;
    }
    const look = looks.get(m.turn.p);
    const who = el('span', 'who');
    who.append(mark(look, 24), el('span', 'name', m.throwerName), el('span', 'turn-tag', 'の番'));
    turnLine.replaceChildren(who);
    frameLine.textContent = `第${m.turn.frame + 1}フレーム · ${m.turn.ball + 1}投目 / 全${m.frames}フレーム`;
  }

  /** @param {Model} m */
  function renderBoard(m) {
    const key = JSON.stringify([m.frames, m.started, m.turn, m.phase === 'settled' || m.phase === 'aim' ? 1 : 0, m.participants]);
    if (key === boardKey) return;
    boardKey = key;
    board.dataset.frames = String(m.frames);
    board.dataset.count = String(m.participants.length);
    const sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'table');
    sheet.setAttribute('aria-label', `得点表（${m.frames}フレーム）`);
    sheet.style.setProperty('--frames', String(m.frames));
    const head = el('div', 'row head');
    head.setAttribute('role', 'row');
    const hName = el('span', 'who-cell', '名前');
    hName.setAttribute('role', 'columnheader');
    head.append(hName);
    for (let f = 0; f < m.frames; f++) {
      const c = el('span', `fh${m.turn && m.turn.frame === f && m.started ? ' is-now' : ''}`, String(f + 1));
      c.setAttribute('role', 'columnheader');
      head.append(c);
    }
    const hTotal = el('span', 'total-cell', '合計');
    hTotal.setAttribute('role', 'columnheader');
    head.append(hTotal);
    sheet.append(head);
    /** @type {Map<string, string>} */
    const marks = new Map();
    for (const seat of m.participants) {
      const isTurn = m.started && m.turn?.p === seat.id && m.phase !== 'ended';
      const row = el('div', `row${isTurn ? ' is-turn' : ''}${seat.left ? ' is-left' : ''}`);
      row.setAttribute('role', 'row');
      row.dataset.seat = String(seat.id);
      const who = el('span', 'who-cell');
      who.setAttribute('role', 'rowheader');
      const tag = seat.left ? '退出' : !seat.online ? '接続待ち' : isTurn ? '▶ 投げる番' : '';
      const names = el('span', 'names');
      names.append(el('span', 'name', seat.name));
      if (tag) names.append(el('span', `tag${isTurn ? ' tag-turn' : ''}`, tag));
      who.append(mark(looks.get(seat.id), 20), names);
      row.append(who);
      seat.card.forEach((cell, f) => {
        const last = f === m.frames - 1;
        const c = el('span', `cell${last ? ' last' : ''}${isTurn && m.turn?.frame === f ? ' is-now' : ''}`);
        c.setAttribute('role', 'cell');
        const ballsBox = el('span', 'balls');
        cell.marks.forEach((v, k) => {
          const id = `${seat.id}:${f}:${k}`;
          marks.set(id, v);
          const isNew = boardDrawn && v !== '' && shownMarks.get(id) !== v;
          const b = el('b', `ball-mark${v === 'X' ? ' strike' : v === '/' ? ' spare' : ''}${isNew ? ' pop' : ''}`, v);
          ballsBox.append(b);
        });
        const cum = el('span', 'cum', cell.cumulative === null ? '' : String(cell.cumulative));
        c.append(el('i', 'fn', String(f + 1)), ballsBox, cum);
        const label = `${f + 1}フレーム ${cell.marks.filter(Boolean).join(' ') || 'まだ'}${cell.cumulative === null ? '' : `、累計${cell.cumulative}`}`;
        c.setAttribute('aria-label', label);
        row.append(c);
      });
      const total = el('span', 'total-cell');
      total.setAttribute('role', 'cell');
      total.append(el('strong', 'total', String(seat.total)), el('span', 'unit', '点'));
      row.append(total);
      sheet.append(row);
    }
    shownMarks = marks;
    boardDrawn = true;
    board.replaceChildren(sheet);
  }

  /** @param {Model} m */
  function renderHero(m) {
    const key = JSON.stringify([m.phase, m.canStart, m.leaderName, m.tooMany, m.outcome, m.participants.map((p) => [p.id, p.name, p.total])]);
    if (key === heroKey) return;
    heroKey = key;
    hero.hidden = m.phase !== 'intro' && m.phase !== 'ended';
    if (m.phase === 'intro') {
      const steps = el('ol', 'steps');
      for (const [i, text] of ['スマホに指をおく（横の位置が、ボールの位置）', '下に引く（長いほど強い）。引きながら左右にずらすと曲がる', 'はなして投げる。10本ぜんぶ倒せばストライク'].entries()) {
        const li = el('li', 'step');
        li.append(el('span', 'step-n', String(i + 1)), el('span', 'step-t', text));
        steps.append(li);
      }
      const who = el('div', 'hero-players');
      who.setAttribute('aria-label', '参加者');
      for (const seat of m.participants) {
        const w = el('span', 'who');
        w.append(mark(looks.get(seat.id), 20), el('span', 'name', seat.name));
        who.append(w);
      }
      hero.replaceChildren(el('p', 'eyebrow', '路地裏の、ちいさなレーン'), el('h2', 'title', 'ストライク横丁'), el('p', 'length-guide', '遊ぶ長さは、ふつう10フレーム・みじかめ5フレーム。進行役のスマホで選びます。'), steps, who);
    } else if (m.phase === 'ended') {
      const ranked = [...m.participants].sort((a, b) => b.total - a.total);
      const list = el('ol', 'final');
      for (const seat of ranked) {
        const li = el('li', 'final-row');
        const w = el('span', 'who');
        w.append(mark(looks.get(seat.id), 20), el('span', 'name', seat.name));
        li.append(w, el('strong', 'final-score', `${seat.total}点`));
        if (seat.left) li.append(el('span', 'tag', '退出'));
        list.append(li);
      }
      hero.replaceChildren(el('h2', 'title', m.outcome === 'incomplete' ? '今回は、順位なし' : 'おつかれさま'), list);
    } else {
      hero.replaceChildren();
    }
  }

  /** @param {Model} m */
  function guideText(m) {
    if (m.blockers.length) return m.blockers.map((b) => BLOCKERS[b] ?? '').filter(Boolean).join('。');
    if (m.phase === 'intro') {
      if (m.tooMany) return '6人までで遊べます。人数を減らしてね';
      return m.canStart ? `${m.leaderName}さんのスマホで、遊ぶ長さを選んでね` : 'みんながそろうのを待っています';
    }
    if (m.phase === 'ended') return '結果は、大画面のつづきで';
    if (m.waiting) return `${m.throwerName}さんのスマホのつなぎ直しを待っています。点はそのまま`;
    if (m.phase === 'aim') return m.retry ? `${m.throwerName}さん、もう少し長く下に引いて、はなしてね` : `${m.throwerName}さん、スマホに指をおいて、下に引いて、はなす`;
    if (m.phase === 'rolling') return 'いけっ……！';
    const c = captionOf(m);
    if (m.phase === 'settled' && c) return `${m.throwerName}さん、${c.main}`;
    return '';
  }

  /** @param {Model} m */
  function renderGuide(m) {
    const text = guideText(m);
    if (text === guideKey) return;
    guideKey = text;
    guide.textContent = text;
  }

  /** @param {Model} m */
  function renderNotice(m) {
    const text = m.blockers.length ? 'ひと休み中' : m.waiting ? 'つなぎ直しを待っています' : '';
    if (text === noticeKey) return;
    noticeKey = text;
    notice.hidden = !text;
    notice.textContent = text;
  }

  /** @param {Model} m */
  function captionOf(m) {
    const roll = m.roll;
    if (m.phase !== 'settled' || !roll) return null;
    const seat = m.participants.find((p) => p.id === roll.p);
    const rolls = seat?.card ?? [];
    if (roll.kind === 'strike') {
      // 同じ人の連続ストライクを数える（ダブル・ターキー）。
      let streak = 0;
      outer: for (let f = rolls.length - 1; f >= 0; f--) {
        const marks = /** @type {{marks: string[]}} */ (rolls[f]).marks;
        for (let k = marks.length - 1; k >= 0; k--) {
          const v = marks[k];
          if (v === '') continue;
          if (v === 'X') streak += 1;
          else break outer;
        }
      }
      const sub = streak >= 3 ? `${streak}連続！ターキー` : streak === 2 ? 'ダブル！' : '10本ぜんぶ';
      return { kind: 'strike', main: 'ストライク！', sub };
    }
    if (roll.kind === 'spare') return { kind: 'spare', main: 'スペア！', sub: '残りをぜんぶ' };
    if (roll.kind === 'gutter') return { kind: 'gutter', main: 'ガター', sub: '溝に落ちました' };
    return { kind: roll.kind, main: `${roll.knocked}本`, sub: `残り${roll.pinsBefore - roll.knocked}本` };
  }

  /** @param {Model} m */
  function renderCaption(m) {
    const c = captionOf(m);
    const key = c && m.roll ? `${m.roll.id}:${c.main}` : '';
    if (key === captionKey) return;
    captionKey = key;
    caption.classList.remove('show', 'strike', 'spare', 'gutter', 'pins', 'miss');
    if (!c) return;
    captionMain.textContent = c.main;
    captionSub.textContent = c.sub;
    // 字幕のはね（行き過ぎてから戻る）を、毎回はじめから。
    void caption.offsetWidth;
    caption.classList.add('show', c.kind);
  }

  /** @param {Model} m */
  function announce(m) {
    let text = '';
    const c = captionOf(m);
    if (m.blockers.length) text = 'ひと休み中です';
    else if (c && m.roll) {
      const seat = m.participants.find((p) => p.id === m.roll?.p);
      text = `${seat?.name ?? ''}さん、${c.main}${c.kind === 'strike' || c.kind === 'spare' ? '' : '。'}合計${seat?.total ?? 0}点`;
    } else if (m.phase === 'aim' && m.turn) text = `${m.throwerName}さんの番。第${m.turn.frame + 1}フレーム、${m.turn.ball + 1}投目`;
    else if (m.phase === 'intro') text = guideText(m);
    else if (m.phase === 'ended') text = m.outcome === 'incomplete' ? '今回は順位なしで終わりました' : '全員投げ終わりました';
    if (text && text !== said) {
      said = text;
      status.textContent = text;
    }
  }

  /** @param {Model} m @param {number} now */
  function aimState(m, now) {
    const a = m.aim;
    const dt = Math.min(0.1, Math.max(0, (now - shown.at) / 1000));
    shown.at = now;
    if (a) {
      // 50ms ほどで、届いた値に追いつく。置いた最初の点には、すぐ合わせる。
      const k = reduce?.matches || !shown.active ? 1 : 1 - Math.exp(-dt / 0.05);
      shown.active = true;
      shown.startX += (a.startX - shown.startX) * k;
      shown.power += (a.power - shown.power) * k;
      shown.hook += (a.hook - shown.hook) * k;
      shown.ok = a.ok;
      restX = releaseX(a.startX);
    } else {
      shown.active = false;
    }
    return a;
  }

  /** @param {Model} m */
  function readoutText(m) {
    const a = m.aim;
    if (m.phase !== 'aim' || !a) return '';
    /** @param {number} v */
    const side = (v) => (Math.abs(v) < 0.05 ? 'まんなか' : `${v < 0 ? '左' : '右'} ${Math.abs(v).toFixed(1)}`);
    const hook = Math.abs(a.hook) < 0.01 ? 'まっすぐ' : `${a.hook < 0 ? '左' : '右'}へ ${Math.abs(a.hook).toFixed(1)}`;
    const power = a.ok ? `${Math.round(a.power * 100)}%（時速${Math.round(speedOf(a.power) * 3.6)}km）` : 'もっと引く';
    return `位置　${side(a.startX)}\n強さ　${power}\n曲がり　${hook}`;
  }

  /** 1コマ描く。 @param {Clock} clock */
  function draw(clock) {
    const m = model;
    if (!m) return;
    // 描くのが遅い端末では、1コマおきに描く（結果は投げた時点で決まっているので、描く速さは結果に響かない）。
    const real = performance.now();
    slow = real - lastFrameAt > 26 ? Math.min(slow + 1, 60) : Math.max(slow - 1, 0);
    lastFrameAt = real;
    skip = slow > 30 && !skip;
    if (skip) return;
    const key = `${m.phase}:${m.roll?.id ?? 0}:${m.turn?.p ?? 0}:${m.turn?.ball ?? 0}`;
    if (key !== phaseKey) {
      fromRoll = phaseKey.startsWith('settled');
      phaseKey = key;
      phaseAt = clock.now;
      if (m.phase === 'aim') restX = 0;
    }
    const since = clock.now - phaseAt;
    const still = !!reduce?.matches;
    const roll = m.roll;
    if (roll && cache?.key !== roll.id) cache = cacheRoll(roll);
    const text = readoutText(m);
    if (readout.textContent !== text) readout.textContent = text;
    readout.hidden = !text;

    // カメラ：投げる前は手前、転がると寄り、当たると少し引く。動きを減らす設定では寄らずに切り替える。
    let u = 0;
    let pull = 0;
    /** @type {((k: number) => number)|null} */
    let at = null;
    if (roll && (m.phase === 'rolling' || m.phase === 'settled')) {
      at = sampler(roll.result.frames, m.phase === 'settled' ? roll.result.durationMs : clock.replayMs);
      const bz = at(1);
      // カメラは球のあとを、少しずつ離されながら追う（見た目の奥行きで、ヘッドピンに着く頃にピンの近く）。
      u = still ? (bz > 12 ? 1 : 0) : clamp(viewZ(bz) / HEAD_VZ, 0, 1);
      if (clock.sinceHit !== null && !still) pull = 0.55 * easeOutBack(clamp(clock.sinceHit / 320, 0, 1)) * (0.4 + 0.6 * IMPACT[roll.kind]);
      if (m.phase === 'settled') {
        u = 1;
        pull = still ? 0 : 0.55 * (0.4 + 0.6 * IMPACT[roll.kind]);
      }
    } else if (m.phase === 'aim' && !still && fromRoll) {
      // 前の投球のピンの近くから、投げる位置へ戻ってくる。
      u = 1 - easeInOut(clamp(since / 700, 0, 1));
    }
    let sx = 0;
    let sy = 0;
    if (roll && clock.sinceHit !== null && !still) {
      const amp = IMPACT[roll.kind] * Math.min(lane.size().W, lane.size().H) * 0.014;
      const tt = clock.sinceHit / 1000;
      const decay = Math.exp(-tt / 0.16);
      sx = amp * decay * Math.sin(tt * 2 * Math.PI * 21);
      sy = amp * 0.7 * decay * Math.cos(tt * 2 * Math.PI * 16);
    }
    const cam = lane.camera(u, pull, sx, sy);
    let glow = 0.75 + 0.08 * Math.sin(clock.now / 420) + 0.05 * Math.sin(clock.now / 170 + 1);
    if (still) glow = 0.8;
    if (roll?.kind === 'strike' && clock.sinceHit !== null && !still) {
      const tt = clock.sinceHit;
      glow += 0.8 * Math.exp(-tt / 700) * (0.5 + 0.5 * Math.cos((tt / 260) * Math.PI * 2));
    }
    if (roll?.kind === 'strike' && m.phase === 'settled') glow = Math.max(glow, 1.1);
    const { ctx } = lane;
    const { W, H } = lane.size();
    ctx.clearRect(0, 0, W, H);
    lane.backdrop(cam, glow);
    lane.lanes(cam, glow);

    /** @type {{d: number, draw: () => void}[]} */
    const items = [];
    const look = (m.turn ? balls.get(m.turn.p) : undefined) ?? null;

    if (roll && at) {
      const sample = at;
      // ピン。
      PIN_SPOTS.forEach((_, i) => {
        const t = sample(2 + i * 3 + 2);
        if (t < 0 || t >= 2) return;
        const x = sample(2 + i * 3);
        const z = sample(3 + i * 3);
        const dx = /** @type {number} */ (roll.result.dirs[i * 2]);
        const dz = /** @type {number} */ (roll.result.dirs[i * 2 + 1]);
        const fi = clamp(Math.round(((m.phase === 'settled' ? roll.result.durationMs : clock.replayMs) / 1000) * 60), 0, roll.result.frames.length - 1);
        const spin = still || !cache ? 0 : /** @type {number} */ (cache.spins[i]?.[fi] ?? 0);
        const drop = t > 1 ? (t - 1) * 0.5 : 0;
        const tilt = still ? (t > 0 ? 1 : 0) : Math.min(1, t);
        const p = project(cam, x, 0, z);
        if (!p) return;
        items.push({ d: p.d, draw: () => lane.drawPin(cam, { x, z, tilt, dx, dz, spin, drop, alpha: t > 1 ? clamp(2 - t, 0, 1) : 1 }) });
      });
      // 球と軌跡。
      const ms = m.phase === 'settled' ? roll.result.durationMs : clock.replayMs;
      let bx = sample(0);
      const bz = sample(1);
      let by = 0;
      let alpha = 1;
      const gutterMs = roll.result.gutterMs;
      if (gutterMs !== null && ms >= gutterMs) {
        // 溝の中へ。ガターは、しょんぼり揺れる。
        const tt = (ms - gutterMs) / 1000;
        const into = clamp(tt / 0.14, 0, 1);
        bx = Math.sign(bx) * (Math.abs(bx) + (LANE.width / 2 + LANE.gutterWidth / 2 - Math.abs(bx)) * into);
        by = -0.045 * into;
        if (roll.kind === 'gutter' && !still) bx += 0.035 * Math.sin(tt * 2 * Math.PI * 2.6) * Math.exp(-tt / 0.9) * into;
      }
      if (bz > LANE.pitZ) {
        const fall = clamp((bz - LANE.pitZ) / 0.6, 0, 1);
        by -= fall * 0.3;
        alpha = 1 - fall;
      }
      if (alpha > 0) {
        /** @type {number[][]} */
        const trail = [];
        for (let k = 0; k <= 18 && m.phase === 'rolling' && !still; k++) {
          const tms = ms - k * 18;
          if (tms < 0) break;
          const s = sampler(roll.result.frames, tms);
          trail.push([s(0), s(1)]);
        }
        const bp = project(cam, bx, 0, bz);
        if (bp) {
          items.push({
            d: bp.d - 0.01,
            draw: () => {
              if (trail.length > 2) {
                ctx.save();
                ctx.lineCap = 'butt';
                for (let k = 1; k < trail.length; k++) {
                  const a = project(cam, /** @type {number} */ (trail[k - 1]?.[0]), 0.02, /** @type {number} */ (trail[k - 1]?.[1]));
                  const b = project(cam, /** @type {number} */ (trail[k]?.[0]), 0.02, /** @type {number} */ (trail[k]?.[1]));
                  if (!a || !b) continue;
                  ctx.strokeStyle = `rgba(255, 217, 160, ${0.4 * (1 - k / trail.length)})`;
                  ctx.lineWidth = Math.max(1, BODY.ballR * a.s * 1.1 * (1 - k / trail.length));
                  ctx.beginPath();
                  ctx.moveTo(a.x, a.y);
                  ctx.lineTo(b.x, b.y);
                  ctx.stroke();
                }
                ctx.restore();
              }
              lane.drawBall(cam, { x: bx, y: by, z: bz, alpha, look: balls.get(roll.p) ?? null, roll: still ? 0 : bz / BODY.ballR });
            },
          });
        }
      }
      // 火花（倒れたピンの根元から。種は投球の番号とピン）。
      if (!still) {
        for (const fall of roll.result.falls) {
          const tt = (ms - fall.ms) / 1000;
          if (tt < 0 || tt > 0.6) continue;
          const rand = seeded(roll.id * 977 + fall.pin * 131);
          const n = roll.kind === 'strike' ? 7 : roll.kind === 'spare' ? 6 : 4;
          for (let k = 0; k < n; k++) {
            const ang = rand() * Math.PI * 2;
            const sp = 0.5 + rand() * 1.4;
            const up = 0.9 + rand() * 1.6;
            const x = fall.x + Math.cos(ang) * sp * tt;
            const z = fall.z + Math.sin(ang) * sp * tt;
            const y = Math.max(0, 0.15 + up * tt - 4.2 * tt * tt);
            const p = project(cam, x, y, z);
            if (!p) continue;
            const life = 1 - tt / 0.6;
            items.push({
              d: p.d - 0.02,
              draw: () => {
                ctx.fillStyle = `rgba(255, ${Math.round(160 + 60 * life)}, 90, ${0.9 * life})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(1.2, 0.012 * p.s), 0, Math.PI * 2);
                ctx.fill();
              },
            });
          }
        }
      }
    } else {
      // 投げる前：立っているピンと、置いた球。
      PIN_SPOTS.forEach((s, i) => {
        if (!m.standing[i]) return;
        const p = project(cam, s.x, 0, s.z);
        if (!p) return;
        items.push({ d: p.d, draw: () => lane.drawPin(cam, { x: s.x, z: s.z, tilt: 0, dx: 0, dz: 1, spin: 0, drop: 0, alpha: 1 }) });
      });
      if (m.phase === 'aim' && m.turn) {
        const a = aimState(m, clock.now);
        const x = a ? releaseX(shown.startX) : restX;
        const bob = still ? 0 : 0.012 * Math.sin(clock.now / 300);
        // 狙いの予想線（球と同じ式で、ピンが無いとしたときの道）。
        if (a) {
          const k = `${shown.startX.toFixed(3)}:${shown.hook.toFixed(3)}:${shown.power.toFixed(3)}`;
          if (aimPath?.key !== k) aimPath = { key: k, path: ballPath({ startX: shown.startX, hook: shown.hook, power: shown.power }, 0.4) };
          drawAim(cam, aimPath.path, shown.ok);
        }
        const p = project(cam, x, 0, -0.3);
        if (p) items.push({ d: p.d, draw: () => lane.drawBall(cam, { x, y: bob, z: -0.3, alpha: 1, look, roll: 0.35 }) });
      }
    }
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();
    if (m.phase === 'aim' && m.aim) drawGauge(shown.power, shown.ok);
  }

  /** @param {Cam} cam @param {ReturnType<typeof ballPath>} path @param {boolean} ok */
  function drawAim(cam, path, ok) {
    const { ctx } = lane;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 引きが足りない間は、細い点線（まだ投げにならない）。
    if (!ok) ctx.setLineDash([6, 8]);
    const pts = path.points;
    for (let k = 1; k < pts.length; k++) {
      const [x0, z0] = /** @type {number[]} */ (pts[k - 1]);
      const [x1, z1] = /** @type {number[]} */ (pts[k]);
      const a = project(cam, /** @type {number} */ (x0), 0.01, /** @type {number} */ (z0));
      const b = project(cam, /** @type {number} */ (x1), 0.01, /** @type {number} */ (z1));
      if (!a || !b) continue;
      // 遠くほど薄く（先は自分の目で）。
      const fade = clamp(1 - (/** @type {number} */ (z1) - 9) / 12, 0.3, 1) * (ok ? 1 : 0.6);
      ctx.strokeStyle = `rgba(255, 217, 160, ${0.9 * fade})`;
      ctx.lineWidth = Math.max(ok ? 2.5 : 1.5, a.s * (ok ? 0.03 : 0.016));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (path.gutterAt !== null) {
      // 溝に落ちる所に × 。
      const last = /** @type {number[]} */ (pts[pts.length - 1]);
      const p = project(cam, /** @type {number} */ (last[0]), 0.02, /** @type {number} */ (last[1]));
      if (p) {
        const r = Math.max(7, p.s * 0.07);
        ctx.strokeStyle = 'rgba(255, 217, 160, 0.95)';
        ctx.lineWidth = Math.max(2.5, r * 0.32);
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y - r);
        ctx.lineTo(p.x + r, p.y + r);
        ctx.moveTo(p.x + r, p.y - r);
        ctx.lineTo(p.x - r, p.y + r);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 強さの目盛り（左下）。 @param {number} power @param {boolean} ok */
  function drawGauge(power, ok) {
    const { ctx } = lane;
    const { W, H } = lane.size();
    const h = Math.min(H * 0.42, 260);
    const w = Math.max(14, Math.min(22, W * 0.022));
    const x = Math.max(14, W * 0.035);
    const y = H - h - Math.max(18, H * 0.06);
    ctx.save();
    ctx.fillStyle = 'rgba(26, 20, 17, 0.8)';
    ctx.strokeStyle = 'rgba(255, 217, 160, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, w / 2);
    ctx.fill();
    ctx.stroke();
    if (ok) {
      const fh = (h - 6) * clamp(power, 0, 1);
      const g = ctx.createLinearGradient(0, y + h, 0, y);
      g.addColorStop(0, '#ff8a3d');
      g.addColorStop(1, '#ffd9a0');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + h - 3 - fh, w - 6, fh, (w - 6) / 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 217, 160, 0.55)';
    ctx.lineWidth = 1.5;
    for (const k of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(x + w + 3, y + h - h * k);
      ctx.lineTo(x + w + 9, y + h - h * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** @param {string} title @param {string} body */
  function showMessage(title, body) {
    hero.hidden = false;
    hero.replaceChildren(el('h2', 'title', title), el('p', 'eyebrow', body));
    guide.textContent = body;
    status.textContent = `${title}。${body}`;
  }

  return {
    update,
    draw,
    showMessage,
    reduced: () => !!reduce?.matches,
    dispose() {
      ro?.disconnect();
      model = null;
    },
  };
}
