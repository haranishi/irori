// @ts-check
/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {Model['seats'][number]} PublicSeat */
/** @typedef {{assist?: boolean}} RenderOptions */

/** @param {string} tag @param {string} className @param {string} [text] */
function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
/** @param {HTMLElement} node @param {string} value */
function text(node, value) { if (node.textContent !== value) node.textContent = value; }
/** @param {HTMLElement} node @param {boolean} value */
function hide(node, value) { if (node.hidden !== value) node.hidden = value; }
const ROLES = {wolf:'人狼', seer:'占い師', knight:'騎士', madman:'狂人', villager:'村人'};

/**
 * 段階ごとの見出し。大事な知らせ（襲撃・処刑・勝敗）を一番大きな文字にし、同じ意味の文を二度出さない。
 * @param {Model} model @param {'village'|'wolf'|null} winner @param {boolean} runoff
 */
function words(model, winner, runoff) {
  const {phase, announce} = model;
  if (phase === 'intro') return {kicker:'', title:'月あかりの寄り合い', copy:'ひとつの村を囲んで、言葉を交わそう。'};
  if (phase === 'reveal') return {kicker:'役の確認', title:'スマホで自分の役を確認', copy:''};
  if (phase === 'night') {
    const [first = announce, ...rest] = announce.split('。');
    return {kicker:'', title:first, copy:rest.join('。')};
  }
  if (phase === 'dawn') return {kicker:'夜が明けました', title:announce, copy:''};
  if (phase === 'day') return {kicker:'昼', title:'顔を合わせて、話そう', copy:''};
  if (phase === 'vote') return runoff ? {kicker:'決選投票', title:announce, copy:'同数の人だけが候補です'} : {kicker:'投票', title:'スマホで投票', copy:''};
  if (phase === 'exec') return {kicker:'村の決定', title:announce, copy:''};
  const title = model.outcome === 'incomplete' ? '今回は、勝敗なし' : winner === 'wolf' ? '人狼側の勝ち' : winner === 'village' ? '村人側の勝ち' : '村の物語は、おしまい';
  return {kicker:'勝負あり', title, copy:announce};
}

/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage, status) {
  const top = element('header', 'topbar');
  const edition = element('p', 'edition');
  top.append(element('p', 'brand', 'IRORI / NIGHT AT HEARTH VILLAGE'), edition);
  const content = element('section', 'content');
  const heading = element('div', 'heading');
  const kicker = element('p', 'kicker');
  const title = element('h1', 'title');
  const copy = element('p', 'copy');
  heading.append(kicker, title, copy);
  // 空と村は飾り。夜だけ、家の窓（決定の数の灯）を並べる。窓と席は対応させない。
  const scene = element('div', 'scene');
  scene.setAttribute('aria-hidden', 'true');
  const lights = element('div', 'anonymous-lights');
  lights.setAttribute('aria-hidden', 'true');
  scene.append(element('div', 'stars'), element('div', 'orb'), element('div', 'hills'), lights);
  const rules = element('ol', 'rules');
  for (const line of ['スマホで自分の役を見て、かくす', '夜は全員、相手を1人選んで決定', '昼は話し合い、スマホで投票']) rules.append(element('li', 'rule', line));
  const clock = element('div', 'clock');
  clock.setAttribute('role', 'timer');
  clock.setAttribute('aria-live', 'off');
  const time = element('strong', 'clock-time');
  const label = element('span', 'clock-label', '話し合いの残り時間');
  const extension = element('p', 'extension');
  clock.append(time, label, extension);
  const progress = element('section', 'progress');
  const count = element('p', 'decided');
  const ballot = element('div', 'ballot-box');
  ballot.setAttribute('aria-hidden', 'true');
  const fill = element('div', 'ballot-fill');
  const paper = element('div', 'ballot-paper');
  ballot.append(fill, paper);
  progress.append(ballot, count);
  const roster = element('ul', 'village');
  roster.setAttribute('aria-label', '村のみんな');
  const votes = element('section', 'votes');
  const action = document.createElement('button');
  action.className = 'continue';
  action.type = 'button';
  action.dataset.action = 'day';
  action.textContent = 'つづける';
  const footer = element('div', 'footer');
  const guide = element('p', 'guide');
  footer.append(guide, action);
  const suspension = element('p', 'suspension', '時計を止めています。接続・表示・メニューを戻し、進行役のスマホで再開してください。');
  // 票箱と公開票は同じ段に置き、広い画面では横に並べる。
  const board = element('div', 'board');
  board.append(progress, votes);
  content.append(heading, scene, rules, clock, board, roster, footer, suspension);
  stage.className = 'game';
  stage.replaceChildren(top, content);
  /** @type {Map<number, {node:HTMLElement, key:string, alive:boolean}>} */
  const seats = new Map();
  let voteKey = '';
  let progressKey = '';
  let announcement = '';
  let shownPhase = '';
  let lastCount = -1;

  /** @param {Model} model @param {RenderOptions} [options] */
  function render(model, options = {}) {
    const phase = model.phase;
    if (document.documentElement.dataset.phase !== phase) document.documentElement.dataset.phase = phase;
    if (shownPhase !== phase) {
      // 段階が替わったときだけ、見出しを短く出し直す（動きを減らす設定ではフェードだけ）。
      shownPhase = phase;
      content.classList.remove('content--enter');
      void content.offsetWidth;
      content.classList.add('content--enter');
    }
    text(edition, model.day ? `${model.day}日目` : '4〜8人 / 顔を合わせて遊ぶ');
    // Derive the final side only from the fully revealed public roles and living seats.
    const roles = phase === 'ended' ? model.reveal : null;
    const wolves = roles?.filter((r)=>r.role === 'wolf' && model.seats.some((s)=>s.id === r.id && s.alive && !s.left)).length ?? 0;
    const living = model.seats.filter((s)=>s.alive && !s.left).length;
    const winner = roles && model.outcome === 'complete' ? (wolves === 0 ? 'village' : wolves >= living-wolves ? 'wolf' : null) : null;
    const runoff = phase === 'vote' && model.votes !== null;
    const head = words(model, winner, runoff);
    text(kicker, head.kicker);
    hide(kicker, !head.kicker);
    text(title, head.title);
    text(copy, head.copy);
    hide(copy, !head.copy);
    // 襲撃・処刑・勝敗は、遠くからでも読める大きさにする。
    heading.dataset.tone = phase === 'dawn' || phase === 'exec' || phase === 'ended' ? 'news' : 'plain';
    hide(rules, phase !== 'intro');
    hide(scene, !['intro', 'reveal', 'night', 'dawn'].includes(phase));
    hide(clock, phase !== 'day');
    if (phase === 'day' && model.timer) {
      const seconds = Math.ceil(model.timer.remaining/1000);
      text(time, `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2, '0')}`);
      clock.style.setProperty('--remaining', String(Math.max(0, Math.min(1, model.timer.remaining/model.timer.total))));
      // 残りが少ないことを、色だけでなく文と動きでも伝える。
      const low = seconds <= 30;
      clock.classList.toggle('clock--low', low);
      text(label, low ? 'まもなく投票' : '話し合いの残り時間');
      const extra = Math.max(0, Math.round((model.timer.total-180000)/60000));
      text(extension, extra ? `延長 ＋${extra}分` : '進行役のスマホで ＋1分');
    }
    hide(progress, !model.decided);
    if (model.decided) {
      const decided = model.decided;
      const key = `${phase}:${decided.count}/${decided.total}`;
      if (key !== progressKey) {
        progressKey = key;
        text(count, `${decided.count} / ${decided.total}人が決定`);
        // Anonymous order has no relation to seats, names, or actual completion order.
        lights.replaceChildren(...Array.from({length:decided.total}, (_, i)=>element('span', `anonymous-light${i < decided.count ? ' anonymous-light--out' : ''}`)));
        fill.style.setProperty('--fill', String(decided.count/Math.max(1, decided.total)));
        // 票が1枚増えたら、紙を1枚落とす。
        if (phase === 'vote' && decided.count > lastCount && lastCount >= 0) {
          paper.classList.remove('ballot-paper--drop');
          void paper.offsetWidth;
          paper.classList.add('ballot-paper--drop');
        }
        lastCount = phase === 'vote' ? decided.count : -1;
      }
    } else lastCount = -1;
    hide(lights, phase !== 'night');
    hide(ballot, phase !== 'vote');
    // No named light can become a proxy for a secret night action.
    hide(roster, phase === 'night');
    const ids = new Set(model.seats.map((s)=>s.id));
    for (const [id, entry] of seats) if (!ids.has(id)) {entry.node.remove(); seats.delete(id);}
    roster.style.setProperty('--n', String(model.seats.length));
    roster.style.setProperty('--half', String(Math.ceil(model.seats.length/2)));
    model.seats.forEach((seat, index)=>{
      const role = roles?.find((r)=>r.id === seat.id)?.role ?? null;
      const side = role === 'wolf' || role === 'madman' ? 'wolf' : 'village';
      const won = role !== null && winner === side && !seat.left;
      const key = JSON.stringify([seat, role, won]);
      let entry = seats.get(seat.id);
      if (!entry) {entry = {node:element('li', 'resident'), key:'', alive:seat.alive && !seat.left}; seats.set(seat.id, entry); roster.append(entry.node);}
      if (entry.key === key) return;
      const out = !seat.alive || seat.left;
      // 生きていた灯が消えた瞬間だけ、ゆらいで消える演出を付ける（襲撃・処刑・退出）。
      const fading = entry.key !== '' && entry.alive && out;
      entry.key = key;
      entry.alive = !out;
      entry.node.className = `resident${out ? ' resident--out' : ''}${fading ? ' resident--fading' : ''}${won ? ' resident--winner' : ''}${roles && !won ? ' resident--lost' : ''}`;
      entry.node.style.setProperty('--order', String(index));
      const lamp = element('span', 'resident-lamp');
      lamp.setAttribute('aria-hidden', 'true');
      const info = element('span', 'resident-info');
      info.append(element('strong', 'resident-name', seat.name), element('span', 'resident-state', seat.left ? '退出' : !seat.alive ? '脱落' : !seat.online ? '接続待ち' : '生存'));
      entry.node.replaceChildren(lamp, info);
      if (roles) entry.node.append(element('span', 'role-card', role ? `${ROLES[role]}${won ? ' ★勝ち' : ''}` : '未配役'));
    });
    // 終了の画面は役の表が主役なので、最後の公開票は出さない。
    hide(votes, !model.votes || !['vote', 'exec'].includes(phase));
    hide(board, progress.hidden === true && votes.hidden === true);
    const nextVoteKey = JSON.stringify([model.votes, model.seats.map((s)=>[s.id, s.name])]);
    if (nextVoteKey !== voteKey) {
      voteKey = nextVoteKey;
      votes.replaceChildren();
      if (model.votes) {
        votes.append(element('h2', 'votes-title', '公開された投票'));
        const name = (/** @type {number} */ id)=>model.seats.find((s)=>s.id === id)?.name ?? '退出した人';
        const arrows = element('ul', 'vote-arrows');
        model.votes.forEach((vote, index)=>{
          const row = element('li', 'vote-arrow', `${name(vote.from)} → ${vote.to === null ? '棄権' : name(vote.to)}`);
          row.style.setProperty('--order', String(index));
          arrows.append(row);
        });
        const tallies = element('div', 'vote-tallies');
        tallies.style.setProperty('--after', String(model.votes.length));
        const counted = model.seats.map((seat)=>({seat, n:model.votes?.filter((v)=>v.to === seat.id).length ?? 0})).filter((t)=>t.n).sort((a, b)=>b.n-a.n);
        for (const {seat, n} of counted) {
          const row = element('p', 'vote-tally', `${seat.name} ${n}票`);
          row.style.setProperty('--votes', String(n/Math.max(1, model.votes.length)));
          tallies.append(row);
        }
        votes.append(arrows, tallies);
      }
    }
    // 大画面のボタンは、仮想プレイヤーで試すときの補助。本物のホストではリーダーのスマホで進める。
    hide(action, !options.assist || (phase !== 'dawn' && phase !== 'exec'));
    const leader = model.seats.find((s)=>s.id === model.leader)?.name ?? '進行役';
    const hint = phase === 'intro' ? model.canBegin ? `${leader}さんのスマホで「はじめる」` : '4〜8人と接続がそろうのを待っています'
      : phase === 'reveal' ? '自分だけで確認して「かくす」を押してください'
      : phase === 'night' ? '灯が1つ消えるごとに、1人が決めました。名前は出しません'
      : phase === 'day' ? `${leader}さんのスマホで「投票へ」`
      : phase === 'dawn' || phase === 'exec' ? `${leader}さんのスマホで「つづける」`
      : phase === 'vote' ? '全員が決めると、投票先を公開します'
      : 'まもなく結果へ。「もう一度」で新しい村へ';
    text(guide, hint);
    const say = [head.kicker, head.title, head.copy, hint].filter(Boolean).join('。');
    if (say !== announcement) {announcement = say; text(status, say);}
  }
  /** @param {string} heading @param {string} body @param {'unsupported'|'error'} phase */
  function showMessage(heading, body, phase) {
    document.documentElement.dataset.phase = phase;
    stage.className = 'game game--message';
    stage.replaceChildren(element('h1', 'title', heading), element('p', 'copy', body));
    text(status, `${heading}。${body}`);
  }
  return {render, showMessage, dispose(){seats.clear();}};
}
