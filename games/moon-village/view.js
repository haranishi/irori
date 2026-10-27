// @ts-check
/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {Model['seats'][number]} PublicSeat */

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
const TITLES = {intro:'月夜の村', reveal:'スマホで自分の役を確認', night:'夜です', dawn:'夜が明けました', day:'顔を合わせて、話そう', vote:'スマホで投票', exec:'村の決定', ended:'村の物語は、おしまい'};
const ROLES = {wolf:'人狼', seer:'占い師', knight:'騎士', madman:'狂人', villager:'村人'};

/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage, status) {
  const top = element('header', 'topbar');
  const edition = element('p', 'edition');
  top.append(element('p', 'brand', 'IRORI / MOONLIT VILLAGE'), edition);
  const content = element('section', 'content');
  const title = element('h1', 'title');
  const copy = element('p', 'copy');
  const scene = element('div', 'scene');
  scene.setAttribute('aria-hidden', 'true');
  scene.append(element('div', 'orb'), element('div', 'hills'));
  const rules = element('ol', 'rules');
  for (const line of ['スマホで自分の役を見て、かくす', '夜は全員、相手を1人選んで決定', '昼は話し合い、スマホで投票']) rules.append(element('li', 'rule', line));
  const clock = element('div', 'clock');
  clock.setAttribute('role', 'timer');
  clock.setAttribute('aria-live', 'off');
  const time = element('strong', 'clock-time');
  const extension = element('p', 'extension');
  clock.append(time, element('span', 'clock-label', '話し合いの残り時間'), extension);
  const progress = element('section', 'progress');
  const count = element('p', 'decided');
  const lights = element('div', 'anonymous-lights');
  lights.setAttribute('aria-hidden', 'true');
  const ballot = element('div', 'ballot-box');
  ballot.setAttribute('aria-hidden', 'true');
  const fill = element('div', 'ballot-fill');
  ballot.append(fill);
  progress.append(count, lights, ballot);
  const roster = element('ul', 'village');
  roster.setAttribute('aria-label', '村のみんな');
  const votes = element('section', 'votes');
  const action = document.createElement('button');
  action.className = 'continue';
  action.type = 'button';
  action.dataset.action = 'day';
  action.textContent = '昼へ';
  const guide = element('p', 'guide');
  const suspension = element('p', 'suspension', '時計を止めています。接続・表示・メニューを戻し、進行役のスマホで再開してください。');
  content.append(title, copy, scene, rules, clock, progress, roster, votes, action, guide, suspension);
  stage.className = 'game';
  stage.replaceChildren(top, content);
  /** @type {Map<number, {node:HTMLElement, key:string}>} */
  const seats = new Map();
  let voteKey = '';
  let progressKey = '';
  let announcement = '';

  /** @param {Model} model */
  function render(model) {
    const phase = model.phase;
    if (document.documentElement.dataset.phase !== phase) document.documentElement.dataset.phase = phase;
    text(edition, model.day ? `${model.day}日目` : '4〜8人 / 顔を合わせて遊ぶ');
    // Derive the final side only from the fully revealed public roles and living seats.
    const roles = phase === 'ended' ? model.reveal : null;
    const wolves = roles?.filter((r)=>r.role === 'wolf' && model.seats.some((s)=>s.id === r.id && s.alive && !s.left)).length ?? 0;
    const living = model.seats.filter((s)=>s.alive && !s.left).length;
    const winner = roles && model.outcome === 'complete' ? (wolves === 0 ? 'village' : wolves >= living-wolves ? 'wolf' : null) : null;
    const headline = phase === 'ended' ? model.outcome === 'incomplete' ? '今回は、勝敗なし' : winner === 'wolf' ? '人狼側の勝ち' : winner === 'village' ? '村人側の勝ち' : TITLES.ended : TITLES[phase];
    text(title, headline);
    text(copy, phase === 'intro' ? 'ひとつの村を囲んで、言葉を交わそう。' : model.announce);
    hide(rules, phase !== 'intro');
    hide(scene, phase === 'day' || phase === 'vote');
    hide(clock, phase !== 'day');
    if (phase === 'day' && model.timer) {
      const seconds = Math.ceil(model.timer.remaining/1000);
      text(time, `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2, '0')}`);
      clock.style.setProperty('--remaining', String(Math.max(0, Math.min(1, model.timer.remaining/model.timer.total))));
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
      }
    }
    hide(lights, phase !== 'night');
    hide(ballot, phase !== 'vote');
    // No named light can become a proxy for a secret night action.
    hide(roster, phase === 'night');
    const ids = new Set(model.seats.map((s)=>s.id));
    for (const [id, entry] of seats) if (!ids.has(id)) {entry.node.remove(); seats.delete(id);}
    for (const seat of model.seats) {
      const role = roles?.find((r)=>r.id === seat.id)?.role ?? null;
      const side = role === 'wolf' || role === 'madman' ? 'wolf' : 'village';
      const won = role !== null && winner === side && !seat.left;
      const key = JSON.stringify([seat, role, won]);
      let entry = seats.get(seat.id);
      if (!entry) {entry = {node:element('li', 'resident'), key:''}; seats.set(seat.id, entry); roster.append(entry.node);}
      if (entry.key === key) continue;
      entry.key = key;
      entry.node.className = `resident${!seat.alive || seat.left ? ' resident--out' : ''}${won ? ' resident--winner' : ''}`;
      const lamp = element('span', 'resident-lamp');
      lamp.setAttribute('aria-hidden', 'true');
      entry.node.replaceChildren(lamp, element('strong', 'resident-name', seat.name), element('span', 'resident-state', seat.left ? '退出' : !seat.alive ? '脱落' : !seat.online ? '接続待ち' : '生存'));
      if (roles) entry.node.append(element('span', 'role-card', role ? `${ROLES[role]}${won ? ' / 勝ち' : ''}` : '未配役'));
    }
    hide(votes, !model.votes || !['vote', 'exec', 'ended'].includes(phase));
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
        votes.append(arrows);
        for (const seat of model.seats) {
          const n = model.votes.filter((v)=>v.to === seat.id).length;
          if (!n) continue;
          const row = element('p', 'vote-tally', `${seat.name} ${n}票`);
          row.style.setProperty('--votes', String(n/Math.max(1, model.votes.length)));
          votes.append(row);
        }
      }
    }
    hide(action, phase !== 'dawn');
    const leader = model.seats.find((s)=>s.id === model.leader)?.name ?? '進行役';
    const hint = phase === 'intro' ? model.canBegin ? `${leader}さんのスマホで「はじめる」` : '4〜8人と接続がそろうのを待っています' : phase === 'reveal' ? '自分だけで確認して「かくす」を押してください' : phase === 'night' ? '決定した人の名前と選択は、ここには表示されません' : phase === 'day' ? `${leader}さんのスマホで「投票へ」` : phase === 'dawn' ? '発表を読んだら、大画面の「昼へ」' : phase === 'vote' ? '全員が決めると、投票先を公開します' : phase === 'exec' ? `${leader}さんのスマホで「次の夜へ」` : '結果画面の「もう一度」で、新しい村へ';
    text(guide, hint);
    const say = `${headline}。${model.announce}。${hint}`;
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
