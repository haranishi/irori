// @ts-check
import { currentRole, roleText, primaryKey } from './presentation.js';
import { cardText, compareHands, deal, evaluate, makeRng } from './cards.js';
/** @typedef {import('./cards.js').SeatId} SeatId */
/** @typedef {{id:SeatId,name:string,online:boolean,cpu?:boolean}} Player */
/** @typedef {{connected:boolean,visible:boolean}} Environment */
/** @typedef {Player & {cpu:boolean,hand:string[],points:number,street:number,paid:number,folded:boolean,left:boolean,rank:number|null}} Seat */
/** @typedef {{id:string,label:string,sub?:string,off?:boolean}} Tile */
/** @typedef {{k:'tiles',token:string,tiles:Tile[],min:number,max:number,ok:string,disabled:boolean,note:string}} PadSpec */
/** @typedef {{k:string,ids?:string[],t?:string,pass?:boolean}} GameInput */
/** @typedef {{players:readonly Player[],leader:SeatId|null,seed:number,nonce:string,paused?:boolean,environment?:Environment|null}} GameInit */
/** @typedef {{t:'input',p:SeatId,input:GameInput}|{t:'tick',ms:number}|{t:'players',players:readonly Player[],leader:SeatId|null}|{t:'menu',paused:boolean}|{t:'environment',value:Environment|null}} GameEvent */
/** @typedef {{p:SeatId,score:number,rank:number|null,cpu:boolean,label:string,ranked:boolean}} Result */
/** @typedef {{p:number,score:number,label:string,ranked:boolean}} EndRow */
/** @typedef {{t:'pad',to:SeatId,spec:PadSpec}|{t:'cue',name:'deal'|'flip'|'place'|'win'|'lose'}|{t:'end',results:EndRow[],options:{display:'points',outcome:'complete'|'incomplete'}}} GameEffect */
/** @typedef {{seq:number,p:SeatId,type:string,amount:number}} PublicEvent */
/** @typedef {{
 * phase:'intro'|'deal'|'turn'|'flop'|'river'|'fourth'|'showdown'|'result',
 * streetIndex:number,
 * seats:Seat[],
 * leader:SeatId|null,
 * nonce:string,
 * rngState:number,
 * handNumber:number,
 * dealer:SeatId|null,
 * turn:SeatId|null,
 * deck:string[],
 * board:string[],
 * pot:number,
 * settledPot:number,
 * payouts:Record<SeatId,number>,
 * current:number,
 * lastRaise:number,
 * pending:SeatId[],
 * remaining:number,
 * paused:boolean,
 * environment:Environment|null,
 * epochs:Record<SeatId,number>,
 * events:PublicEvent[],
 * seq:number,
 * winners:SeatId[],
 * revealed:SeatId[],
 * outcome:'complete'|'incomplete',
 * ended:boolean
 * }} GameState */
/** @typedef {{state:GameState,effects:GameEffect[]}} Transition */
/** @typedef {{kind:'fold'|'check'|'call'|'raise'|'all'|'start',amount:number,label:string}} Action */
/** @param {GameState} s */
const blocked = s => s.paused || !s.environment?.connected || !s.environment.visible;
/** @param {GameState} s @param {SeatId} p @returns {Seat} */
const seat = (s, p) => /** @type {Seat} */ (s.seats.find(v => v.id === p));
/** @param {GameState} s */
const live = s => s.seats.filter(v => !v.left && !v.folded && v.hand.length === 2);
/** @param {GameState} s */
const funded = s => s.seats.filter(v => !v.left && v.points > 0);
/** @param {GameState} s @param {SeatId|null} p @param {Seat[]} options */
function after(s, p, options) {
  const i = s.seats.findIndex(v => v.id === p);
  for (let j = 1; j <= s.seats.length; j++) {
    const v = s.seats[(i + j) % s.seats.length];
    if (v && options.includes(v))
      return v.id;
  }
  return null;
}
/** @param {GameState} s @param {SeatId} p */
const token = (s, p) => `p${s.nonce}_${(s.epochs[p] ?? 0).toString(36)}`;
/** @param {GameState} s */
function bump(s) {
  for (const v of s.seats)
    s.epochs[v.id] = (s.epochs[v.id] ?? 0) + 1;
}
/** @param {GameState} s @param {SeatId} p @param {string} type @param {number} amount */
function record(s, p, type, amount) {
  s.events.push({ seq: ++s.seq, p, type, amount });
  s.events = s.events.slice(-4);
}
/** @param {GameState} s @param {Seat} v @param {number} amount */
function pay(s, v, amount) {
  v.points -= amount;
  v.street += amount;
  v.paid += amount;
  s.pot += amount;
}
/** @param {GameState} s @param {SeatId} p @returns {Action[]} */
export function legalActions(s, p) {
  const own = s.seats.find(v => v.id === p);
  if (!own || own.left || !own.online || blocked(s) || s.ended)
    return [];
  if (s.phase === 'intro')
    return p === s.leader && s.seats.length >= 2 ? [{ kind: 'start', amount: 0, label: 'はじめる' }] : [];
  if (s.phase !== 'turn' || s.turn !== p || own.folded)
    return [];
  const cap = Math.min(...live(s).map(v => v.points + v.street)), due = s.current - own.street;
  /** @type {Action[]} */
  const out = [{ kind: 'fold', amount: 0, label: 'おりる' }];
  if (due === 0)
    out.push({ kind: 'check', amount: 0, label: 'そのまま' });
  else if (s.current <= cap)
    out.push({ kind: own.street + due === cap ? 'all' : 'call', amount: due, label: own.street + due === cap ? `ぜんぶ ${due}` : `あわせる ${due}` });
  const widths = [40, Math.floor(s.pot / 2), s.pot], seen = new Set();
  for (const width of widths) {
    const target = s.current + width;
    if (width < s.lastRaise || target >= cap || seen.has(target))
      continue;
    seen.add(target);
    out.push({ kind: 'raise', amount: target - own.street, label: `ふやす +${width}` });
  }
  if (cap > s.current && cap > own.street)
    out.push({ kind: 'all', amount: cap - own.street, label: `ぜんぶ ${cap - own.street}` });
  return out;
}
/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  const ids = init.players.map(v => v.id);
  if (init.players.length < 2 || init.players.length > 8
      || new Set(ids).size !== ids.length
      || ids.some(id => typeof id === 'number' ? !Number.isSafeInteger(id) || id < 1 || id > 8 : !/^cpu[1-9]\d*$/.test(id))
      || init.players.some(v => typeof v.id === 'string' && !v.cpu)
      || !Number.isFinite(init.seed)
      || !/^[a-z0-9]{1,8}$/.test(init.nonce))
    throw new RangeError('初期値が不正です');
  const rng = makeRng(init.seed);
  // 親は席IDやCPUの印に依存させず、最初に等確率で選ぶ。
  const dealer = ids[Math.floor(rng() * ids.length)] ?? null;
  /** @type {GameState} */
  const s = {
    phase: 'intro',
    streetIndex: 0,
    seats: init.players.map(p => ({ ...p, cpu: p.cpu === true, hand: [], points: 1000, street: 0, paid: 0, folded: false, left: false, rank: null })),
    leader: init.leader,
    nonce: init.nonce,
    rngState: rng.state,
    handNumber: 0,
    dealer,
    turn: null,
    deck: [],
    board: [],
    pot: 0,
    settledPot: 0,
    payouts: {},
    current: 0,
    lastRaise: 20,
    pending: [],
    remaining: 0,
    paused: init.paused ?? false,
    environment: init.environment ? { ...init.environment } : null,
    epochs: {},
    events: [],
    seq: 0,
    winners: [],
    revealed: [],
    outcome: 'complete',
    ended: false
  };
  return transition(null, s);
}
/** @param {GameState} s @param {SeatId} p @returns {PadSpec} */
function padFor(s, p) {
  const own = seat(s, p), t = token(s, p), actions = legalActions(s, p);
  let note = '手札2枚と場の札で役を作ろう。持ち点は1000から。';
  if (s.phase !== 'intro') {
    if (own.points === 0 && own.hand.length === 0) {
      note = '持ち点0：この局は見るだけです。役の早見：ロイヤル＞ストフラ＞フォーカード＞フルハウス＞フラッシュ＞ストレート＞スリーカード＞ツーペア＞ワンペア＞なし';
    } else {
      const personal = `あなた：${own.hand.map(cardText).join(' ')}｜いまの役：${currentRole(own.hand, s.board)}`;
      const totals = `｜たまり${s.phase === 'showdown' ? s.settledPot : s.pot}｜持ち点${own.points}`;
      const board = `｜場：${s.board.map(cardText).join(' ')}`;
      // 上限では長い場の一覧から省き、本人の手札と役を残す。
      note = personal + board + totals;
      if ([...note].length > 120) note = personal + totals;
    }
  }
  const tiles = actions.length ? actions.map((a, i) => ({
    id: `${t}_${i}`,
    label: a.label,
    ...(['call', 'raise', 'all'].includes(a.kind)
      ? { sub: `${a.kind === 'call' ? '出す' : '合計'}${a.amount}点` } : {}),
  })) : own.hand.map((c, i) => ({ id: `${t}_${i}`, label: cardText(c), off: true }));
  return { k: 'tiles', token: t, tiles, min: actions.length ? 1 : 0, max: actions.length ? 1 : 0, ok: '決定', disabled: !actions.length, note };
}
/** @param {GameState} s */
function startHand(s) {
  const players = funded(s);
  if (players.length < 2) {
    finish(s);
    return;
  }
  if (s.handNumber > 0 || !players.some(v => v.id === s.dealer))
    s.dealer = after(s, s.dealer, players);
  s.settledPot = 0;
  s.payouts = {};
  s.handNumber++;
  s.board = [];
  s.winners = [];
  s.revealed = [];
  s.streetIndex = 0;
  s.current = 0;
  s.lastRaise = 20;
  const d = deal(players.map(v => v.id), s.rngState);
  s.deck = d.deck;
  s.rngState = d.rngState;
  for (const v of s.seats) {
    v.hand = d.hands[v.id] ?? [];
    v.folded = v.hand.length === 0;
    v.street = 0;
    v.paid = 0;
  }
  const small = players.length === 2 ? s.dealer : after(s, s.dealer, players), big = after(s, small, players), cap = Math.min(...players.map(v => v.points));
  pay(s, seat(s, /** @type {SeatId} */ (small)), Math.min(10, cap));
  pay(s, seat(s, /** @type {SeatId} */ (big)), Math.min(20, cap));
  s.current = Math.min(20, cap);
  s.pending = players.map(v => v.id);
  s.turn = after(s, big, players);
  s.phase = 'deal';
  s.remaining = 1200;
}
/** @param {GameState} s */
function openTurn(s) {
  s.pending = s.pending.filter(p => live(s).some(v => v.id === p));
  // 同額の上限に全員が届いたら、追加の入力なしで場を開く。
  const cap = Math.min(...live(s).map(v => v.points + v.street));
  s.pending = s.pending.filter(p => seat(s, p).street < cap);
  if (!s.pending.length) {
    nextStreet(s);
    return;
  }
  if (!s.pending.includes(/** @type {SeatId} */ (s.turn)))
    s.turn = after(s, s.turn, live(s).filter(v => s.pending.includes(v.id)));
  s.phase = 'turn';
  s.remaining = 25000;
}
/** @param {GameState} s */
function nextStreet(s) {
  if (s.streetIndex === 3) {
    settle(s);
    return;
  }
  s.streetIndex++;
  const count = s.streetIndex === 1 ? 3 : 1;
  for (let i = 0; i < count; i++)
    s.board.push(/** @type {string} */ (s.deck.shift()));
  for (const v of s.seats)
    v.street = 0;
  s.current = 0;
  s.lastRaise = 20;
  s.pending = live(s).map(v => v.id);
  s.turn = after(s, s.dealer, live(s));
  s.phase = s.streetIndex === 1 ? 'flop' : s.streetIndex === 2 ? 'fourth' : 'river';
  s.remaining = 1000;
}
/** @param {GameState} s */
function settle(s) {
  const contenders = live(s);
  // 精算済みの点はpotに戻さず、勝負中の表示だけに残す。
  s.settledPot = s.pot;
  const before = new Map(s.seats.map(v => [v.id, v.points]));
  s.revealed = contenders.length >= 2 ? contenders.map(v => v.id) : [];
  let winners = contenders;
  if (contenders.length >= 2) {
    const ranked = contenders.map(v => ({ v, hand: evaluate([...v.hand, ...s.board]) }));
    ranked.sort((a, b) => compareHands(b.hand, a.hand));
    winners = ranked.filter(v => compareHands(v.hand, /** @type {typeof ranked[number]} */ (ranked[0]).hand) === 0).map(v => v.v);
  }
  if (!winners.length) {
    // 全員退出のときも、出した点を返して総数を保つ。
    for (const v of s.seats)
      v.points += v.paid;
  }
  else {
    const share = Math.floor(s.pot / winners.length);
    for (const v of winners)
      v.points += share;
    let rest = s.pot % winners.length, p = s.dealer;
    while (rest-- > 0) {
      p = after(s, p, winners);
      seat(s, /** @type {SeatId} */ (p)).points++;
    }
  }
  s.payouts = Object.fromEntries(winners.map(v => [v.id, v.points - (before.get(v.id) ?? v.points)]));
  s.winners = winners.map(v => v.id);
  s.pot = 0;
  for (const v of s.seats) {
    v.paid = 0;
    v.street = 0;
  }
  s.turn = null;
  s.pending = [];
  s.phase = 'showdown';
  s.remaining = 3500;
}
/** @param {GameState} s */
function finish(s) {
  if (s.pot) {
    for (const v of s.seats) {
      v.points += v.paid;
      v.paid = 0;
      v.street = 0;
    }
    s.pot = 0;
  }
  s.phase = 'result';
  s.turn = null;
  s.pending = [];
  s.remaining = 20000;
  for (const v of s.seats)
    v.rank = s.outcome === 'complete' ? 1 + s.seats.filter(other => other.points > v.points).length : null;
}
/** @param {GameState} s @param {SeatId} p @param {Action} action @param {boolean} auto */
function act(s, p, action, auto = false) {
  if (action.kind === 'start') {
    startHand(s);
    return;
  }
  const own = seat(s, p);
  record(s, p, auto ? 'auto' : action.kind, action.amount);
  s.pending = s.pending.filter(id => id !== p);
  if (action.kind === 'fold')
    own.folded = true;
  else {
    const before = s.current;
    pay(s, own, action.amount);
    if (own.street > before) {
      const width = own.street - before;
      s.current = own.street;
      if (width >= s.lastRaise) {
        s.lastRaise = width;
        s.pending = live(s).filter(v => v.id !== p).map(v => v.id);
      }
      else
        s.pending = live(s).filter(v => v.id !== p && (s.pending.includes(v.id) || v.street < s.current)).map(v => v.id);
    }
  }
  if (live(s).length <= 1) {
    settle(s);
    return;
  }
  s.turn = after(s, p, live(s).filter(v => s.pending.includes(v.id)));
  openTurn(s);
}
/** @param {GameState} s @returns {Result[]} */
function results(s) {
  return s.phase === 'result' ? s.seats.map(v => ({ p: v.id, score: v.points, rank: v.rank, cpu: v.cpu, ranked: v.rank !== null, label: v.rank === null ? '勝負なし' : `${v.rank}位` })) : [];
}
/** SDKへは、この4項目以外を渡さない。 @param {GameState} s @returns {EndRow[]} */
export function endRows(s) {
  const cpu = s.seats.some(v => v.cpu);
  return results(s).filter(v => !v.cpu).map(v => ({
    p: /** @type {number} */ (v.p),
    score: v.score,
    label: cpu && v.ranked ? `${v.rank}位(CPUこみ)` : v.label,
    ranked: v.ranked && !cpu
  }));
}
/** @param {GameState} s */
export function publicView(s) {
  const ranks = new Map(s.revealed.map(p => [p, evaluate([...seat(s, p).hand, ...s.board])]));
  return {
    phase: s.phase, streetIndex: s.streetIndex, handNumber: s.handNumber,
    dealer: s.dealer, turn: s.turn, board: [...s.board],
    pot: s.phase === 'showdown' ? s.settledPot : s.pot,
    current: s.current, lastRaise: s.lastRaise, remaining: s.remaining,
    paused: blocked(s), ended: s.ended, outcome: s.outcome, winners: [...s.winners],
    seats: s.seats.map(({ hand, ...v }) => {
      const rank = ranks.get(v.id);
      const kicker = rank && s.winners.includes(v.id) && [...ranks.values()].some(other =>
        primaryKey(rank) === primaryKey(other) && compareHands(rank, other) > 0);
      return {
        id: v.id, name: v.name, online: v.online, cpu: v.cpu,
        points: v.points, street: v.street, paid: v.paid,
        folded: v.folded, left: v.left, rank: v.rank, count: hand.length,
        received: s.phase === 'showdown' ? (s.payouts[v.id] ?? 0) : 0,
        ...(rank ? { hand: [...hand], role: roleText(rank), kicker: Boolean(kicker) } : {}),
      };
    }),
    events: s.events.map(e => ({ ...e })), results: results(s),
  };
}
/** @param {GameState} s @param {SeatId} p */
export function viewFor(s, p) {
  const own = s.seats.find(v => v.id === p);
  if (!own)
    throw new RangeError('席がありません');
  return { ...publicView(s), self: p, hand: [...own.hand], pad: padFor(s, p), actions: legalActions(s, p) };
}
/** @typedef {ReturnType<typeof viewFor>} SeatView */
/** @param {GameState|null} previous @param {GameState} s @returns {Transition} */
function transition(previous, s) {
  /** @type {GameEffect[]} */
  const effects = [];
  for (const v of s.seats) {
    const spec = padFor(s, v.id);
    if (!previous || JSON.stringify(spec) !== JSON.stringify(padFor(previous, v.id)))
      effects.push({ t: 'pad', to: v.id, spec });
  }
  if (previous && s.phase !== previous.phase) {
    const name = s.phase === 'deal' ? 'deal' : s.phase === 'showdown' ? 'win' : ['flop', 'fourth', 'river'].includes(s.phase) ? 'flip' : null;
    if (name)
      effects.push({ t: 'cue', name });
  }
  else if (previous && s.seq !== previous.seq)
    effects.push({ t: 'cue', name: 'place' });
  if (s.ended && !previous?.ended)
    effects.push({ t: 'end', results: endRows(s), options: { display: 'points', outcome: s.outcome } });
  return { state: s, effects };
}
/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state, event) {
  if (state.ended)
    return { state, effects: [] };
  if (event.t === 'tick' && (!Number.isFinite(event.ms) || event.ms <= 0 || blocked(state) || state.phase === 'intro'))
    return { state, effects: [] };
  const s = structuredClone(state);
  if (event.t === 'input') {
    const own = s.seats.find(v => v.id === event.p);
    if (!own)
      return { state, effects: [] };
    const pad = padFor(s, event.p), input = event.input, i = pad.tiles.findIndex(v => v.id === input?.ids?.[0]);
    if (!input || input.k !== 'tiles' || input.pass || input.t !== pad.token || input.ids?.length !== 1 || pad.disabled || i < 0 || pad.tiles[i]?.off) {
      s.epochs[event.p] = (s.epochs[event.p] ?? 0) + 1;
      return transition(state, s);
    }
    act(s, event.p, /** @type {Action} */ (legalActions(s, event.p)[i]));
    bump(s);
  }
  else if (event.t === 'tick') {
    s.remaining = Math.max(0, s.remaining - event.ms);
    if (s.remaining === 0) {
      if (s.phase === 'turn') {
        const own = seat(s, /** @type {SeatId} */ (s.turn));
        act(s, own.id, { kind: own.street === s.current ? 'check' : 'fold', amount: 0, label: '' }, true);
      }
      else if (s.phase === 'showdown') {
        if (s.handNumber >= 6 || funded(s).length < 2)
          finish(s);
        else
          startHand(s);
      }
      else if (s.phase === 'result')
        s.ended = true;
      else
        openTurn(s);
      bump(s);
    }
  }
  else if (event.t === 'menu') {
    s.paused = event.paused;
    bump(s);
  }
  else if (event.t === 'environment') {
    s.environment = event.value ? { ...event.value } : null;
    bump(s);
  }
  else if (event.t === 'players') {
    s.leader = event.leader;
    for (const v of s.seats) {
      const now = event.players.find(p => p.id === v.id);
      if (now && !v.left) {
        v.online = now.online;
        v.name = now.name;
      }
      else if (!v.cpu && !v.left) {
        v.left = true;
        v.online = false;
        v.folded = true;
        s.pending = s.pending.filter(p => p !== v.id);
        record(s, v.id, 'leave', 0);
      }
    }
    if (s.seats.some(v => !v.cpu) && !s.seats.some(v => !v.cpu && !v.left)) {
      s.outcome = 'incomplete';
      finish(s);
      s.ended = true;
    }
    else if (!['intro', 'result', 'showdown'].includes(s.phase)) {
      if (live(s).length <= 1)
        settle(s);
      else if (s.phase === 'turn' && seat(s, /** @type {SeatId} */ (s.turn)).left) {
        s.turn = after(s, s.turn, live(s).filter(v => s.pending.includes(v.id)));
        openTurn(s);
      }
    }
    bump(s);
  }
  return transition(state, s);
}
