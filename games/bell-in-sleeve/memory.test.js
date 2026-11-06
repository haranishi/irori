import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView} from './logic.js';
import {CARD_NAMES} from './cards.js';
const players=Array.from({length:5},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
function scene() {
  const s=createGame({players,leader:1,seed:19,nonce:'memory',environment:{connected:true,visible:true}}).state;
  Object.assign(s,{phase:'turn',step:'pickCard',turn:1,h:4,remaining:25000});
  s.seats.forEach((v,i)=>{v.hand=i === 1 ? ['bell','guard'] : ['peek','swap','whisper','catch'];v.played=1;});
  return s;
}
function pick(s,p,i) {const pad=viewFor(s,p).pad;return updateGame(s,{t:'input',p,input:{k:'tiles',ids:[pad.tiles[i].id],t:pad.token}}).state;}
describe('手元の記憶と進み具合',()=>{
  it('実際ののぞき見を通知後も残し、他席へ送らない',()=>{
    let s=scene();s=pick(s,1,0);s=pick(s,1,1);
    s=pick(s,1,s.slots.indexOf(0));
    expect(viewFor(s,1).pad.note).toContain('見えた札：金の鈴');
    s=updateGame(s,{t:'tick',ms:3000}).state;
    expect(viewFor(s,1).pad.note).toContain('席2の金の鈴を見た(当時)');
    expect(viewFor(s,3).pad.note).not.toContain('席2の金の鈴');
    expect(JSON.stringify(publicView(s))).not.toContain('observations');
  });
  it('交換と見せ合いの両当事者にだけ、当時の事実を残す',()=>{
    for (const kind of ['swap','whisper']) {
      let s=scene();s=pick(s,1,s.seats[0].hand.indexOf(kind));s=pick(s,1,1);
      if (kind === 'swap') {s=pick(s,1,s.slots.indexOf(0));s=pick(s,1,0);}
      else {s=pick(s,1,0);s=pick(s,2,0);}
      s=updateGame(s,{t:'tick',ms:3000}).state;
      expect(viewFor(s,1).pad.note).toContain('(当時)');expect(viewFor(s,2).pad.note).toContain('(当時)');
      expect(viewFor(s,3).pad.note).not.toContain('(当時)');
    }
  });
  it('長い名前と多数の記録でも120文字以内、最新を優先し古い事実を短縮',()=>{
    const s=scene();s.seats.forEach((v)=>{v.name='長い名前😀'.repeat(4);});
    s.observations[1]=Array.from({length:40},(_,i)=>({seq:i,type:i === 39 ? 'swap' : 'peek',target:2,card:i === 39 ? 'bell' : 'guard'}));
    const note=viewFor(s,1).pad.note;
    expect([...note].length).toBeLessThanOrEqual(120);expect(note).toContain('金の鈴を渡した(当時)');
    expect(note.indexOf('金の鈴')).toBeLessThan(note.indexOf(':かばう(当時)'));
    for (const card of s.seats[0].hand) expect(note).toContain(CARD_NAMES[card]);
  });
  it('話し合いと投票後も手札を読め、投票時は手札を選べない',()=>{
    const s=scene();s.observations[1]=[{seq:1,type:'whisper',target:2,card:'bell'}];
    for (const phase of ['talk','vote']) {
      s.phase=phase;const pad=viewFor(s,1).pad;
      expect(pad.k).toBe('tiles');expect(pad.note).toContain('席2の金の鈴');
      const hands=phase === 'talk' ? pad.tiles.slice(0,-1) : pad.tiles.slice(5);
      expect(hands.map((t)=>t.label)).toEqual(s.seats[0].hand.map((c)=>CARD_NAMES[c]));
      expect(hands.every((t)=>t.off)).toBe(true);
    }
    s.votes[1]=2;expect(viewFor(s,1).pad.disabled).toBe(true);
    for (const extra of [{paused:true},{phase:'result'}]) {
      const pad=viewFor({...s,...extra},1).pad;expect(pad).toMatchObject({k:'tiles',disabled:true});expect(pad.note).toContain('席2の金の鈴');
    }
  });
  it('札の効果は12文字以内、使用前の制限も保つ',()=>{
    const s=scene();s.seats[0].hand=['peek','swap','whisper','catch','guard','bell'];
    expect(viewFor(s,1).pad.tiles.map((t)=>t.sub)).toEqual(['ひとりの札を見る','札を取りかえる','見せ合う','指名・外れ−1点','つかまえるを防ぐ','出せない']);
    expect(viewFor(s,1).pad.tiles.every((t)=>[...t.sub].length <= 12)).toBe(true);
    s.seats[0].played=0;expect(viewFor(s,1).pad.tiles[3]).toMatchObject({sub:'二周目から',off:true});
  });
  it('全員の消化手数から周と残り手を計算する',()=>{
    const s=scene();expect(publicView(s).progress).toEqual({round:2,left:10});
    expect(viewFor(s,1).pad.note).toContain('2周目・あと10手');
    s.seats.forEach((v)=>v.played=3);s.phase='talk';
    expect(publicView(s).progress).toEqual({round:3,left:0});expect(viewFor(s,1).pad.note).toContain('3周目・あと0手');
  });
});
describe('結果の数字と理由',()=>{
  it('全員の投票先と得票数、減点と加点を合計に一致させる',()=>{
    let s=scene();s.phase='vote';s.votes={1:2,2:3,3:2,4:2};
    s.events=[{seq:1,type:'miss',p:1,target:4}];s.seats[0].score=-1;
    s=pick(s,5,3);
    const rows=publicView(s).results;
    expect(rows.map((r)=>r.voteFor)).toEqual([2,3,2,2,4]);expect(rows.map((r)=>r.votesReceived)).toEqual([0,3,1,1,0]);
    expect(rows.map((r)=>r.score)).toEqual([1,0,2,2,1]);expect(rows[1].voters).toEqual([1,3,4]);
    expect(rows[0].reasons).toEqual([{label:'外れた指名',score:-1},{label:'持ち主に投票',score:2}]);
    for (const r of rows) expect(r.reasons.reduce((n,v)=>n+v.score,0)).toBe(r.score);
  });
  it('逃げ切りと即時発見にも内訳があり、endの4項目は変えない',()=>{
    for (const caught of [true,false]) {
      let s=scene();
      if (caught) {s=pick(s,1,3);s=pick(s,1,1);}
      else {s.phase='vote';s.votes={1:3,2:3,3:4,4:3};s=pick(s,5,2);}
      const rows=publicView(s).results;
      expect(rows[caught ? 0 : 1].reasons).toContainEqual({label:caught ? '当てた' : '逃げ切り',score:caught ? 3 : 4});
      for (const r of rows) expect(r.reasons.reduce((n,v)=>n+v.score,0)).toBe(r.score);
      const end=updateGame(s,{t:'tick',ms:20000}).effects.find((e)=>e.t === 'end');
      expect(end.results.every((r)=>Object.keys(r).sort().join() === 'label,p,ranked,score')).toBe(true);
    }
  });
});
