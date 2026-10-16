// @ts-check
// 4択クイズの画面。規則は logic.js、問題は questions.js にあり、ここは irori とのやり取りと描画だけ。
// 文字はすべて textContent で入れる（スマホの名前を HTML として解釈しない）。
import { connect } from './irori.js';
import {
  ANSWER_MS, ROUNDS, answer, begin, createClock, createQuiz, makeRng, nextHistory, pickQuestions, seatTag, tick, toRound, updatePlayers,
} from './logic.js';
import { QUESTIONS } from './questions.js';

/** @typedef {import('./irori.js').Irori} Irori */
/** @typedef {import('./logic.js').Effect} Effect */

const W = 960;
const H = 540;
const SVG = 'http://www.w3.org/2000/svg';
/** 前に出した問題の id を覚える鍵（irori.storage）。次の回では、足りるかぎり避ける（覚えるのは前の2回ぶん）。 */
const RECENT_KEY = 'recent';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const stage = $('stage');
const status = $('status');

/** @type {Irori} */
let irori;
try {
  irori = await connect();
} catch (err) {
  status.textContent = 'コンソールとつながりませんでした。ゲームを開き直してください。';
  status.className = 'error';
  throw err;
}

const rng = makeRng(Math.floor(Math.random() * 2 ** 32));
const history = await loadRecent();
const picked = pickQuestions(QUESTIONS, ROUNDS, rng, history);
const remember = nextHistory(history, picked.map((q) => q.id), QUESTIONS.length - ROUNDS);
irori.storage.set(RECENT_KEY, JSON.stringify(remember)).catch(() => {});
const clock = createClock(() => performance.now());
const quiz = createQuiz(irori.players, picked.map((q) => toRound(q, rng)), clock.now());
const order = [...quiz.seats.keys()];
const names = new Map(irori.players.map((p) => [p.id, p.name]));
const looks = new Map(order.map((p) => [p, irori.look(p)]));

/** 保存が使えないとき（単体で開いた枠など）や遅いときは、避けずに選ぶ。最初の画面を待たせない。 */
async function loadRecent() {
  try {
    const raw = await Promise.race([irori.storage.get(RECENT_KEY), new Promise((_, no) => setTimeout(no, 800))]);
    const list = JSON.parse(typeof raw === 'string' ? raw : '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 規則が返した「やること」を、irori に渡す。 */
function apply(/** @type {Effect[]} */ effects) {
  for (const e of effects) {
    if (e.t === 'pad') irori.setPad(e.spec, e.to);
    else irori.end(e.results);
  }
}

irori.on('input', (p, input) => {
  // 一時停止のあいだは時計が止まっているので、答えも受けない。
  if (!clock.paused) apply(answer(quiz, p, input, clock.now()));
});
irori.on('players', (players) => {
  for (const pl of players) names.set(pl.id, pl.name);
  apply(updatePlayers(quiz, players, clock.now()));
});
irori.on('pause', () => {
  clock.pause();
  stop();
  render();
});
irori.on('resume', () => {
  clock.resume();
  start();
});
addEventListener('resize', fit);

// ---- ループ ----

let raf = 0;

function start() {
  if (!raf && quiz.phase !== 'over') raf = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function frame() {
  raf = requestAnimationFrame(frame);
  apply(tick(quiz, clock.now()));
  if (quiz.phase === 'over') stop();
  render();
}

// ---- 描画（変わったところだけ書き換える） ----

function fit() {
  const s = Math.max(0.1, Math.min(innerWidth / W, innerHeight / H));
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}

let shownRound = '';
let shownSeats = '';
let said = '';

function render() {
  const now = clock.now();
  const round = quiz.rounds[quiz.index];
  document.documentElement.dataset.phase = quiz.phase;
  document.documentElement.dataset.round = String(quiz.index + 1);
  const key = `${quiz.phase}:${quiz.index}`;
  if (key !== shownRound) {
    shownRound = key;
    if (quiz.phase === 'intro') {
      $('round').textContent = '4択クイズ';
      $('question').textContent = `全${quiz.rounds.length}問。早く正解するほど高得点`;
      $('note').textContent = '正解は1000点から200点まで下がる。まちがいと時間切れは-200点\n答えは1回だけ。押し直しはできない';
      $('choices').replaceChildren();
    } else if (round) {
      $('round').textContent = `第${quiz.index + 1}問 / ${quiz.rounds.length}`;
      $('question').textContent = round.text;
      $('note').textContent = quiz.phase === 'reveal' ? `答え：${round.choices.find((c) => c.id === round.answer)?.label ?? ''}` : '';
      $('choices').replaceChildren(...round.choices.map((c, i) => choiceCard(c, i, round.answer)));
    }
    speak();
  }
  // 残り時間の帯。出題中だけ減り、説明と答え合わせのあいだは止めて見せる。
  const left = quiz.phase === 'question' ? Math.max(0, quiz.at + ANSWER_MS - now) : quiz.phase === 'intro' ? ANSWER_MS : 0;
  $('timer').style.transform = `scaleX(${left / ANSWER_MS})`;
  $('secs').textContent = quiz.phase === 'question' ? `${Math.ceil(left / 1000)}秒` : '';
  const seatsKey = JSON.stringify([quiz.phase, ...order.map((p) => quiz.seats.get(p)), ...order.map((p) => names.get(p))]);
  if (seatsKey !== shownSeats) {
    shownSeats = seatsKey;
    $('seats').replaceChildren(...order.map(seatChip));
  }
  overlay(quiz.phase === 'over' ? ['おわり', quiz.why === 'left' ? '全員退出' : `全${quiz.rounds.length}問、おつかれさま`] : clock.paused ? ['一時停止中', 'メニューを閉じると続きから'] : null);
}

function speak() {
  const round = quiz.rounds[quiz.index];
  const line = quiz.phase === 'question' && round ? `第${quiz.index + 1}問。${round.text}`
    : quiz.phase === 'reveal' && round ? `答えは、${round.choices.find((c) => c.id === round.answer)?.label ?? ''}`
      : quiz.phase === 'over' ? 'おわり' : '';
  if (line && line !== said) status.textContent = said = line;
}

/**
 * 選択肢のカード。答え合わせのときは、正解を光の輪で示し、選んだ人の印を答えの下の行に並べる。
 * 印を答えと同じ行に置くと、8人が同じ長い答えを選んだとき、文字が押されて折り返し、枠の上下にはみ出した。
 * @param {{ id: string, label: string }} c
 * @param {number} i
 * @param {string} answerId
 */
function choiceCard(c, i, answerId) {
  const li = document.createElement('li');
  li.className = 'choice';
  li.dataset.id = c.id;
  const num = document.createElement('span');
  num.className = 'choice__num';
  num.textContent = String(i + 1);
  const label = document.createElement('span');
  label.className = 'choice__label';
  // 選択肢は12文字まで。11文字からは字を小さくして、1行に収める。
  if ([...c.label].length > 10) label.classList.add('is-long');
  label.textContent = c.label;
  li.append(num, label);
  if (quiz.phase === 'reveal') {
    li.classList.add('has-who', c.id === answerId ? 'is-answer' : 'is-dim');
    const who = document.createElement('span');
    who.className = 'choice__who';
    for (const p of order) if (quiz.seats.get(p)?.pick === c.id) who.append(shape(p, 18));
    li.append(who);
  }
  return li;
}

/** 参加者の札：色と形・名前・合計点と、答えたか（答え合わせでは増減）。席が消えた人は「退出」。点はそのまま見せる。 */
function seatChip(/** @type {number} */ p) {
  const seat = quiz.seats.get(p);
  const li = document.createElement('li');
  li.className = seat?.online ? 'seat' : 'seat is-off';
  const name = document.createElement('span');
  name.className = 'seat__name';
  name.textContent = names.get(p) ?? `プレイヤー${p}`;
  const score = document.createElement('span');
  score.className = 'seat__score';
  score.textContent = String(seat?.score ?? 0);
  li.append(shape(p, 24), name, score);
  const tag = seatTag(quiz, p);
  if (tag.text) {
    const chip = document.createElement('span');
    chip.className = tag.good ? 'seat__chip is-good' : 'seat__chip';
    chip.textContent = tag.text;
    li.append(chip);
  }
  return li;
}

/** 席の印（色と形）の SVG。読み上げは名前で行うので、絵は読み上げから外す。 */
function shape(/** @type {number} */ p, /** @type {number} */ size) {
  const look = looks.get(p) ?? irori.look(p);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', look.path);
  path.setAttribute('fill', look.color);
  path.setAttribute('stroke', 'rgba(0,0,0,0.5)');
  path.setAttribute('stroke-width', '1');
  svg.append(path);
  return svg;
}

/** @param {[string, string] | null} msg */
function overlay(msg) {
  const box = $('overlay');
  box.hidden = msg === null;
  if (!msg) return;
  $('overlay-title').textContent = msg[0];
  $('overlay-sub').textContent = msg[1];
}

// ---- 起動 ----（宣言をすべて済ませてから。let と const は、宣言より前に使えない）

fit();
apply(begin(quiz));
render();
irori.ready();
start();
