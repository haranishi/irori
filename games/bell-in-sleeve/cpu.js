// @ts-check
/** @typedef {import('./logic.js').SeatView} SeatView */
/** @typedef {import('./cards.js').SeatId} SeatId */
/** @param {number} humans @returns {import('./logic.js').Player[]} */
export function fillSeats(humans) {
  if (!Number.isSafeInteger(humans) || humans < 0 || humans > 8) throw new RangeError('人数が不正です');
  return humans >= 3 ? [] : Array.from({length:5-humans},(_,i)=>({id:`cpu${i+1}`,name:`CPU ${i+1}`,cpu:true,online:true}));
}
/** @param {()=>number} rng */
export function thinkMs(rng) { return 800+Math.floor(rng()*1201); }
/** 移動の前の証拠は確定扱いにしない。 @param {SeatView} view */
export function suspicion(view) {
  /** @type {Record<SeatId,number>} */
  const weights=Object.fromEntries(view.seats.map((v)=>[v.id,1]));
  for (const e of view.events) {
    if (e.type === 'swap') {weights[e.p]=1;if (e.target !== undefined) weights[e.target]=1;}
    if (e.type === 'miss' && e.target !== undefined) weights[e.target]=0.02;
    if (e.type === 'guard' && e.target !== undefined) weights[e.target]=(weights[e.target] ?? 1)*1.4;
  }
  for (const o of view.observations) {
    if (view.events.some((e)=>e.type === 'swap' && e.seq > o.seq && (e.p === o.target || e.target === o.target))) continue;
    if (view.events.some((e)=>e.type === 'miss' && e.seq > o.seq && e.target === o.target)) continue;
    const count=view.seats.find((v)=>v.id === o.target)?.count ?? 1;
    if (o.card === 'bell') weights[o.target]=100000;
    else if ((weights[o.target] ?? 1) < 100000) weights[o.target]=(weights[o.target] ?? 1)*(count === 1 ? 0.02 : 0.55);
  }
  if (view.hand.includes('bell')) for (const v of view.seats) weights[v.id]=v.id === view.self ? 100000 : 0.02;
  return weights;
}
/** @param {SeatView} view @param {SeatId} p @param {()=>number} rng @returns {import('./logic.js').GameInput|null} */
export function decide(view,p,rng) {
  if (view.self !== p) throw new RangeError('自分の情報だけを渡してください');
  const pad=view.pad;
  if (pad.k !== 'tiles' || pad.disabled) return null;
  const options=pad.tiles.flatMap((tile,i)=>tile.off ? [] : [{tile,i}]);
  if (!options.length) return null;
  const weights=suspicion(view),hasBell=view.hand.includes('bell');
  const known=Object.entries(weights).find(([,w])=>w >= 100000)?.[0];
  const reachable=known !== undefined && known !== String(p) && !view.seats.find((v)=>String(v.id) === known)?.guard;
  /** @param {typeof options[number]} option */
  function weight({i}) {
    if (view.phase === 'vote') {
      const target=view.seats[i];
      return !target ? 1 : hasBell ? target.id === p ? 0 : 1 : weights[target.id] ?? 1;
    }
    if (view.phase === 'turn' && view.step === 'pickTarget') {
      const target=view.seats[i];if (!target) return 1;
      if (view.step === 'pickTarget' && view.discard.at(-1) === 'guard') return target.id === p && hasBell ? 100000 : 1;
      if (view.step === 'pickTarget' && view.discard.at(-1) === 'catch' && reachable) return String(target.id) === known ? 100000 : 0;
      return hasBell ? target.id === p ? 0 : 1 : weights[target.id] ?? 1;
    }
    if (view.step === 'pickCard') {
      const card=view.hand[i];
      if (reachable && card === 'catch') return 100000;
      if (reachable && view.hand.includes('catch')) return 0;
      if (hasBell) return card === 'guard' ? 8 : card === 'swap' ? 6 : card === 'catch' ? 0.2 : 1;
      return card === 'peek' ? 4 : card === 'catch' ? 0.7 : 1;
    }
    if (view.step === 'pickGive') return view.hand[i] === 'bell' ? 100000 : 1;
    if (view.step === 'whisper') return view.hand[i] === 'bell' && view.hand.some((c)=>c !== 'bell') ? 0 : 1;
    return 1;
  }
  const weighted=options.map((option)=>({...option,w:weight(option)}));
  // 確認済みの鈴へは、低い確率の外れを混ぜない。
  const certain=weighted.filter((o)=>o.w >= 100000);
  const candidates=certain.length ? certain : weighted;
  let draw=rng()*candidates.reduce((sum,o)=>sum+o.w,0),chosen=candidates[0];
  for (const option of candidates) {draw-=option.w;if (draw < 0) {chosen=option;break;}}
  return {k:'tiles',ids:[/** @type {typeof options[number]} */ (chosen).tile.id],t:pad.token};
}
