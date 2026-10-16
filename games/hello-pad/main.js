// @ts-check
// ハローパッド：SDKの全体像（players・leader・setPad・input・look・ready・end）を見せる、いちばん小さな見本。
// 規則は logic.js にあり、ここは irori とのやり取りと描画だけ。
import { connect } from './irori.js';
import {
  BADGE, FLOOR, GAME_MS, H, SIZE, W,
  createClock, createWorld, handleInput, handlePlayers, hopScale, leaderOf, padsFor, placeNames, step, tick, timeLeft,
} from './logic.js';

/** @typedef {import('./irori.js').Irori} Irori */

const COLOR = { bg: '#1a1411', floor: '#231a15', card: '#2f241d', line: '#4a382c', text: '#f5ebe0', dim: '#c9b8a6', glow: '#ffd9a0', ember: '#ff8a3d' };
const FONT = 'ui-rounded, "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif';
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const calm = matchMedia('(prefers-reduced-motion: reduce)');
let raf = 0;
let last = 0;
/** 最後に画面を送ったときのリーダー。替わったときだけ送り直す。 */
let padsLeader = /** @type {number | null | undefined} */ (undefined);

// 1. つなぐ。コンソールの中なら握手し、単体で開いたなら仮想プレイヤー（?mock=3 で3人）になる。
/** @type {Irori} */
let irori;
try {
  irori = await connect();
} catch (err) {
  status.textContent = 'コンソールとつながりませんでした。ゲームを開き直してください。';
  status.className = 'error';
  throw err;
}

// 2. いまいる席に、四角を1つずつ置く。色と形は irori.look(席番号) で、コンソールの表示とそろう。
//    リーダー（irori.leader）の席も覚える。「おわる」を押せるのは、リーダーだけ。
//    時間は、一時停止のあいだ止まる時計で測る（30秒の締切も止まる）。
const clock = createClock(() => performance.now());
const world = createWorld(irori.players, irori.leader, clock.now());
const names = new Map(irori.players.map((p) => [p.id, p.name]));
const looks = new Map([...world.boxes.keys()].map((p) => {
  const look = irori.look(p);
  return [p, { color: look.color, path: new Path2D(look.path) }];
}));

// 3. スマホの画面を決める。全員にスティックと「ぴょん」、リーダーにだけ「おわる」も出す。
//    「おわる」を全員に出すと、連打の最中の押し間違いで、全員のゲームが終わってしまうため。
sendPads();

// 4. 入力と席の変化を受ける。規則が end を返したら、結果をつけてコンソールに知らせる。
irori.on('input', (p, input) => {
  // 一時停止のあいだは、ぴょんも「おわる」も受けない（時計が止まっている）。スティックの向きだけは覚える。
  if (!clock.paused || input.k === 'axis') run(handleInput(world, p, input, clock.now()));
});
irori.on('players', (players, leader) => {
  for (const pl of players) names.set(pl.id, pl.name);
  run(handlePlayers(world, players, leader));
  sendPads();
});

// 5. 一時停止のあいだは、動きを止める（コンソールのメニューが前に出ている）。
irori.on('pause', () => {
  clock.pause();
  cancelAnimationFrame(raf);
  raf = 0;
  draw();
});
irori.on('resume', () => {
  clock.resume();
  last = performance.now();
  if (!raf && !world.over) raf = requestAnimationFrame(frame);
});
addEventListener('resize', () => {
  fit();
  draw();
});

/** @param {import('./logic.js').Effect[]} effects */
function run(effects) {
  for (const e of effects) irori.end(e.results);
}

/** スマホの画面を送る。全員に PAD_PLAYER、リーダーに席番号を付けて PAD_LEADER。リーダーが替わったときだけ送り直す。 */
function sendPads() {
  const lead = leaderOf(world);
  if (world.over || lead === padsLeader) return;
  padsLeader = lead;
  for (const { spec, to } of padsFor(world)) irori.setPad(spec, to);
}

function frame(/** @type {number} */ t) {
  step(world, Math.min(0.1, (t - last) / 1000));
  last = t;
  run(tick(world, clock.now()));
  draw();
  raf = world.over ? 0 : requestAnimationFrame(frame);
}

function fit() {
  const s = Math.max(0.1, Math.min(innerWidth / W, innerHeight / H));
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  const k = s * (window.devicePixelRatio || 1);
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(H * k);
  ctx.setTransform(k, 0, 0, k, 0, 0);
}

function draw() {
  const now = clock.now();
  document.documentElement.dataset.phase = world.over ? 'over' : 'play';
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.beginPath();
  ctx.roundRect(FLOOR.left, FLOOR.top, FLOOR.right - FLOOR.left, FLOOR.bottom - FLOOR.top, 18);
  ctx.fillStyle = COLOR.floor;
  ctx.fill();
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 上の2行：遊び方と順位の決まり（遊ぶ前に分かるように）、「おわる」を押せる人。右上に残りの秒数、縁に残りの帯。
  const lead = leaderOf(world);
  const left = timeLeft(world, now);
  ctx.beginPath();
  ctx.roundRect(24, 14, W - 48, 4, 2);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  if (left > 0) {
    ctx.beginPath();
    ctx.roundRect(24, 14, (W - 48) * (left / GAME_MS), 4, 2);
    ctx.fillStyle = COLOR.ember;
    ctx.fill();
  }
  label('スティックで動く・「ぴょん」でふくらむ・30秒のぴょんの回数で順位', W / 2, 40, 18, COLOR.text, 640);
  label(lead === null ? '「おわる」でおしまい' : `「おわる」はリーダー（${names.get(lead) ?? `プレイヤー${lead}`}）だけ`, W / 2, 64, 16, COLOR.dim, 640);
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = 'right';
  ctx.fillText(`残り ${Math.ceil(left / 1000)}秒`, W - 28, 46);
  for (const [p, box] of world.boxes) {
    const look = looks.get(p);
    if (!look) continue;
    const scale = calm.matches ? 1 : hopScale(box, now);
    const size = SIZE * scale;
    ctx.save();
    ctx.globalAlpha = box.online ? 1 : 0.35;
    // 動きを減らす設定のときは、ふくらむ代わりに光の輪を出す。
    if (calm.matches && hopScale(box, now) > 1) {
      ctx.beginPath();
      ctx.roundRect(box.x - SIZE / 2 - 6, box.y - SIZE / 2 - 6, SIZE + 12, SIZE + 12, 16);
      ctx.strokeStyle = COLOR.glow;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.roundRect(box.x - size / 2, box.y - size / 2, size, size, 12 * scale);
    ctx.fillStyle = look.color;
    ctx.fill();
    // 四角の中に、席の形を暗い色で抜く。色と形の両方で、誰の四角かが分かる。
    const k = (30 * scale) / 24;
    ctx.translate(box.x - 15 * scale, box.y - 15 * scale);
    ctx.scale(k, k);
    ctx.fillStyle = COLOR.bg;
    ctx.fill(look.path);
    ctx.restore();
    // 右上の角に、いまの「ぴょん」の回数（順位の決まり）。
    ctx.save();
    ctx.globalAlpha = box.online ? 1 : 0.5;
    ctx.beginPath();
    ctx.arc(box.x + BADGE.dx, box.y + BADGE.dy, BADGE.r, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.bg;
    ctx.fill();
    ctx.strokeStyle = COLOR.glow;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(box.hops), box.x + BADGE.dx, box.y + BADGE.dy + 1, BADGE.r * 2 - 4);
    ctx.restore();
  }
  // 名前は、四角をすべて描いてから、ほかの四角に乗らない場所に置く（logic.js の placeNames）。
  ctx.font = `700 18px ${FONT}`;
  // 札の幅は、最初に並べたときの間隔より少し狭くする（8人が横一列でも、隣の札に触れない）。
  const nameMax = Math.min(128, W / (world.boxes.size + 1) - 18);
  const nameOf = (/** @type {number} */ p) => names.get(p) ?? `プレイヤー${p}`;
  const spots = placeNames(
    [...world.boxes].map(([p, b]) => ({ p, x: b.x, y: b.y })),
    (p) => Math.min(nameMax, ctx.measureText(nameOf(p)).width) + 12,
  );
  for (const [p, r] of spots) {
    ctx.save();
    ctx.globalAlpha = world.boxes.get(p)?.online ? 1 : 0.5;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 8);
    ctx.fillStyle = 'rgba(26, 20, 17, 0.72)';
    ctx.fill();
    ctx.restore();
    label(nameOf(p), r.x + r.w / 2, r.y + r.h / 2 + 6, 18, COLOR.text, r.w - 12);
  }
  if (world.over) label('おわり', W / 2, H / 2 + 16, 48, COLOR.glow);
  else if (clock.paused) label('一時停止中', W / 2, H / 2 + 16, 40, COLOR.glow);
}

/**
 * @param {string} s @param {number} x @param {number} y @param {number} size @param {string} color @param {number} [max]
 */
function label(s, x, y, size, color, max = W - 48) {
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y, max);
}

// 6. 最初の画面を描いたら ready。誰もつながっていなければ、ここで end になる。
fit();
run(handlePlayers(world, irori.players, irori.leader));
draw();
irori.ready();
last = performance.now();
if (!world.over) raf = requestAnimationFrame(frame);
