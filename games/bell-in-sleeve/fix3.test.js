import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,shortNames} from './logic.js';
import {eventText} from './view.js';
const human=(id,name='同じ名前')=>({id,name,online:true});
const cpu=(n)=>({id:`cpu${n}`,name:`CPU ${n}`,online:true,cpu:true});
function state(players) {
  const s=createGame({players,leader:1,seed:19,nonce:'fix3',environment:{connected:true,visible:true}}).state;
  Object.assign(s,{phase:'turn',step:'pickTarget',turn:1,card:'guard',h:4});
  s.seats.forEach((v)=>{v.hand=['guard'];v.played=3;});
  s.seats[0].played=2;s.seats[1].hand=['bell'];return s;
}
function pick(s,p,i) {
  const pad=viewFor(s,p).pad;
  return updateGame(s,{t:'input',p,input:{k:'tiles',t:pad.token,ids:[pad.tiles[i].id]}}).state;
}
describe('採点で見つかった進行と案内',()=>{
  it('人2〜8人とCPUの組み合わせでも短縮名が一意で、CPU番号を保つ',()=>{
    for (let n=2;n<=8;n++) for (let c=0;c<=8-n;c++) {
      for (const names of [Array(n).fill('同じ名前'),Array(n).fill('C1'),Array.from({length:n},(_,i)=>i%2 ? 'あいう#1' : 'あいう')]) {
        const seats=[...names.map((name,i)=>human(i+1,name)),...Array.from({length:c},(_,i)=>cpu(i+1))];
        const aliases=Object.values(shortNames(seats));expect(new Set(aliases).size).toBe(seats.length);
      }
    }
    expect(shortNames([human(1),cpu(1),cpu(3)])).toMatchObject({cpu1:'C1',cpu3:'C3'});
    const s=state([human(1),cpu(1),cpu(3)]);
    s.observations[1]=[{seq:1,type:'peek',target:'cpu1',card:'guard'},{seq:2,type:'peek',target:'cpu3',card:'bell'}];
    expect(viewFor(s,1).pad.note).toContain('C1:かばう');expect(viewFor(s,1).pad.note).toContain('C3の金の鈴');
  });
  it('外れた直後に本人へ減点を知らせ、出来事にも残す',()=>{
    let s=state([human(1,'一'),human(2,'二'),human(3,'三')]);s.card='catch';s.seats[2].played=1;
    s=pick(s,1,2);expect(s.seats[0].score).toBe(-1);
    expect(viewFor(s,1).pad.note).toContain('外れました −1点');
    expect(eventText(viewFor(s,1),s.events.at(-1))).toContain('一の指名は外れ（−1点）');
  });
  it('人1人は10秒で話し合いを終え、理由と早期終了を示す',()=>{
    let s=pick(state([human(1),cpu(1),cpu(2)]),1,0);
    expect(s).toMatchObject({phase:'talk',remaining:10000});
    expect(viewFor(s,1).pad.note).toContain('CPUは話さないため10秒');
    expect(viewFor(s,'cpu1').pad.disabled).toBe(true);
    expect(updateGame(s,{t:'tick',ms:9999}).state.phase).toBe('talk');
    expect(updateGame(s,{t:'tick',ms:10000}).state.phase).toBe('vote');
    s=pick(s,1,s.seats[0].hand.length);expect(s.phase).toBe('vote');
  });
  it('人2人以上は45秒、全員の同意だけで早期終了し、古い入力を拒む',()=>{
    for (const players of [[human(1),human(2),cpu(1)],[human(1),human(2),human(3)]]) {
      let s=pick(state(players),1,0);expect(s.remaining).toBe(45000);
      const pad=viewFor(s,2).pad;
      expect(pad.tiles.filter((v)=>!v.off).map((v)=>v.label)).toEqual(['指名へ進む']);
      s=pick(s,1,1);expect(s.phase).toBe('talk');expect(viewFor(s,1).pad.disabled).toBe(true);
      const before=s.remaining;s=pick(s,1,1);expect(s.remaining).toBe(before);
      s=updateGame(s,{t:'input',p:2,input:{k:'tiles',t:pad.token,ids:[pad.tiles.at(-1).id]}}).state;
      if (players[2].cpu) expect(s.phase).toBe('vote');
      else {expect(s.phase).toBe('talk');s=pick(s,3,1);expect(s.phase).toBe('vote');}
      expect(viewFor(s,1).pad.note).toContain('守りは、一斉指名には効きません');
    }
  });
});
