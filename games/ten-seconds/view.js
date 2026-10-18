// @ts-check
// 描画に渡すのは公開済みのモデルと席の見た目だけ。時計や回答状況は参照しない。

/** @typedef {import('./logic.js').GameViewModel} GameViewModel */
/** @typedef {import('./logic.js').RevealRow} RevealRow */
/** @typedef {import('./logic.js').Blocker} Blocker */
/** @typedef {import('./logic.js').SeatState} SeatState */
/** @typedef {import('./irori.js').PlayerId} PlayerId */
/** @typedef {import('./irori.js').Look} Look */

const BLOCKER_TEXT = {
  menu: 'メニューを閉じるのを待っています',
  'host-offline': '大画面の接続を待っています',
  hidden: '大画面に戻るのを待っています',
  'player-offline': 'つなぎ直しを待っています',
};

/** @param {keyof HTMLElementTagNameMap} tag @param {string} className @param {string} [text] */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 色と形を一緒に出す。色の値とpathはSDKの固定lookに由来する。 @param {Look | undefined} look */
function mark(look) {
  const box = element('span', 'seat-mark');
  if (!look) return box;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', look.label);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', look.path);
  path.setAttribute('fill', look.color);
  path.setAttribute('stroke', '#1a1411');
  path.setAttribute('stroke-width', '1');
  svg.append(path);
  box.append(svg);
  return box;
}

/** @param {SeatState} seat @param {ReadonlyMap<PlayerId, Look>} looks */
function who(seat, looks) {
  const box = element('span', 'who');
  box.append(mark(looks.get(seat.id)), element('span', 'name', seat.name));
  if (seat.left) box.append(element('span', 'seat-state', '退出'));
  else if (!seat.online) box.append(element('span', 'seat-state', '接続待ち'));
  return box;
}

/** @param {GameViewModel} model */
function leaderName(model) {
  return model.participants.find((p) => p.id === model.leader)?.name
    ?? model.waitingPlayers.find((p) => p.id === model.leader)?.name;
}

/** @param {GameViewModel} model @param {string} label */
function leaderGuide(model, label) {
  const name = leaderName(model);
  return `${name ? `${name}さん` : '進行役'}のスマホで「${label}」`;
}

/** @param {GameViewModel} model */
function progressGuide(model) {
  if (model.blockers.length) return model.blockers.map((b) => BLOCKER_TEXT[b]).join('。');
  switch (model.phase) {
    case 'intro':
      return model.canBegin ? leaderGuide(model, 'はじめる')
        : model.neededPlayers > 0 ? `あと${model.neededPlayers}人で遊べます` : 'みんながそろうのを待っています';
    case 'countdown': return '「せーの」が出たら、心の中で数えよう';
    case 'counting': return '10秒だと思ったら、手元で1回押そう';
    case 'reveal': return model.canContinue ? leaderGuide(model, model.actionLabel) : '進行役が戻るのを待っています';
    case 'recover': return model.canRetry ? leaderGuide(model, model.actionLabel) : model.message;
    case 'ended': return model.outcome === 'incomplete' ? '人数が足りないため、今回は勝敗なし' : '総合結果を大画面で見よう';
  }
}

/** @param {RevealRow} row @param {SeatState} seat @param {ReadonlyMap<PlayerId, Look>} looks */
function resultRow(row, seat, looks) {
  const node = element('li', 'result-row');
  node.dataset.seat = String(row.p);
  node.dataset.rank = String(row.rank ?? '');
  node.append(element('span', 'rank', row.rank === null ? '—' : `${row.rank}位`), who(seat, looks));
  const record = row.record;
  const value = element('span', 'record');
  const delta = element('span', 'delta');
  if (record?.kind === 'stopped') {
    value.textContent = `${(record.tenths / 10).toFixed(1)}秒`;
    delta.textContent = record.deltaTenths === 0 ? 'ぴったり！'
      : `${(Math.abs(record.deltaTenths) / 10).toFixed(1)}秒 ${record.deltaTenths < 0 ? '早かった' : '遅かった'}`;
  } else if (record?.kind === 'timeout') {
    value.textContent = '時間切れ';
    value.classList.add('record--timeout');
    delta.classList.add('delta--timeout');
    delta.append(element('span', 'delta-caption', '採点用のズレ'), element('span', '', '10.0秒'));
  } else {
    value.textContent = '未計測';
    value.classList.add('record--timeout');
    delta.textContent = '—';
  }
  const total = element('span', 'total', row.roundsCompleted ? `${(row.totalTenths / 10).toFixed(1)}秒` : '未計測');
  node.append(value, delta, total);
  return node;
}

/** @param {GameViewModel} model */
function announcement(model) {
  const round = `第${model.roundIndex + 1}回`;
  switch (model.phase) {
    case 'intro': return `せーので10秒。${model.instruction}。${progressGuide(model)}`;
    case 'countdown': return `${round}。せーのが出たら、数えよう`;
    case 'counting': return `${round}、せーの`;
    case 'reveal': return `${round}の結果発表`;
    case 'recover': return `この回はやり直し。ここまでの記録はそのまま。${progressGuide(model)}`;
    case 'ended': return model.outcome === 'incomplete' ? '人数が足りないため、今回は勝敗なし' : '総合結果';
  }
}

/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage, status) {
  let previous = '';
  let said = '';

  /** @param {string} text */
  function say(text) {
    if (said === text) return;
    said = text;
    status.textContent = text;
  }

  /** @param {GameViewModel} model @param {ReadonlyMap<PlayerId, Look>} looks */
  function render(model, looks) {
    const key = JSON.stringify(model);
    if (key === previous) return;
    previous = key;
    document.documentElement.dataset.phase = model.phase;
    document.documentElement.dataset.round = String(model.roundIndex + 1);
    stage.className = `game game--${model.phase}`;
    const header = element('header', 'topbar');
    header.append(element('p', 'brand', model.phase === 'intro' ? '2〜8人 · 3回勝負' : 'せーので10秒'));
    if (model.phase !== 'intro') header.append(element('p', 'round', `第${model.roundIndex + 1}回 / 全3回`));
    const scene = element('section', `scene scene--${model.phase}`);
    if (model.phase === 'intro') {
      const hero = element('div', 'hero');
      const copy = element('div', 'hero-copy');
      copy.append(element('h1', 'title', 'せーので10秒'), element('p', 'tagline', 'みんなの10秒、どのくらい違う？'), element('p', 'rule', model.instruction));
      const target = element('div', 'target');
      target.setAttribute('aria-hidden', 'true');
      target.append(element('span', 'target-number', '10'), element('span', 'target-unit', '秒'));
      hero.append(copy, target);
      const people = element('ul', 'people');
      people.setAttribute('aria-label', '参加者');
      for (const seat of model.participants) {
        const li = element('li', 'person');
        li.append(who(seat, looks));
        people.append(li);
      }
      scene.append(hero, people);
    } else if (model.phase === 'countdown' || model.phase === 'counting') {
      scene.append(element('h1', 'cue', model.cue));
    } else if (model.phase === 'reveal') {
      const labels = element('div', 'result-labels');
      labels.setAttribute('aria-hidden', 'true');
      for (const text of ['順位', 'プレイヤー', '今回の記録', '10秒との差', '累計ズレ']) labels.append(element('span', '', text));
      const rows = element('ol', 'results');
      rows.setAttribute('aria-label', `第${model.roundIndex + 1}回の結果。今回の順位、記録、10秒との差、累計ズレ`);
      const sorted = [...model.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.p - b.p);
      for (const row of sorted) {
        const seat = model.participants.find((p) => p.id === row.p);
        if (seat) rows.append(resultRow(row, seat, looks));
      }
      scene.append(labels, rows);
    } else if (model.phase === 'recover') {
      scene.append(element('p', 'eyebrow', 'ひと息ついて、もう一度'), element('h1', 'message-title', 'この回は、やり直し'), element('p', 'message-body', 'ここまでの記録はそのまま'));
      if (model.blockers.length) {
        const reasons = element('ul', 'reasons');
        for (const blocker of model.blockers) reasons.append(element('li', '', BLOCKER_TEXT[blocker]));
        scene.append(reasons);
      }
    } else {
      scene.append(element('h1', 'message-title', model.outcome === 'incomplete' ? '今回は、勝敗なし' : '総合結果'), element('p', 'message-body', 'みんなの記録を、大画面で見よう'));
    }
    const footer = element('footer', 'footer');
    footer.append(element('p', 'progress-guide', progressGuide(model)));
    const meta = element('div', 'footer-meta');
    meta.append(element('p', 'precision-note', model.precisionNote));
    if (model.waitingPlayers.length) meta.append(element('p', 'late-join', `あとから来た${model.waitingPlayers.length}人は、次の勝負から参加できます`));
    footer.append(meta);
    stage.replaceChildren(header, scene, footer);
    say(announcement(model));
  }

  /** @param {string} title @param {string} body */
  function showMessage(title, body) {
    previous = '';
    stage.className = 'game game--message';
    const scene = element('section', 'scene scene--message');
    scene.append(element('h1', 'message-title', title), element('p', 'message-body', body));
    stage.replaceChildren(scene);
    say(`${title}。${body}`);
  }

  return {
    render,
    showMessage,
    dispose() { previous = ''; said = ''; },
  };
}
