import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor} from './logic.js';
import {fillSeats} from './cpu.js';
function result(n=3) {
  const humans=Array.from({length:n},(_,i)=>({id:i+1,name:'長い名前😀'.repeat(4),online:true}));
  let s=createGame({players:[...humans,...fillSeats(n)],leader:1,seed:19,nonce:'fix6',environment:{connected:true,visible:true}}).state;
  Object.assign(s,{phase:'vote',h:4,remaining:30000,ready:Object.fromEntries(humans.map((v)=>[v.id,true]))});
  s.seats.forEach((v,i)=>{v.hand=[i ? 'guard' : 'bell'];v.played=3;});
  s.votes=Object.fromEntries(s.seats.slice(1).map((v)=>[v.id,1]));
  return press(s,s.seats[0].id).state;
}
function press(s,p,pad=viewFor(s,p).pad) {
  return updateGame(s,{t:'input',p,input:{k:'tiles',t:pad.token,ids:[pad.tiles.find((v)=>!v.off)?.id ?? pad.tiles[0].id]}});
}
describe('結果から全員で次へ進む',()=>{
  it('結果で同意をリセットし、全員の最後の入力で1秒以内にendを一度だけ出す',()=>{
    let s=result();expect(s.ready).toEqual({});expect(s.remaining).toBe(20000);
    s=press(s,1).state;s=updateGame(s,{t:'tick',ms:347}).state;
    const third=viewFor(s,3).pad;
    let r=press(s,2);expect(r.state.ended).toBe(false);expect(r.effects.some((e)=>e.t === 'end')).toBe(false);
    r=press(r.state,3,third);expect(r.state.ended).toBe(true);expect(r.effects.filter((e)=>e.t === 'end')).toHaveLength(1);
    expect(r.state.remaining).toBe(s.remaining);expect(press(r.state,3).effects).toEqual([]);
  });
  it('1人が押さなければ19999msでは終わらず20000msで終わる',()=>{
    let s=press(result(),1).state;s=press(s,2).state;
    let r=updateGame(s,{t:'tick',ms:19999});expect(r.state.ended).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:1});expect(r.effects.filter((e)=>e.t === 'end')).toHaveLength(1);
  });
  it('退出済みの席を同意の人数に数えず、入力も受けない',()=>{
    let s=result();s.seats[2].left=true;s.seats[2].online=false;
    expect(press(s,3).effects).toEqual([]);
    s=press(s,1).state;expect(press(s,2).state.ended).toBe(true);
  });
  it('人1人とCPUでは人の入力だけで終わり、CPUには押せる札がない',()=>{
    const s=result(1);for (const v of s.seats.filter((v)=>v.cpu)) {
      expect(viewFor(s,v.id).pad.disabled).toBe(true);expect(viewFor(s,v.id).pad.tiles.every((v)=>v.off)).toBe(true);
    }
    expect(press(s,1).effects.filter((e)=>e.t === 'end')).toHaveLength(1);
  });
  it('CPUだけの観戦は20秒で自動終了する',()=>{
    const s=result(0);expect(s.ended).toBe(false);
    const r=updateGame(s,{t:'tick',ms:19999});expect(r.state.ended).toBe(false);
    expect(updateGame(r.state,{t:'tick',ms:1}).state.ended).toBe(true);
  });
  it('押したあと次へは無効になり、待つ案内が出て二重入力を拒む',()=>{
    const s=result(),pad=viewFor(s,1).pad;let r=press(s,1);
    const after=viewFor(r.state,1).pad;
    expect(after).toMatchObject({disabled:true,min:0,max:0});expect(after.note).toContain('ほかの人を待っています');
    expect(after.tiles).toEqual([{id:`${after.token}_0`,label:'次へ',off:true}]);
    r=press(r.state,1,pad);expect(r.state.ready).toEqual({1:true});expect(r.state.ended).toBe(false);
    expect(viewFor(r.state,1).pad.disabled).toBe(true);
  });
  it('古いtokenを捨て、未入力の人の画面は同意のたびに送り直さない',()=>{
    const s=result(),second=viewFor(s,2).pad;
    const stale={...second,token:'old'};let r=press(s,2,stale);
    expect(r.state.ready).toEqual({});expect(viewFor(r.state,2).pad.token).not.toBe(second.token);
    r=press(s,1);expect(r.effects.filter((e)=>e.t === 'pad').map((e)=>e.to)).toEqual([1]);
    expect(viewFor(r.state,2).pad).toEqual(second);
    r=updateGame(r.state,{t:'tick',ms:1000});expect(r.effects.filter((e)=>e.t === 'pad')).toHaveLength(0);
  });
  it('次への札は1枚だけで、長い名前と記録があってもnote・ラベルは上限内',()=>{
    for (const n of [1,3,8]) {
      let s=result(n);
      s.seats.forEach((v)=>{v.hand=Array(4).fill('catch');});
      s.notices[1]='外れました −1点';s.observations[1]=Array.from({length:40},(_,seq)=>({seq,type:'peek',target:s.seats[1].id,card:'bell'}));
      for (const ready of [false,true]) {
        s.ready[1]=ready;const pad=viewFor(s,1).pad;
        expect(pad.tiles).toHaveLength(1);expect(pad.tiles[0].label).toBe('次へ');
        expect([...pad.note].length).toBeLessThanOrEqual(120);expect(pad.note).toContain('手札:');
        for (const tile of pad.tiles) {expect([...tile.label].length).toBeLessThanOrEqual(12);expect([...(tile.sub ?? '')].length).toBeLessThanOrEqual(12);}
      }
    }
  });
});
