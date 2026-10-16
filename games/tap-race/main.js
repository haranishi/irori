// @ts-check
// 連打レースの画面。規則は logic.js にあり、ここは irori とのやり取りと描画だけ。
import { connect } from './irori.js';
import { RACE_MS, TAPS_TO_FINISH, begin, createClock, createRace, standings, tap, tick, updatePlayers } from './logic.js';

/** @typedef {import('./irori.js').Irori} Irori */
/** @typedef {import('./logic.js').Effect} Effect */

const W = 960;
const H = 540;
const COLOR = { bg: '#1a1411', card: '#2f241d', line: '#4a382c', text: '#f5ebe0', dim: '#c9b8a6', glow: '#ffd9a0', ember: '#ff8a3d' };
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
const race = createRace(irori.players, clock.now());
const lanes = [...race.runners.keys()];
const names = new Map(irori.players.map((p) => [p.id, p.name]));
/** 席ごとの色と、形を塗る Path2D。色だけで区別しないよう、印は必ず両方で描く。 */
const marks = new Map(lanes.map((p) => {
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

irori.on('input', (p, input, T) => {
  // 一時停止のあいだの連打は数えない（時計も止まっている）。
  if (!clock.paused) apply(tap(race, p, input, clock.now(), T));
});
irori.on('players', (players) => {
  for (const pl of players) names.set(pl.id, pl.name);
  apply(updatePlayers(race, players));
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
  if (raf || race.phase === 'over') return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function frame(/** @type {number} */ t) {
  raf = requestAnimationFrame(frame);
  // 60fpsを保てない端末では、描画を1フレームおきにする。規則の時計は毎フレーム進める。
  slow = t - lastFrame > 24 ? Math.min(slow + 1, 60) : Math.max(slow - 1, 0);
  lastFrame = t;
  skip = slow > 30 && !skip;
  apply(tick(race, clock.now()));
  if (race.phase === 'over') stop();
  if (!skip || race.phase === 'over') draw();
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

const warmth = ctx.createRadialGradient(W / 2, H * 0.62, 0, W / 2, H * 0.62, 560);
warmth.addColorStop(0, 'rgba(255, 138, 61, 0.10)');
warmth.addColorStop(1, 'rgba(255, 138, 61, 0)');

let said = '';

function draw() {
  const now = clock.now();
  document.documentElement.dataset.phase = race.phase;
  announce();
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = warmth;
  ctx.fillRect(0, 0, W, H);
  header(now);
  const ranks = new Map(standings(race).map((s) => [s.p, s]));
  const top = 104;
  const laneH = Math.min(88, 416 / Math.max(1, lanes.length));
  const y0 = top + (416 - laneH * lanes.length) / 2;
  lanes.forEach((p, i) => lane(p, y0 + laneH * (i + 0.5), laneH, ranks.get(p)));
  if (race.phase === 'count') countdown(now);
  else if (race.phase === 'race' && now - race.goAt < 700) flash('連打!', 1 - (now - race.goAt) / 700);
  if (race.phase === 'over') banner('おわり', race.why === 'finish' ? '全員完走！' : race.why === 'time' ? '時間切れ' : '全員退出');
  else if (clock.paused) banner('一時停止中', 'メニューを閉じると続きから');
}

function announce() {
  if (said === race.phase) return;
  said = race.phase;
  status.textContent = race.phase === 'count' ? 'よーい' : race.phase === 'race' ? 'スタート。40回たたこう' : 'おわり';
}

function header(/** @type {number} */ now) {
  text('連打レース', 32, 60, 30, COLOR.text);
  text(`${TAPS_TO_FINISH}回たたいたら完走`, 200, 60, 18, COLOR.dim, 'left', 600);
  if (race.phase === 'count') {
    text('まもなくスタート', 928, 60, 20, COLOR.dim, 'right', 600);
    return;
  }
  const left = Math.max(0, race.goAt + RACE_MS - Math.max(now, race.goAt));
  pill(660, 46, 268, 12, COLOR.card);
  pill(660, 46, 268 * (left / RACE_MS), 12, COLOR.ember);
  text(`残り ${Math.ceil(left / 1000)}秒`, 644, 60, 20, COLOR.text, 'right', 600);
}

/**
 * 1人ぶんのレーン。左に色と形と名前、真ん中に進み具合、右に回数か順位。
 * 切れている人は薄くして「切断」と回数（戻れば続きから）、席が消えた人は「棄権」。
 * @param {number} p
 * @param {number} cy
 * @param {number} laneH
 * @param {{ rank: number, label: string, done: boolean } | undefined} rank
 */
function lane(p, cy, laneH, rank) {
  const r = race.runners.get(p);
  const m = marks.get(p);
  if (!r || !m) return;
  const away = r.state === 'run' && !r.online;
  const alpha = r.state === 'out' ? 0.35 : away ? 0.6 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  mark(p, 52, cy, 32);
  text(names.get(p) ?? `プレイヤー${p}`, 78, cy + 7, 20, COLOR.text, 'left', 600, 140);
  const x0 = 236;
  const x1 = 796;
  const th = Math.max(24, Math.min(40, laneH - 18));
  pill(x0, cy - th / 2, x1 - x0, th, COLOR.card, COLOR.line);
  const progress = Math.min(r.taps, TAPS_TO_FINISH) / TAPS_TO_FINISH;
  ctx.globalAlpha = alpha * 0.45;
  pill(x0, cy - th / 2, Math.max(th, (x1 - x0) * progress), th, m.color);
  ctx.globalAlpha = alpha;
  mark(p, x0 + th / 2 + (x1 - x0 - th) * progress, cy, th - 6);
  if (r.state === 'out') text('棄権', 928, cy + 8, 20, COLOR.dim, 'right', 600);
  else if (rank?.done) text(`${rank.rank}位 ${rank.label}`, 928, cy + 8, 20, COLOR.glow, 'right');
  else if (away) text(`切断 ${r.taps}/${TAPS_TO_FINISH}`, 928, cy + 8, 18, COLOR.dim, 'right', 600);
  else text(`${r.taps}/${TAPS_TO_FINISH}`, 928, cy + 8, 22, COLOR.text, 'right', 600);
  ctx.restore();
}

function countdown(/** @type {number} */ now) {
  const n = Math.max(1, Math.ceil((race.goAt - now) / 1000));
  card(330, 160, 300, 220);
  text(String(n), W / 2, 300, 120, COLOR.glow, 'center');
  text('よーい', W / 2, 352, 26, COLOR.text, 'center', 600);
}

function flash(/** @type {string} */ s, /** @type {number} */ alpha) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  text(s, W / 2, H / 2 + 40, 110, COLOR.glow, 'center');
  ctx.restore();
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

/**
 * 角の丸い帯。
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {string} fill @param {string} [stroke]
 */
function pill(x, y, w, h, fill, stroke) {
  if (w <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
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
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
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
apply(begin(race));
draw();
irori.ready();
start();
