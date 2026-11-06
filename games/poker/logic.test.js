import {describe,it,expect} from 'vitest';
import {createGame,updateGame,publicView,viewFor,legalActions,endRows} from './logic.js';
const env={connected:true,visible:true};
const players=(n=4)=>Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
function init(n=4){return createGame({players:players(n),leader:1,seed:52,nonce:'test',environment:env}).state;}
function pick(s,p,index){const v=viewFor(s,p);return updateGame(s,{t:'input',p,input:{k:'tiles',ids:[v.pad.tiles[index].id],t:v.pad.token}});}
function start(n=4){return updateGame(pick(init(n),1,0).state,{t:'tick',ms:1200}).state;}
function choose(s,kind){const i=legalActions(s,s.turn).findIndex(a=>a.kind===kind);expect(i).toBeGreaterThanOrEqual(0);return pick(s,s.turn,i).state;}
function total(s){return s.pot+s.seats.reduce((n,v)=>n+v.points,0);}
function freeze(s){Object.freeze(s);for(const v of s.seats)Object.freeze(v);return s;}
describe('進行・合法な一覧・持ち点',()=>{
  it('初期点・ブラインド・段階・親の移動・6ハンドとend一回',()=>{
    let s=start(),ends=0,prior=s.dealer;expect(s.pot).toBe(30);expect(s.current).toBe(20);
    const phases=new Set();
    for(let i=0;i<1000&&!s.ended;i++){
      phases.add(s.phase);expect(total(s)).toBe(4000);
      const action=s.phase==='turn'?{t:'input',p:s.turn,input:(()=>{const v=viewFor(s,s.turn),at=v.actions.findIndex(a=>a.kind==='check'||a.kind==='call'||a.kind==='all');return {k:'tiles',ids:[v.pad.tiles[at].id],t:v.pad.token};})()}:{t:'tick',ms:s.remaining};
      const r=updateGame(freeze(s),action);if(r.state.handNumber!==s.handNumber){expect(r.state.dealer).not.toBe(prior);prior=r.state.dealer;}s=r.state;ends+=r.effects.filter(e=>e.t==='end').length;
    }
    expect(s.ended).toBe(true);expect(s.handNumber).toBe(6);expect(ends).toBe(1);expect(phases).toEqual(new Set(['deal','turn','flop','fourth','river','showdown','result']));expect(updateGame(s,{t:'tick',ms:99999}).effects).toEqual([]);expect(total(s)).toBe(4000);
  });
  it('増やす3幅・直前幅・最小持ち点による上限',()=>{
    const s=start();expect(legalActions(s,s.turn).filter(a=>a.kind==='raise').map(a=>a.amount)).toEqual([60,50]);
    s.pot=200;s.lastRaise=80;expect(legalActions(s,s.turn).filter(a=>a.kind==='raise').map(a=>a.amount)).toEqual([120,220]);
    const other=s.seats.find(v=>v.id!==s.turn);other.points=90-other.street;
    const actions=legalActions(s,s.turn);expect(actions.filter(a=>a.kind==='raise')).toEqual([]);expect(actions.find(a=>a.kind==='all').amount).toBe(90-s.seats.find(v=>v.id===s.turn).street);
  });
  it('上限に届くと場を自動で開く。全点が保存される',()=>{
    let s=start(2);for(const v of s.seats)v.points=25-v.street;s.pot=s.seats.reduce((n,v)=>n+v.street,0);
    s=choose(s,'all');if(s.phase==='turn')s=choose(s,'all');
    for(let i=0;i<10&&s.phase!=='showdown';i++)s=updateGame(s,{t:'tick',ms:s.remaining}).state;
    expect(s.phase).toBe('showdown');expect(s.board).toHaveLength(5);expect(total(s)).toBe(50);
  });
  it('あわせるで上限が縮まらない',()=>{
    let s=start();const before=Math.max(...legalActions(s,s.turn).map(a=>a.amount+s.seats.find(v=>v.id===s.turn).street));s=choose(s,'call');const after=Math.max(...legalActions(s,s.turn).map(a=>a.amount+s.seats.find(v=>v.id===s.turn).street));expect(after).toBe(before);
  });
  it('全員がおりたら手札を公開せずたまりを渡す',()=>{let s=start();while(s.phase==='turn')s=choose(s,'fold');expect(s.phase).toBe('showdown');expect(s.revealed).toEqual([]);expect(publicView(s).seats.every(v=>!('hand'in v))).toBe(true);expect(total(s)).toBe(4000);});
  it('完全な同点の等分・端数は親の次から',()=>{
    let s=start(3);s.board=['s10','s11','s12','s13','s14'];s.streetIndex=3;s.current=0;s.pot=5;s.dealer=1;s.pending=[1,2,3];s.turn=1;
    for(const [i,v]of s.seats.entries()){v.hand=[`h${i+2}`,`d${i+2}`];v.points=100;v.street=0;v.paid=0;}
    while(s.phase==='turn')s=choose(s,'check');expect(s.seats.map(v=>v.points)).toEqual([101,102,102]);expect(s.winners).toEqual([1,2,3]);expect(s.revealed).toHaveLength(3);
  });
  it('持ち点0は次のハンドで見るだけ。生存1席なら終了',()=>{
    let s=start();s.phase='showdown';s.remaining=1;for(const v of s.seats)v.points=v.id===1?4000:0;s.pot=0;
    s=updateGame(s,{t:'tick',ms:1}).state;expect(s.phase).toBe('result');expect(publicView(s).results.map(v=>v.rank)).toEqual([1,2,2,2]);
  });
});
describe('入力の拒否・時間・席',()=>{
  it.each(['番外','古いtoken','範囲外','複数','パス','種類'])('%sを拒み、本人tokenだけ進む',(kind)=>{
    const s=start(),p=kind==='番外'?s.seats.find(v=>v.id!==s.turn).id:s.turn,v=viewFor(s,p),input={k:'tiles',ids:[v.pad.tiles[0].id],t:v.pad.token};
    if(kind==='古いtoken')input.t='old';if(kind==='範囲外')input.ids=['bad'];if(kind==='複数')input.ids.push(input.ids[0]);if(kind==='パス')input.pass=true;if(kind==='種類')input.k='pick';
    const before=structuredClone(s),r=updateGame(freeze(s),{t:'input',p,input});expect(s).toEqual(before);const expected=structuredClone(s);expected.epochs[p]=(expected.epochs[p]??0)+1;expect(r.state).toEqual(expected);expect(r.effects).toHaveLength(1);expect(r.effects[0].to).toBe(p);
  });
  it('時間切れはそのまま又はおりる。接続切れでも時計は進む',()=>{
    let s=start(),p=s.turn;s.seats.find(v=>v.id===p).online=false;s=updateGame(s,{t:'tick',ms:25000}).state;expect(s.seats.find(v=>v.id===p).folded).toBe(true);
    s=start();s.current=s.seats.find(v=>v.id===s.turn).street;p=s.turn;s=updateGame(s,{t:'tick',ms:25000}).state;expect(s.seats.find(v=>v.id===p).folded).toBe(false);expect(s.events.at(-1).type).toBe('auto');
  });
  it.each([{t:'menu',paused:true},{t:'environment',value:null},{t:'environment',value:{connected:false,visible:true}},{t:'environment',value:{connected:true,visible:false}}])('停止中は時計と入力を止める %j',e=>{
    const s=updateGame(start(),e).state;expect(updateGame(s,{t:'tick',ms:99999}).state).toBe(s);expect(viewFor(s,s.turn).pad.disabled).toBe(true);
  });
  it('再開後は渡した差分だけ減らす。不正な時間を無視',()=>{let s=start();for(const ms of [0,-1,NaN,Infinity])expect(updateGame(s,{t:'tick',ms}).state).toBe(s);s=updateGame(s,{t:'menu',paused:true}).state;s=updateGame(s,{t:'menu',paused:false}).state;expect(updateGame(s,{t:'tick',ms:50}).state.remaining).toBe(24950);});
  it('開始前に親が退出したら有効な席へ親を移す',()=>{
    let s=init(3);const old=s.dealer;s=updateGame(s,{t:'players',players:players(3).filter(v=>v.id!==old),leader:players(3).find(v=>v.id!==old).id}).state;
    s=pick(s,s.leader,0).state;expect(s.dealer).not.toBe(old);expect(s.seats.find(v=>v.id===old).points).toBe(1000);expect(s.seats.find(v=>v.id===old).street).toBe(0);expect(total(s)).toBe(3000);
  });
  it('途中の退出はおりる。点と初期名簿の結果は残す',()=>{
    const s=start(),p=s.turn,r=updateGame(s,{t:'players',players:players().filter(v=>v.id!==p),leader:1});expect(r.state.seats.find(v=>v.id===p).left).toBe(true);expect(r.state.seats.find(v=>v.id===p).folded).toBe(true);expect(r.state.turn).not.toBe(p);expect(r.state.phase).toBe('turn');expect(total(r.state)).toBe(4000);
  });
  it.each(['intro','deal','turn','flop','fourth','river','showdown','result'])('%sで最後の人が退出すると勝負なしを1回だけ送る',phase=>{
    const s=start();s.phase=phase;const r=updateGame(s,{t:'players',players:[],leader:null});expect(r.state.ended).toBe(true);expect(r.state.outcome).toBe('incomplete');expect(total(r.state)).toBe(4000);expect(r.effects.filter(e=>e.t==='end')).toHaveLength(1);expect(endRows(r.state).every(v=>!v.ranked&&v.label==='勝負なし')).toBe(true);expect(updateGame(r.state,{t:'players',players:[],leader:null}).effects).toEqual([]);
  });
});
describe('秘匿と複製',()=>{
  it('他席の手札と山札を変えても公開状態と本人ビューは同じ',()=>{
    const a=start(),b=structuredClone(a);b.seats[1].hand=['s2','s3'];b.deck.reverse();b.rngState=0;expect(publicView(a)).toEqual(publicView(b));expect(viewFor(a,1)).toEqual(viewFor(b,1));expect(viewFor(a,1)).not.toHaveProperty('deck');expect(viewFor(a,1)).not.toHaveProperty('rngState');
    const view=viewFor(a,1);view.hand.pop();view.seats[0].points=9999;view.pad.tiles.pop();expect(a).toEqual(start());
  });
  it('効果は席別padだけに手札を載せる。全員宛てには出さない',()=>{
    const r=pick(init(),1,0);for(const e of r.effects){if(e.t==='pad'){expect(e.to).toBeDefined();const own=r.state.seats.find(v=>v.id===e.to);expect(e.spec.note).toContain(own.hand.map(c=>c[0]==='s'?'♠':'').join('')||'あなた');}else expect(e).not.toHaveProperty('hand');}
    expect(publicView(r.state).seats.every(v=>!('hand'in v))).toBe(true);
  });
});
