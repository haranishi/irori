// @ts-check
/** @typedef {number|string} SeatId */
/** @typedef {(() => number) & {state:number}} Rng */
/** @param {number} seed @returns {Rng} */
export function makeRng(seed) {
  const rng=Object.assign(()=>{rng.state=(rng.state+0x6d2b79f5)>>>0;let n=rng.state;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;},{state:seed>>>0});return rng;
}
/** @template T @param {readonly T[]} values @param {()=>number} rng */
export function shuffle(values,rng) {
  const out=[...values];for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[out[i],out[j]]=[/** @type {T} */(out[j]),/** @type {T} */(out[i])];}return out;
}
export function buildDeck(){return ['s','h','d','c'].flatMap(s=>Array.from({length:13},(_,i)=>s+(i+2)));}
/** @param {string} card */
export function cardText(card){return ({s:'♠',h:'♥',d:'♦',c:'♣'}[card[0]??'']??'')+({11:'J',12:'Q',13:'K',14:'A'}[Number(card.slice(1))]??card.slice(1));}
/** @param {readonly SeatId[]} ids @param {number} seed */
export function deal(ids,seed){
  if(ids.length<2||ids.length>8||new Set(ids).size!==ids.length)throw new RangeError('席は2〜8人です');
  const rng=makeRng(seed),deck=shuffle(buildDeck(),rng);
  /** @type {Record<SeatId,string[]>} */const hands=Object.fromEntries(ids.map(id=>[id,[]]));
  for(let round=0;round<2;round++)for(const id of ids)hands[id]?.push(/** @type {string} */(deck.shift()));
  return {hands,deck,rngState:rng.state};
}
export const HAND_NAMES=Object.freeze(['ハイカード','ワンペア','ツーペア','スリーカード','ストレート','フラッシュ','フルハウス','フォーカード','ストレートフラッシュ','ロイヤルフラッシュ']);
/** @typedef {{category:number,name:string,value:number[],cards:string[]}} HandRank */
/** @param {readonly number[]} ranks */
function straight(ranks){const values=new Set(ranks);if(values.has(14))values.add(1);for(let high=14;high>=5;high--)if(Array.from({length:5},(_,i)=>high-i).every(n=>values.has(n)))return high;return 0;}
/** @param {Pick<HandRank,'value'>} a @param {Pick<HandRank,'value'>} b */
export function compareHands(a,b){for(let i=0;i<Math.max(a.value.length,b.value.length);i++){const d=(a.value[i]??0)-(b.value[i]??0);if(d)return Math.sign(d);}return 0;}
/** 5〜7枚を直接比較する。柄は同点を破らない。 @param {readonly string[]} cards @returns {HandRank} */
export function evaluate(cards){
  if(cards.length<5||cards.length>7||new Set(cards).size!==cards.length||cards.some(c=>! /^(?:[shdc](?:[2-9]|1[0-4]))$/.test(c)))throw new RangeError('札が不正です');
  const sorted=[...cards].sort((a,b)=>Number(b.slice(1))-Number(a.slice(1))),ranks=sorted.map(c=>Number(c.slice(1)));
  const unique=[...new Set(ranks)],groups=unique.map(n=>({n,count:ranks.filter(r=>r===n).length})).sort((a,b)=>b.count-a.count||b.n-a.n);
  const flush=['s','h','d','c'].map(s=>sorted.filter(c=>c[0]===s)).find(cs=>cs.length>=5),sf=flush?straight(flush.map(c=>Number(c.slice(1)))):0;
  let category=0,keys=unique.slice(0,5),pool=sorted;
  if(sf){category=sf===14?9:8;keys=[sf];pool=/** @type {string[]} */(flush);}
  else if(groups[0]?.count===4){category=7;keys=[groups[0].n,/** @type {number} */(unique.find(n=>n!==groups[0]?.n))];}
  else if(groups[0]?.count===3&&(groups[1]?.count??0)>=2){category=6;keys=[groups[0].n,/** @type {{n:number}} */(groups[1]).n];}
  else if(flush){category=5;keys=flush.slice(0,5).map(c=>Number(c.slice(1)));pool=flush;}
  else if(straight(unique)){category=4;keys=[straight(unique)];}
  else if(groups[0]?.count===3){category=3;keys=[groups[0].n,...unique.filter(n=>n!==groups[0]?.n).slice(0,2)];}
  else if(groups[0]?.count===2){const pairs=groups.filter(g=>g.count===2).map(g=>g.n);category=pairs.length>=2?2:1;keys=category===2?[...pairs.slice(0,2),...unique.filter(n=>!pairs.slice(0,2).includes(n)).slice(0,1)]:[/** @type {number} */(pairs[0]),...unique.filter(n=>n!==pairs[0]).slice(0,3)];}
  const wanted=category===4||category>=8?Array.from({length:5},(_,i)=>{const n=(keys[0]??0)-i;return n===1?14:n;}):category===7?[keys[0],keys[0],keys[0],keys[0],keys[1]]:category===6?[keys[0],keys[0],keys[0],keys[1],keys[1]]:category===3?[keys[0],keys[0],keys[0],...keys.slice(1)]:category===2?[keys[0],keys[0],keys[1],keys[1],keys[2]]:category===1?[keys[0],keys[0],...keys.slice(1)]:keys;
  const selected= wanted.map(n=>{const i=pool.findIndex(c=>Number(c.slice(1))===n);return /** @type {string} */(pool.splice(i,1)[0]);});
  return {category,name:HAND_NAMES[category]??'',value:[category,...keys],cards:selected};
}
