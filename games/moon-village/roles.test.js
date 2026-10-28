import {describe,expect,it} from 'vitest';
import {assignRoles,makeRng,rolesFor} from './roles.js';

const counts=(roles)=>Object.fromEntries(['wolf','seer','knight','madman','villager'].map((r)=>[r,roles.filter((v)=>v===r).length]));
describe('配役',()=>{
  it.each([[4,[1,1,0,0,2]],[5,[1,1,1,0,2]],[6,[2,1,1,0,2]],[7,[2,1,1,1,2]],[8,[2,1,1,1,3]]])('%i人の設計表と一致する',(n,want)=>{
    expect(Object.values(counts(rolesFor(n)))).toEqual(want);
    const copy=rolesFor(n);copy.pop();expect(rolesFor(n)).toHaveLength(n);
  });
  it.each([0,3,9,4.5,NaN])('範囲外の人数 %s を断る',(n)=>expect(()=>rolesFor(n)).toThrow(RangeError));
  it('各人数・200種で全員に1つ、同じ種で再現し、席の並びを変更しない',()=>{
    for(let n=4;n<=8;n++)for(let seed=0;seed<200;seed++){
      const ids=Object.freeze(Array.from({length:n},(_,i)=>i*3+1));
      const assigned=assignRoles(ids,seed);
      expect(Object.keys(assigned).map(Number)).toEqual(ids);
      expect(counts(Object.values(assigned))).toEqual(counts(rolesFor(n)));
      expect(assignRoles(ids,seed)).toEqual(assigned);
    }
    expect(new Set(Array.from({length:100},(_,seed)=>JSON.stringify(assignRoles([1,2,3,4,5,6,7,8],seed)))).size).toBeGreaterThan(50);
  });
  it('重複・不正な席、種を断る',()=>{
    for(const ids of [[1,1,2,3],[0,1,2,3],[-1,1,2,3],[1,2,3,4.5]])expect(()=>assignRoles(ids,1)).toThrow(RangeError);
    expect(()=>makeRng(NaN)).toThrow(RangeError);
  });
  it('乱数の範囲・再現・保存した状態からの再開',()=>{
    const a=makeRng(123),b=makeRng(123);const seen=[];
    for(let i=0;i<1000;i++){const v=a();expect(v).toBe(b());expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThan(1);seen.push(v);}
    expect(new Set(seen).size).toBe(1000);
    const resume=makeRng(a.state);expect(resume()).toBe(a());
    expect(makeRng(-1)()).toBe(makeRng(0xffffffff)());
  });
});
