// @ts-check
/** @typedef {ReturnType<import('./logic.js').publicView>} Model */
const SVG = 'http://www.w3.org/2000/svg';
/** @param {string} value @param {number} max */
export const short = (value, max) => [...value].slice(0, max).join('');
/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [text] */
function el(tag, cls, text = '') {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}
/** @param {string} cls @param {string} d @param {string} box */
function shape(cls, d, box = '0 0 40 40') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', box);
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}
const suits = {
  s: 'M20 2C14 12 3 15 3 24C3 34 15 35 19 28L15 38H25L21 28C25 35 37 34 37 24C37 15 26 12 20 2Z',
  h: 'M20 36C12 29 2 21 2 12C2 0 16 0 20 9C24 0 38 0 38 12C38 21 28 29 20 36Z',
  d: 'M20 1 36 20 20 39 4 20Z',
  c: 'M20 2C9 2 8 15 15 19C1 12-3 33 10 33C14 33 17 30 19 27L15 38H25L21 27C23 30 26 33 30 33C43 33 39 12 25 19C32 15 31 2 20 2Z'
};
// 数と絵札は線で組み立てる。札面を端末の字形に依存させない。
const digits = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abfgcd'];
const segments = { a: 'M2 2H12', b: 'M13 3V11', c: 'M13 13V21', d: 'M2 22H12', e: 'M1 13V21', f: 'M1 3V11', g: 'M2 12H12' };
/** @param {string} card */
export function cardFace(card) {
  const face = el('div', 'face');
  face.dataset.red = String(card[0] === 'h' || card[0] === 'd');
  const rank = Number(card.slice(1)), label = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[rank] ?? String(rank);
  face.setAttribute('role', 'img');
  face.setAttribute('aria-label', `${({ s: 'スペード', h: 'ハート', d: 'ダイヤ', c: 'クラブ' })[card[0] ?? '']} ${label}`);
  const number = document.createElementNS(SVG, 'svg');
  number.setAttribute('viewBox', label === '10' ? '0 0 32 25' : '0 0 16 25');
  number.setAttribute('class', 'number');
  number.dataset.digits = String(label.length);
  number.setAttribute('aria-hidden', 'true');
  const letters = {
    J: 'M2 2H13V17Q13 24 5 22L1 18',
    Q: 'M3 2H11L14 6V18L11 22H3L1 18V6ZM9 17 15 24',
    K: 'M2 1V23M14 1 3 12 14 23',
    A: 'M1 23 7 1H9L15 23M4 15H12'
  };
  for (let i = 0; i < label.length; i++) {
    const char = label[i] ?? '', path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', letters[ /** @type {keyof typeof letters} */(char)] ?? [...(digits[Number(char)] ?? '')].map(s => segments[ /** @type {keyof typeof segments} */(s)]).join(''));
    path.setAttribute('transform', `translate(${i * 16} 0)`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '3.4');
    path.setAttribute('stroke-linejoin', 'round');
    number.append(path);
  }
  face.append(number, shape('suit', suits[ /** @type {keyof typeof suits} */(card[0])] ?? suits.s));
  return face;
}
/** @param {Model} m @param {Model['events'][number]} e */
export function eventText(m, e) {
  const name = short(m.seats.find(s => s.id === e.p)?.name ?? '', 12);
  const words = {
    fold: 'おりた',
    check: 'そのまま',
    call: `あわせた ${e.amount}`,
    raise: `ふやした ${e.amount}`,
    all: `${e.capLabel ?? 'ぜんぶ'} ${e.amount}`,
    'auto-check': '時間切れでそのまま',
    'auto-fold': '時間切れでおりた'
  };
  return short(`${name} · ${words[ /** @type {keyof typeof words} */(e.type)] ?? '札が進んだ'}`, 64);
}
/** @param {Model} m */
function heading(m) {
  if (m.phase === 'intro')
    return '手札は、あなたのスマホだけに。';
  if (m.phase === 'result')
    return m.outcome === 'incomplete' ? '今回は勝負なし' : '持ち点で、順位が決まりました。';
  if (m.phase === 'showdown')
    return m.seats.some(s => s.hand) ? '手札をひらいて、勝負'
      : `1人残ったので、${short(m.seats.find(s => m.winners.includes(s.id))?.name ?? '', 12)}さんがたまりを受け取ります`;
  if (m.phase === 'turn')
    return `${short(m.seats.find(s => s.id === m.turn)?.name ?? '', 12)}さんの番`;
  return m.phase === 'deal' ? '手札を2枚ずつ配っています' : '場の札をひらきます';
}
/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage, status) {
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let held = false, last = '', scene = '';
  const reflect = () => {
    stage.dataset.motion = motion?.matches ? 'reduce' : 'full';
  };
  motion?.addEventListener?.('change', reflect);
  reflect();
  return {
    /** @param {Model} m @param {Map<number,import('./irori.js').Look>} [looks] */
    render(m, looks = new Map()) {
      document.documentElement.dataset.phase = m.phase;
      stage.dataset.phase = m.phase;
      stage.dataset.count = String(m.seats.length);
      stage.dataset.frozen = String(held || m.paused);
      const clockText = m.phase === 'intro' ? '準備'
          : m.phase === 'result' ? `あと${Math.ceil(m.remaining / 1000)}秒で、「もう一度／ホームへ」の画面へ` : `${Math.ceil(m.remaining / 1000)}秒`;
      const fingerprint = JSON.stringify({ ...m, remaining: 0 }), old = stage.querySelector('.clock-label');
      if (last === fingerprint && old instanceof HTMLElement) {
        old.textContent = clockText;
        const clock = stage.querySelector('.clock');
        if (clock instanceof HTMLElement) clock.style.setProperty('--time', String(Math.min(1, m.remaining / (m.phase === 'result' ? 20000 : 25000))));
        return;
      }
      last = fingerprint;
      const header = el('header', 'masthead'), brand = el('div', 'brand');
      brand.append(el('p', 'eyebrow', '夕暮れの縁側 / 札あそび'), el('h1', 'title', '持ち点ポーカー'));
      const clock = el('div', 'clock');
      const ring = el('span', 'clock-ring');
      ring.setAttribute('aria-hidden', 'true');
      clock.append(el('span', 'clock-label', clockText), ring);
      clock.style.setProperty('--time', String(Math.min(1, m.remaining / (m.phase === 'result' ? 20000 : 25000))));
      header.append(brand, el('div', 'hand-number', `第 ${Math.max(1, m.handNumber)} / 6 ハンド`), clock);
      const line = el('h2', 'turn-line', heading(m)), table = el('section', 'table');
      table.setAttribute('aria-label', '席と場の札');
      const center = el('div', 'center');
      if (m.phase === 'intro') {
        center.classList.add('intro');
        center.append(
          el('p', 'intro-title', '二枚の手札。五枚の場。'),
          el('p', '', '強い五枚の組み合わせを作ろう。'),
          el('p', '', 'おりる・あわせる・ふやす をスマホで選ぶ。'),
          el('p', 'start-guide', '進行役のスマホで「はじめる」'),
          el('p', 'fine', '2〜8人 / 1人でもCPUと / 推奨4人'),
        );
      }
      else if (m.phase === 'result') {
        const results = el('ol', 'results');
        for (const r of [...m.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
          const seat = m.seats.find(s => s.id === r.p);
          const row = el('li', 'result-row');
          row.dataset.first = String(r.rank === 1);
          const tag = r.rank === 1 ? 'strong' : 'span';
          row.append(
            el(tag, 'result-rank', r.rank === null ? '—' : `${r.rank}位`),
            el(tag, 'result-name', short(seat?.name ?? '', 12)),
            el('span', 'result-cpu', r.cpu ? 'CPU' : ''),
            el(tag, 'result-score', `${r.score}点`),
          );
          results.append(row);
        }
        center.append(el('p', 'result-title', '持ち点と順位'));
        if (m.seats.some(s => s.cpu)) center.append(el('p', 'result-guide', 'CPUを含む全席の順位です。CPUの席は印で示します。'));
        center.append(results);
      }
      else {
        center.append(el('p', 'pot', `たまり ${m.pot} 点`));
        const board = el('div', 'board');
        for (let i = 0; i < 5; i++)
          board.append(m.board[i] ? cardFace(/** @type {string} */ (m.board[i])) : el('div', 'empty-card'));
        center.append(board);
        if (m.phase === 'showdown') center.append(el('p', 'fine', '光っている席が、このハンドの勝者'));
      }
      const guides = [];
      if (!['showdown', 'result'].includes(m.phase)) {
        const guide = el('p', 'role-guide');
        guide.append(el('span', '', '強い順：ストレートフラッシュ＞フォーカード＞フルハウス＞フラッシュ'), el('span', '', '＞ストレート＞スリーカード＞ツーペア＞ワンペア'));
        guides.push(guide);
      }
      const seats = el('div', 'seats');
      m.seats.forEach((s, i) => {
        const positions = [[28, 17], [72, 17], [90, 32], [90, 73], [72, 81], [28, 81], [10, 73], [10, 32]], pos = positions[i * 8 / m.seats.length | 0] ?? [50, 50];
        const node = el('article', 'seat');
        node.dataset.id = String(s.id);
        node.dataset.active = String(m.phase === 'turn' && s.id === m.turn);
        node.dataset.winner = String(m.winners.includes(s.id) && m.phase === 'showdown');
        node.dataset.folded = String(s.folded);
        node.style.left = `${pos[0]}%`;
        node.style.top = `${pos[1]}%`;
        const who = el('div', 'who');
        if (s.cpu)
          who.append(shape('robot', 'M18 2H22V8H33V13H38V32H33V37H7V32H2V13H7V8H18ZM10 16V22H16V16ZM24 16V22H30V16ZM12 28V31H28V28Z'));
        else if (typeof s.id === 'number') {
          const look = looks.get(s.id);
          if (look) {
            const mark = shape('mark', look.path, '0 0 24 24');
            mark.style.color = look.color;
            who.append(mark);
          }
        }
        who.append(el('span', 'name', short(s.name, 12)));
        if (m.phase === 'showdown' && m.winners.includes(s.id)) who.append(el('span', 'winner-mark', '勝者'));
        if (s.id === m.dealer)
          who.append(el('span', 'dealer', '親'));
        node.append(who, el('div', 'points', `${s.points} 点`));
        const hand = el('div', 'hand');
        if (s.hand)
          for (const c of s.hand)
            hand.append(cardFace(c));
        else
          for (let j = 0; j < s.count; j++)
            hand.append(el('i', 'back'));
        const meta = m.phase === 'showdown' && s.received > 0 ? `＋${s.received}点`
          : s.left ? '退出しました' : s.points === 0 ? (!s.folded && s.count === 2 && !['showdown', 'result'].includes(m.phase) ? '勝負待ち' : '見るだけ')
          : s.folded ? 'おりた'
          : m.phase === 'showdown' ? (m.winners.includes(s.id) ? 'このハンドの勝者' : '勝負')
          : m.phase === 'result' ? '局が終わりました'
          : m.phase === 'turn' && s.id === m.turn ? '行動を選んでいます'
          : !s.online ? '接続待ち' : s.street ? `この周 ${s.street}点` : '待っています';
        node.append(hand, el('div', 'seat-meta', meta));
        if (s.role && m.phase === 'showdown')
          node.append(el('div', 'role', s.role));
        if (s.kicker && m.phase === 'showdown') node.append(el('div', 'kicker', `残りの札 ${s.kickerRank}`));
        seats.append(node);
      });
      table.append(center, seats);
      const footer = el('footer', 'foot'), events = el('ol', 'events');
      for (const e of m.events.slice(-4).reverse())
        events.append(el('li', '', eventText(m, e)));
      if (!m.events.length)
        events.append(el('li', '', 'お金・景品は使いません。持ち点はゲームの中だけ。'));
      footer.append(el('span', 'log-label', '卓の便り'), events);
      stage.replaceChildren(header, line, table, ...guides, footer);
      const next = `${m.phase}:${m.turn}:${m.events.at(-1)?.seq}`;
      if (scene !== next) {
        status.textContent = heading(m);
        scene = next;
      }
    },
    /** @param {boolean} value */
    hold(value) {
      held = value;
      stage.dataset.frozen = String(value);
    },
    /** @param {string} title @param {string} body */
    showMessage(title, body) {
      stage.replaceChildren(el('h1', 'title', title), el('p', '', body));
    },
    dispose() {
      motion?.removeEventListener?.('change', reflect);
    },
  };
}
