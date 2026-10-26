// @ts-check
// 秘密の選択を含まない公開モデルからだけ画面を作る。
import { MAX_ROUNDS, MOVES } from './logic.js';
/** @typedef {import('./logic.js').GameViewModel} GameViewModel */
/** @typedef {import('./logic.js').Seat} Seat */
/** @typedef {import('./logic.js').Move} Move */
/** @typedef {import('./irori.js').Look} Look */
const SVG = 'http://www.w3.org/2000/svg';

/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {Look|undefined} look */
function mark(look) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', look?.label ?? '席の印');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', look?.path ?? 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20');
  path.setAttribute('fill', look?.color ?? '#ffd9a0');
  svg.append(path);
  return svg;
}

/** 自作の刀と軌跡。画面の装飾なので読み上げない。 @param {string} cls */
function sword(cls) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('sword', cls);
  svg.setAttribute('viewBox', '0 0 170 260');
  svg.setAttribute('aria-hidden', 'true');
  const paths = [
    ['blade-shadow', 'M81 195L86 24Q87 7 98 2L100 195Z'],
    ['blade-edge', 'M88 189L92 25L96 14L96 189Z'],
    ['hilt', 'M67 190Q89 183 111 190L111 198Q89 206 67 198ZM83 203L98 203L98 249Q91 255 83 249Z'],
    ['wrap', 'M84 211L96 220M84 224L96 233M84 237L96 246'],
  ];
  for (const [name, d] of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('class', /** @type {string} */ (name));
    path.setAttribute('d', /** @type {string} */ (d));
    svg.append(path);
  }
  return svg;
}

/** @param {Seat} seat @param {GameViewModel} model @param {ReadonlyMap<number,Look>} looks @param {number} index */
function fighter(seat, model, looks, index) {
  const look = looks.get(seat.id);
  const panel = el('section', `fighter fighter--${index === 0 ? 'left' : 'right'}`);
  panel.dataset.seat = String(seat.id);
  panel.style.setProperty('--seat-color', look?.color ?? '#ffd9a0');
  const identity = el('div', 'identity');
  identity.append(mark(look), el('h2', 'player-name', seat.name));
  panel.append(identity);
  const meters = el('div', 'meters');
  const health = el('div', 'meter health');
  health.setAttribute('role', 'img');
  health.setAttribute('aria-label', `体力 ${seat.hp} / 4`);
  health.append(el('span', 'meter-label', '体力'));
  for (let i = 0; i < 4; i++) {
    const dot = el('i', i < seat.hp ? 'pip pip--hp is-full' : 'pip pip--hp');
    dot.setAttribute('aria-hidden', 'true');
    health.append(dot);
  }
  const energy = el('div', 'meter energy');
  energy.setAttribute('role', 'img');
  energy.setAttribute('aria-label', `気力 ${seat.energy} / 3`);
  energy.append(el('span', 'meter-label', '気力'));
  for (let i = 0; i < 3; i++) {
    const dot = el('i', i < seat.energy ? 'pip pip--energy is-full' : 'pip pip--energy');
    dot.setAttribute('aria-hidden', 'true');
    energy.append(dot);
  }
  meters.append(health, energy);
  panel.append(meters);
  const art = el('div', 'fighter-art');
  art.append(sword(index === 0 ? 'sword--left' : 'sword--right'));
  art.append(el('span', 'blade-caption', index === 0 ? '壱' : '弐'));
  panel.append(art);
  const record = model.reveal.find((r) => r.p === seat.id);
  const action = el('div', 'fighter-action');
  if (record) {
    action.dataset.move = record.move;
    action.append(el('strong', 'move-name', MOVES[record.move].label));
    action.append(el('span', record.damage ? 'move-result is-hit' : 'move-result',
      record.damage ? `体力 −${Math.min(record.hpBefore, record.damage)}` : record.move === 'focus' ? '気力を整えた' : '無傷'));
  } else action.append(el('span', 'hidden-move', model.phase === 'intro' ? '体力4・気力1で開始' : '構えは、まだ秘密。'));
  if (!seat.online || seat.left) action.append(el('span', 'connection', seat.left ? '退出' : '接続待ち'));
  panel.append(action);
  return panel;
}

/** @param {GameViewModel} model */
function guide(model) {
  if (model.blockers.length) return model.blockers.join('。');
  if (model.seats.filter((s) => !s.left).length !== 2) return '2人そろってからゲームを開き直してください';
  const leader = model.seats.find((s) => s.id === model.leader)?.name;
  if (model.phase === 'choose') return 'スマホで手を1つ選ぼう。2人が決めたら、一斉公開。';
  if (model.phase === 'ended') return model.outcome === 'incomplete' ? '参加者が退出したため、今回は勝敗なし' : '総合結果を大画面で見よう';
  return `${leader ? `${leader}さん` : '進行役'}のスマホで「${model.actionLabel}」`;
}

/** @param {GameViewModel} model */
function headline(model) {
  if (model.phase === 'intro') return '一手先を、読む。';
  if (model.phase === 'recover') return 'ひと息ついて、もう一度。';
  if (model.phase === 'choose') return 'その守りに、何を出す？';
  if (model.phase === 'ended') return model.outcome === 'incomplete' ? '今回は、勝敗なし。' : '勝負あり。';
  if (model.finished) {
    const [left, right] = model.seats;
    if (!left || !right) return '勝負あり。';
    if (left.hp === right.hp) return '互角。見事な勝負。';
    return `${left.hp > right.hp ? left.name : right.name}さんの勝ち。`;
  }
  const hits = model.reveal.filter((r) => r.damage > 0);
  if (hits.length === 2) return '交差する、ふたつの刃。';
  if (hits.length === 1) return '読みが、届いた。';
  return '静かな間合い。次の一手は。';
}

/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage, status) {
  let previous = '';
  /** @param {GameViewModel} model @param {ReadonlyMap<number,Look>} looks */
  function render(model, looks) {
    document.documentElement.dataset.phase = model.phase;
    document.documentElement.dataset.round = String(model.round);
    const key = JSON.stringify(model);
    if (previous === key) return;
    previous = key;
    const frame = el('div', 'game-frame');
    const header = el('header', 'masthead');
    const brand = el('div', 'brand');
    brand.append(el('p', 'eyebrow', 'BLADE AND BREATH'), el('h1', 'title', '火花の間合い'));
    const round = el('div', 'round');
    round.append(el('span', 'round-label', model.phase === 'intro' ? '二人で、読み合う' : 'いまの一手'),
      el('span', 'round-number', `${String(model.round).padStart(2, '0')} / ${MAX_ROUNDS}`));
    header.append(brand, round);
    const message = el('div', 'message');
    message.append(el('p', 'headline', headline(model)), el('p', 'subline',
      model.phase === 'intro' ? '斬る、受ける、溜める。気力3の大技が、守りを崩す。'
        : model.phase === 'recover' ? '選んだ手は取り消し。ここまでの体力と気力は、そのまま。'
          : model.phase === 'reveal' ? model.finished ? '残り体力で勝負。同じなら引き分け。' : '出した手を見て、次の読みを組み立てよう。'
            : '時間制限なし。早さよりも、読みの勝負。'));
    const arena = el('div', 'arena');
    model.seats.slice(0, 2).forEach((s, i) => arena.append(fighter(s, model, looks, i)));
    const center = el('div', 'clash');
    center.setAttribute('aria-hidden', 'true');
    center.append(el('span', 'clash-label', model.phase === 'reveal' ? '一閃' : '間合い'));
    arena.append(center);
    const progress = el('div', 'progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '1');
    progress.setAttribute('aria-valuemax', String(MAX_ROUNDS));
    progress.setAttribute('aria-valuenow', String(model.round));
    progress.setAttribute('aria-label', `第${model.round}手、全${MAX_ROUNDS}手まで`);
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      const tick = el('span', `step${i === model.round ? ' is-current' : i < model.round ? ' is-past' : ''}`);
      tick.setAttribute('aria-hidden', 'true');
      progress.append(tick);
    }
    const prompt = el('p', 'prompt', guide(model));
    const rules = el('div', 'rules');
    rules.setAttribute('role', 'group');
    rules.setAttribute('aria-label', '4つの手');
    for (const move of /** @type {Move[]} */ (['slash', 'guard', 'focus', 'burst'])) {
      const card = el('div', `rule rule--${move}`);
      const ruleTitle = el('div', 'rule-title');
      ruleTitle.append(el('span', 'rule-name', MOVES[move].label), el('span', 'cost', `気力 ${MOVES[move].cost}`));
      card.append(ruleTitle, el('p', 'rule-description', MOVES[move].description));
      rules.append(card);
    }
    const note = el('p', 'footnote', '同時に解決 · 体力0で決着 · 最大10手、残り体力で勝負');
    frame.append(header, message, arena, progress, prompt, rules, note);
    stage.replaceChildren(frame);
    status.textContent = `${headline(model)} ${guide(model)}`;
  }
  /** @param {string} title @param {string} body */
  function showMessage(title, body) {
    stage.replaceChildren(el('h1', 'error-title', title), el('p', 'error-body', body));
    status.textContent = `${title}。${body}`;
  }
  return { render, showMessage, dispose() { previous = ''; } };
}
