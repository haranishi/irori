// @ts-check
/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {import('./irori.js').Look} Look */
/** @typedef {Model['seats'][number]} Seat */
/** @typedef {Model['events'][number]} PublicEvent */

const SVG='http://www.w3.org/2000/svg';
const RANKS=['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
/** 柄はこの画面のために描いた図形（24×24の枠）。読み上げには文字の柄を使う。 */
const SUITS=/** @type {Record<string,{glyph:string,red:boolean,path:string}>} */ ({
  s:{glyph:'♠',red:false,path:'M12 2C13.4 4.6 22 9.8 22 14.6C22 17.4 19.8 19.2 17.4 19.2C15.6 19.2 14.2 18.3 13.3 17.1C13.5 19 14.3 20.6 15.6 22H8.4C9.7 20.6 10.5 19 10.7 17.1C9.8 18.3 8.4 19.2 6.6 19.2C4.2 19.2 2 17.4 2 14.6C2 9.8 10.6 4.6 12 2Z'},
  h:{glyph:'♥',red:true,path:'M12 21.3C10.6 20 2 13.6 2 8.2C2 5.1 4.4 3 7.1 3C9.2 3 11 4.3 12 6.2C13 4.3 14.8 3 16.9 3C19.6 3 22 5.1 22 8.2C22 13.6 13.4 20 12 21.3Z'},
  d:{glyph:'♦',red:true,path:'M12 2C14.6 5.8 17.4 9.1 20.5 12C17.4 14.9 14.6 18.2 12 22C9.4 18.2 6.6 14.9 3.5 12C6.6 9.1 9.4 5.8 12 2Z'},
  c:{glyph:'♣',red:false,path:'M7.4 7.2a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0ZM2.4 14.2a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0ZM12.4 14.2a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0ZM10.9 10H13.1C13.1 15.5 14.2 19.4 16.4 22H7.6C9.8 19.4 10.9 15.5 10.9 10Z'},
});
// ジョーカーの灯（外の炎と内の炎）。48×64の枠。
const FLAME=['M24 3C31 17 41 21 41 37C41 50 33 59 24 59C14 59 7 50 7 39C7 30 14 25 16 15C20 20 22 25 22 31C27 25 28 15 24 3Z','M24 29C28 36 33 40 33 47C33 53 29 57 24 57C19 57 15 53 15 48C15 43 19 41 20 36C22 39 23 41 23 44C26 41 26 35 24 29Z'];

/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [value] */
function element(tag,cls,value) {
  const node=document.createElement(tag);
  node.className=cls;
  if (value !== undefined) node.textContent=value;
  return node;
}
/** @param {HTMLElement} node @param {string} value */
function text(node,value) {if (node.textContent !== value) node.textContent=value;}
/** @param {HTMLElement} node @param {Look|undefined} look @param {boolean} [decor] 名前の横の飾りは読み上げない */
function mark(node,look,decor=false) {
  const key=JSON.stringify(look);
  if (node.dataset.look === key) return;
  node.dataset.look=key;
  if (!look) {node.replaceChildren();return;}
  const svg=document.createElementNS(SVG,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  if (decor) svg.setAttribute('aria-hidden','true');
  else {svg.setAttribute('role','img');svg.setAttribute('aria-label',look.label);}
  const path=document.createElementNS(SVG,'path');
  path.setAttribute('d',look.path);path.setAttribute('fill',look.color);
  svg.append(path);node.replaceChildren(svg);
}
/** @param {string[]} paths @param {string} box @param {string} cls */
function icon(paths,box,cls) {
  const svg=document.createElementNS(SVG,'svg');
  svg.setAttribute('viewBox',box);svg.setAttribute('class',cls);svg.setAttribute('aria-hidden','true');
  paths.forEach((d,i)=>{
    const path=document.createElementNS(SVG,'path');
    path.setAttribute('d',d);path.setAttribute('class',`${cls}-${i}`);path.setAttribute('fill','currentColor');
    svg.append(path);
  });
  return svg;
}
/** 札の絵。数を中央に大きく、左上と右下に数と柄。decor は飾り（読み上げない）。
 * @param {string} id @param {boolean} [decor] */
function card(id,decor=false) {
  const joker=id.startsWith('jk');
  const key=id[0] ?? '';
  const suit=SUITS[key];
  const rank=id.slice(1).toUpperCase();
  const node=element('div',`playing-card${suit?.red ? ' playing-card--red' : ''}${joker ? ' playing-card--joker' : ''}`);
  if (decor) node.setAttribute('aria-hidden','true');
  else {node.setAttribute('role','img');node.setAttribute('aria-label',joker ? `ジョーカー${id.slice(2)}` : `${suit?.glyph ?? ''}${rank}`);}
  /** @type {Element[]} */
  const parts=[];
  if (joker) {
    parts.push(element('span','card-corner card-corner--lamp','灯'),icon(FLAME,'0 0 48 64','card-lantern'),element('span','card-foot','JOKER'));
  } else {
    const pip=()=>icon([suit?.path ?? ''],'0 0 24 24','card-pip');
    const corner=element('span','card-corner');corner.append(element('span','card-rank',rank),pip());
    const center=element('span','card-center');center.append(element('span','card-big',rank),icon([suit?.path ?? ''],'0 0 24 24','card-suit'));
    const tail=element('span','card-corner card-corner--tail');tail.append(element('span','card-rank',rank),pip());
    parts.push(corner,center,tail);
  }
  for (const part of parts) part.setAttribute('aria-hidden','true');
  node.append(...parts);
  return node;
}
/** @param {string[]} ids @param {string} cls */
function cardSet(ids,cls) {
  const set=element('div',cls);
  set.style.setProperty('--n',String(ids.length));
  ids.forEach((id,k)=>{const node=card(id);node.style.setProperty('--k',String(k));set.append(node);});
  return set;
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
  node.append(flag,head,count,note,rank);
  return {node,symbol,name,count,flag,note,rank,key:'',shown:-1};
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
  return model.table ? `同じ${model.table.n}枚で、場より強く。出さないときはスマホで「パス」。` : '先に出す · スマホで同じ数を1〜4枚選び、「出す」。';
}
/** @param {Seat} seat @param {number} ranked */
function rankTitle(seat,ranked) {
  if (seat.rank === 1) return ' · 大富豪';
  return seat.rank !== null && seat.count>0 && seat.rank === ranked ? ' · 大貧民' : '';
}
/** @param {PublicEvent} event @param {Model} model */
function eventText(event,model) {
  const name=model.seats.find((seat)=>seat.id === event.p)?.name ?? '参加者';
  if (event.type === 'sweep') return event.reason === 'eight' ? '8切り！' : 'みんなパス。場が流れました';
  if (event.type === 'revolution') return event.revolution ? '革命！' : '革命返し！';
  if (event.type === 'finish') {
    const seat=model.seats.find((item)=>item.id === event.p);
    return seat?.count === 0 ? `${name}さん、${event.rank}位で上がり！` : 'みんなの順位が決まりました';
  }
  return event.type === 'pass' ? `${name}さんはパス` : `${name}さんが${event.cards?.length ?? 0}枚出しました`;
}
/** @param {HTMLElement} node @param {string} cls 同じ反応を、続けて起きても最初から出し直す */
function replay(node,cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
/** 自分の動き（names）が終わったら要素を外す。子や疑似要素の動きの終わりでは外さない。
 * @param {HTMLElement} node @param {string[]} names */
function removeAfter(node,names) {
  node.addEventListener('animationend',(event)=>{
    if (event.target === node && !event.pseudoElement && names.includes(event.animationName)) node.remove();
  });
}

/** 公開モデルだけを描く。手札・判定状態・pad指定を受け取らない。
 * @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage,status) {
  const header=element('header','topbar');
  const edition=element('p','edition');
  header.append(element('p','brand','IRORI / DAIFUGO'),element('h1','title','大富豪'),edition);

  const intro=element('section','intro');
  const lead=element('div','intro-lead');
  lead.append(element('h2','intro-title','手札を先に、出し切ろう。'),element('p','intro-copy','札は手元に。読み合いは、みんなで。'));
  const rules=element('ol','rules');
  for (const copy of ['同じ数を1〜4枚。場と同じ枚数で、より強い札を出す。','8を出せば場が流れ、もう一度。4枚出すと革命で強さが逆に。','手札を出し切った順に上がり。パスしても次の番は出せる。']) rules.append(element('li','rule',copy));
  lead.append(rules);
  const fan=element('div','intro-fan');fan.setAttribute('aria-hidden','true');
  ['s3','d8','hq','c2','jk1'].forEach((id,k)=>{const node=card(id,true);node.style.setProperty('--k',String(k));fan.append(node);});
  intro.append(lead,fan);

  const round=element('section','round');
  const head=element('div','round-head');
  const turnHeading=element('h2','turn-heading');
  const turnMark=element('span','turn-mark');const turnText=element('span','turn-text');
  turnHeading.append(turnMark,turnText);
  const strength=element('div','strength');
  const order=element('p','strength-order');
  const orderState=element('span','strength-state');const orderDetail=element('span','sr');
  order.append(orderState,orderDetail);
  const scale=element('ol','strength-scale');scale.setAttribute('aria-hidden','true');
  RANKS.forEach((rank,i)=>{
    const chip=element('li',`strength-chip${rank === '8' ? ' strength-chip--eight' : ''}`,rank);
    chip.style.setProperty('--i',String(i));scale.append(chip);
  });
  // 弱・数の並び・灯・強は折り返さない1つの組（読み上げは strength-order の文が担う）。
  const ladder=element('span','strength-ladder');ladder.setAttribute('aria-hidden','true');
  ladder.append(element('span','strength-end','弱'),scale,element('span','strength-chip strength-chip--lamp','灯'),element('span','strength-end','強'));
  strength.append(order,ladder);
  head.append(turnHeading,strength);

  const table=element('section','table-area');table.setAttribute('aria-label','場に出た札');
  const tableCaption=element('h3','table-caption');
  const captionMark=element('span','caption-mark');const captionText=element('span','caption-text');
  tableCaption.append(captionMark,captionText);
  const pile=element('div','pile');
  let cards=element('div','table-cards');
  pile.append(cards);
  const empty=element('p','table-empty');
  empty.append(element('span','table-empty-main','先に出す'),element('span','table-empty-sub','好きな数を1〜4枚'));
  const banner=element('p','event-banner');
  const badge=element('p','rev-badge','革命中');badge.setAttribute('aria-hidden','true');
  table.append(tableCaption,pile,empty,banner,badge);
  round.append(head,table);

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
  let previous='';let tableKey='[]';let lastSeq=0;let lastPhase='';let disposed=false;let held=false;
  /** @type {number|null} */
  let lastTurn=null;
  /** この画面が始めた動き（輪の移動・配る札）。一時停止で止める。 @type {Set<Animation>} */
  const motions=new Set();
  const still=()=>held || disposed || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** @param {Element} node @param {Keyframe[]} frames @param {KeyframeAnimationOptions} options */
  function move(node,frames,options) {
    if (typeof node.animate !== 'function') return null;
    const motion=node.animate(frames,options);
    motions.add(motion);
    motion.addEventListener('finish',()=>motions.delete(motion));
    motion.addEventListener('cancel',()=>motions.delete(motion));
    return motion;
  }
  /** 番が替わるとき、前の席から次の席へ輪を滑らせる。止まっている間の目印は席の枠が持つ。
   * @param {HTMLElement} from @param {HTMLElement} to */
  function glide(from,to) {
    if (still()) return;
    const area=seatsArea.getBoundingClientRect();const a=from.getBoundingClientRect();const b=to.getBoundingClientRect();
    if (!b.width) return;
    const at=(/** @type {DOMRect} */ r)=>({transform:`translate(${r.left-area.left}px,${r.top-area.top}px)`,width:`${r.width}px`,height:`${r.height}px`});
    ring.hidden=false;
    const motion=move(ring,[{...at(a),opacity:.95},{...at(b),opacity:1,offset:.78},{...at(b),opacity:0}],{duration:520,easing:'cubic-bezier(.22,.9,.28,1.08)'});
    if (!motion) {ring.hidden=true;return;}
    motion.addEventListener('finish',()=>{ring.hidden=true;});
  }
  /** 配札：場の中央から各席へ札の背が飛ぶ。 */
  function deal() {
    if (still()) return;
    const from=pile.getBoundingClientRect();
    if (!from.width) return;
    [...rows.values()].forEach((row,i)=>{
      const to=row.count.getBoundingClientRect();
      for (let k=0;k<3;k++) {
        const back=element('div','flying-card');back.setAttribute('aria-hidden','true');
        stage.append(back);
        const x0=from.left+from.width/2;const y0=from.top+from.height/2;
        const x1=to.left+Math.min(to.width,90)/2;const y1=to.top+to.height/2;
        const motion=move(back,[
          {transform:`translate(${x0}px,${y0}px) translate(-50%,-50%) rotate(${k*9-9}deg) scale(.95)`,opacity:0},
          {opacity:1,offset:.15},
          {transform:`translate(${x1}px,${y1}px) translate(-50%,-50%) rotate(${k*12-12}deg) scale(.5)`,opacity:0},
        ],{duration:560,delay:i*70+k*40,easing:'cubic-bezier(.25,.75,.35,1)',fill:'both'});
        if (motion) {motion.addEventListener('finish',()=>back.remove());motion.addEventListener('cancel',()=>back.remove());}
        else back.remove();
      }
    });
  }
  /** 場の札。直近の組を大きく、前の組は薄く後ろへ。流すときは全部を払う。
   * @param {Model} model @param {PublicEvent[]} fresh */
  function updatePile(model,fresh) {
    // 前の更新で払った組を片づける（動きの終わりでも消える）。
    for (const old of pile.querySelectorAll('[data-gone]')) old.remove();
    const nextKey=JSON.stringify(model.table?.cards ?? []);
    const play=fresh.filter((event)=>event.type === 'play').at(-1);
    const swept=fresh.some((event)=>event.type === 'sweep');
    // 8切りは一手の中で場が空になるため、同じ公開イベントの出札を置いてから払う。
    const cut=!model.table && swept ? play?.cards : undefined;
    if (nextKey === tableKey && !swept) return;
    tableKey=nextKey;
    if (!model.table) {
      for (const set of pile.querySelectorAll('.table-cards,.table-trail')) {
        const node=/** @type {HTMLElement} */ (set);
        node.className=`table-trail table-trail--${swept ? 'swept' : 'gone'}`;node.setAttribute('aria-hidden','true');node.dataset.gone='';
        removeAfter(node,['swept','fade-out']);
      }
      if (cut) {
        const set=cardSet(cut,'table-trail table-trail--cut');set.setAttribute('aria-hidden','true');set.dataset.gone='';
        removeAfter(set,['cut','fade-out']);
        pile.append(set,element('div','sweep-line'));
      } else if (swept) pile.append(element('div','sweep-line sweep-line--soft'));
      for (const line of pile.querySelectorAll('.sweep-line')) /** @type {HTMLElement} */ (line).dataset.gone='';
      cards=element('div','table-cards');pile.append(cards);
      // 払い終わってから「先に出す」を出す。8切りは大きな見出しが消えてから。
      empty.classList.remove('table-empty--after','table-empty--after-cut');
      if (swept) replay(empty,cut ? 'table-empty--after-cut' : 'table-empty--after');
      return;
    }
    const placed=!!play && JSON.stringify(play.cards) === nextKey;
    if (cards.childElementCount) {
      for (const back of pile.querySelectorAll('.table-trail--back')) {
        const node=/** @type {HTMLElement} */ (back);
        const depth=Number(node.dataset.depth ?? '1')+1;
        if (depth>2) node.remove();else node.dataset.depth=String(depth);
      }
      cards.className='table-trail table-trail--back';cards.setAttribute('aria-hidden','true');cards.dataset.depth='1';
    } else cards.remove();
    cards=cardSet(model.table.cards,`table-cards${placed ? ' table-cards--placed' : ''}`);
    pile.append(cards);
  }
  /** 出来事の文（残る帯）と、大きな出来事の一時的な見出し。
   * @param {PublicEvent[]} fresh @param {Model} model */
  function announce(fresh,model) {
    const rev=fresh.find((event)=>event.type === 'revolution');
    const eight=fresh.find((event)=>event.type === 'sweep' && event.reason === 'eight');
    const passes=fresh.find((event)=>event.type === 'sweep' && event.reason !== 'eight');
    const win=fresh.find((event)=>event.type === 'finish' && model.seats.find((seat)=>seat.id === event.p)?.count === 0);
    const important=rev ?? eight ?? win ?? passes ?? fresh.at(-1);
    if (!important) return;
    // 新しい要素で同じ種類の出来事にも短い反応を出す。過去ログは再生しない。
    const label=element('span','event-label',eventText(important,model));
    banner.replaceChildren(label);banner.dataset.event=important.type;
    if (eight && important.type === 'revolution') banner.append(element('span','event-detail','8切り！'));
    const big=rev ?? eight ?? win;
    if (big && model.phase !== 'ended') {
      table.querySelector('.event-burst')?.remove();
      const burst=element('div',`event-burst event-burst--${big === rev ? 'revolution' : big === eight ? 'eight' : 'finish'}`);
      burst.setAttribute('aria-hidden','true');
      const name=model.seats.find((seat)=>seat.id === big.p)?.name ?? '参加者';
      const main=big === win ? '上がり！' : eventText(big,model);
      const sub=big === rev ? (rev.revolution ? '強さの順が逆になった' : '強さの順が元に戻った') + (eight ? ' · 8切りで場も流れる' : '')
        : big === eight ? (model.turn === big.p ? `${name}さんが、もう一度` : '場が流れた') : `${name}さん · ${big.rank}位`;
      burst.append(element('span','burst-main',main),element('span','burst-sub',sub));
      removeAfter(burst,['burst-life','burst-fade']);
      table.append(burst);
    }
    if (rev) {
      replay(scale,'is-flipping');
      if (model.table) replay(cards,'table-cards--flip');
    }
  }

  /** @param {Model} model @param {ReadonlyMap<number,Look>} [looks] */
  function render(model,looks=new Map()) {
    const key=JSON.stringify([model,[...looks]]);
    if (disposed || previous === key) return;
    previous=key;
    const before=lastPhase;lastPhase=model.phase;
    document.documentElement.dataset.phase=model.phase;
    stage.dataset.revolution=String(model.revolution);
    stage.className=`game game--${model.phase}`;
    intro.hidden=model.phase !== 'intro';round.hidden=model.phase === 'intro';
    text(edition,model.phase === 'intro' ? '3〜8人 · 54枚の読み合い' : model.phase === 'ended' ? '勝負の結果' : '手札は、手元に');
    const turn=model.seats.find((seat)=>seat.id === model.turn);
    text(turnText,model.phase === 'ended' ? model.outcome === 'incomplete' ? '今回は、勝敗なし' : '勝負がつきました' : turn ? `${turn.name}さんの番` : '次の番を待っています');
    mark(turnMark,model.phase === 'play' && turn ? looks.get(turn.id) : undefined,true);
    text(orderState,model.revolution ? '革命中' : '通常');
    text(orderDetail,model.revolution ? ' · 弱い 2 → 3 強い · ジョーカーは最強' : ' · 弱い 3 → 2 強い · ジョーカーは最強');
    const by=model.seats.find((seat)=>seat.id === model.table?.by);
    text(captionText,model.table ? `${by?.name ?? '参加者'}さんが出した${model.table.n}枚` : '場は空です');
    mark(captionMark,model.table && by ? looks.get(by.id) : undefined,true);
    const fresh=model.events.filter((event)=>event.seq>lastSeq);
    if (fresh.length) lastSeq=Math.max(...fresh.map((event)=>event.seq));
    updatePile(model,fresh);
    empty.hidden=!!model.table;
    table.hidden=model.phase === 'ended';
    if (fresh.length) announce(fresh,model);

    const ids=new Set(model.seats.map((seat)=>seat.id));
    seats.dataset.count=String(model.seats.length);
    for (const [id,row] of rows) if (!ids.has(id)) {row.node.remove();rows.delete(id);}
    const ranked=model.seats.filter((seat)=>seat.rank !== null && !seat.left).length;
    // 終わったら順位の順に並べ替える。遊んでいる間は席の順のまま動かさない。
    const ordered=model.phase === 'ended'
      ? [...model.seats].sort((a,b)=>(a.rank ?? 99)-(b.rank ?? 99) || model.seats.indexOf(a)-model.seats.indexOf(b)) : model.seats;
    ordered.forEach((seat,index)=>{
      let row=rows.get(seat.id);
      if (!row) {row=seatParts();rows.set(seat.id,row);}
      const isTurn=model.phase === 'play' && seat.id === model.turn && !seat.left;
      const finished=seat.rank !== null && !seat.left;
      const seatKey=JSON.stringify([seat,isTurn,model.phase,ranked,looks.get(seat.id)]);
      if (row.key !== seatKey) {
        row.key=seatKey;
        row.node.dataset.seat=String(seat.id);
        const passed=seat.passed && !seat.left && seat.online && model.phase === 'play';
        row.node.className=`seat${isTurn ? ' seat--turn' : ''}${finished ? ' seat--finished' : ''}${seat.left ? ' seat--left' : ''}${!seat.online ? ' seat--offline' : ''}${seat.rank !== null && seat.count>0 ? ' seat--last' : ''}${seat.rank === 1 ? ' seat--first' : ''}`;
        if (isTurn) row.node.setAttribute('aria-current','step');else row.node.removeAttribute('aria-current');
        mark(row.symbol,looks.get(seat.id));text(row.name,seat.name);
        const count=seat.left ? '退出' : model.phase === 'intro' ? '配札前' : finished && seat.count === 0 ? '上がり' : '';
        if (count) {text(row.count,count);row.shown=-1;}
        else if (row.shown !== seat.count) {
          // 枚数が変わったときだけ数字を差し替え、短くはずませる。
          const num=element('span',`count-num${row.shown>seat.count ? ' count-num--drop' : ''}`,String(seat.count));
          row.count.replaceChildren(element('span','count-label','残り'),num,element('span','count-unit','枚'));
          row.shown=seat.count;
        }
        row.flag.hidden=!isTurn;
        // 終わったあとはパスの吹き出しを残さない（順位札と重なるため）。
        text(row.note,seat.left ? 'この勝負はここまで' : model.phase === 'ended' ? '' : !seat.online ? '接続待ち' : passed ? 'パス' : '');
        row.note.classList.toggle('seat-note--pass',passed);
        text(row.rank,finished ? `${seat.rank}位${rankTitle(seat,ranked)}` : '');row.rank.hidden=!finished;
      }
      // 同じ席のDOMを保持し、並びが実際に変わるときだけ移動する。
      if (seats.children[index] !== row.node) seats.insertBefore(row.node,seats.children[index] ?? null);
    });
    const turnNode=model.phase === 'play' && model.turn !== null ? rows.get(model.turn)?.node : undefined;
    const fromNode=lastTurn !== null && lastTurn !== model.turn ? rows.get(lastTurn)?.node : undefined;
    if (model.phase !== 'play') {ring.hidden=true;for (const motion of [...motions]) motion.cancel();}
    else if (turnNode && fromNode && before === 'play') glide(fromNode,turnNode);
    lastTurn=model.phase === 'play' ? model.turn : null;
    if (before === 'intro' && model.phase === 'play') deal();
    text(nextAction,guide(model));
    text(status,`${model.phase === 'intro' ? '大富豪' : turnText.textContent}。${fresh.length ? `${fresh.map((event)=>eventText(event,model)).join('。')}。` : ''}${guide(model)}`);
  }
  /** 一時停止・非表示の間は、この画面が始めた動きを止める（CSSの動きはスタイルで止まる）。
   * @param {boolean} on */
  function hold(on) {
    held=on;
    for (const motion of motions) on ? motion.pause() : motion.play();
  }
  /** @param {string} title @param {string} body */
  function showMessage(title,body) {
    stage.className='game game--message';
    stage.replaceChildren(element('h1','message-title',title),element('p','message-copy',body));
    text(status,`${title}。${body}`);
  }
  function dispose() {
    if (disposed) return;
    disposed=true;
    for (const motion of [...motions]) motion.cancel();
    rows.clear();
  }
  return {render,hold,showMessage,dispose};
}
