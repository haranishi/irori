// @ts-check
// 大画面に出すのは公開モデル（publicView）だけ。手札の中身とジョーカーの所在は、このモジュールに来ない。
// 文字はすべて textContent で入れる。札の裏の模様とジョーカーの灯は、自作の図形（style.css と FLAME）。
// 演出は、直前に描いたモデルから新しいモデルへ、公開イベント（draw・pair・out）の順に動かす。
// 演出の途中で机の形が変わるモデルが届いたら、残りを飛ばして最終の形にそろえてから次を始める（入力は止めない）。

/** @typedef {import('./logic.js').GameViewModel} Model */
/** @typedef {Model['seats'][number]} SeatView */
/** @typedef {Model['events'][number]} PublicEvent */
/** @typedef {import('./irori.js').Look} Look */
/** @typedef {Extract<import('./logic.js').GameEffect,{t:'cue'}>} CueEffect */
/** @typedef {CueEffect['name']} CueName */
/** @typedef {{paused:boolean,connected:boolean,visible:boolean}} Host */
/** @typedef {{cue:(name:CueName,v?:number)=>void}} Hooks */
/** @typedef {{skip:boolean,anims:Set<Animation>}} Run */
/** @typedef {{x:number,y:number}} Point */
/** @typedef {{root:HTMLLIElement,fan:HTMLElement,cards:HTMLElement[],mark:HTMLElement,name:HTMLElement,meta:HTMLElement,tag:HTMLElement,badge:HTMLElement,joker:HTMLElement|null,look:string}} SeatNode */
/** @typedef {{edition:HTMLElement,eyebrow:HTMLElement,line:HTMLElement,table:HTMLElement,inner:HTMLElement,seats:Map<number,SeatNode>,order:number[],pile:HTMLElement,pileCards:HTMLElement,pileCount:HTMLElement,fx:HTMLElement,path:SVGPathElement,tip:SVGPathElement,guide:HTMLElement,lineTurn:Model['turn'],size:string}} Board */

const SVG='http://www.w3.org/2000/svg';
/** 演出の長さ（ミリ秒）。重要な出来事ほど長く強く、日常の動作は短く。 */
const MS={lift:170,fly:470,beat:120,flip:300,pile:440,badge:480,line:340,deal:420,dealSeat:90,dealCard:22,fade:200,rise:480,reveal:600,hold:1700};
const SUITS=/** @type {Record<string,{mark:string,name:string,red:boolean}>} */ ({
  s:{mark:'♠',name:'スペード',red:false},h:{mark:'♥',name:'ハート',red:true},d:{mark:'♦',name:'ダイヤ',red:true},c:{mark:'♣',name:'クラブ',red:false},
});
/** 灯（炎）の自作の絵。外・中・芯の3枚。viewBox 0 0 40 56。 */
const FLAME=[
  'M20 3c6 9 14 16 14 29 0 10-6.3 17-14 17S6 42 6 32c0-7 4-12 8-17 .5 5 2 8 5 9-1.5-7-1-14 1-21z',
  'M20 18c4 6 8 10 8 17 0 6-3.6 10-8 10s-8-4-8-10c0-4 2-7 4-9 .5 3 1.5 4.5 3 5-.6-4.5 0-8.5 1-13z',
  'M20 31c2 3 4 5 4 8 0 3-1.8 5-4 5s-4-2-4-5c0-2.6 2-5 4-8z',
];
/** 札の幅の候補（px）。机に席と捨て札が重ならずに収まる、いちばん大きいものを使う。 */
const CARD_SIZES=[58,52,46,41,36,32,28,25,22,20];
const RULES=['配ったら、同じ数の2枚は自動で捨てる','番が来たら、となりの人の伏せた札をスマホで1枚ひく','手札がなくなった人から上がり。最後にジョーカーを持っていた人の負け'];

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} cls @param {string} [text] @returns {HTMLElementTagNameMap[K]} */
function el(tag,cls,text) {
  const node=document.createElement(tag);node.className=cls;
  if(text !== undefined) node.textContent=text;
  return node;
}
/** @template {keyof SVGElementTagNameMap} K @param {K} tag @param {string} cls @returns {SVGElementTagNameMap[K]} */
function svgEl(tag,cls) {const node=document.createElementNS(SVG,tag);node.setAttribute('class',cls);return node;}
/** @param {Look|undefined} look */
function mark(look) {
  const node=el('span','seat-mark');
  if(!look) return node;
  const svg=svgEl('svg','mark-svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('role','img');svg.setAttribute('aria-label',look.label);
  const path=svgEl('path','mark-path');path.setAttribute('d',look.path);path.setAttribute('fill',look.color);
  svg.append(path);node.append(svg);return node;
}
/** @param {SeatView|undefined} seat @param {ReadonlyMap<number,Look>} looks */
function who(seat,looks) {
  const node=el('span','who');
  if(seat) node.append(mark(looks.get(seat.id)),el('span','who-name',`${seat.name}さん`));
  return node;
}
function backCard() {return el('span','card card--back');}
/** 表向きの札。数と柄の記号を文字で出し、色だけに頼らない。 @param {string} card */
function faceCard(card) {
  if(card === 'jk') return jokerCard();
  const suit=SUITS[card.charAt(0)];
  const node=el('span',`card card--face${suit?.red ? ' card--red' : ''}`);
  node.append(el('span','card-rank',card.slice(1).toUpperCase()),el('span','card-suit',suit?.mark ?? ''));
  return node;
}
function jokerCard() {
  const node=el('span','card card--joker');
  const svg=svgEl('svg','joker-art');svg.setAttribute('viewBox','0 0 40 56');svg.setAttribute('aria-hidden','true');
  FLAME.forEach((d,i)=>{const path=svgEl('path',`flame flame--${i}`);path.setAttribute('d',d);svg.append(path);});
  node.append(el('span','card-corner','JK'),svg);
  return node;
}
/** 写しの札を、別の札の見た目に替える（裏から表へ返すとき）。 @param {HTMLElement} node @param {HTMLElement} face */
function become(node,face) {node.className=`${face.className} fly`;node.replaceChildren(...face.childNodes);}
/** 札の名前（読み上げ用）。 @param {string} card */
function cardName(card) {return card === 'jk' ? 'ジョーカー' : `${SUITS[card.charAt(0)]?.name ?? ''}の${card.slice(1).toUpperCase()}`;}
/** 見た目のための決まった選び方。乱数を使わず、同じイベントは同じ札を動かす。 @param {number} seq @param {number} n */
function pick(seq,n) {return n>0 ? (seq*7+3)%n : 0;}
/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v,lo,hi) {return Math.min(hi,Math.max(lo,v));}
/** @param {Model} model 机の形（演出をやり直すべき変化）だけを並べた鍵。接続の揺れや名前の変化では演出を切らない。 */
function tableKey(model) {
  return JSON.stringify([model.phase,model.outcome,model.turn,model.discard.length,model.seats.map((s)=>[s.id,s.count,s.rank,s.left])]);
}

/** 楕円の周を同じ道のりで分け、下から時計回りに席を置く（横長の机でも隣どうしが詰まらない）。 @param {number} n @param {number} rx @param {number} ry @returns {Point[]} */
function ringPoints(n,rx,ry) {
  const steps=720;let total=0;
  /** @type {{x:number,y:number,d:number}[]} */
  const pts=[];
  for(let k=0;k<=steps;k++) {
    const a=Math.PI/2+k/steps*Math.PI*2;const p={x:rx*Math.cos(a),y:ry*Math.sin(a),d:0};
    const prev=pts[pts.length-1];if(prev) total+=Math.hypot(p.x-prev.x,p.y-prev.y);
    p.d=total;pts.push(p);
  }
  return Array.from({length:n},(_,i)=>{const want=total*(i+.5)/n;const p=pts.find((q)=>q.d>=want) ?? pts[pts.length-1];return {x:p?.x ?? 0,y:p?.y ?? 0};});
}
/** 2点を結ぶ緩い弧の制御点。向き dir の左へ膨らむ（時計回りの番では机の内側、2人なら行きと帰りで上下に分かれる）。 @param {Point} a @param {Point} b @param {Point} dir */
function control(a,b,dir) {
  const len=Math.hypot(dir.x,dir.y)||1;const span=Math.hypot(b.x-a.x,b.y-a.y);const bulge=clamp(span*.16,Math.min(22,span*.2),140);
  return {x:(a.x+b.x)/2-dir.y/len*bulge,y:(a.y+b.y)/2+dir.x/len*bulge};
}
/** @param {Point} a @param {Point} c @param {Point} b @param {number} t */
function bezier(a,c,b,t) {const u=1-t;return {x:u*u*a.x+2*u*t*c.x+t*t*b.x,y:u*u*a.y+2*u*t*c.y+t*t*b.y};}
/** @param {Element} node */
function angleOf(node) {const v=getComputedStyle(node).rotate;return v && v !== 'none' ? Number.parseFloat(v) || 0 : 0;}

/** @param {HTMLElement} stage @param {HTMLElement} status @param {Hooks} hooks */
export function createView(stage,status,hooks) {
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const still=()=>motion.matches;
  /** @type {ReadonlyMap<number,Look>} */ let looks=new Map();
  /** @type {Host} */ let host={paused:false,connected:true,visible:true};
  let frozen=false;let announced='';let introKey='';let shapeKey='';let finale=0;let disposed=false;
  /** 最後に受け取ったモデル（画面が向かう先）と、いま机に描き終えているモデル。番と案内の文字は後者に合わせる。 */
  /** @type {Model|null} */ let target=null;
  /** @type {Model|null} */ let shown=null;
  /** @type {Board|null} */ let board=null;
  /** @type {Run|null} */ let run=null;
  /** @type {Promise<void>} */ let chain=Promise.resolve();
  const observer=new ResizeObserver(()=>{
    if(!board) return;
    const size=`${board.table.clientWidth}x${board.table.clientHeight}`;
    if(size === board.size) return;
    // 幅が変わったら（窓の大きさが変わったら）飛んでいる札の座標が古くなるので演出を飛ばす。高さだけなら並べ直すだけ。
    if(run && size.split('x')[0] !== board.size.split('x')[0]) skip(run);
    board.size=size;layout();
  });

  // 書体が替わる（棚の画像を撮る道具が差し替えて resize を送る）と名前の幅が変わるので、並べ直す。
  const relayout=()=>{if(board && !run) layout();};
  addEventListener('resize',relayout);document.fonts?.addEventListener('loadingdone',relayout);

  /** @param {Run} r */
  function skip(r) {r.skip=true;for(const a of [...r.anims]) a.finish();}
  /** WAAPI の動き。止まっている間に始めた動きも止め、飛ばすときは即座に終える。 @param {Element} node @param {Keyframe[]} frames @param {KeyframeAnimationOptions} opts @param {Run} r */
  function anim(node,frames,opts,r) {
    const a=node.animate(frames,opts);r.anims.add(a);
    if(r.skip) a.finish();else if(frozen) a.pause();
    return a.finished.then(()=>{},()=>{}).finally(()=>{r.anims.delete(a);});
  }
  /** 止まる間は進まない待ち時間。 @param {number} ms @param {Run} r */
  function wait(ms,r) {return board ? anim(board.fx,[{opacity:1},{opacity:1}],{duration:ms},r) : Promise.resolve();}
  /** 机の左上を原点にした中心。 @param {Element} node */
  function centerOf(node) {
    const box=board?.inner.getBoundingClientRect();const r=node.getBoundingClientRect();
    return {x:r.left+r.width/2-(box?.left ?? 0),y:r.top+r.height/2-(box?.top ?? 0)};
  }
  /** 机の左上を原点にした箱。 @param {Element} node */
  function boxOf(node) {
    const box=board?.inner.getBoundingClientRect();const r=node.getBoundingClientRect();
    const x=r.left-(box?.left ?? 0);const y=r.top-(box?.top ?? 0);
    return {l:x,t:y,r:x+r.width,b:y+r.height};
  }
  /** 箱の中の点 p から向き d へ進み、箱（余白 m）を出る点。 @param {Point} p @param {Point} d @param {{l:number,t:number,r:number,b:number}} box @param {number} m */
  function exit(p,d,box,m) {
    const tx=d.x>0 ? (box.r+m-p.x)/d.x : d.x<0 ? (box.l-m-p.x)/d.x : Infinity;
    const ty=d.y>0 ? (box.b+m-p.y)/d.y : d.y<0 ? (box.t-m-p.y)/d.y : Infinity;
    const t=Math.max(0,Math.min(tx,ty));
    return {x:p.x+d.x*t,y:p.y+d.y*t};
  }
  /** fx 層に、同じ大きさの札の写しを置く。 @param {HTMLElement} node @param {HTMLElement} like */
  function flyer(node,like) {
    node.classList.add('fly');node.style.width=`${like.offsetWidth}px`;node.style.height=`${like.offsetHeight}px`;
    board?.fx.append(node);return node;
  }
  /** @param {HTMLElement} node @param {Point} c @param {number} rot @param {number} scale @param {number} [flip] */
  function place(node,c,rot,scale,flip=0) {
    return `translate(${(c.x-node.offsetWidth/2).toFixed(1)}px,${(c.y-node.offsetHeight/2).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${scale.toFixed(3)}) perspective(520px) rotateY(${flip}deg)`;
  }
  /** 弧に沿って飛ぶ動きのキーフレーム。途中で少し大きくなる。 @param {HTMLElement} node @param {Point} a @param {Point} b @param {Point} dir @param {[number,number]} rot @param {[number,number]} scale */
  function arc(node,a,b,dir,rot,scale) {
    const c=control(a,b,dir);
    return [0,.2,.4,.6,.8,1].map((t)=>({transform:place(node,bezier(a,c,b,t),rot[0]+(rot[1]-rot[0])*t,scale[0]+(scale[1]-scale[0])*t+Math.sin(t*Math.PI)*.12)}));
  }

  // ── 席と札 ──
  /** @param {SeatNode} S */
  function indexFan(S) {
    S.fan.style.setProperty('--n',String(Math.max(1,S.cards.length)));
    S.cards.forEach((c,i)=>c.style.setProperty('--i',String(i)));
  }
  /** @param {SeatNode} S @param {number} count */
  function setFan(S,count) {
    while(S.cards.length>count) S.cards.pop()?.remove();
    while(S.cards.length<count) {const c=backCard();S.fan.append(c);S.cards.push(c);}
    indexFan(S);
  }
  /** @param {SeatNode} S @param {number} k */
  function takeCard(S,k) {const [c]=S.cards.splice(k,1);c?.remove();indexFan(S);}
  /** 右端に伏せた札を足す（届くまでは見えない）。 @param {SeatNode} S */
  function addCard(S) {const c=backCard();c.style.visibility='hidden';S.fan.append(c);S.cards.push(c);indexFan(S);return c;}
  /** @param {SeatView} seat */
  function makeSeat(seat) {
    const root=el('li','seat');root.dataset.seat=String(seat.id);
    const fan=el('div','seat-fan');fan.setAttribute('aria-hidden','true');
    const head=el('p','seat-who');const markBox=el('span','seat-mark-box');const name=el('span','seat-name');head.append(markBox,name);
    const tag=el('span','seat-tag');const meta=el('p','seat-meta');const badge=el('span','seat-rank');badge.setAttribute('aria-hidden','true');
    root.append(tag,fan,head,meta,badge);
    /** @type {SeatNode} */ const node={root,fan,cards:[],mark:markBox,name,meta,tag,badge,joker:null,look:''};
    return node;
  }
  /** @param {Model} model @param {SeatView} seat @param {SeatNode} S @param {boolean} [roles] */
  function setSeat(model,seat,S,roles=true) {
    const look=looks.get(seat.id);const lookKey=look ? `${look.color}${look.path}` : '';
    if(S.look !== lookKey) {S.look=lookKey;S.mark.replaceChildren(mark(look));}
    S.name.textContent=seat.name;
    const out=seat.rank !== null && seat.count === 0;const last=model.phase === 'ended' && seat.rank !== null && seat.count>0;
    const role=roles && model.phase === 'play' && !seat.left ? model.turn?.from === seat.id ? 'from' : model.turn?.to === seat.id ? 'to' : '' : '';
    S.root.dataset.role=role;
    S.tag.textContent=role === 'from' ? 'ひく番' : role === 'to' ? 'ひかれています' : '';
    S.root.toggleAttribute('data-out',out);S.root.toggleAttribute('data-left',seat.left);
    S.root.toggleAttribute('data-offline',!seat.left && !seat.online);S.root.toggleAttribute('data-last',last);
    S.badge.textContent=out ? `${seat.rank}位` : '';
    S.meta.textContent=seat.left ? '退出' : out ? `上がり・${seat.rank}位` : last ? '最後まで残った' : `${seat.count}枚${seat.online ? '' : '・接続待ち'}`;
  }
  /** 捨て札の上に、最後の6枚（3組）を表で重ねる。位置は札の通し番号で決まり、描き直しても動かない。 @param {readonly string[]} discard @param {number} [hideFrom] */
  function renderPile(discard,hideFrom=discard.length) {
    if(!board) return [];
    const shown=discard.slice(-6);const base=discard.length-shown.length;
    const nodes=shown.map((card,k)=>{
      const index=base+k;const pair=Math.floor(index/2);const side=index%2 ? 1 : -1;const node=faceCard(card);
      node.style.setProperty('--px',(((pair*31)%21-10)/10*.4+side*.34).toFixed(3));
      node.style.setProperty('--py',(((pair*17)%11-5)/5*.1).toFixed(3));
      node.style.setProperty('--pr',`${(pair*47)%25-12+side*5}deg`);
      if(index>=hideFrom) node.style.visibility='hidden';
      return node;
    });
    board.pileCards.replaceChildren(...nodes);
    board.pileCount.replaceChildren(el('span','pile-label','捨て札'),el('strong','pile-number',String(discard.length)),el('span','pile-label','枚'));
    return nodes;
  }

  // ── 線（引く人 → 引かれる人） ──
  /** @param {Model['turn']} turn @param {Run|null} grow */
  function drawLine(turn,grow) {
    if(!board) return;
    const F=turn ? board.seats.get(turn.from) : undefined;const T=turn ? board.seats.get(turn.to) : undefined;
    const fresh=JSON.stringify(turn) !== JSON.stringify(board.lineTurn);board.lineTurn=F && T && F !== T ? turn : null;
    if(!F || !T || F === T) {board.path.setAttribute('d','');board.tip.setAttribute('d','');return;}
    const a=centerOf(F.fan);const b=centerOf(T.fan);const len=Math.hypot(b.x-a.x,b.y-a.y);
    if(len<1) return;
    // 線は席の箱の外側だけに引く（箱の中は席が隠すので、矢じりを引かれる人の箱の手前に置く）。
    const u={x:(b.x-a.x)/len,y:(b.y-a.y)/len};
    const e=exit(b,{x:-u.x,y:-u.y},boxOf(T.root),12);let s=exit(a,u,boxOf(F.root),4);
    if((e.x-s.x)*u.x+(e.y-s.y)*u.y<10) s={x:e.x-u.x*10,y:e.y-u.y*10};
    const c=control(s,e,u);
    board.path.setAttribute('d',`M${s.x.toFixed(1)} ${s.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`);
    const dl=Math.hypot(e.x-c.x,e.y-c.y)||1;const d={x:(e.x-c.x)/dl,y:(e.y-c.y)/dl};const w=8;
    const tip=[{x:e.x+d.x*w,y:e.y+d.y*w},{x:e.x-d.y*w*.7-d.x*w*.5,y:e.y+d.x*w*.7-d.y*w*.5},{x:e.x+d.y*w*.7-d.x*w*.5,y:e.y-d.x*w*.7-d.y*w*.5}];
    board.tip.setAttribute('d',`M${tip.map((p)=>`${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`);
    if(grow && fresh && !still()) {
      const total=board.path.getTotalLength().toFixed(1);
      void anim(board.path,[{strokeDasharray:total,strokeDashoffset:total},{strokeDasharray:total,strokeDashoffset:'0'}],{duration:MS.line,easing:'cubic-bezier(.3,.7,.2,1)'},grow);
      void anim(board.tip,[{opacity:0},{opacity:0,offset:.65},{opacity:1}],{duration:MS.line+120,easing:'ease-out'},grow);
    }
  }

  // ── 配置：幅が足りなければ2列。足りれば楕円に並べ、席と捨て札が重ならない最大の札の大きさを選ぶ ──
  function layout() {
    if(!board) return;
    const W=board.table.clientWidth;const H=board.table.clientHeight;const n=board.order.length;const inner=board.inner.style;
    const nodes=board.order.map((id)=>board?.seats.get(id)).filter((s)=>s !== undefined);
    const columns=W<560;board.table.dataset.layout=columns ? 'columns' : 'ring';
    if(columns) {
      inner.setProperty('--card-w',`${clamp(Math.round(W*.08),22,34)}px`);inner.removeProperty('--seat-w');board.pile.style.top='';
      const half=Math.ceil(n/2);
      nodes.forEach((S,i)=>{S.root.style.left='';S.root.style.top='';S.root.style.gridArea=`${i<half ? half-i : i-half+1} / ${i<half ? 1 : 2}`;});
    } else {
      /** 席の上に出る札（ひく番など）のぶん、上へ少し広げて重なりを見る。 @param {{x:number,y:number,w:number,h:number}[]} boxes */
      const fits=(boxes)=>!boxes.some((a,i)=>boxes.some((b,j)=>j>i && Math.abs(a.x-b.x)<(a.w+b.w)/2+6 && Math.abs(a.y-b.y)<(a.h+b.h)/2+6));
      for(const size of CARD_SIZES) {
        inner.setProperty('--card-w',`${size}px`);inner.setProperty('--seat-w',`${clamp(Math.round(size*4.4),150,260)}px`);
        const sizes=nodes.map((S)=>({w:S.root.offsetWidth,h:S.root.offsetHeight+14}));
        const sw=Math.max(0,...sizes.map((s)=>s.w));const sh=Math.max(0,...sizes.map((s)=>s.h));
        const pts=ringPoints(n,Math.max(0,W/2-sw/2-6),Math.max(0,H/2-sh/2-4));
        nodes.forEach((S,i)=>{const p=pts[i] ?? {x:0,y:0};S.root.style.gridArea='';S.root.style.left=`${(W/2+p.x).toFixed(1)}px`;S.root.style.top=`${(H/2+p.y+7).toFixed(1)}px`;});
        const seats=pts.map((p,i)=>({x:p.x,y:p.y,w:sizes[i]?.w ?? 0,h:sizes[i]?.h ?? 0}));
        const pile={w:board.pile.offsetWidth,h:board.pile.offsetHeight};
        // 捨て札は中央に置く。席が中央の縦の線上にあるとき（奇数人など）は、空いている上下へずらす。
        const dy=[0,.2,-.2,.34,-.34].map((f)=>f*H).find((y)=>fits([...seats,{x:0,y,...pile}]));
        board.pile.style.top=`calc(50% + ${(dy ?? 0).toFixed(1)}px)`;
        if(fits(seats) && dy !== undefined) break;
      }
    }
    board.size=`${board.table.clientWidth}x${board.table.clientHeight}`;
    drawLine(board.lineTurn,null);
  }

  // ── 文字（番・案内・読み上げ） ──
  /** @param {Model} model */
  function blockers(model) {
    if(host.paused) return 'メニューを閉じるのを待っています';
    if(!host.connected) return '大画面の接続を待っています';
    if(!host.visible) return '大画面に戻るのを待っています';
    const away=model.seats.filter((s)=>!s.left && !s.online).map((s)=>`${s.name}さん`);
    return away.length ? `${away.join('・')}のスマホのつなぎ直しを待っています` : '';
  }
  /** @param {Model} model */
  function loserOf(model) {return model.phase === 'ended' && model.outcome === 'complete' ? model.seats.find((s)=>!s.left && s.rank !== null && s.count>0) : undefined;}
  /** @param {Model} model */
  function setCaption(model) {
    if(!board) return;
    const seat=(/** @type {number|undefined} */ id)=>model.seats.find((s)=>s.id === id);
    const loser=loserOf(model);
    if(model.phase === 'ended') board.line.replaceChildren(...(loser ? [el('span','turn-verb','ジョーカーは'),who(loser,looks),el('span','turn-verb','の手に')] : [el('span','turn-verb','参加者が退出したため、勝敗なしで終わります')]));
    else if(model.turn) board.line.replaceChildren(who(seat(model.turn.from),looks),el('span','turn-verb','が'),who(seat(model.turn.to),looks),el('span','turn-verb','から1枚ひく'));
    else board.line.replaceChildren();
  }
  /** @param {Model} model */
  function setText(model) {
    if(!board) return;
    const wait=blockers(model);const loser=loserOf(model);
    const playing=model.seats.filter((s)=>!s.left);const outs=playing.filter((s)=>s.rank !== null && s.count === 0).length;
    board.edition.textContent=`上がり ${outs}人 / ${playing.length}人`;
    board.eyebrow.textContent=model.phase === 'ended' ? model.outcome === 'complete' ? '勝負あり' : '勝負なし' : wait ? 'ひと休み中' : 'いまの番';
    const from=model.seats.find((s)=>s.id === model.turn?.from);const to=model.seats.find((s)=>s.id === model.turn?.to);
    board.guide.textContent=model.phase === 'ended' ? loser ? '最後に残った人が、ジョーカーを持っていました' : '結果を出します'
      : wait || (from && to ? `${from.name}さんのスマホで、${to.name}さんの札を1枚えらんで「ひく」` : '');
    stage.toggleAttribute('data-blocked',model.phase === 'play' && wait !== '');
  }
  /** @param {Model} model */
  function narrate(model) {
    const name=(/** @type {number|undefined} */ id)=>model.seats.find((s)=>s.id === id)?.name ?? '';
    /** @type {string[]} */ const parts=[];
    for(const ev of model.events) {
      if(ev.type === 'draw') parts.push(`${name(ev.from)}さんが${name(ev.to)}さんから1枚ひきました`);
      else if(ev.type === 'pair') parts.push(`ペア成立、${ev.cards.map(cardName).join('と')}を捨てました`);
      else if(model.seats.find((s)=>s.id === ev.p)?.count === 0) parts.push(`${name(ev.p)}さんが上がり、${ev.rank}位`);
    }
    const loser=loserOf(model);const wait=blockers(model);
    if(model.phase === 'play' && model.turn) parts.push(`${name(model.turn.from)}さんが${name(model.turn.to)}さんの札をひく番です`);
    if(model.phase === 'ended') parts.push(loser ? `勝負あり。ジョーカーは${loser.name}さんの手に` : '参加者が退出したため、勝敗なしで終わります');
    if(wait && model.phase === 'play') parts.push(wait);
    const say=parts.join('。');
    if(say && say !== announced) {announced=say;status.textContent=`${say}。`;}
  }

  // ── 盤面を組む・最終の形にそろえる ──
  /** @param {Model} model */
  function buildBoard(model) {
    const header=el('header','topbar');const edition=el('p','edition');
    header.append(el('p','brand','IRORI / HEARTH JOKER'),edition);
    const content=el('section','content content--table');
    const turn=el('div','turn');const eyebrow=el('p','eyebrow');const line=el('p','turn-line');turn.append(eyebrow,line);
    const table=el('div','table');const inner=el('div','table-inner');
    const svg=svgEl('svg','reach');svg.setAttribute('aria-hidden','true');
    const path=svgEl('path','reach-line');const tip=svgEl('path','reach-tip');svg.append(path,tip);
    const pile=el('div','pile');const pileCards=el('div','pile-cards');pileCards.setAttribute('aria-hidden','true');const pileCount=el('p','pile-count');
    pile.append(pileCards,pileCount);
    const list=el('ul','seats');list.setAttribute('aria-label','席と手札の枚数');
    const fx=el('div','fx');fx.setAttribute('aria-hidden','true');
    inner.append(svg,pile,list,fx);table.append(inner);content.append(turn,table);
    const footer=el('footer','footer');const guide=el('p','progress-guide');
    footer.append(guide,el('p','fine-print','ペアは自動で捨てます · ひかれる人の札の並びは、毎回入れ替わります · 引いた札は本人のスマホにだけ出ます'));
    stage.className='game game--table';stage.replaceChildren(header,content,footer);
    /** @type {Map<number,SeatNode>} */ const seats=new Map();
    const order=[...model.seats].sort((a,b)=>a.id-b.id).map((s)=>s.id);
    for(const seat of order.map((id)=>model.seats.find((s)=>s.id === id))) {if(!seat) continue;const S=makeSeat(seat);seats.set(seat.id,S);list.append(S.root);setSeat(model,seat,S,false);}
    board={edition,eyebrow,line,table,inner,seats,order,pile,pileCards,pileCount,fx,path,tip,guide,lineTurn:null,size:''};
    layout();observer.observe(table);
  }
  /** モデルの最終の形に、机全体をそろえる。 @param {Model} model @param {Run|null} grow */
  function settle(model,grow) {
    if(!board) return;
    shown=model;
    for(const seat of model.seats) {const S=board.seats.get(seat.id);if(S) {setFan(S,seat.count);setSeat(model,seat,S);}}
    renderPile(model.discard);setText(model);setCaption(model);
    stage.classList.toggle('is-finale',model.phase === 'ended');
    const loser=loserOf(model);const S=loser ? board.seats.get(loser.id) : undefined;
    if(S) {showJoker(S).style.visibility='';const c=S.cards[S.cards.length-1];if(c) c.style.visibility='hidden';}
    layout();
    drawLine(model.phase === 'play' ? model.turn : null,grow);
  }
  /** 最後に残った人の席に、ジョーカーの絵を出す（終わった後だけ）。 @param {SeatNode} S */
  function showJoker(S) {
    if(!S.joker) {S.joker=jokerCard();S.joker.classList.add('seat-joker');S.root.append(S.joker);}
    return S.joker;
  }

  // ── 演出の各段 ──
  /** @param {Model} model @param {Run} r @param {(name:CueName)=>void} take */
  async function deal(model,r,take) {
    if(!board) return;
    take('deal');
    for(const seat of model.seats) {const S=board.seats.get(seat.id);if(S) {setFan(S,seat.count);setSeat(model,seat,S,false);S.badge.textContent='';}}
    setText(model);renderPile([]);board.eyebrow.textContent='はじまり';board.line.replaceChildren(el('span','turn-verb','札を配っています'));
    board.guide.textContent='同じ数の2枚は、配ったあと自動で捨てます';drawLine(null,null);layout();
    if(r.skip) return;
    const center=centerOf(board.pileCards);
    /** @type {Promise<void>[]} */
    const moves=[];
    model.seats.forEach((seat,si)=>{
      board?.seats.get(seat.id)?.cards.forEach((card,ci)=>{
        const c=centerOf(card);
        moves.push(still() ? anim(card,[{opacity:0},{opacity:1}],{duration:MS.fade,delay:si*40,fill:'backwards'},r)
          : anim(card,[{translate:`${(center.x-c.x).toFixed(1)}px ${(center.y-c.y).toFixed(1)}px`,opacity:0},{opacity:1,offset:.25},{translate:'0 0',opacity:1}],
            {duration:MS.deal,delay:si*MS.dealSeat+ci*MS.dealCard,easing:'cubic-bezier(.2,.8,.25,1.08)',fill:'backwards'},r));
      });
    });
    await Promise.all(moves);
    renderPile(model.discard);
    if(!r.skip) await anim(board.pileCards,still() ? [{opacity:0},{opacity:1}] : [{opacity:0,scale:.8},{opacity:1,scale:1.06,offset:.7},{opacity:1,scale:1}],{duration:still() ? MS.fade : 360,easing:'ease-out'},r);
    for(const ev of model.events) if(ev.type === 'out') await out(ev,model,r,take);
  }
  /** 引かれる人の扇の1枚が浮き、裏のまま線に沿って引く人の扇の右端へ移る。 @param {Extract<PublicEvent,{type:'draw'}>} ev @param {Run} r @param {(name:CueName)=>void} take */
  async function draw(ev,r,take) {
    const F=board?.seats.get(ev.from);const T=board?.seats.get(ev.to);
    if(!board || !F || !T) return;
    take('flip');
    const k=pick(ev.seq,T.cards.length);const card=T.cards[k];
    if(r.skip || !card || still()) {
      takeCard(T,k);addCard(F).style.visibility='';
      if(!r.skip && still()) await Promise.all([anim(T.fan,[{opacity:.35},{opacity:1}],{duration:MS.fade},r),anim(F.fan,[{opacity:.35},{opacity:1}],{duration:MS.fade},r)]);
      return;
    }
    await anim(card,[{translate:'0 0',scale:1},{translate:'0 -16px',scale:1.1}],{duration:MS.lift,easing:'cubic-bezier(.2,.9,.3,1.4)',fill:'forwards'},r);
    const a=centerOf(card);const rotA=angleOf(card);const clone=flyer(backCard(),card);
    const fanF=centerOf(F.fan);const fanT=centerOf(T.fan);
    takeCard(T,k);const slot=addCard(F);const b=centerOf(slot);const rotB=angleOf(slot);
    clone.style.transform=place(clone,a,rotA,1.1);
    await anim(clone,arc(clone,a,b,{x:fanT.x-fanF.x,y:fanT.y-fanF.y},[rotA,rotB],[1.1,1]),{duration:MS.fly,easing:'cubic-bezier(.3,.6,.25,1)'},r);
    slot.style.visibility='';clone.remove();
    void anim(slot,[{scale:1.16},{scale:.96,offset:.6},{scale:1}],{duration:220,easing:'ease-out'},r);
  }
  /** ペアができたときだけ、2枚が表になって中央の捨て札へ流れる。 @param {Extract<PublicEvent,{type:'pair'}>} ev @param {readonly string[]} before @param {Run} r @param {(name:CueName)=>void} take */
  async function pair(ev,before,r,take) {
    const S=board?.seats.get(ev.p);
    if(!board || !S) return;
    const after=[...before,...ev.cards];
    const newest=S.cards[S.cards.length-1];const mate=S.cards[pick(ev.seq,S.cards.length-1)];
    if(r.skip || still() || !newest || !mate || newest === mate) {
      setFan(S,Math.max(0,S.cards.length-2));renderPile(after);take('place');
      if(!r.skip && still()) await anim(board.pileCards,[{opacity:.4},{opacity:1}],{duration:MS.fade},r);
      return;
    }
    await wait(MS.beat,r);
    // 引いた札（右端）は判定の pair の後ろの札、もう1枚は前の札。どちらも公開イベントの中身だけを表にする。
    // 2枚は扇の上で左右に並べてから返す（重なって数字が隠れないように）。
    const mid=centerOf(S.fan);const w=newest.offsetWidth;const h=newest.offsetHeight;
    const pairs=[{node:newest,card:ev.cards[1] ?? '',side:1},{node:mate,card:ev.cards[0] ?? '',side:-1}].map(({node,card,side})=>{
      const c=centerOf(node);const rot=angleOf(node);const clone=flyer(backCard(),node);
      node.style.visibility='hidden';clone.style.transform=place(clone,c,rot,1);
      return {node,card,c,rot,clone,up:{x:mid.x+side*w*.62,y:mid.y-h*.45}};
    });
    await Promise.all(pairs.map((p)=>anim(p.clone,[{transform:place(p.clone,p.c,p.rot,1)},{transform:place(p.clone,p.up,p.rot/2,1.12,90)}],{duration:MS.flip/2,easing:'ease-in'},r)));
    for(const p of pairs) become(p.clone,faceCard(p.card));
    await Promise.all(pairs.map((p)=>anim(p.clone,[{transform:place(p.clone,p.up,p.rot/2,1.12,90)},{transform:place(p.clone,p.up,0,1.2,0)}],{duration:MS.flip/2,easing:'cubic-bezier(.2,.8,.3,1.3)',fill:'forwards'},r)));
    await wait(MS.beat*2,r);
    for(const p of pairs) {const i=S.cards.indexOf(p.node);if(i>=0) takeCard(S,i);}
    const slots=renderPile(after,before.length);const from=centerOf(S.fan);const to=centerOf(board.pile);
    const targets=[slots[slots.length-1],slots[slots.length-2]];
    await Promise.all(pairs.map((p,i)=>{
      const slot=targets[i];if(!slot) return Promise.resolve();
      return anim(p.clone,arc(p.clone,p.up,centerOf(slot),{x:to.x-from.x,y:to.y-from.y},[0,angleOf(slot)],[1.2,1]),{duration:MS.pile,delay:i*60,easing:'cubic-bezier(.3,.6,.25,1)',fill:'forwards'},r);
    }));
    take('place');
    for(const p of pairs) p.clone.remove();
    for(const slot of targets) if(slot) {slot.style.visibility='';void anim(slot,[{scale:1.14},{scale:1}],{duration:200,easing:'ease-out'},r);}
  }
  /** 上がった人の席に、順位の札が弾んで付く。 @param {Extract<PublicEvent,{type:'out'}>} ev @param {Model} model @param {Run} r @param {(name:CueName)=>void} take */
  async function out(ev,model,r,take) {
    const seat=model.seats.find((s)=>s.id === ev.p);const S=board?.seats.get(ev.p);
    if(!seat || !S || seat.count>0) return;
    setFan(S,0);setSeat(model,seat,S,false);take('win');
    if(r.skip) return;
    await anim(S.badge,still() ? [{opacity:0},{opacity:1}]
      : [{opacity:0,scale:.2,translate:'0 -30px'},{opacity:1,scale:1.32,translate:'0 0',offset:.5},{scale:.9,offset:.74},{scale:1.04,offset:.88},{scale:1}],
    {duration:still() ? MS.fade : MS.badge,easing:'ease-out'},r);
  }
  /** 最後に残った人が、何も言わずにジョーカーを表にする（結果へ進む前の短い間）。 @param {Model} model @param {Run} r @param {(name:CueName)=>void} take */
  async function reveal(model,r,take) {
    if(!board) return;
    const loser=loserOf(model);
    shown=model;stage.classList.add('is-finale');drawLine(null,null);setText(model);setCaption(model);
    const S=loser ? board.seats.get(loser.id) : undefined;
    if(!loser || !S) return;
    setSeat(model,loser,S);
    const source=S.cards[S.cards.length-1];const joker=showJoker(S);
    take('lose');
    if(r.skip || !source) return;
    if(still()) {source.style.visibility='hidden';await anim(joker,[{opacity:0},{opacity:1}],{duration:MS.fade*1.6,easing:'ease-out'},r);return;}
    joker.style.visibility='hidden';await wait(MS.beat*2,r);
    const a=centerOf(source);const rot=angleOf(source);const b=centerOf(joker);const clone=flyer(backCard(),source);
    source.style.visibility='hidden';const grow=joker.offsetWidth/(source.offsetWidth||1);
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2-source.offsetHeight*.25};
    clone.style.transform=place(clone,a,rot,1);
    await anim(clone,[{transform:place(clone,a,rot,1)},{transform:place(clone,mid,rot/2,(1+grow)/2,90)}],{duration:MS.rise,easing:'cubic-bezier(.4,0,.6,1)'},r);
    become(clone,jokerCard());
    await anim(clone,[{transform:place(clone,mid,rot/2,(1+grow)/2,90)},{transform:place(clone,b,0,grow,0)}],{duration:MS.reveal,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'},r);
    joker.style.visibility='';clone.remove();
    void anim(joker,[{filter:'drop-shadow(0 0 0 #ff8a3d00)'},{filter:'drop-shadow(0 0 18px #ff8a3daa)'},{filter:'drop-shadow(0 0 10px #ff8a3d77)'}],{duration:900,easing:'ease-out'},r);
  }

  /** @param {Model|null} prev @param {Model} next @param {readonly CueEffect[]} cues @param {Run} r */
  async function play(prev,next,cues,r) {
    const queue=[...cues];
    /** @param {CueName} name */
    const take=(name)=>{const i=queue.findIndex((c)=>c.name === name);if(i<0) return;const [c]=queue.splice(i,1);if(c && !disposed) hooks.cue(c.name,c.v);};
    stage.dataset.busy='';
    try {
      if(!prev) await deal(next,r,take);
      else {
        let discard=[...prev.discard];
        for(const ev of next.events) {
          if(ev.type === 'draw') await draw(ev,r,take);
          else if(ev.type === 'pair') {await pair(ev,discard,r,take);discard=[...discard,...ev.cards];}
          else await out(ev,next,r,take);
        }
      }
      if(next.phase === 'ended') await reveal(next,r,take);
    } finally {
      for(const c of queue) if(!disposed) hooks.cue(c.name,c.v);
      // 演出の途中で届いた「机の形が同じ」モデル（接続の揺れなど）があれば、その最新を描く。
      settle(target && tableKey(target) === tableKey(next) ? target : next,r.skip ? null : r);
      if(run === r) {run=null;delete stage.dataset.busy;}
    }
  }
  /** 結果へ進む前に待つ長さ。止まっている間は main.js の時計も止まる。 @param {Model} model */
  function finaleLength(model) {
    if(still()) return MS.fade*(2+model.events.length)+(loserOf(model) ? MS.hold : 1600);
    let ms=0;
    for(const ev of model.events) ms+=ev.type === 'draw' ? MS.lift+MS.fly : ev.type === 'pair' ? MS.beat*3+MS.flip+MS.pile+60 : model.seats.find((s)=>s.id === ev.p)?.count === 0 ? MS.badge : 0;
    return ms+(loserOf(model) ? MS.beat*2+MS.rise+MS.reveal+MS.hold : 1600);
  }

  // ── 導入画面 ──
  /** @param {Model} model */
  function renderIntro(model) {
    const header=el('header','topbar');header.append(el('p','brand','IRORI / HEARTH JOKER'),el('p','edition','2〜8人 · 1回およそ5〜8分'));
    const content=el('section','content content--intro');
    const hero=el('div','hero');const copy=el('div','hero-copy');
    copy.append(el('p','eyebrow','表情を読む、となりの1枚。'),el('h1','title','ババ抜き'),el('p','tagline','最後にジョーカーを持っていた人の負け。'));
    const art=el('div','hero-art');art.setAttribute('aria-hidden','true');
    const fan=el('div','art-fan');[backCard(),backCard(),backCard(),backCard(),jokerCard()].forEach((c,i)=>{c.style.setProperty('--i',String(i));fan.append(c);});
    fan.style.setProperty('--n','5');art.append(fan);hero.append(copy,art);
    const rules=el('ol','rules');
    RULES.forEach((text,i)=>{const li=el('li','rule');li.append(el('span','rule-number',String(i+1)),el('span','rule-copy',text));rules.append(li);});
    const names=el('ul','intro-players');names.setAttribute('aria-label','参加者');
    for(const seat of [...model.seats].sort((a,b)=>a.id-b.id)) {const li=el('li','intro-player');li.append(who(seat,looks));names.append(li);}
    content.append(hero,rules,names);
    const leader=model.seats.find((s)=>s.id === model.leader);const wait=blockers(model);const n=model.seats.length;
    const guide=wait || (model.canBegin && leader ? `${leader.name}さんのスマホで「はじめる」` : n<2 ? '2人以上そろうと遊べます' : n>8 ? '遊べるのは8人までです' : 'みんながそろうのを待っています');
    const footer=el('footer','footer');
    footer.append(el('p','progress-guide',guide),el('p','fine-print','ジョーカーは灯の札。引いた札は本人のスマホにだけ出ます。'));
    stage.className='game game--intro';stage.replaceChildren(header,content,footer);
    if(guide !== announced) {announced=guide;status.textContent=`ババ抜き。${guide}。`;}
  }

  /** 一時停止・切断・非表示の間は、動きを止める。 @param {Host} next */
  function setHost(next) {
    host=next;
    const stop=next.paused || !next.connected || !next.visible;
    if(stop !== frozen) {
      frozen=stop;stage.toggleAttribute('data-frozen',stop);
      for(const a of stage.getAnimations({subtree:true})) {if(stop) a.pause();else if(a.playState === 'paused') a.play();}
    }
    if(!target) return;
    if(target.phase === 'intro') {const key=JSON.stringify([target,next]);if(key !== introKey) {introKey=key;renderIntro(target);}}
    else if(board) {if(shown) setText(shown);narrate(target);}
  }
  /** @param {Model} model @param {ReadonlyMap<number,Look>} nextLooks @param {Host} nextHost @param {readonly CueEffect[]} [cues] */
  function render(model,nextLooks,nextHost,cues=[]) {
    if(disposed) return;
    looks=nextLooks;
    document.documentElement.dataset.phase=model.phase;
    const prev=target;target=model;
    if(model.phase === 'intro') {setHost(nextHost);return;}
    if(!board) buildBoard(model);
    const shape=tableKey(model);
    if(shape === shapeKey) {
      // 机の形が同じ（接続の揺れ・名前・一時停止）：文字と印だけ直し、演出は切らない。
      if(!run) shown=model;
      for(const seat of model.seats) {const S=board?.seats.get(seat.id);if(S && !run) setSeat(model,seat,S);else S?.root.toggleAttribute('data-offline',!seat.left && !seat.online);}
      for(const c of cues) hooks.cue(c.name,c.v);
      setHost(nextHost);return;
    }
    shapeKey=shape;
    if(run) skip(run);
    /** @type {Run} */ const r={skip:false,anims:new Set()};run=r;
    if(model.phase === 'ended') finale=finaleLength(model);
    setHost(nextHost);
    chain=chain.then(()=>play(prev && prev.phase !== 'intro' ? prev : null,model,cues,r)).catch(()=>{});
  }
  /** @param {string} title @param {string} body @param {'unsupported'|'error'} phase */
  function showMessage(title,body,phase) {
    if(run) skip(run);
    observer.disconnect();board=null;target=null;
    document.documentElement.dataset.phase=phase;
    stage.className='game game--message';
    stage.replaceChildren(el('h1','message-title',title),el('p','message-copy',body));
    status.textContent=`${title}。${body}`;
  }
  return {render,setHost,showMessage,finaleMs:()=>finale,dispose(){
    disposed=true;observer.disconnect();removeEventListener('resize',relayout);document.fonts?.removeEventListener('loadingdone',relayout);
  }};
}
