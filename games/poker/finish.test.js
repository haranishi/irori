// @vitest-environment happy-dom
import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView,legalActions} from './logic.js';
import {createView,eventText,cardFace} from './view.js';
import {kickerText} from './presentation.js';
import {evaluate} from './cards.js';
const init=(n=4)=>createGame({players:Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true})),leader:1,seed:52,nonce:'finish',environment:{connected:true,visible:true}}).state;
function press(s,p,index=0){const pad=viewFor(s,p).pad;return updateGame(s,{t:'input',p,input:{k:'tiles',t:pad.token,ids:[pad.tiles[index].id]}});}
function start(){return updateGame(press(init(),1).state,{t:'tick',ms:1200}).state;}
function result(n=4){const s=init(n);s.phase='showdown';s.handNumber=6;s.remaining=1;return updateGame(s,{t:'tick',ms:1}).state;}
function render(s){const root=document.createElement('main'),v=createView(root,document.createElement('p'));v.render(publicView(s));v.dispose();return root;}
describe('最後の仕上げの回帰',()=>{
  it('持ち点を使い切る時だけぜんぶ、他席による上限は上限まで',()=>{
    const s=start(),p=s.turn,own=s.seats.find(v=>v.id===p);
    expect(legalActions(s,p).find(a=>a.kind==='all').label).toMatch(/^ぜんぶ /);
    s.seats.find(v=>v.id!==p).points-=60;
    const a=legalActions(s,p).find(a=>a.kind==='all');
    expect(a.label).toBe(`上限まで ${a.amount}`);expect(a.amount).toBe(940);
    const pad=viewFor(s,p).pad;expect(pad.tiles.find(t=>t.label===a.label).sub).toBe('合計940点');
    expect(pad.tiles.every(t=>[...t.label].length<=12)).toBe(true);
    own.street=0;s.current=940;
    expect(legalActions(s,p).find(a=>a.kind==='all').label).toBe('上限まで 940');
  });
  it('同じ役の最初に差がつく残りの札の数を示す',()=>{
    const board=['s9','h9','d2','c3','s4'];
    const best=evaluate([...board,'h14','d13']);
    expect(kickerText(best,[best,evaluate([...board,'d14','h12'])])).toBe('K');
    expect(kickerText(best,[best,evaluate([...board,'d14','h12']),evaluate([...board,'h11','d10'])])).toBe('K');
    expect(kickerText(best,[best,best])).toBe('');
    const s=init(2);s.phase='showdown';s.board=board;s.revealed=[1,2];s.winners=[1];
    s.seats[0].hand=['h14','d13'];s.seats[1].hand=['d14','h12'];
    expect(publicView(s).seats[0].kickerRank).toBe('K');
    expect(render(s).querySelector('.kicker').textContent).toBe('残りの札 K');
  });
  it.each([true,false])('時間切れの実際の行動を履歴へ残す：そのまま=%s',check=>{
    let s=start();const own=s.seats.find(v=>v.id===s.turn);
    if(check)s.current=own.street;
    s=updateGame(s,{t:'tick',ms:25000}).state;
    expect(eventText(publicView(s),s.events.at(-1))).toContain(check?'時間切れでそのまま':'時間切れでおりた');
  });
  it('導入で行動の意味を120字以内に案内',()=>{
    const note=viewFor(init(),1).pad.note;
    for(const text of ['おりる＝やめる','そのまま＝出さずに進む','あわせる＝同じ額を出す','ふやす＝上乗せ','上限まで＝出せる最大','ぜんぶ＝持ち点すべて'])expect(note).toContain(text);
    expect([...note].length).toBeLessThanOrEqual(120);
  });
  it('手番中の中央に役の早見を強い順に出し、勝負では手札の場所を空ける',()=>{
    const s=start();
    expect(render(s).querySelector('.role-guide').textContent).toBe('強い順：ストレートフラッシュ＞フォーカード＞フルハウス＞フラッシュ＞ストレート＞スリーカード＞ツーペア＞ワンペア');
    s.phase='showdown';expect(render(s).querySelector('.role-guide')).toBeNull();
  });
  it('手番の補足は行動を選んでいます、ほかの席は従来の案内',()=>{
    const s=start(),root=render(s);
    expect(root.querySelector('[data-active=true] .seat-meta').textContent).toBe('行動を選んでいます');
    expect([...root.querySelectorAll('[data-active=false] .seat-meta')].some(n=>n.textContent==='待っています')).toBe(true);
  });
  it.each([[2,6000],[3,10000],[8,10000]])('公開%i席の勝負表示は%iミリ秒', (n,ms)=>{
    let s=init(n);s=press(s,1).state;
    for(let i=0;i<1000&&s.phase!=='showdown';i++){
      if(s.phase==='turn'){
        const v=viewFor(s,s.turn),index=v.actions.findIndex(a=>['check','call','all'].includes(a.kind));
        s=press(s,s.turn,index).state;
      }else s=updateGame(s,{t:'tick',ms:s.remaining}).state;
    }
    expect(s.revealed).toHaveLength(n);expect(s.remaining).toBe(ms);
    s=updateGame(s,{t:'tick',ms:ms-1}).state;expect(s.phase).toBe('showdown');
    expect(updateGame(s,{t:'tick',ms:1}).state.phase).toBe('deal');
  });
  it('小札の10は太い線と2桁用の幅で描く',()=>{
    const face=cardFace('s10');expect(face.querySelector('.number').dataset.digits).toBe('2');
    expect([...face.querySelectorAll('.number path')].every(n=>Number(n.getAttribute('stroke-width'))>=3.4)).toBe(true);
  });
});
describe('結果の次へ',()=>{
  it('全員の次へで即時に一度だけendし、押した席は待機',()=>{
    let s=result();
    for(const p of [1,2,3]){
      const pad=viewFor(s,p).pad;expect(pad.tiles.map(t=>t.label)).toEqual(['次へ']);
      s=updateGame(s,{t:'tick',ms:p*100}).state;
      const r=press(s,p);s=r.state;expect(r.effects.some(e=>e.t==='end')).toBe(false);
      expect(viewFor(s,p).pad.note).toBe('ほかの人を待っています');expect(viewFor(s,p).pad.disabled).toBe(true);
    }
    const r=press(s,4);expect(r.state.ended).toBe(true);expect(r.effects.filter(e=>e.t==='end')).toHaveLength(1);
    expect(updateGame(r.state,{t:'tick',ms:100}).effects).toEqual([]);
  });
  it('1人が押さない間は最長20秒、重複・古い入力で水増しできない',()=>{
    let s=result(2);const pad=viewFor(s,1).pad;
    s=press(s,1).state;
    s=updateGame(s,{t:'input',p:1,input:{k:'tiles',t:pad.token,ids:[pad.tiles[0].id]}}).state;
    expect(s.ready).toEqual([1]);
    let r=updateGame(s,{t:'tick',ms:19999});expect(r.state.ended).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:1});expect(r.effects.filter(e=>e.t==='end')).toHaveLength(1);
  });
  it('退出席とCPUを数えず、結果での退出でも待機を解く',()=>{
    let s=result();s.seats[3].cpu=true;s.seats[2].left=true;
    s=press(s,1).state;const r=press(s,2);expect(r.state.ended).toBe(true);
    s=result(2);s=press(s,1).state;
    const left=updateGame(s,{t:'players',players:[{id:1,name:'席1',online:true}],leader:1});
    expect(left.state.ended).toBe(true);expect(left.effects.filter(e=>e.t==='end')).toHaveLength(1);
  });
  it('CPUだけは従来どおり20秒で自動終了',()=>{
    let s=result();s.seats.forEach(v=>v.cpu=true);
    s=updateGame(s,{t:'players',players:[],leader:null}).state;expect(s.ended).toBe(false);
    expect(updateGame(s,{t:'tick',ms:20000}).effects.filter(e=>e.t==='end')).toHaveLength(1);
  });
});

it('同じ結果画面から全員が同時に押しても、ほかの席の次へを無効にしない',()=>{
  let s=result();const pads=s.seats.map(v=>({p:v.id,pad:viewFor(s,v.id).pad}));
  for(const [i,{p,pad}] of pads.entries()){
    if(i)s=updateGame(s,{t:'tick',ms:i*100}).state;
    s=updateGame(s,{t:'input',p,input:{k:'tiles',t:pad.token,ids:[pad.tiles[0].id]}}).state;
  }
  expect(s.ended).toBe(true);expect(s.ready).toEqual([1,2,3,4]);
});
