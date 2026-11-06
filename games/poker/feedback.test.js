// @vitest-environment happy-dom
import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView,legalActions} from './logic.js';
import {evaluate} from './cards.js';
import {roleText,currentRole} from './presentation.js';
import {createView} from './view.js';
const init=(n=4)=>createGame({players:Array.from({length:n},(_,i)=>({id:i+1,name:`席${i+1}`,online:true})),leader:1,seed:52,nonce:'feedback',environment:{connected:true,visible:true}}).state;
function pick(s,kind){
  const p=s.phase==='intro'?s.leader:s.turn,v=viewFor(s,p);
  const i=v.actions.findIndex(a=>a.kind===kind);
  expect(i).toBeGreaterThanOrEqual(0);
  return updateGame(s,{t:'input',p,input:{k:'tiles',t:v.pad.token,ids:[v.pad.tiles[i].id]}}).state;
}
const start=()=>updateGame(pick(init(),'start'),{t:'tick',ms:1200}).state;
function render(s){
  const stage=document.createElement('main'),status=document.createElement('p');
  const view=createView(stage,status);view.render(publicView(s));view.dispose();return stage;
}
function river(n=2){
  const s=init(n);s.phase='turn';s.handNumber=1;s.streetIndex=3;s.turn=1;s.pending=s.seats.map(v=>v.id);
  s.board=['s13','h5','d5','c8','s2'];s.pot=100;s.seats.forEach(v=>{v.hand=['h3','d4'];v.points=950;});
  return s;
}
describe('読み取れる行動と勝負の説明',()=>{
  it('出す点は追加額を含む今回の総額で、札の文字は上限内',()=>{
    const s=start(),v=viewFor(s,s.turn);
    for(const [i,a]of v.actions.entries()){
      const tile=v.pad.tiles[i];expect([...tile.label].length).toBeLessThanOrEqual(12);
      if(['call','raise','all'].includes(a.kind)){
        expect(tile.sub).toBe(`${a.kind==='call'?'出す':'合計'}${a.amount}点`);
        expect([...tile.sub].length).toBeLessThanOrEqual(12);
      }
    }
    expect(v.pad.tiles.find(t=>t.label==='ふやす +40').sub).toBe('合計60点');
    expect(v.pad.tiles.find(t=>t.label==='あわせる 20').sub).toBe('出す20点');
    expect(v.pad.tiles.find(t=>t.label.startsWith('ぜんぶ')).sub).toBe('合計1000点');
  });
  it.each([
    [['s13','h13','d2','c5','s9'],'ワンペア・K'],
    [['s13','h13','d5','c5','s9'],'ツーペア・K・5'],
    [['s5','h6','d7','c8','s9'],'ストレート・9まで'],
    [['s14','s12','s9','s6','s3'],'フラッシュ・Aまで'],
  ])('役の決め手を数字で添える %j',(cards,text)=>expect(roleText(evaluate(cards))).toBe(text));
  it.each([['s13','h5','d5','c8','s2'],['s13','h5','d4','c8','s2']])('同じ役のキッカーで勝った席だけに理由を示す %j',(...cards)=>{
    let s=river();s.board=cards.slice(0,5);s.seats[0].hand=['h13','d14'];s.seats[1].hand=['d13','h12'];
    s=pick(pick(s,'check'),'check');const m=publicView(s);
    expect(m.seats[0].role).toBe(m.seats[1].role);
    expect(m.seats.map(v=>v.kicker)).toEqual([true,false]);
    expect(render(s).querySelector('[data-id="1"]').textContent).toContain('残りの札 A');
    expect(render(s).querySelector('[data-id="2"]').textContent).not.toContain('残りの札 A');
  });
  it('役の数字が違う勝負を残りの札 Aと呼ばない',()=>{
    let s=river();s.seats[0].hand=['h13','d14'];s.seats[1].hand=['d12','h12'];
    s=pick(pick(s,'check'),'check');expect(publicView(s).seats.some(v=>v.kicker)).toBe(false);
  });
  it('配る前のたまりと席ごとの受取額を残し、次の配札で消す',()=>{
    let s=river();s.seats[0].hand=['h13','d14'];s.seats[1].hand=['d13','h12'];
    const total=s.pot+s.seats.reduce((n,v)=>n+v.points,0);
    s=pick(pick(s,'check'),'check');const m=publicView(s),stage=render(s);
    expect(s.pot).toBe(0);expect(m.pot).toBe(100);expect(m.seats.map(v=>v.received)).toEqual([100,0]);
    expect(stage.querySelector('.pot').textContent).toBe('たまり 100 点');
    expect(stage.querySelector('[data-id="1"] .seat-meta').textContent).toBe('＋100点');
    expect(s.pot+s.seats.reduce((n,v)=>n+v.points,0)).toBe(total);
    s=updateGame(s,{t:'tick',ms:s.remaining}).state;
    expect(s.phase).toBe('deal');expect(s.settledPot).toBe(0);expect(s.payouts).toEqual({});
    expect(publicView(s).seats.every(v=>v.received===0)).toBe(true);
  });
  it('同点は端数を含む実際の受取額を席別に表示',()=>{
    let s=river(3);s.board=['s10','s11','s12','s13','s14'];s.pot=5;s.dealer=1;
    s.seats.forEach((v,i)=>v.hand=[`h${i+2}`,`d${i+2}`]);
    s=pick(pick(pick(s,'check'),'check'),'check');
    expect(publicView(s).seats.map(v=>v.received)).toEqual([1,2,2]);
    expect(publicView(s).seats.every(v=>!v.kicker)).toBe(true);
  });
  it('1人残りでは札を開かず、受け取る人を見出しで知らせる',()=>{
    let s=start();while(s.phase==='turn')s=pick(s,'fold');
    const winner=s.seats.find(v=>s.winners.includes(v.id)),stage=render(s);
    expect(stage.querySelector('.turn-line').textContent).toBe(`1人残ったので、${winner.name}さんがたまりを受け取ります`);
    expect(stage.querySelector('.hand .face')).toBeNull();
    expect(publicView(s).seats.every(v=>!v.hand)).toBe(true);
  });
  it('配札は人数に依らず2枚ずつと案内',()=>{
    for(const n of [2,4,8])expect(render(pick(init(n),'start')).querySelector('.turn-line').textContent).toBe('手札を2枚ずつ配っています');
  });
  it('いまの役は本人の手札と公開札だけで決まり、120字以内',()=>{
    const s=start();s.seats[0].hand=['s13','h13'];s.board=['d2','c5','s9'];
    const note=viewFor(s,1).pad.note;expect(note).toContain('いまの役：ワンペア・K');
    s.seats[1].hand=['s14','h14'];s.deck.reverse();expect(viewFor(s,1).pad.note).toBe(note);
    s.board=[];expect(viewFor(s,1).pad.note).toContain('いまの役：ペア');
    expect(currentRole(['s14','h12'],['d2','c5','s9'])).toBe('なし（Aが最高）');
    for(const board of [[],['s2','s3','s4'],['s2','s3','s4','s5','s6']]){
      s.board=board;s.seats[0].hand=['s10','s11'];s.pot=8000;s.seats[0].points=8000;
      expect([...viewFor(s,1).pad.note].length).toBeLessThanOrEqual(120);
    }
  });
  it('0点で次の手札がない席には見るだけの案内と役の早見',()=>{
    const s=start();s.seats[0].points=0;s.seats[0].hand=[];s.seats[0].folded=true;
    const v=viewFor(s,1);expect(v.pad.disabled).toBe(true);expect(v.actions).toEqual([]);
    expect(v.pad.note).toContain('この局は見るだけ');
    expect(v.pad.note).toContain('ロイヤル＞ストフラ＞フォーカード＞フルハウス＞フラッシュ＞ストレート＞スリーカード＞ツーペア＞ワンペア');
    expect([...v.pad.note].length).toBeLessThanOrEqual(120);
  });
});
describe('結果と時計の読みやすさ',()=>{
  it('結果は20秒残し、その間はendを出さない',()=>{
    const s=init();s.phase='showdown';s.handNumber=6;s.remaining=1;
    let r=updateGame(s,{t:'tick',ms:1});expect(r.state.remaining).toBe(20000);
    expect(r.effects.some(e=>e.t==='end')).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:19999});expect(r.state.ended).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:1});expect(r.effects.filter(e=>e.t==='end')).toHaveLength(1);
  });
  it('時計の文字と輪は別の要素で、短い残秒へ更新しても保つ',()=>{
    const s=init();s.phase='result';s.remaining=20000;
    const stage=document.createElement('main'),status=document.createElement('p'),v=createView(stage,status);
    v.render(publicView(s));s.remaining=1000;v.render(publicView(s));v.dispose();
    expect(stage.querySelector('.clock-label').textContent).toBe('あと1秒で、「もう一度／ホームへ」の画面へ');
    expect(stage.querySelector('.clock-ring').getAttribute('aria-hidden')).toBe('true');
    expect(stage.querySelector('.clock-label .clock-ring')).toBeNull();
  });
  it('同率1位全員の順位・名前・点を強調し、CPUの説明は一覧の外',()=>{
    const s=init();s.phase='result';s.seats.forEach((v,i)=>{v.rank=i<2?1:3;v.cpu=i===1;});
    const stage=render(s),rows=[...stage.querySelectorAll('.result-row')];
    expect(rows.filter(r=>r.dataset.first==='true')).toHaveLength(2);
    for(const row of rows.slice(0,2))expect(row.querySelectorAll('strong')).toHaveLength(3);
    expect(stage.querySelector('.result-guide').textContent).toContain('CPUを含む全席の順位');
    expect(stage.querySelector('.results').textContent).not.toContain('こみ');
    expect(stage.querySelector('.results .result-guide')).toBeNull();
    expect(rows[1].querySelector('.result-cpu').textContent).toBe('CPU');
    expect(rows[0].querySelector('.result-cpu').textContent).toBe('');
  });
});
