// @vitest-environment happy-dom
import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor,publicView} from './logic.js';
import {createView,heading} from './view.js';
function scene() {
  const players=Array.from({length:5},(_,i)=>({id:i+1,name:`席${i+1}`,online:true}));
  const s=createGame({players,leader:1,seed:19,nonce:'fix4',environment:{connected:true,visible:true}}).state;
  Object.assign(s,{phase:'turn',step:'pickCard',turn:1,h:4,remaining:25000});
  s.seats.forEach((v)=>{v.hand=['guard','catch'];v.played=1;});s.seats[1].hand=['bell','peek'];
  return s;
}
function pick(s,p,i) {
  const pad=viewFor(s,p).pad;
  return updateGame(s,{t:'input',p,input:{k:'tiles',t:pad.token,ids:[pad.tiles[i].id]}}).state;
}
describe('第4回の表示の仕上げ',()=>{
  it('結果の見出しは勝敗によらず持ち主を短く示す',()=>{
    const s=scene();Object.assign(s,{phase:'result',holder:2});s.seats[1].name='あいうえおかきくけこさしすせそ';
    for (const winner of ['bell','stall']) {
      s.winner=winner;const text=heading(publicView(s));
      expect(text).toContain('あいうえおかきくけこ');expect(text).not.toContain('さしすせ');
      expect([...text].length).toBeLessThanOrEqual(26);
      expect(text).toContain(winner === 'bell' ? '逃げ切り' : '見つかった');
    }
  });
  it('結果でだけ持ち主の席に文字の印が1つ付き、勝負なしでは出ない',()=>{
    const s=scene(),stage=document.createElement('main'),status=document.createElement('p');
    const view=createView(stage,status);
    try {
      view.render(publicView(s));expect(stage.querySelector('.holder-label')).toBeNull();
      Object.assign(s,{phase:'result',holder:2,winner:'bell'});view.render(publicView(s));
      expect(stage.querySelectorAll('.holder-label')).toHaveLength(1);
      expect(stage.querySelector('[data-id="2"] .holder-label').textContent).toBe('鈴の持ち主');
      s.outcome='incomplete';view.render(publicView(s));expect(stage.querySelector('.holder-label')).toBeNull();
    } finally {view.dispose();}
  });
  it.each(['catch','vote'])('%sの結果は20秒表示し、境界でendを1回だけ送る',(mode)=>{
    let s=scene();
    if (mode === 'catch') {s.step='pickTarget';s.card='catch';s=pick(s,1,1);}
    else {s.phase='vote';s.votes={1:2,2:3,3:2,4:2};s=pick(s,5,1);}
    expect(s).toMatchObject({phase:'result',remaining:20000});
    let r=updateGame(s,{t:'tick',ms:19999});expect(r.effects.some((e)=>e.t === 'end')).toBe(false);
    r=updateGame(r.state,{t:'tick',ms:1});expect(r.effects.filter((e)=>e.t === 'end')).toHaveLength(1);
    expect(updateGame(r.state,{t:'tick',ms:20000}).effects).toEqual([]);
  });
  it('つかまえるの補足は外れの減点を12字以内で示す',()=>{
    const pad=viewFor(scene(),1).pad,tile=pad.tiles.find((v)=>v.label === 'つかまえる');
    expect(tile.sub).toBe('指名・外れ−1点');expect([...tile.sub].length).toBeLessThanOrEqual(12);
  });
  it.each(['pickCard','pickTarget','pickSlot','pickGive','whisper','vote'])('%sの目安は実際の上限と一致し、1秒後も再送しない',(step)=>{
    const s=scene();Object.assign(s,{step:step === 'vote' ? 'pickCard' : step,phase:step === 'vote' ? 'vote' : 'turn',card:'swap',target:2,slots:[0,1]});
    s.remaining=['whisper','vote'].includes(step) ? 30000 : 25000;
    s.observations[1]=Array.from({length:20},(_,seq)=>({seq,type:'peek',target:2,card:'guard'}));
    const pad=viewFor(s,1).pad;
    expect(pad.hint).toBe(`${s.remaining/1000}秒以内に決めてください`);
    expect([...pad.hint].length).toBeLessThanOrEqual(40);expect([...pad.note].length).toBeLessThanOrEqual(120);
    const r=updateGame(s,{t:'tick',ms:1000});
    expect(viewFor(r.state,1).pad).toEqual(pad);expect(r.effects.filter((e)=>e.t === 'pad')).toHaveLength(0);
  });
  it('古い記録は最新2件までで、指示と手札を先に読める',()=>{
    const s=scene();s.step='pickGive';s.target=2;
    s.observations[1]=['peek','swap','catch','guard'].map((card,seq)=>({seq,type:'peek',target:2,card}));
    const note=viewFor(s,1).pad.note;
    expect(note.startsWith('差し出す札を選んでください')).toBe(true);
    expect(note).toContain('手札:かばう・つかまえる');expect(note.match(/\(当時\)/g)).toHaveLength(2);
    expect(note.indexOf('かばうを見た')).toBeLessThan(note.indexOf(':つかまえる'));
    expect(note).not.toContain('すりかえ(当時)');expect([...note].length).toBeLessThanOrEqual(120);
    s.seats.forEach((v)=>{v.name='😀'.repeat(12);});s.seats[0].hand=Array(4).fill('catch');
    s.notices[1]='外れました −1点';
    const tight=viewFor(s,1).pad.note;
    expect([...tight].length).toBeLessThanOrEqual(120);
    expect(tight.match(/\(当時\)/g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(tight).toContain('手札:つかまえる・つかまえる・つかまえる・つかまえる');
  });
});
