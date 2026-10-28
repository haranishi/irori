// @ts-check
import {describe,expect,it} from 'vitest';
import {buildDeck,classify,isLegal,legalPlays,makeRng,shuffle,strength} from './cards.js';

/** @param {readonly string[]} hand */
const subsets = (hand) => hand.reduce((sets,card)=>sets.concat(sets.map((s)=>[...s,card])),/** @type {string[][]} */ ([[]]));
/** 実装のclassify/strengthを使わず、規則の数列から判定する全探索の参照。 @param {string[]} cards @param {boolean} revolution */
function reference(cards,revolution) {
  if (!cards.length || cards.length > 4 || new Set(cards).size !== cards.length) return null;
  const regular = cards.filter((c)=>c !== 'jk1' && c !== 'jk2');
  if (regular.some((c)=>c.slice(1) !== regular[0]?.slice(1))) return null;
  const order = revolution ? ['2','a','k','q','j','10','9','8','7','6','5','4','3'] : ['3','4','5','6','7','8','9','10','j','q','k','a','2'];
  return {n:cards.length,power:regular.length ? order.indexOf(regular[0].slice(1)) : 13};
}
/** @param {string[][]} plays */
const canonical = (plays) => plays.map((p)=>[...p].sort().join(',')).sort();

describe('54枚と乱数・交換範囲',()=>{
  it('4柄13数と識別できるジョーカー2枚を毎回独立に作る',()=>{
    const deck = buildDeck();
    expect(deck).toHaveLength(54); expect(new Set(deck).size).toBe(54);
    for (const suit of ['s','h','d','c']) expect(deck.filter((c)=>c[0] === suit)).toHaveLength(13);
    expect(deck.filter((c)=>c.startsWith('jk'))).toEqual(['jk1','jk2']);
    expect(deck.every((c)=>/^[a-z0-9_-]{1,24}$/.test(c))).toBe(true);
    deck.pop(); expect(buildDeck()).toHaveLength(54);
  });
  it('同じ種・保存した乱数状態から再生でき、異なる種で配列が変わる',()=>{
    const a = makeRng(0), b = makeRng(0);
    const values = Array.from({length:1000},()=>a());
    expect(values).toEqual(Array.from({length:1000},()=>b()));
    expect(values.every((n)=>n >= 0 && n < 1)).toBe(true);
    expect(a()).toBe(makeRng(b.state())());
    expect(shuffle(buildDeck(),makeRng(1))).not.toEqual(shuffle(buildDeck(),makeRng(2)));
    expect(makeRng(-1)()).toBe(makeRng(0xffffffff)());
  });
  it('3枚の全6通りの交換経路が全6順列に1対1対応する（末尾自身も選べる）',()=>{
    const outcomes = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
      const values = [(a+0.5)/3,(b+0.5)/2]; let index = 0;
      outcomes.push(shuffle(Object.freeze(['s3','h4','d5']),()=>values[index++]).join(','));
      expect(index).toBe(2);
    }
    expect(new Set(outcomes).size).toBe(6);
    expect(shuffle(['s3','h4','d5'],()=>1-Number.EPSILON)).toEqual(['s3','h4','d5']);
    expect(shuffle([],()=>{throw Error('乱数不要');})).toEqual([]);
    expect(shuffle(['s3'],()=>{throw Error('乱数不要');})).toEqual(['s3']);
  });
  it('1000種のシャッフルは札の総数と一意性を保つ',()=>{
    const deck = buildDeck();
    for (let seed = 0; seed < 1000; seed++) expect(shuffle(deck,makeRng(seed)).sort()).toEqual([...deck].sort());
  });
});

describe('セットと強さ',()=>{
  it('全54枚で通常・革命の順、ジョーカーの最強を守る',()=>{
    const ranks = ['3','4','5','6','7','8','9','10','j','q','k','a','2'];
    ranks.forEach((rank,i)=>{
      for (const suit of ['s','h','d','c']) {
        expect(strength(suit+rank,false)).toBe(i); expect(strength(suit+rank,true)).toBe(12-i);
      }
    });
    for (const joker of ['jk1','jk2']) for (const rev of [false,true]) expect(strength(joker,rev)).toBe(13);
    expect(strength('s1',false)).toBe(-1);
  });
  it.each([
    [['jk1'],{n:1,rank:'joker',jokers:1}], [['jk1','jk2'],{n:2,rank:'joker',jokers:2}],
    [['s8','jk1'],{n:2,rank:'8',jokers:1}], [['s3','h3','jk1','jk2'],{n:4,rank:'3',jokers:2}],
  ])('ジョーカーを正しい数の代わりにする: %j',(cards,expected)=>expect(classify(cards)).toEqual(expected));
  it.each([[],['s3','h4'],['s3','s3'],['jk1','jk1'],['s3','h3','d3','c3','jk1'],['s1'],['S3'],['jk3']])('無効なセットを拒む: %j',(/** @type {string[]} */ ...args)=>expect(classify(args)).toBeNull());
  it('同じ強さ・枚数違いを拒み、革命中でもジョーカーには勝てない',()=>{
    for (const rev of [false,true]) {
      expect(isLegal(['s3'],{cards:['h3']},rev)).toBe(false);
      expect(isLegal(['s3','h3'],{cards:['d3']},rev)).toBe(false);
      expect(isLegal(['s3'],{cards:['jk1']},rev)).toBe(false);
      expect(isLegal(['jk1','jk2'],{cards:['s2','h2']},rev)).toBe(true);
      expect(isLegal(['jk2'],{cards:['jk1']},rev)).toBe(false);
    }
    expect(isLegal(['s3'],{cards:['s2']},true)).toBe(true);
    expect(isLegal(['s3'],{cards:['s2']},false)).toBe(false);
    expect(isLegal(['s3'],{cards:[]},false)).toBe(false);
  });
});

describe('合法手の全列挙',()=>{
  it('小さい手札の全256通り×11の場×革命2通りが全ての部分集合の参照判定と一致する',()=>{
    const hands = subsets(['s3','h3','d3','s8','h8','s2','jk1','jk2']);
    const tables = [null,...[['s3'],['s8'],['s2'],['jk1'],['s3','h3'],['s8','h8'],['s3','jk1'],['jk1','jk2'],['s3','h3','d3'],['s3','h3','d3','jk1']].map((cards)=>({cards}))];
    for (const hand of hands) for (const table of tables) for (const rev of [false,true]) {
      const previous = table ? reference(table.cards,rev) : null;
      const expected = subsets(hand).filter((cards)=>{
        const play = reference(cards,rev);
        return play && (!previous || (play.n === previous.n && play.power > previous.power));
      });
      const actual = legalPlays(hand,table,rev);
      expect(canonical(actual)).toEqual(canonical(expected));
      expect(new Set(canonical(actual)).size).toBe(actual.length);
      for (const play of subsets(hand)) expect(isLegal(play,table,rev)).toBe(canonical(expected).includes([...play].sort().join(',')));
    }
  },30000);
  it('全ての数・柄を含む100種の小手札も全探索に一致する',()=>{
    for (let seed = 0; seed < 100; seed++) {
      const deck = shuffle(buildDeck(),makeRng(seed)); const hand = deck.slice(0,8);
      for (const rev of [false,true]) {
        const expected = subsets(hand).filter((cards)=>reference(cards,rev));
        expect(canonical(legalPlays(hand,null,rev))).toEqual(canonical(expected));
      }
    }
  });
});
