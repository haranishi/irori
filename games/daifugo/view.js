// @ts-check
/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {import('./irori.js').Look} Look */
/** @typedef {Model['seats'][number]} Seat */
/** @typedef {Model['events'][number]} PublicEvent */

/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [value] */
function element(tag,cls,value) {
  const node=document.createElement(tag);
  node.className=cls;
  if (value !== undefined) node.textContent=value;
  return node;
}
/** @param {HTMLElement} node @param {string} value */
function text(node,value) {if (node.textContent !== value) node.textContent=value;}
/** @param {HTMLElement} node @param {Look|undefined} look */
function mark(node,look) {
  const key=JSON.stringify(look);
  if (node.dataset.look === key) return;
  node.dataset.look=key;
  if (!look) {node.replaceChildren();return;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('role','img');svg.setAttribute('aria-label',look.label);
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',look.path);path.setAttribute('fill',look.color);
  svg.append(path);node.replaceChildren(svg);
}
/** @param {string} id */
function card(id) {
  const joker=id.startsWith('jk');
  const suits=/** @type {Record<string,string>} */ ({s:'♠',h:'♥',d:'♦',c:'♣'});
  const suit=suits[id[0] ?? ''] ?? '';
  const rank=id.slice(1).toUpperCase();
  const node=element('div',`playing-card${id[0] === 'h' || id[0] === 'd' ? ' playing-card--red' : ''}${joker ? ' playing-card--joker' : ''}`);
  node.setAttribute('role','img');node.setAttribute('aria-label',joker ? `ジョーカー${id.slice(2)}` : `${suit}${rank}`);
  const corner=element('span','card-corner',joker ? '灯' : `${suit}${rank}`);
  const center=element('span','card-center',joker ? '' : suit);
  corner.setAttribute('aria-hidden','true');center.setAttribute('aria-hidden','true');
  if (joker) {
    // 灯の輪郭はこの画面用の自作図形。札の数や柄を画像素材から借りない。
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 48 64');svg.setAttribute('aria-hidden','true');
    const flame=document.createElementNS('http://www.w3.org/2000/svg','path');
    flame.setAttribute('d','M25 3C31 18 40 19 40 36C40 49 33 58 24 58C13 58 7 49 8 38C9 29 17 25 17 16C22 20 24 24 24 29C29 22 30 14 25 3Z');
    flame.setAttribute('fill','currentColor');svg.append(flame);center.append(svg);
  }
  const caption=element('span','card-value',joker ? 'JOKER' : rank);caption.setAttribute('aria-hidden','true');
  node.append(corner,center,caption);return node;
}
function seatParts() {
  const node=element('li','seat');
  const head=element('div','seat-head');
  const symbol=element('span','seat-mark');const name=element('h3','seat-name');
  head.append(symbol,name);
  const count=element('p','seat-count');
  const flag=element('p','turn-flag','いまの番');
  const note=element('p','seat-note');
  const rank=element('p','rank-badge');
  node.append(head,count,flag,note,rank);
  return {node,symbol,name,count,flag,note,rank,key:''};
}
/** @param {Model} model */
function guide(model) {
  if (model.phase === 'intro') {
    if (model.seats.length<3 || model.seats.length>8) return '3〜8人そろうと遊べます';
    if (model.seats.some((seat)=>!seat.online)) return 'スマホのつなぎ直しを待っています';
    const leader=model.seats.find((seat)=>seat.id === model.leader);
    return model.canBegin && leader ? `${leader.name}さんのスマホで「はじめる」` : '接続と再開を待っています';
  }
  if (model.phase === 'ended') return model.outcome === 'incomplete' ? '順位を付けられる人が足りないため、今回は勝敗なし。' : '結果の「もう一度」で、新しい配札から遊べます。';
  const turn=model.seats.find((seat)=>seat.id === model.turn);
  if (!turn?.online) return '番の人のスマホが戻るまで、札を保って待っています';
  return model.table ? '同じ枚数で、場より強く。出さないときはスマホで「パス」。' : '先に出す · スマホで同じ数を1〜4枚選び、「出す」。';
}
/** @param {PublicEvent} event @param {Model} model */
function eventText(event,model) {
  const name=model.seats.find((seat)=>seat.id === event.p)?.name ?? '参加者';
  if (event.type === 'sweep') return event.reason === 'eight' ? '8切り！' : '場を流しました';
  if (event.type === 'revolution') return event.revolution ? '革命！' : '革命が戻りました！';
  if (event.type === 'finish') {
    const seat=model.seats.find((item)=>item.id === event.p);
    return seat?.count === 0 ? `${name}さん、${event.rank}位で上がり！` : 'みんなの順位が決まりました';
  }
  return event.type === 'pass' ? `${name}さんはパス` : `${name}さんが${event.cards?.length ?? 0}枚出しました`;
}

/** 公開モデルだけを描く。手札・判定状態・pad指定を受け取らない。
 * @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage,status) {
  const header=element('header','topbar');
  const title=element('h1','title','大富豪');
  const edition=element('p','edition');
  header.append(element('p','brand','IRORI / DAIFUGO'),title,edition);
  const intro=element('section','intro');
  intro.append(element('h2','intro-title','手札を先に、出し切ろう。'),element('p','intro-copy','札は手元に。読み合いは、みんなで。'));
  const rules=element('ol','rules');
  for (const copy of ['同じ数を1〜4枚。場と同じ枚数で、より強い札を出す。','8を出せば場が流れ、もう一度。4枚出すと革命で強さが逆に。','手札を出し切った順に上がり。パスしても次の番は出せる。']) rules.append(element('li','rule',copy));
  intro.append(rules);
  const round=element('section','round');
  const turnHeading=element('h2','turn-heading');
  const order=element('p','strength-order');
  const table=element('section','table-area');table.setAttribute('aria-label','場に出た札');
  const tableCaption=element('h3','table-caption');
  let trail=element('div','table-trail');trail.setAttribute('aria-hidden','true');
  const cards=element('div','table-cards');
  const empty=element('p','table-empty','先に出す');
  const banner=element('p','event-banner');
  table.append(tableCaption,trail,cards,empty,banner);round.append(turnHeading,order,table);
  const seatsArea=element('section','seats-area');seatsArea.setAttribute('aria-label','みんなの残り枚数と順位');
  const seats=element('ol','seat-list');
  const ring=element('div','turn-ring');ring.setAttribute('aria-hidden','true');ring.hidden=true;
  seatsArea.append(seats,ring);
  const footer=element('footer','guide');
  const nextAction=element('p','next-action');
  footer.append(nextAction,element('p','privacy-note','手札は自分のスマホだけに表示 · 時間制限なし'));
  stage.className='game';stage.replaceChildren(header,intro,round,seatsArea,footer);
  /** @type {Map<number,ReturnType<typeof seatParts>>} */
  const rows=new Map();
  let previous='';let tableKey='';let lastSeq=0;let disposed=false;
  /** @type {string[]} */
  let previousCards=[];
  /** @type {HTMLElement|null} */
  let currentSeat=null;
  function positionRing() {
    if (!currentSeat || disposed) {ring.hidden=true;return;}
    const area=seatsArea.getBoundingClientRect();const seat=currentSeat.getBoundingClientRect();
    ring.hidden=false;ring.style.width=`${seat.width}px`;ring.style.height=`${seat.height}px`;
    ring.style.transform=`translate(${seat.left-area.left}px,${seat.top-area.top}px)`;
  }
  const observer=typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionRing);
  observer?.observe(seatsArea);addEventListener('resize',positionRing);
  /** @param {Model} model @param {ReadonlyMap<number,Look>} [looks] */
  function render(model,looks=new Map()) {
    const key=JSON.stringify([model,[...looks]]);
    if (disposed || previous === key) return;
    previous=key;document.documentElement.dataset.phase=model.phase;
    stage.dataset.revolution=String(model.revolution);
    stage.className=`game game--${model.phase}`;
    intro.hidden=model.phase !== 'intro';round.hidden=model.phase === 'intro';
    text(edition,model.phase === 'intro' ? '3〜8人 · 54枚の読み合い' : model.phase === 'ended' ? '勝負の結果' : '手札は、手元に');
    const turn=model.seats.find((seat)=>seat.id === model.turn);
    text(turnHeading,model.phase === 'ended' ? model.outcome === 'incomplete' ? '今回は、勝敗なし' : '勝負がつきました' : turn ? `${turn.name}さんの番` : '次の番を待っています');
    text(order,model.revolution ? '↶ 革命中 · 弱い 2 → 3 強い · ジョーカーは最強' : '通常 · 弱い 3 → 2 強い · ジョーカーは最強');
    const by=model.seats.find((seat)=>seat.id === model.table?.by);
    text(tableCaption,model.table ? `${by?.name ?? '参加者'}さんが出した${model.table.n}枚` : '場は空です');
    const fresh=model.events.filter((event)=>event.seq>lastSeq);
    const cutCards=!model.table && fresh.some((event)=>event.type === 'sweep')
      ? fresh.filter((event)=>event.type === 'play').at(-1)?.cards : undefined;
    const nextTable=JSON.stringify(model.table?.cards ?? []);
    if (nextTable !== tableKey || cutCards) {
      tableKey=nextTable;
      // 8切りは一手の中で場が空になるため、同じ公開イベントの出札を掃く。
      const nextTrail=element('div',`table-trail${model.table ? ' table-trail--fading' : ' table-trail--swept'}`);
      nextTrail.setAttribute('aria-hidden','true');nextTrail.append(...(cutCards ?? previousCards).map(card));
      trail.replaceWith(nextTrail);trail=nextTrail;
      previousCards=[...(model.table?.cards ?? [])];
      cards.replaceChildren(...previousCards.map(card));
    }
    empty.hidden=!!model.table;
    table.hidden=model.phase === 'ended';
    if (fresh.length) {
      lastSeq=Math.max(...fresh.map((event)=>event.seq));
      const important=fresh.find((event)=>event.type === 'revolution') ?? fresh.find((event)=>event.type === 'sweep') ?? fresh.find((event)=>event.type === 'finish') ?? fresh.at(-1);
      if (important) {
        // 新しい要素で同じ種類の出来事にも短い反応を出す。過去ログは再生しない。
        const label=element('span','event-label',eventText(important,model));
        banner.replaceChildren(label);banner.dataset.event=important.type;
        if (fresh.some((event)=>event.type === 'sweep' && event.reason === 'eight') && important.type === 'revolution') banner.append(element('span','event-detail','8切り！'));
      }
    }
    const ids=new Set(model.seats.map((seat)=>seat.id));
    seats.dataset.count=String(model.seats.length);
    for (const [id,row] of rows) if (!ids.has(id)) {row.node.remove();rows.delete(id);}
    model.seats.forEach((seat,index)=>{
      let row=rows.get(seat.id);
      if (!row) {row=seatParts();rows.set(seat.id,row);}
      const isTurn=model.phase === 'play' && seat.id === model.turn && !seat.left;
      const finished=seat.rank !== null && !seat.left;
      const seatKey=JSON.stringify([seat,isTurn,model.phase,looks.get(seat.id)]);
      if (row.key !== seatKey) {
        row.key=seatKey;
        row.node.dataset.seat=String(seat.id);
        row.node.className=`seat${isTurn ? ' seat--turn' : ''}${finished ? ' seat--finished' : ''}${seat.left ? ' seat--left' : ''}${!seat.online ? ' seat--offline' : ''}${seat.rank !== null && seat.count>0 ? ' seat--last' : ''}`;
        if (isTurn) row.node.setAttribute('aria-current','step');else row.node.removeAttribute('aria-current');
        mark(row.symbol,looks.get(seat.id));text(row.name,seat.name);
        text(row.count,seat.left ? '退出' : model.phase === 'intro' ? '配札前' : finished && seat.count === 0 ? '出し切りました' : `残り ${seat.count}枚`);
        row.flag.hidden=!isTurn;
        text(row.note,seat.left ? 'この勝負はここまで' : !seat.online ? '接続待ち' : model.phase === 'intro' ? '開始を待っています' : seat.passed ? 'パス' : finished ? seat.count>0 ? '最後まで参加' : '上がり' : '手札は手元に');
        row.note.classList.toggle('seat-note--pass',seat.passed && !seat.left);
        const rankLabel=finished ? `${seat.rank}位${seat.rank === 1 ? ' · 大富豪' : ''}` : '';
        text(row.rank,rankLabel);row.rank.hidden=!finished;
      }
      // 同じ席のDOMを保持し、並びが実際に変わるときだけ移動する。
      if (seats.children[index] !== row.node) seats.insertBefore(row.node,seats.children[index] ?? null);
    });
    currentSeat=model.phase === 'play' && model.turn !== null ? rows.get(model.turn)?.node ?? null : null;
    positionRing();
    text(nextAction,guide(model));
    text(status,`${model.phase === 'intro' ? '大富豪' : turnHeading.textContent}。${fresh.length ? `${fresh.map((event)=>eventText(event,model)).join('。')}。` : ''}${guide(model)}`);
  }
  /** @param {string} title @param {string} body */
  function showMessage(title,body) {
    stage.className='game game--message';
    stage.replaceChildren(element('h1','message-title',title),element('p','message-copy',body));
    text(status,`${title}。${body}`);
  }
  function dispose() {
    if (disposed) return;
    disposed=true;observer?.disconnect();removeEventListener('resize',positionRing);
    rows.clear();previousCards=[];currentSeat=null;
  }
  return {render,showMessage,dispose};
}
