import {describe,it,expect} from 'vitest';
import {CARD_NAMES,buildDeck,deal,handSize,makeRng,shuffle} from './cards.js';

// 設計書の配札表を固定値で照合し、実装同士の比較にしない。
const expected={3:[1,1,4,1,1,4],4:[1,0,6,1,2,6],5:[1,1,7,2,2,7],6:[1,5,4,2,3,3],7:[1,6,4,3,4,3],8:[1,7,5,3,4,4]};

describe('配札と種つき乱数',()=>{
  it.each([3,4,5,6,7,8])('%i人の構成・均等配札・初手を守る',(n)=>{
    const deck=buildDeck(n),h=handSize(n),keys=Object.keys(CARD_NAMES);
    expect(deck).toHaveLength(n*h);
    expect(keys.map((c)=>deck.filter((v)=>v===c).length)).toEqual(expected[n]);
    expect(deck.filter((c)=>c==='bell')).toHaveLength(1);
    expect(deck.filter((c)=>c==='catch').length).toBeGreaterThanOrEqual(n===3?1:2);
    for (const c of keys) {expect([...CARD_NAMES[c]].length).toBeLessThanOrEqual(12);expect(deck.filter((v)=>v===c).length/deck.length).toBeLessThanOrEqual(0.4);}
    for (let seed=0;seed<200;seed++) {
      const ids=Array.from({length:n},(_,i)=>i+1),d=deal(ids,seed);
      expect(d).toEqual(deal(ids.reverse(),seed));
      expect(Object.values(d.hands).flat().sort()).toEqual([...deck].sort());
      for (const hand of Object.values(d.hands)) {expect(hand).toHaveLength(h);expect(hand.some((c)=>c!=='bell'&&c!=='catch')).toBe(true);}
    }
  });
  it('CPUの席を受け付け、数字の席のあとへ並べる',()=>{
    expect(deal([9,'cpu2','cpu1'],9)).toEqual(deal(['cpu1',9,'cpu2'],9));
  });
  it.each([0,2,9,3.5])('人数%iを断る',(n)=>expect(()=>buildDeck(n)).toThrow(RangeError));
  it.each([[1,1,2],[0,1,2],[1,2,'other'],[1,2,NaN]])('不正な席%jを断る',(...ids)=>expect(()=>deal(ids,1)).toThrow(RangeError));
  it('乱数の続きと並べ替えを再生でき、入力を変えない',()=>{
    const rng=makeRng(42),a=[1,2,3,4],first=shuffle(a,rng),saved=rng.state;
    expect(a).toEqual([1,2,3,4]);expect(shuffle(a,makeRng(42))).toEqual(first);
    expect(rng()).toBe(makeRng(saved)());
    expect(shuffle(a,makeRng(43))).not.toEqual(first);
  });
});
