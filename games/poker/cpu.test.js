import {it,expect,describe} from 'vitest';
import {fillSeats,thinkMs,decide,strength} from './cpu.js';
import {makeRng} from './cards.js';
import {createGame,updateGame,viewFor} from './logic.js';
function initial(){return createGame({players:[{id:1,name:'席1',online:true},...fillSeats(1)],leader:1,seed:1,nonce:'cpu',environment:{connected:true,visible:true}}).state;}
describe('CPUの補充と判断',()=>{
  it.each([0,1,2,3,4,5,6,7,8])('人%i人なら最小未満のときだけ4席まで補充',n=>{const seats=fillSeats(n);expect(seats).toHaveLength(n<2?4-n:0);expect(seats.every((p,i)=>p.id===`cpu${i+1}`&&p.cpu&&p.online)).toBe(true);});
  it.each([-1,9,0.5,NaN])('人数%iは拒む',n=>expect(()=>fillSeats(n)).toThrow());
  it('思考時間の範囲と決定性',()=>{const a=makeRng(5),b=makeRng(5);for(let i=0;i<1000;i++){const t=thinkMs(a);expect(t).toBe(thinkMs(b));expect(t).toBeGreaterThanOrEqual(800);expect(t).toBeLessThanOrEqual(2000);}expect(thinkMs(()=>0)).toBe(800);expect(thinkMs(()=>1-Number.EPSILON)).toBe(2000);});
  it('本人情報だけから合法手を返し、停止・番外はnull',()=>{
    let s=initial(),v=viewFor(s,1);const before=structuredClone(v),input=decide(v,1,makeRng(5));expect(input).toEqual(decide(v,1,makeRng(5)));expect(v).toEqual(before);expect(()=>decide(v,'cpu1',makeRng(5))).toThrow();
    s=updateGame(s,{t:'input',p:1,input}).state;s=updateGame(s,{t:'tick',ms:1200}).state;
    for(const own of s.seats){v=viewFor(s,own.id);const d=decide(v,own.id,makeRng(5));if(s.turn!==own.id)expect(d).toBeNull();else expect(v.pad.tiles.some(t=>t.id===d.ids[0]&&!t.off)).toBe(true);}
    s=updateGame(s,{t:'menu',paused:true}).state;expect(decide(viewFor(s,s.turn),s.turn,makeRng(5))).toBeNull();
  });
  it('強い組・中・弱、役と未完成の並びを使う',()=>{
    const v=viewFor(initial(),1);v.hand=['s14','h14'];expect(strength(v)).toBeGreaterThan(0.8);v.hand=['s2','h7'];expect(strength(v)).toBeLessThan(0.4);
    v.hand=['s14','s13'];v.board=['s12','s11','h2'];const draw=strength(v);v.board=['d8','h5','c2'];expect(draw).toBeGreaterThan(strength(v));
    v.board=['s12','s11','s10'];expect(strength(v)).toBeGreaterThan(0.9);
  });
});
