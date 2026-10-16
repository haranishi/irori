// @ts-check
// あつめて点の画面。規則は logic.js にあり、ここは irori とのやり取りと描画だけ。
import { connect } from './irori.js';
import {
  BOUNDS, DOT_GLOW_R, DOT_R, GAME_MS, H, MOVER_R, W,
  begin, createClock, createField, handleInput, makeRng, step, updatePlayers,
} from './logic.js';

/** @typedef {import('./irori.js').Irori} Irori */
/** @typedef {import('./logic.js').Effect} Effect */

const COLOR = { bg: '#1a1411', floor: '#231a15', card: '#2f241d', line: '#4a382c', text: '#f5ebe0', dim: '#c9b8a6', glow: '#ffd9a0', ember: '#ff8a3d' };
const FONT = 'ui-rounded, "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif';

const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

/** @type {Irori} */
let irori;
try {
  irori = await connect();
} catch (err) {
  status.textContent = 'コンソールとつながりませんでした。ゲームを開き直してください。';
  status.className = 'error';
  throw err;
}

const clock = createClock(() => performance.now());
const field = createField(irori.players, clock.now(), makeRng(Math.floor(Math.random() * 2 ** 32)));
const order = [...field.movers.keys()];
const names = new Map(irori.players.map((p) => [p.id, p.name]));
/** 席ごとの色と、形を塗る Path2D。色だけで区別しないよう、印は必ず両方で描く。 */
const marks = new Map(order.map((p) => {
  const look = irori.look(p);
  return [p, { color: look.color, path: new Path2D(look.path) }];
}));

/** 規則が返した「やること」を、irori に渡す。 */
function apply(/** @type {Effect[]} */ effects) {
  for (const e of effects) {
    if (e.t === 'pad') irori.setPad(e.spec, e.to);
    else if (e.t === 'buzz') irori.vibrate(e.ms, e.to);
    else irori.end(e.results);
  }
}

// 一時停止のあいだも向きは受ける（離した知らせを落とすと、再開のあとに走り出すため）。動かすのは step だけ。
irori.on('input', (p, input) => handleInput(field, p, input, clock.now()));
irori.on('players', (players) => {
  for (const pl of players) names.set(pl.id, pl.name);
  apply(updatePlayers(field, players));
});
irori.on('pause', () => {
  clock.pause();
  stop();
  draw();
});
irori.on('resume', () => {
  clock.resume();
  start();
});
addEventListener('resize', () => {
  fit();
  draw();
});

// ---- ループ ----

let raf = 0;
let lastFrame = 0;
let slow = 0;
let skip = false;

function start() {
  if (raf || field.phase === 'over') return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function frame(/** @type {number} */ t) {
  raf = requestAnimationFrame(frame);
  // 動きは前のフレームからの時間 dt で進める。端末が遅くても、速さは変わらない。
  const dt = (t - lastFrame) / 1000;
  // 60fpsを保てない端末では、描画を1フレームおきにする。動きと時計は毎フレーム進める。
  slow = t - lastFrame > 24 ? Math.min(slow + 1, 60) : Math.max(slow - 1, 0);
  lastFrame = t;
  skip = slow > 30 && !skip;
  apply(step(field, dt, clock.now()));
  if (field.phase === 'over') stop();
  if (!skip || field.phase === 'over') draw();
}

// ---- 描画 ----

function fit() {
  const s = Math.max(0.1, Math.min(innerWidth / W, innerHeight / H));
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  const k = s * (window.devicePixelRatio || 1);
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(H * k);
  ctx.setTransform(k, 0, 0, k, 0, 0);
}

let said = '';

function draw() {
  const now = clock.now();
  document.documentElement.dataset.phase = field.phase;
  if (said !== field.phase) {
    said = field.phase;
    status.textContent = field.phase === 'intro' ? 'まもなく開始' : field.phase === 'play' ? 'スタート。点を集めよう' : 'おわり';
  }
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.beginPath();
  ctx.roundRect(BOUNDS.left - MOVER_R - 4, BOUNDS.top - MOVER_R - 4, BOUNDS.right - BOUNDS.left + 2 * MOVER_R + 8, BOUNDS.bottom - BOUNDS.top + 2 * MOVER_R + 8, 18);
  ctx.fillStyle = COLOR.floor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.line;
  ctx.stroke();
  hud(now);
  for (const d of field.dots) if (d.live) ember(d.x, d.y);
  for (const p of order) {
    const m = field.movers.get(p);
    if (!m) continue;
    ctx.save();
    ctx.globalAlpha = m.online ? 1 : 0.35;
    mark(p, m.x, m.y, MOVER_R * 2);
    // 下の端では、名前を上に出す（画面の外に切れないように）。
    const below = m.y + MOVER_R + 20 <= H - 6;
    text(names.get(p) ?? `プレイヤー${p}`, m.x, below ? m.y + MOVER_R + 20 : m.y - MOVER_R - 8, 16, COLOR.text, 'center', 600, 120);
    ctx.restore();
  }
  if (field.phase === 'intro') {
    const n = Math.max(1, Math.ceil((field.playAt - now) / 1000));
    card(330, 170, 300, 210);
    text(String(n), W / 2, 300, 110, COLOR.glow, 'center');
    text('光る点を集めよう', W / 2, 350, 24, COLOR.text, 'center', 600);
  } else if (field.phase === 'over') {
    banner('おわり', field.why === 'time' ? '時間切れ' : '全員退出');
  } else if (clock.paused) {
    banner('一時停止中', 'メニューを閉じると続きから');
  }
}

/** 上の帯：題名、席ごとの印と取った数、残り時間。 */
function hud(/** @type {number} */ now) {
  text('あつめて点', 32, 52, 26, COLOR.text);
  // 8人でも重ならない幅（印20px＋2桁の数）。
  const slot = Math.min(84, 432 / Math.max(1, order.length));
  order.forEach((p, i) => {
    const m = field.movers.get(p);
    const x = 196 + slot * i;
    mark(p, x + 10, 45, 20);
    text(String(m?.score ?? 0), x + 24, 52, 20, COLOR.text, 'left', 700);
  });
  const left = field.phase === 'intro' ? GAME_MS : Math.max(0, field.endAt - now);
  pill(700, 38, 228, 12, COLOR.card);
  pill(700, 38, 228 * (left / GAME_MS), 12, COLOR.ember);
  text(`${Math.ceil(left / 1000)}秒`, 688, 52, 20, COLOR.text, 'right', 600);
}

/** 光る点（残り火のような小さな光）。 */
function ember(/** @type {number} */ x, /** @type {number} */ y) {
  ctx.beginPath();
  ctx.arc(x, y, DOT_GLOW_R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 138, 61, 0.22)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.ember;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - 3, y - 3, DOT_R * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.glow;
  ctx.fill();
}

function banner(/** @type {string} */ title, /** @type {string} */ sub) {
  ctx.fillStyle = 'rgba(26, 20, 17, 0.55)';
  ctx.fillRect(0, 0, W, H);
  card(280, 180, 400, 180);
  text(title, W / 2, 262, 48, COLOR.glow, 'center');
  text(sub, W / 2, 316, 24, COLOR.text, 'center', 600);
}

function card(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fillStyle = 'rgba(47, 36, 29, 0.94)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.glow;
  ctx.stroke();
}

/** @param {number} x @param {number} y @param {number} w @param {number} h @param {string} fill */
function pill(x, y, w, h, fill) {
  if (w <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** 席の印（色と形）を、(cx, cy) を中心に size の大きさで描く。 */
function mark(/** @type {number} */ p, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ size) {
  const m = marks.get(p);
  if (!m) return;
  const k = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(k, k);
  ctx.fillStyle = m.color;
  ctx.fill(m.path);
  ctx.lineWidth = 1.5 / k;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.stroke(m.path);
  ctx.restore();
}

/**
 * @param {string} s @param {number} x @param {number} y @param {number} size @param {string} color
 * @param {CanvasTextAlign} [align] @param {number} [weight] @param {number} [maxWidth]
 */
function text(s, x, y, size, color, align = 'left', weight = 700, maxWidth = undefined) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth === undefined) ctx.fillText(s, x, y);
  else ctx.fillText(s, x, y, maxWidth);
}

// ---- 起動 ----（宣言をすべて済ませてから。let と const は、宣言より前に使えない）

fit();
apply(begin(field));
draw();
irori.ready();
start();
