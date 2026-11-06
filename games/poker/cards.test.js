import {describe,it,expect} from 'vitest';
import {buildDeck,deal,evaluate,compareHands,makeRng,shuffle,HAND_NAMES,cardText} from './cards.js';
const hand=s=>s.split(' ');
describe('札と役の比較',()=>{
  it('52枚の保存と種つき配札',()=>{
    expect(new Set(buildDeck()).size).toBe(52);
    for(let n=2;n<=8;n++){const d=deal(Array.from({length:n},(_,i)=>i+1),123);expect(d).toEqual(deal(Array.from({length:n},(_,i)=>i+1),123));expect([...Object.values(d.hands).flat(),...d.deck].sort()).toEqual(buildDeck().sort());expect(Object.values(d.hands).every(h=>h.length===2)).toBe(true);}
    expect(shuffle(buildDeck(),makeRng(1))).not.toEqual(buildDeck());expect(cardText('s14')).toBe('♠A');expect(cardText('h11')).toBe('♥J');
  });
  it.each([
    ['s14 s13 s12 s11 s10 h2 d3',9,[14]],
    ['h9 h8 h7 h6 h5 s14 d14',8,[9]],
    ['s9 h9 d9 c9 s14 h13 d2',7,[9,14]],
    ['s9 h9 d9 c14 s14 h13 d2',6,[9,14]],
    ['s9 h9 d9 s14 h14 d14 c2',6,[14,9]],
    ['h14 h11 h9 h6 h3 s14 d13',5,[14,11,9,6,3]],
    ['s14 h2 d3 c4 s5 h13 d12',4,[5]],
    ['s14 h13 d12 c11 s10 h10 d2',4,[14]],
    ['s9 h9 d9 c14 s13 h8 d2',3,[9,14,13]],
    ['s9 h9 d14 c14 s13 h8 d2',2,[14,9,13]],
    ['s9 h9 d14 c14 s13 h13 d2',2,[14,13,9]],
    ['s9 h9 d14 c13 s11 h8 d2',1,[9,14,13,11]],
    ['s14 h13 d11 c9 s7 h4 d2',0,[14,13,11,9,7]],
  ])('%s の役と最強5枚',(cards,category,keys)=>{
    const result=evaluate(hand(cards));expect(result.category).toBe(category);expect(result.value).toEqual([category,...keys]);expect(result.cards).toHaveLength(5);expect(new Set(result.cards).size).toBe(5);expect(result.cards.every(c=>hand(cards).includes(c))).toBe(true);expect(evaluate(result.cards).value).toEqual(result.value);expect([...result.name].length).toBeLessThanOrEqual(12);
  });
  it.each([
    ['s14 h14 d13 c11 s9 h4 d2','d14 c14 s12 h11 d9 c4 h2',1],
    ['s14 s12 s9 s6 s3 h2 d4','h14 h12 h9 h6 h3 d2 c4',0],
    ['s14 s12 s9 s6 s4 h2 d3','h14 h12 h9 h6 h3 d2 c4',1],
    ['s9 h9 d14 c14 s13 h8 d2','s9 h9 d14 c14 s12 h8 d2',1],
    ['s14 h2 d3 c4 s5 h13 d12','s2 h3 d4 c5 s6 h13 d12',-1],
    ['s14 s13 s12 s11 s10 h2 d3','s14 s13 s12 s11 s10 c9 h9',0],
  ])('キッカー・柄の同点・場だけの勝負 %s',(a,b,want)=>expect(compareHands(evaluate(hand(a)),evaluate(hand(b)))).toBe(want));
  it('不正な札を拒む',()=>{for(const cards of ['s14 s14 h2 d3 c4','s1 h2 d3 c4 s5','s14 h2 d3 c4'])expect(()=>evaluate(hand(cards))).toThrow();expect(HAND_NAMES).toHaveLength(10);});
});
