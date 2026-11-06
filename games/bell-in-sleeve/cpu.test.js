import {describe,it,expect} from 'vitest';
import {createGame,updateGame,viewFor} from './logic.js';
import {decide,fillSeats,suspicion,thinkMs} from './cpu.js';
import {makeRng} from './cards.js';
function view() {
  let s=createGame({players:[1,2,3].map((id)=>({id,name:`席${id}`,online:true})),leader:1,seed:5,nonce:'cpu',environment:{connected:true,visible:true}}).state;
  const input=decide(viewFor(s,1),1,makeRng(5));s=updateGame(s,{t:'input',p:1,input}).state;s=updateGame(s,{t:'tick',ms:8000}).state;
  s.turn=1;s.seats[0].hand=['peek','catch','guard'];s.seats[0].played=2;
  return viewFor(s,1);
}
describe('CPUの補充・思考・推理',()=>{
  it.each([0,1,2,3,4,8])('人%i人なら不足するときだけ推奨5席まで補充する',(h)=>{
    const cpus=fillSeats(h);expect(cpus).toHaveLength(h<3?5-h:0);
    cpus.forEach((v,i)=>expect(v).toEqual({id:`cpu${i+1}`,name:`CPU ${i+1}`,cpu:true,online:true}));
  });
  it.each([-1,9,0.5,NaN])('人数%iは断る',(h)=>expect(()=>fillSeats(h)).toThrow(RangeError));
  it('思考時間は0.8〜2.0秒で同じ種から再現する',()=>{
    const a=makeRng(1),b=makeRng(1);
    for(let i=0;i<1000;i++){const ms=thinkMs(a);expect(ms).toBe(thinkMs(b));expect(ms).toBeGreaterThanOrEqual(800);expect(ms).toBeLessThanOrEqual(2000);}
    expect(thinkMs(()=>0)).toBe(800);expect(thinkMs(()=>1-Number.EPSILON)).toBe(2000);
  });
  it('見えた鈴へはつかまえるを確実に出して指名する',()=>{
    const v=view();v.observations=[{seq:1,type:'peek',target:2,card:'bell'}];
    for(let seed=0;seed<100;seed++)expect(decide(v,1,makeRng(seed)).ids).toEqual([v.pad.tiles[1].id]);
    v.step='pickTarget';v.discard=['catch'];v.pad.tiles=v.seats.map((s,i)=>({id:`x_${i}`,label:s.name,off:s.id===1}));
    for(let seed=0;seed<100;seed++)expect(decide(v,1,makeRng(seed)).ids).toEqual(['x_1']);
  });
  it.each(['guard','catch','peek','swap','whisper'])('最後の札が%sでも投票では観測済みの鈴を必ず選ぶ',(card)=>{
    const v=view();v.phase='vote';v.step='pickTarget';v.discard=[card];
    v.observations=[{seq:1,type:'peek',target:3,card:'bell'}];v.seats[2].guard=true;
    v.pad.tiles=v.seats.map((s,i)=>({id:`v_${i}`,label:s.name,off:s.id===1}));
    for(let seed=0;seed<100;seed++)expect(decide(v,1,makeRng(seed)).ids).toEqual(['v_2']);
  });
  it('同じ相手の別の札を見ても、鈴の確定を取り消さない',()=>{
    const v=view();v.observations=[{seq:1,type:'peek',target:2,card:'bell'},{seq:2,type:'whisper',target:2,card:'peek'}];
    expect(suspicion(v)[2]).toBe(100000);
  });
  it('古い鈴の確定と外れた指名はすりかえで失効する',()=>{
    const v=view();v.observations=[{seq:1,type:'peek',target:2,card:'bell'}];v.events=[{seq:2,type:'swap',p:2,target:3}];
    expect(suspicion(v)[2]).toBe(1);
    v.events=[{seq:2,type:'miss',p:3,target:2}];expect(suspicion(v)[2]).toBe(0.02);
    v.events.push({seq:3,type:'swap',p:3,target:2});expect(suspicion(v)[2]).toBe(1);
  });
  it.each(['peek','whisper','swap'])('%sで見た鈴も指名の根拠にする',(type)=>{
    const v=view();v.observations=[{seq:1,type,target:2,card:'bell'}];expect(suspicion(v)[2]).toBe(100000);
  });
  it('外れ・守り・鈴ではない札で重みを変える',()=>{
    const v=view();v.events=[{seq:1,type:'miss',p:3,target:2},{seq:2,type:'guard',p:3,target:3}];
    v.observations=[{seq:3,type:'whisper',target:3,card:'peek'}];
    expect(suspicion(v)[2]).toBe(0.02);expect(suspicion(v)[3]).toBeCloseTo(1.4*0.55);
  });
  it('鈴を持つときは守りや入れ替えを優先し、渡す場面で鈴を渡す',()=>{
    const v=view();v.hand=['bell','swap','guard'];v.pad.tiles[0].off=true;
    let defensive=0;
    for(let seed=0;seed<100;seed++)if(['swap','guard'].includes(v.hand[v.pad.tiles.findIndex((t)=>t.id===decide(v,1,makeRng(seed)).ids[0])]))defensive++;
    expect(defensive).toBe(100);
    v.step='pickGive';v.pad.tiles[0].off=false;
    for(let seed=0;seed<100;seed++)expect(decide(v,1,makeRng(seed)).ids).toEqual([v.pad.tiles[0].id]);
    v.step='whisper';for(let seed=0;seed<100;seed++)expect(decide(v,1,makeRng(seed)).ids).not.toEqual([v.pad.tiles[0].id]);
  });
  it('守られた鈴は指名できず、待つ画面は入力を返さない',()=>{
    const v=view();v.observations=[{seq:1,type:'peek',target:2,card:'bell'}];v.seats[1].guard=true;
    for(let i=0;i<100;i++)expect(decide(v,1,makeRng(i)).ids).toHaveLength(1);
    v.pad.disabled=true;expect(decide(v,1,makeRng(1))).toBeNull();
    v.pad={k:'wait',title:'待つ'};expect(decide(v,1,makeRng(1))).toBeNull();
    expect(()=>decide(v,2,makeRng(1))).toThrow(RangeError);
  });
  it('判断は入力の複製を変えず、同じ種なら同じ',()=>{
    const v=view(),before=structuredClone(v);
    expect(decide(v,1,makeRng(77))).toEqual(decide(v,1,makeRng(77)));expect(v).toEqual(before);
    for(const s of v.seats)expect(s).not.toHaveProperty('hand');expect(v).not.toHaveProperty('slots');
  });
});
