// @vitest-environment happy-dom
import {describe,it,expect} from 'vitest';
import {createGame,updateGame,publicView,viewFor} from './logic.js';
import {createView,eventText} from './view.js';
const init=()=>createGame({players:[1,2,3].map(id=>({id,name:`席${id}`,online:true})),leader:1,seed:52,nonce:'fix3',environment:{connected:true,visible:true}}).state;
const pick=(s,p,kind)=>{const v=viewFor(s,p),i=v.actions.findIndex(a=>a.kind===kind);expect(i).toBeGreaterThanOrEqual(0);return updateGame(s,{t:'input',p,input:{k:'tiles',t:v.pad.token,ids:[v.pad.tiles[i].id]}});};
const start=()=>updateGame(pick(init(),1,'start').state,{t:'tick',ms:1200}).state;
const render=s=>{const root=document.createElement('main'),v=createView(root,document.createElement('p'));v.render(publicView(s));v.dispose();return root;};
describe('第4回の表示の回帰',()=>{
  it.each([false,true])('上限の履歴は行動時の持ち点を記録し、精算後も変わらない CPU=%s',cpu=>{
    for(const empty of [false,true]){
      const s=start(),p=s.turn,own=s.seats.find(v=>v.id===p);own.cpu=cpu;
      // 他席の残りで止まる場合と、自分を使い切る場合を同じ入力経路で比べる。
      s.seats.forEach(v=>{v.points=(v===own&&!empty?1180:1000)-v.street;});
      const before=own.points,v=viewFor(s,p),a=v.actions.find(a=>a.kind==='all');
      const r=pick(s,p,'all'),e=r.state.events.at(-1),word=empty?'ぜんぶ':'上限まで';
      expect(a.label).toBe(`${word} ${a.amount}`);expect(e.capLabel).toBe(word);
      expect(eventText(publicView(r.state),e)).toBe(`席${p} · ${word} ${a.amount}`);
      expect(r.state.seats.find(v=>v.id===p).points).toBe(before-a.amount);
      r.state.seats.forEach(v=>v.points=0);expect(eventText(publicView(r.state),e)).toContain(word);
    }
  });
  it('0点でも残っている手札は勝負待ちで、精算後に0点なら見るだけ',()=>{
    const s=start(),own=s.seats[0];own.points=0;own.folded=false;
    expect(render(s).querySelector('[data-id="1"] .seat-meta').textContent).toBe('勝負待ち');
    expect(viewFor(s,1).pad.note).toContain('勝負待ち');expect(viewFor(s,1).pad.note).not.toContain('役の早見');
    for(const phase of ['showdown','result']){
      s.phase=phase;expect(render(s).querySelector('[data-id="1"] .seat-meta').textContent).toBe('見るだけ');
      if(phase==='showdown')expect(viewFor(s,1).pad.note).toContain('この局は見るだけ');
    }
    s.phase='turn';own.folded=true;own.hand=[];
    expect(viewFor(s,1).pad.note).toContain('役の早見');expect(render(s).querySelector('[data-id="1"] .seat-meta').textContent).toBe('見るだけ');
  });
  it('勝者全員に文字の印があり、勝負の後は消える',()=>{
    const s=start();s.phase='showdown';s.winners=[1,3];s.payouts={1:50,3:50};
    const root=render(s);expect([...root.querySelectorAll('.winner-mark')].map(n=>[n.closest('.seat').dataset.id,n.textContent])).toEqual([['1','勝者'],['3','勝者']]);
    expect(root.querySelector('[data-id="1"] .seat-meta').textContent).toBe('＋50点');
    s.phase='result';expect(render(s).querySelector('.winner-mark')).toBeNull();
  });
  it('行動のhintは40字以内で実際の25秒と一致し、時計だけでは再送しない',()=>{
    const s=start(),p=s.turn,pad=viewFor(s,p).pad;
    expect(pad.hint).toBe('25秒以内に決めよう');expect([...pad.hint].length).toBeLessThanOrEqual(40);expect(s.remaining).toBe(25000);
    const r=updateGame(s,{t:'tick',ms:1000});expect(viewFor(r.state,p).pad).toEqual(pad);expect(r.effects.filter(e=>e.t==='pad')).toEqual([]);
    expect(viewFor(s,s.seats.find(v=>v.id!==p).id).pad.hint).toBeUndefined();
    const end=updateGame(s,{t:'tick',ms:25000});expect(end.state.events.at(-1).type).toMatch(/^auto-/);
  });
  it.each(['intro','deal','turn','showdown','result'])('早見は卓と便りから独立した帯に置く %s',phase=>{
    const s=start();s.phase=phase;const root=render(s),guide=root.querySelector('.role-guide');
    if(['showdown','result'].includes(phase))expect(guide).toBeNull();else{
      expect(guide.parentElement).toBe(root);expect(guide.previousElementSibling.className).toBe('table');expect(guide.nextElementSibling.className).toBe('foot');
      expect(guide.textContent).toBe('強い順：ストレートフラッシュ＞フォーカード＞フルハウス＞フラッシュ＞ストレート＞スリーカード＞ツーペア＞ワンペア');
    }
  });
});
