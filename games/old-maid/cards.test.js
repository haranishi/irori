// @ts-check
import {describe,expect,it} from 'vitest';
import {buildDeck,cardText,dealAndPair,makeRng,pairOff,shuffle} from './cards.js';

describe('札と配札',() => {
  it('53枚は一意でジョーカーが1枚、札の識別子の範囲を守る',() => {
    const deck=buildDeck();
    expect(deck).toHaveLength(53);expect(new Set(deck).size).toBe(53);
    expect(deck.filter((c) => c==='jk')).toHaveLength(1);
    expect(deck.every((c) => /^[a-z0-9_-]{1,24}$/.test(c))).toBe(true);
    expect(cardText('h7')).toBe('♥7');expect(cardText('jk')).toBe('JK');
  });
  it.each([1,2,3,4])('同数%i枚は偶数枚だけ捨てる（3枚は1枚残し、4枚は全て捨てる）',(n) => {
    const hand=['s7','h7','d7','c7'].slice(0,n);
    const original=[...hand];const result=pairOff(hand);
    expect(result.hand).toHaveLength(n%2);expect(result.discard).toHaveLength(n-n%2);
    expect([...result.hand,...result.discard].sort()).toEqual([...hand].sort());expect(hand).toEqual(original);
  });
  it('異なる数とジョーカーはペアにしない',() => {
    expect(pairOff(['jk','s3','h4','d3','c4','s10','hj','dk'])).toEqual({hand:['jk','s10','hj','dk'],discard:['s3','d3','h4','c4']});
  });
  it('同じ種は同じ配札、種が違えば変わり、呼出元の席順は変えない',() => {
    const seats=[8,1,4];expect(dealAndPair(seats,51)).toEqual(dealAndPair([1,4,8],51));
    expect(dealAndPair(seats,51)).not.toEqual(dealAndPair(seats,52));expect(seats).toEqual([8,1,4]);
    for(const ids of [[],[1],[1,1],[1,2,3,4,5,6,7,8,9]]) expect(() => dealAndPair(ids,1)).toThrow(RangeError);
  });
  it('各席に余りを先の席から配り、自動で上がる席も返す',() => {
    // 配札だけで上がれる種を探し、空の手札の扱いを確認する。
    let found=false;
    for(let seed=0;seed<2000;seed++) {
      const ids=[1,2];const result=dealAndPair(ids,seed);
      const all=[...Object.values(result.hands).flat(),...result.discard];
      expect(all.sort()).toEqual(buildDeck().sort());
      const rng=makeRng(seed);const deck=shuffle(buildDeck(),rng);
      for(let i=0;i<2;i++) expect(result.hands[ids[i]]).toEqual(pairOff(deck.filter((_,j) => j%2===i)).hand);
      expect(result.out).toEqual(ids.filter((id) => result.hands[id].length===0));
      if(result.out.length) {found=true;break;}
    }
    expect(found).toBe(true);
  });
});

describe('種つきの乱数とシャッフル',() => {
  it('保存した乱数状態から同じ続きを得られ、入力配列を変更しない',() => {
    const rng=makeRng(21);rng();const resume=makeRng(rng.state);
    expect(Array.from({length:20},() => rng())).toEqual(Array.from({length:20},() => resume()));
    const deck=Object.freeze([1,2,3]);expect(shuffle(deck,makeRng(7)).sort()).toEqual([1,2,3]);
    expect(shuffle([],makeRng(0))).toEqual([]);expect(shuffle([1],makeRng(0))).toEqual([1]);
  });
  it('3枚の全ての交換先を全探索すると6順列がちょうど1回ずつ出る',() => {
    const counts=new Map();
    for(let a=0;a<3;a++) for(let b=0;b<2;b++) {
      const values=[(a+0.5)/3,(b+0.5)/2];let index=0;
      const key=shuffle([1,2,3],() => values[index++]).join('');counts.set(key,(counts.get(key)??0)+1);
    }
    expect(counts.size).toBe(6);expect([...counts.values()]).toEqual([1,1,1,1,1,1]);
  });
  it('60000種の3枚の全順列の頻度は一様（カイ二乗<25）',() => {
    const counts=new Map();
    for(let seed=0;seed<60000;seed++) {
      const key=shuffle([1,2,3],makeRng(seed)).join('');counts.set(key,(counts.get(key)??0)+1);
    }
    expect(counts.size).toBe(6);
    const chi=[...counts.values()].reduce((sum,count) => sum+(count-10000)**2/10000,0);
    expect(chi).toBeLessThan(25);
  });
});
