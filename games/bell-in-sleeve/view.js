// @ts-check
import {CARD_NAMES} from './cards.js';
/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {import('./irori.js').Look} Look */
const SVG='http://www.w3.org/2000/svg';
const SYMBOLS={bell:'M20 4 36 20 20 36 4 20Z',peek:'M3 20Q20 0 37 20Q20 40 3 20ZM26 20a6 6 0 1 1-12 0a6 6 0 1 1 12 0',swap:'M4 13H34L26 5M36 27H6L14 35',whisper:'M8 20a2 2 0 1 1-4 0a2 2 0 1 1 4 0M22 20a2 2 0 1 1-4 0a2 2 0 1 1 4 0M36 20a2 2 0 1 1-4 0a2 2 0 1 1 4 0',catch:'M36 20a16 16 0 1 1-32 0a16 16 0 1 1 32 0M30 20a10 10 0 1 1-20 0a10 10 0 1 1 20 0',guard:'M20 3 36 20 20 37 4 20ZM20 14 26 20 20 26 14 20Z'};
/** @param {import('./cards.js').Card} card */
function symbol(card) {
  const svg=document.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 40 40');svg.setAttribute('class','glyph');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS(SVG,'path');path.setAttribute('d',SYMBOLS[card]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','2.5');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;
}
/** @param {string} value @param {number} max */
export const short=(value,max)=>[...value].slice(0,max).join('');
/** @param {keyof HTMLElementTagNameMap} tag @param {string} cls @param {string} [text] */
function el(tag,cls,text='') {
  const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;
}
/** 自作の鈴と猫。結果になるまではDOMにも置かない。 @param {'bell'|'cat'|'robot'} kind */
function icon(kind) {
  const svg=document.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 80 80');svg.setAttribute('class',kind);
  svg.setAttribute('role','img');svg.setAttribute('aria-label',kind === 'bell' ? '金の鈴' : kind === 'cat' ? '猫の影絵' : 'CPUの席');
  const path=document.createElementNS(SVG,'path');
  path.setAttribute('d',kind === 'bell' ? 'M34 16a6 6 0 1 1 12 0v6c15 3 22 18 22 34Q40 75 12 56c0-16 7-31 22-34ZM38 38v19h4V38ZM24 60v4h32v-4Z'
    : kind === 'cat' ? 'M22 35 17 8 34 21Q40 18 47 21L64 9 60 36Q69 44 60 51L57 70H23l-3-19Q9 44 22 35ZM57 68Q81 65 73 41L68 43Q74 60 55 61Z'
      : 'M37 8h6v12h18v9h8v31h-8v9H19v-9h-8V29h8v-9h18ZM24 34v10h9V34ZM47 34v10h9V34ZM29 54v5h22v-5Z');
  path.setAttribute('fill','currentColor');path.setAttribute('fill-rule','evenodd');svg.append(path);return svg;
}
/** @param {Model} model */
export function heading(model) {
  const name=short(model.seats.find((s)=>s.id === model.turn)?.name ?? '',12);
  if (model.phase === 'intro') return '鈴は、誰のふところに？';
  if (model.phase === 'deal') return 'そっと、自分の札を確かめよう';
  if (model.phase === 'talk') return model.seats.filter((s)=>!s.cpu).length === 1 ? 'CPUは話さないため、話し合いは10秒' : '鈴の行方を、話し合おう';
  if (model.phase === 'vote') return 'せーので、持ち主を指名';
  if (model.phase === 'result') return model.outcome === 'incomplete' ? '席が空いたので、今回は勝負なし' : model.winner === 'stall' ? '見つけた！ 金の鈴' : '鈴は、逃げ切りました';
  const steps={pickCard:'札を選んでいます',pickTarget:'相手を選んでいます',pickSlot:'伏せた位置を選んでいます',pickGive:'差し出す札を選んでいます',whisper:'ふたりで、ひそひそ話',reveal:'手がかりを確かめています'};
  return `${name}さん · ${steps[model.step]}`;
}
/** @param {Model} model @param {Model['events'][number]} event */
export function eventText(model,event) {
  const name=(/** @type {import('./cards.js').SeatId|undefined} */ id)=>short(model.seats.find((s)=>s.id === id)?.name ?? 'だれか',12);
  const p=name(event.p),target=name(event.target);
  const lines={play:`${p}：${event.card ? CARD_NAMES[event.card] : '札'}を出した`,peek:`${p}が${target}をのぞき見`,swap:`${p}と${target}が札を取り替えた`,whisper:`${p}と${target}がひそひそ話`,guard:`${p}が${target}をかばった`,miss:`${p}の指名は外れ（−1点）・${target}はいま持っていない`,caught:`${p}が鈴を見つけた！`,auto:`${p}は、おまかせ`,skip:`${p}は見送り`,noTarget:'みんな守られているので、指名なし'};
  return short(lines[/** @type {keyof typeof lines} */ (event.type)] ?? '札が動きました',64);
}
/** @param {HTMLElement} stage @param {HTMLElement} status */
export function createView(stage,status) {
  const motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let held=false;
  const reflectMotion=()=>{stage.dataset.motion=motion?.matches ? 'reduce' : 'full';};
  motion?.addEventListener?.('change',reflectMotion);reflectMotion();
  let lastScene='',lastModel='';
  return {
    /** @param {Model} model @param {Map<number,Look>} [looks] */
    render(model,looks=new Map()) {
      document.documentElement.dataset.phase=model.phase;
      stage.dataset.phase=model.phase;stage.dataset.count=String(model.seats.length);stage.dataset.frozen=String(held || model.blocked);
      const scene=`${model.phase}:${model.step}:${model.turn}:${model.events.at(-1)?.seq ?? 0}`;
      stage.dataset.scene=scene;
      const clockText=()=>model.phase === 'intro' ? '準備' : model.phase === 'result' ? `あと${Math.ceil(model.remaining/1000)}秒で、「もう一度／ホームへ」の画面へ` : `${Math.ceil(model.remaining/1000)}秒`;
      const duration=model.phase === 'talk' ? model.seats.filter((s)=>!s.cpu).length === 1 ? 10000 : 45000 : model.phase === 'vote' || model.step === 'whisper' ? 30000 : model.phase === 'deal' || model.phase === 'result' ? 8000 : model.step === 'reveal' ? 3000 : 25000;
      const fingerprint=JSON.stringify({...model,remaining:0});
      const oldClock=stage.querySelector('.clock');
      if (fingerprint === lastModel && oldClock instanceof HTMLElement) {
        oldClock.textContent=clockText();
        oldClock.style.setProperty('--time',String(Math.min(1,Math.max(0,model.remaining/duration))));
        oldClock.setAttribute('aria-label',`残り時間 ${oldClock.textContent}`);return;
      }
      lastModel=fingerprint;
      const header=el('header','masthead');
      const brand=el('div','brand');brand.append(el('span','eyebrow','夜の屋台通り · 推理カード'),el('h1','title','ふところの鈴'));
      const clock=el('div','clock',clockText());
      clock.style.setProperty('--time',String(Math.min(1,Math.max(0,model.remaining/duration))));
      clock.setAttribute('aria-label',`残り時間 ${clock.textContent}`);header.append(brand,clock);
      const line=el('h2','turn-line',heading(model));
      const progress=el('div','progress',`${model.progress.round}周目・あと${model.progress.left}手${model.phase === 'intro' ? '' : ` ｜ 出された札${model.discard.length}枚・${model.phase === 'result' ? '持ち主を公開' : '鈴の位置は結果まで秘密'}`}`);
      const table=el('section','table');table.setAttribute('aria-label','席と出された札');
      const center=el('div','center');
      if (model.phase === 'intro') {
        center.classList.add('intro');center.append(el('div','street-sign','ひと札の手がかり。ひと声の駆け引き。'),el('p','','札を出す → 相手を選ぶ → 鈴を探す'),el('p','','鈴は出せません。最後はみんなで一斉指名。'),el('p','start-guide','進行役のスマホで「はじめる」'),el('small','','3〜8人 · 1人でもCPUと · 推奨5人'));
      } else {
        center.append(el('div','pile-label',model.phase === 'talk' ? '声で推理しよう' : model.phase === 'vote' ? 'スマホで1人を選ぼう' : '出された札'));
        const pile=el('div','pile');
        for (const card of model.discard.slice(-3)) {
          if (!card) continue;
          const face=el('div',`face face--${card}`);face.append(symbol(card),el('span','',CARD_NAMES[card]));pile.append(face);
        }
        if (!model.discard.length) pile.append(el('div','empty-pile','まだ、手がかりはありません'));
        center.append(pile);
      }
      const seats=el('div','seats');
      model.seats.forEach((seat,i)=>{
        const angle=i*2*Math.PI/model.seats.length;
        const node=el('article','seat');node.dataset.id=String(seat.id);
        const position=model.seats.length === 8 ? [[50,13],[76,16],[90,50],[76,84],[50,87],[24,84],[10,50],[24,16]][i] : [50+39*Math.sin(angle),50-35*Math.cos(angle)];
        node.style.left=`${position?.[0]}%`;node.style.top=`${position?.[1]}%`;
        node.dataset.top=String(Math.cos(angle) > .9);
        node.dataset.lower=String(-Math.cos(angle) > .7);
        node.dataset.active=String(model.phase === 'turn' && model.turn === seat.id);
        node.dataset.offline=String(!seat.online || seat.left);
        const who=el('div','who');
        if (seat.cpu) who.append(icon('robot'));
        else {
          const look=typeof seat.id === 'number' ? looks.get(seat.id) : undefined;
          if (look) {
            const mark=document.createElementNS(SVG,'svg');mark.setAttribute('viewBox','0 0 24 24');mark.setAttribute('class','mark');mark.setAttribute('aria-label',look.label);
            const path=document.createElementNS(SVG,'path');path.setAttribute('d',look.path);path.setAttribute('fill',look.color);mark.append(path);who.append(mark);
          }
        }
        who.append(el('span','name',short(seat.name,12)));node.append(who);
        const fan=el('div','fan');fan.setAttribute('aria-label',`伏せた札 ${seat.count}枚`);
        for (let j=0;j<Math.min(4,seat.count);j++) {const back=el('i','back');back.style.setProperty('--angle',`${(j-(seat.count-1)/2)*12}deg`);fan.append(back);}
        node.append(fan,el('div','seat-meta',seat.left ? '退出しました' : !seat.online ? '接続待ち · 時間でおまかせ' : `${seat.count}枚${seat.cpu ? ' · CPU' : ''}`));
        const badges=el('div','badges');if (seat.guard) badges.append(el('span','guard','⟐ つかまえる除け'));
        if (model.clear.includes(seat.id)) badges.append(el('span','clear','いまは持っていない'));
        node.append(badges);
        if (model.phase === 'result' && model.holder === seat.id && model.outcome === 'complete') {
          const reveal=el('div','reveal');node.dataset.holder='true';reveal.append(icon('cat'),icon('bell'));fan.replaceChildren(reveal);
        }
        seats.append(node);
      });
      table.append(center,seats);
      const footer=el('footer','foot');
      if (model.phase === 'result') {
        const board=el('ol','results');board.setAttribute('aria-label','得点表');board.style.gridTemplateColumns=`repeat(${Math.ceil(model.results.length/2)},1fr)`;
        for (const r of [...model.results].sort((a,b)=>(a.rank ?? 99)-(b.rank ?? 99))) {
          const name=short(model.seats.find((s)=>s.id === r.p)?.name ?? '',12);
          const row=el('li','',`${r.rank === null ? '—' : `${r.rank}位`} ${name}${r.cpu ? '（CPU）' : ''} ${r.score}点`);
          row.append(el('div','score-reasons',r.reasons.map((reason)=>`${reason.label}${reason.score >= 0 ? '＋' : '−'}${Math.abs(reason.score)}`).join('・')));
          const target=model.seats.find((s)=>s.id === r.voteFor)?.name;
          row.append(el('div','vote-detail',`指名：${target ?? 'なし'} ／ 得票${r.votesReceived}票`));board.append(row);
        }
        footer.append(board);
      } else {
        footer.append(el('span','log-label','通りのうわさ'));
        const logs=el('ol','events');for (const event of model.events.slice(-4).reverse()) logs.append(el('li','',eventText(model,event)));
        if (!model.events.length) logs.append(el('li','','手札は自分のスマホだけ。大画面には映りません。'));
        footer.append(logs);
      }
      stage.replaceChildren(header,line,progress,table,footer);
      if (scene !== lastScene) {status.textContent=heading(model);lastScene=scene;}
    },
    /** @param {boolean} value */
    hold(value) {held=value;stage.dataset.frozen=String(value);},
    /** @param {string} title @param {string} body */
    showMessage(title,body) {stage.replaceChildren(el('h1','title',title),el('p','',body));},
    dispose() {motion?.removeEventListener?.('change',reflectMotion);},
  };
}
