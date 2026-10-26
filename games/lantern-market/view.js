// @ts-check
// 選択中の札はこのモジュールへ渡さない。DOMのテキストも公開モデルだけから作る。
/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {import('./irori.js').Look} Look */
/** @typedef {Model['participants'][number]} Participant */
/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [text] */
function element(tag,cls,text) {
  const node=document.createElement(tag);node.className=cls;
  if(text !== undefined) node.textContent=text;
  return node;
}
/** @param {Look|undefined} look */
function mark(look) {
  const node=element('span','seat-mark');
  if(!look) return node;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('role','img');svg.setAttribute('aria-label',look.label);
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',look.path);path.setAttribute('fill',look.color);
  svg.append(path);node.append(svg);return node;
}
/** @param {Participant} seat @param {ReadonlyMap<number,Look>} looks */
function who(seat,looks) {
  const node=element('span','who');node.append(mark(looks.get(seat.id)),element('span','name',seat.name));
  return node;
}
/** @param {string} value @param {string} [caption] */
function lantern(value,caption) {
  const outer=element('div','lantern-wrap');
  const light=element('div','lantern');
  light.append(element('span','lantern-value',value));
  outer.append(light);
  if(caption) outer.append(element('span','lantern-caption',caption));
  return outer;
}
const BLOCKERS=/** @type {Record<string,string>} */ ({menu:'メニューを閉じるのを待っています','host-offline':'大画面の接続を待っています',hidden:'大画面に戻るのを待っています','player-offline':'スマホのつなぎ直しを待っています'});
/** @param {Model} model */
function guide(model) {
  if(model.blockers.length) return model.blockers.map((b)=>BLOCKERS[b]).join('。');
  if(model.canContinue) return `${model.leaderName}さんのスマホで「${model.actionLabel}」`;
  if(model.phase === 'choose') return 'スマホで札を1枚。全員が選んだら、一斉公開。';
  if(model.phase === 'intro') return model.participants.length<2 ? '2人以上そろうと遊べます' : 'みんながそろうのを待っています';
  return model.phase === 'ended' ? '総合結果を大画面で見よう' : '進行役を待っています';
}
/** @param {Model} model @param {ReadonlyMap<number,Look>} looks */
function board(model,looks) {
  const list=element('ul','players');
  list.setAttribute('aria-label','みんなの札と得点');
  for(const seat of model.participants) {
    const bid=model.reveal?.bids.find((b)=>b.p === seat.id);
    const winner=model.reveal?.winner === seat.id;
    const row=element('li',`player${winner ? ' player--winner' : ''}${bid?.duplicate ? ' player--duplicate' : ''}`);
    row.dataset.seat=String(seat.id);
    const head=element('div','player-head');head.append(who(seat,looks));
    const score=element('p','score');score.append(element('strong','score-value',String(seat.score)),element('span','score-unit','点'));
    head.append(score);row.append(head);
    const hand=element('div',`card-display${bid ? ' card-display--revealed' : ''}`);
    if(bid) {
      hand.append(element('span','bid-card',String(bid.card)),element('span',`bid-status${winner ? ' bid-status--winner' : ''}`,winner ? `灯を獲得 ＋${model.reveal?.awarded}` : bid.duplicate ? '札が重なって失格' : '今回は届かず'));
    } else {
      const back=element('span','card-back','灯');back.setAttribute('aria-hidden','true');
      hand.append(back,element('span','bid-status',seat.left ? '退出' : !seat.online ? '接続待ち' : model.phase === 'choose' ? '札は、まだ秘密' : '札は手元に'));
    }
    row.append(hand);
    const used=element('p','used-cards');
    used.append(element('span','used-label','使った札'));
    for(let n=1;n<=6;n++) {
      const chip=element('span',seat.used.includes(n) ? 'used-number used-number--out' : 'used-number',String(n));
      chip.setAttribute('aria-label',`${n}${seat.used.includes(n) ? '使用済み' : '未使用'}`);used.append(chip);
    }
    row.append(used);list.append(row);
  }
  return list;
}
/** @param {Model} model */
function upcoming(model) {
  const track=element('ol','market-track');track.setAttribute('aria-label','6つの市の灯の価値');
  model.prizes.forEach((prize,index)=>{
    const li=element('li',`market-stop${index === model.roundIndex ? ' market-stop--current' : ''}${index<model.roundIndex ? ' market-stop--past' : ''}`);
    li.append(element('span','market-index',`${index+1}市`),element('strong','market-value',String(prize)));
    if(index === model.roundIndex) li.setAttribute('aria-current','step');
    track.append(li);
  });return track;
}

/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage,status) {
  let previous='';let announced='';
  /** @param {Model} model @param {ReadonlyMap<number,Look>} looks */
  function render(model,looks) {
    const key=JSON.stringify(model);if(previous === key) return;previous=key;
    document.documentElement.dataset.phase=model.phase;
    document.documentElement.dataset.round=String(model.roundIndex+1);
    stage.className=`game game--${model.phase}`;
    const header=element('header','topbar');
    header.append(element('p','brand','IRORI / LANTERNS UNCLAIMED'),element('p','edition',model.phase === 'intro' ? '2〜8人 · 6枚の読み合い' : `第${model.roundIndex+1}市 / 全6市`));
    const content=element('section','content');
    if(model.phase === 'intro') {
      const hero=element('div','hero');const copy=element('div','hero-copy');
      copy.append(element('p','eyebrow','その一枚、かぶりませんように。'),element('h1','title','灯市のかけひき'),element('p','tagline','大きい札より、ひとりだけの札。'));
      hero.append(copy,lantern('灯','6つの市で、灯を集めよう'));content.append(hero);
      const rules=element('ol','rules');
      for(const [i,text] of ['1〜6の札から、1枚を秘密に選ぶ','同じ数字は全員失格。残った最大の札が灯を獲得','使えるのは各札1回。6つの市の合計点で勝負'].entries()) {
        const li=element('li','rule');li.append(element('span','rule-number',String(i+1)),element('span','rule-copy',text));rules.append(li);
      }
      content.append(rules);
      const names=element('div','intro-players');names.setAttribute('aria-label','参加者');
      for(const seat of model.participants) names.append(who(seat,looks));
      content.append(names);
    } else if(model.phase === 'recover') {
      content.classList.add('recovery');
      content.append(lantern('休'),element('h1','recovery-title',model.recoverTarget === 'reveal' ? 'ひと息ついて、結果の続きへ' : 'この市は、もう一度'),element('p','recovery-copy',model.recoverTarget === 'reveal' ? '公開した結果はそのまま。灯を二重に配りません。' : '伏せた札を戻しました。得点も使った札も、そのままです。'));
      content.append(board(model,looks));
    } else if(model.phase === 'ended') {
      content.classList.add('recovery');content.append(lantern('灯'),element('h1','recovery-title',model.outcome === 'incomplete' ? '今回は、勝敗なし' : '灯を数えよう'),element('p','recovery-copy',model.outcome === 'incomplete' ? '参加者が退出したため、この勝負を終了します。' : '集めた灯の合計を、大画面で見よう'));
    } else {
      const lot=element('div','lot');
      const copy=element('div','lot-copy');
      const winner=model.participants.find((p)=>p.id === model.reveal?.winner);
      copy.append(element('p','eyebrow',model.phase === 'choose' ? '札は手元で。気持ちは顔に？' : '一斉公開'));
      copy.append(element('h1','lot-title',model.phase === 'choose' ? 'ひとりだけの、一枚を。' : winner ? `${winner.name}さんが獲得` : '全員の札が重なった！'));
      const detail=model.phase === 'choose' ? model.roundIndex === 5 ? '最後の1枚は、自動で公開します。' : '同じ札は全員失格。残った最大の札が灯を獲得。'
        : winner ? `${model.reveal?.awarded}点の灯が手元へ。` : model.roundIndex === 5 ? `残った${model.carry}点の灯は、誰も獲得しません。` : `${model.carry}点の灯を次の市へ持ち越し。`;
      copy.append(element('p','lot-detail',detail));
      const total=model.phase === 'reveal' && model.reveal ? model.reveal.prize+model.reveal.carried : (model.prizes[model.roundIndex] ?? 0)+model.carry;
      lot.append(copy,lantern(String(total),'この市の灯 / 点'));content.append(lot,upcoming(model),board(model,looks));
    }
    const footer=element('footer','footer');footer.append(element('p','progress-guide',guide(model)),element('p','fine-print',model.phase === 'intro' ? '札が全部重なったら灯は持ち越し。最後の1枚は自動で出します。' : '使った札は戻りません · 同点は同順位 · 時間制限なし'));
    stage.replaceChildren(header,content,footer);
    const say=`第${model.roundIndex+1}市。${model.phase === 'choose' ? '札を選んでください' : model.phase === 'reveal' ? winnerAnnouncement(model) : guide(model)}`;
    if(say !== announced) {announced=say;status.textContent=say;}
  }
  /** @param {string} title @param {string} body */
  function showMessage(title,body) {stage.className='game game--message';stage.replaceChildren(element('h1','recovery-title',title),element('p','recovery-copy',body));status.textContent=`${title}。${body}`;}
  return {render,showMessage,dispose(){previous='';announced='';}};
}
/** @param {Model} model */
function winnerAnnouncement(model) {
  const name=model.participants.find((p)=>p.id === model.reveal?.winner)?.name;
  return name ? `${name}さんが${model.reveal?.awarded}点を獲得。${guide(model)}` : `全員の札が重なりました。${guide(model)}`;
}
