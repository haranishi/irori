// @ts-check
import {assignRoles, makeRng, rolesFor} from './roles.js';
/** @typedef {import('./roles.js').Role} Role */
/** @typedef {import('./irori.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./irori.js').HostEnvironment} HostEnvironment */
/** @typedef {Extract<import('./irori.js').PadSpec,{k:'tiles'}>} Tiles */
/** @typedef {import('./irori.js').PadSpec} PadSpec */
/** @typedef {import('./irori.js').GameInput} GameInput */
/** @typedef {PlayerInfo & {alive:boolean,left:boolean,role:Role|null,lastGuard:number|null}} Seat */
/** @typedef {'intro'|'reveal'|'night'|'dawn'|'day'|'vote'|'exec'|'ended'} Phase */
/** @typedef {{from:number,to:number|null}} Vote */
/** @typedef {{phase:Phase,day:number,seats:Seat[],players:PlayerInfo[],leader:number|null,environment:HostEnvironment|null,paused:boolean,resumeRequired:boolean,blockers:string[],nonce:string,revision:number,epochs:Record<number,number>,seed:number,rng:number,discussMs:number,remaining:number,total:number,picks:Record<number,number|null>,checked:Record<number,'shown'|'done'>,showRole:Record<number,boolean>,reports:Record<number,string>,victim:number|null,runoff:boolean,candidates:number[],votes:Vote[]|null,announce:string,outcome:'complete'|'incomplete',winner:'village'|'wolf'|null}} GameState */
/** @typedef {{players:readonly PlayerInfo[],leader:number|null,environment:Readonly<HostEnvironment>|null,paused:boolean,nonce:string,seed:number,discussMs?:number}} GameInit */
/** @typedef {{t:'input',p:number,input:GameInput}|{t:'players',players:readonly PlayerInfo[],leader:number|null}|{t:'menu',paused:boolean}|{t:'environment',value:Readonly<HostEnvironment>|null}|{t:'tick',ms:number}} GameEvent */
/** @typedef {{t:'pad',to:number,spec:PadSpec}|{t:'cue',name:string,v?:number}|{t:'vibrate',to:number,ms:number[]}|{t:'end',results:import('./irori.js').GameResult[],options:import('./irori.js').GameEndOptions}} GameEffect */
/** @typedef {{state:GameState,effects:GameEffect[]}} Transition */
const IDLE_MS = 120000;
const ROLE_NAMES = {villager:'村人',wolf:'人狼',seer:'占い師',knight:'騎士',madman:'狂人'};

/** @param {GameInit} init @returns {Transition} */
export function createGame(init) {
  if (!/^[a-z0-9]{1,8}$/.test(init.nonce)) throw new RangeError('Invalid nonce');
  if (!Number.isFinite(init.seed)) throw new RangeError('Invalid seed');
  if (init.discussMs !== undefined && (!Number.isFinite(init.discussMs) || init.discussMs <= 0)) throw new RangeError('Invalid discussion duration');
  if (new Set(init.players.map((p)=>p.id)).size !== init.players.length || init.players.some((p)=>!Number.isSafeInteger(p.id) || p.id < 1)) throw new RangeError('Invalid seats');
  /** @type {GameState} */
  const state = {phase:'intro',day:0,seats:init.players.map((p)=>({...p,alive:true,left:false,role:null,lastGuard:null})),
    players:init.players.map((p)=>({...p})),leader:init.leader,environment:init.environment ? {...init.environment} : null,
    paused:init.paused,resumeRequired:false,blockers:[],nonce:init.nonce,revision:0,epochs:{},seed:init.seed,rng:(init.seed ^ 0x9e3779b9) >>> 0,
    discussMs:init.discussMs ?? 180000,remaining:0,total:0,picks:{},checked:{},showRole:{},reports:{},victim:null,
    runoff:false,candidates:[],votes:null,announce:'役を確かめて、月あかりの寄り合いを始めましょう',outcome:'complete',winner:null};
  return transition(null, reconcile(state));
}

/** @param {GameState} state @returns {Seat[]} */
function living(state) { return state.seats.filter((s)=>s.alive && !s.left); }
/** @param {GameState} state */
function canBegin(state) { return state.phase === 'intro' && !state.blockers.length && state.seats.length >= 4 && state.seats.length <= 8 && state.seats.some((s)=>s.id === state.leader && s.online); }
/** @param {GameState} state @param {number} p @param {number} target */
function tileId(state,p,target) { return `w${state.nonce}_${(state.epochs[p] ?? 0).toString(36)}_${target.toString(36)}`; }
/** @param {GameState} state @param {number} p */
function tileToken(state,p) { return `w${state.nonce}_${(state.epochs[p] ?? 0).toString(36)}`; }

/** @param {GameState} state @param {GameEvent} event @returns {Transition} */
export function updateGame(state,event) {
  if (state.phase === 'ended') return {state,effects:[]};
  if (event.t === 'players') {
    // introの名簿を作り直す前に、最後の全員退出を記録して終える。
    if (state.phase === 'intro' && event.players.length === 0 && state.seats.length > 0) {
      return transition(state,{...state,phase:'ended',outcome:'incomplete',winner:null,leader:null,players:[],
        seats:state.seats.map((s)=>({...s,online:false,left:true,alive:false}))});
    }
    const roster = new Map(event.players.map((p)=>[p.id,p]));
    const seats = state.phase === 'intro'
      ? event.players.map((p)=>({...p,alive:true,left:false,role:null,lastGuard:null}))
      : state.seats.map((s)=>({...s,online:!s.left && roster.get(s.id)?.online === true,left:s.left || !roster.has(s.id),alive:s.alive && roster.has(s.id)}));
    const leaderLeft = state.phase !== 'intro' && state.leader !== null && !seats.some((s)=>s.id === state.leader && !s.left);
    const leader = leaderLeft ? null : seats.some((s)=>s.id === event.leader && (s.alive || s.id === state.leader)) ? event.leader : state.leader;
    let next = reconcile({...state,seats,players:event.players.map((p)=>({...p})),leader});
    if (next.phase !== 'intro') {
      next = judge(next);
      if (!next.blockers.length && next.phase !== 'ended') next = settle(next);
    }
    return transition(state,next);
  }
  if (event.t === 'menu') return transition(state,reconcile({...state,paused:event.paused}));
  if (event.t === 'environment') return transition(state,reconcile({...state,environment:event.value ? {...event.value} : null}));
  if (state.blockers.length || state.resumeRequired && event.t === 'tick') return {state,effects:[]};
  if (event.t === 'tick') {
    if (!Number.isFinite(event.ms) || event.ms <= 0 || !['day','night','vote'].includes(state.phase)) return {state,effects:[]};
    let next = {...state,remaining:Math.max(0,state.remaining-event.ms)};
    if (next.remaining === 0) {
      if (state.phase === 'day') next = openVote(next);
      else {
        next.picks = {...next.picks};
        for (const s of living(next)) if (!(s.id in next.picks)) next.picks[s.id] = null;
        next = settle(next);
      }
    }
    return transition(state,next);
  }
  const {p,input} = event;
  const seat = state.seats.find((s)=>s.id === p && !s.left && s.online);
  if (!seat) return {state,effects:[]};
  if (input.k === 'btn' && input.d === 1 && p === state.leader && canBegin(state) && input.id === tileId(state,p,p)) {
    const roles = assignRoles(state.seats.map((s)=>s.id),state.seed);
    return transition(state,{...state,phase:'reveal',seats:state.seats.map((s)=>({...s,role:roles[s.id] ?? null})),announce:'スマホで自分の役を確認してください'});
  }
  if (input.k !== 'tiles' || !Array.isArray(input.ids) || input.ids.length > 1 || (input.pass !== undefined && input.pass !== true) || (input.pass && input.ids.length)) return {state,effects:[]};
  if (input.t !== tileToken(state,p)) return {state,effects:[]};
  if (state.resumeRequired) {
    if (p !== state.leader || input.ids.length || input.pass) return {state,effects:[]};
    return transition(state,settle({...state,resumeRequired:false}));
  }
  if (state.phase === 'reveal' && seat.alive && input.ids.length === 0 && !input.pass && state.checked[p] !== 'done') {
    const checked = {...state.checked,[p]:state.checked[p] === 'shown' ? /** @type {const} */ ('done') : /** @type {const} */ ('shown')};
    return transition(state,settle({...state,checked}));
  }
  if (state.phase === 'day' && p === state.leader && input.ids.length === 0) {
    return transition(state,input.pass ? {...state,total:state.total+60000,remaining:state.remaining+60000} : openVote(state),input.pass ? p : undefined);
  }
  if ((state.phase === 'dawn' || state.phase === 'exec') && p === state.leader && input.ids.length === 0 && !input.pass) {
    return transition(state,state.phase === 'dawn' ? {...state,phase:'day',total:state.discussMs,remaining:state.discussMs,announce:'顔を合わせて話し合いましょう'} : openNight(state));
  }
  if (!seat.alive || !['night','vote'].includes(state.phase) || p in state.picks) return {state,effects:[]};
  if (state.phase === 'night' && (input.pass || state.showRole[p])) {
    if (state.showRole[p] && (input.pass || input.ids.length)) return {state,effects:[]};
    return transition(state,{...state,showRole:{...state.showRole,[p]:!state.showRole[p]}});
  }
  const targets = living(state).filter((s)=>s.id !== p && (state.phase !== 'vote' || !state.runoff || state.candidates.includes(s.id)));
  const emptyVote = state.phase === 'vote' && targets.length === 0 && input.ids.length === 0;
  const target = input.pass || emptyVote ? null : targets.find((s)=>tileId(state,p,s.id) === input.ids[0])?.id;
  if (target === undefined || (!input.pass && !emptyVote && input.ids.length !== 1)) return {state,effects:[]};
  return transition(state,settle({...state,picks:{...state.picks,[p]:target},remaining:IDLE_MS}));
}

/** @param {GameState} state @returns {GameState} */
function reconcile(state) {
  const blockers = [...(state.paused ? ['menu'] : []),...(!state.environment?.connected ? ['host-offline'] : []),
    ...(!state.environment?.visible ? ['hidden'] : []),...(living(state).some((s)=>!s.online) ? ['player-offline'] : [])];
  let next = {...state,blockers};
  if (blockers.length && !state.blockers.length) {
    next = {...next,showRole:{},resumeRequired:state.phase !== 'intro'};
    if (state.phase === 'night' || state.phase === 'vote') next = {...next,remaining:IDLE_MS};
    if (state.phase === 'reveal') next.checked = Object.fromEntries(Object.entries(state.checked).filter(([,v])=>v === 'done'));
  }
  // 脱落済みでも接続中の進行役は操作できる。不在なら操作できる最小番号の生存席へ渡す。
  if (!next.seats.some((s)=>s.id === next.leader && !s.left && s.online)) next.leader = living(next).filter((s)=>s.online).sort((a,b)=>a.id-b.id)[0]?.id ?? null;
  return next;
}

/** @param {GameState} state @returns {GameState} */
function openNight(state) {
  return {...state,phase:'night',day:state.day+1,picks:{},showRole:{},reports:{},victim:null,votes:null,candidates:[],runoff:false,total:IDLE_MS,remaining:IDLE_MS,announce:'夜です。スマホで行動を決めてください'};
}
/** @param {GameState} state @returns {GameState} */
function openVote(state) {
  return {...state,phase:'vote',picks:{},showRole:{},total:IDLE_MS,remaining:IDLE_MS,runoff:false,candidates:[],votes:null,announce:'スマホで投票してください'};
}
/** @param {GameState} state @returns {GameState} */
function settle(state) {
  if (state.blockers.length || state.resumeRequired) return state;
  if (state.phase === 'reveal' && living(state).every((s)=>state.checked[s.id] === 'done')) return openNight(state);
  if (!['night','vote'].includes(state.phase) || !living(state).every((s)=>s.id in state.picks)) return state;
  return state.phase === 'night' ? resolveNight(state) : resolveVote(state);
}
/** @param {GameState} state @returns {GameState} */
function judge(state) {
  if (state.seats.filter((s)=>!s.left).length < 2) return {...state,phase:'ended',outcome:'incomplete',winner:null};
  const alive = living(state);
  const wolves = alive.filter((s)=>s.role === 'wolf').length;
  const humans = alive.length-wolves;
  const winner = wolves === 0 ? 'village' : wolves >= humans ? 'wolf' : null;
  return winner ? {...state,phase:'ended',winner} : state;
}

/** @param {readonly (number|null)[]} values */
function mostVoted(values) {
  const counts = new Map();
  for (const id of values) if (id !== null) counts.set(id,(counts.get(id) ?? 0)+1);
  const max = Math.max(0,...counts.values());
  return /** @type {number[]} */ ([...counts.keys()].filter((id)=>counts.get(id) === max).sort((a,b)=>a-b));
}

/** @param {GameState} state @returns {GameState} */
function resolveNight(state) {
  const alive = living(state);
  /** @type {Record<number,string>} */
  const reports = {};
  /** @type {Record<number,number|null>} */
  const actions = {};
  for (const seat of alive) {
    const target = alive.find((s)=>s.id === state.picks[seat.id] && s.id !== seat.id);
    let reason = '';
    if (!target) reason = '相手が選ばれていないため、行動なしです。';
    else if (seat.role === 'wolf' && target.role === 'wolf') reason = '仲間は襲えないため、行動なしです。';
    else if (seat.role === 'knight' && seat.lastGuard === target.id) reason = '同じ人を続けて守れないため、行動なしです。';
    actions[seat.id] = reason ? null : target?.id ?? null;
    if (reason) reports[seat.id] = reason;
  }
  const wolfTargets = mostVoted(alive.filter((s)=>s.role === 'wolf').map((s)=>actions[s.id] ?? null));
  let rngState = state.rng;
  let attacked = null;
  if (state.day > 1 && wolfTargets.length) {
    const random = makeRng(state.rng);
    attacked = (wolfTargets.length === 1 ? wolfTargets[0] : wolfTargets[Math.floor(random()*wolfTargets.length)]) ?? null;
    rngState = random.state;
  }
  const guarded = alive.filter((s)=>s.role === 'knight').map((s)=>actions[s.id]);
  const victim = guarded.includes(attacked) ? null : attacked;
  for (const seer of alive.filter((s)=>s.role === 'seer')) {
    const target = alive.find((s)=>s.id === actions[seer.id]);
    if (target) reports[seer.id] = `${target.name}さんは${target.role === 'wolf' ? '人狼' : '人狼ではない'}です。`;
  }
  const seats = state.seats.map((s)=>({...s,alive:s.alive && s.id !== victim,lastGuard:s.role === 'knight' && s.alive ? actions[s.id] ?? null : s.lastGuard}));
  const name = state.seats.find((s)=>s.id === victim)?.name;
  return judge({...state,phase:'dawn',seats,rng:rngState,picks:{},showRole:{},reports,victim,remaining:0,total:0,
    announce:name ? `${name}さんが襲われました` : '今朝は誰も襲われませんでした'});
}

/** @param {GameState} state @returns {GameState} */
function resolveVote(state) {
  const alive = living(state);
  const votes = alive.map((s)=>({from:s.id,to:alive.some((t)=>t.id === state.picks[s.id]) ? state.picks[s.id] ?? null : null}));
  const tied = mostVoted(votes.map((v)=>v.to));
  if (tied.length > 1 && !state.runoff) return {...state,runoff:true,candidates:tied,picks:{},votes,total:IDLE_MS,remaining:IDLE_MS,announce:'同数のため、決選投票です'};
  const victim = tied.length === 1 ? tied[0] : null;
  const name = state.seats.find((s)=>s.id === victim)?.name;
  return judge({...state,phase:'exec',seats:state.seats.map((s)=>({...s,alive:s.alive && s.id !== victim})),picks:{},votes,total:0,remaining:0,
    announce:name ? `${name}さんが処刑されました` : '今回は処刑しません'});
}

/** @param {GameState} state @param {Seat} seat */
function roleText(state,seat) {
  if (!seat.role) return '';
  const friends = state.seats.filter((s)=>s.id !== seat.id && s.role === 'wolf').map((s)=>s.name);
  const job = {villager:'話し合いで人狼を探します。',wolf:'夜に1人を襲います。',seer:'夜に1人が人狼か占います。',knight:'自分以外を守ります。同じ人は2夜続けて守れません。',madman:'人間として数えますが、人狼の勝ちを願います。'};
  return `あなたは【${ROLE_NAMES[seat.role]}】。${seat.role === 'wolf' && friends.length ? `仲間：${friends.join('、')}。` : ''}${job[seat.role]}`;
}
/** @param {string} ok @param {string} note @param {string|undefined} [pass] @returns {Tiles} */
function emptyTiles(ok,note,pass) { return {k:'tiles',tiles:[],min:0,max:0,ok,note,...(pass ? {pass} : {})}; }
/** @param {GameState} state @param {Seat} seat @returns {PadSpec} */
function padFor(state,seat) {
  const spec = padContent(state,seat);
  return spec.k === 'tiles' ? {...spec,token:tileToken(state,seat.id)} : spec;
}
/** @param {GameState} state @param {Seat} seat @returns {PadSpec} */
function padContent(state,seat) {
  if (state.phase === 'ended') return {k:'wait',title:state.outcome === 'incomplete' ? '今回は未成立です' : '勝負が終わりました',...(state.seats.some((s)=>s.role) ? {body:[...state.seats.map((s)=>`${s.name}：${s.role ? ROLE_NAMES[s.role] : '未配役'}`).join('、')].slice(0,120).join('')} : {})};
  if (seat.left) return {k:'wait',title:'退出しました'};
  if (state.blockers.length) return {k:'wait',title:'再開を待っています',body:'接続・表示・メニューが戻るまで時計を止めています。'};
  if (state.resumeRequired) return seat.id === state.leader ? emptyTiles('再開する','同じ場面から再開します。') : {k:'wait',title:'進行役の再開を待っています'};
  if (state.phase === 'intro') return canBegin(state) && seat.id === state.leader
    ? {k:'pad',stick:'none',buttons:[{id:tileId(state,seat.id,seat.id),label:'はじめる'}],hint:'4〜8人で、スマホに出る役を確かめます'}
    : {k:'wait',title:'月あかりの寄り合い',body:'4〜8人そろったら進行役が始めます。'};
  if (state.phase === 'reveal' && seat.alive) {
    if (state.checked[seat.id] === 'done') return {k:'wait',title:'全員の役の確認を待っています'};
    return emptyTiles(state.checked[seat.id] === 'shown' ? 'かくす' : '役を見る',state.checked[seat.id] === 'shown' ? roleText(state,seat) : '自分の役を確認してください。');
  }
  // 発表と本人だけの夜の結果を残し、脱落した進行役も手元で次へ進める。
  if (state.phase === 'dawn') return seat.id === state.leader
    ? emptyTiles('つづける',[state.victim === seat.id ? 'あなたは襲われました。' : null,state.announce,state.reports[seat.id]].filter(Boolean).join('\n'))
    : {k:'wait',title:'夜が明けました',body:(state.victim === seat.id ? 'あなたは襲われました。\n' : '')+(state.reports[seat.id] ?? state.announce)};
  if (state.phase === 'day') {
    // 本人にだけ夜明けと同じ占い結果を残す。役によらずwaitの形をそろえる。
    const report = seat.role === 'seer' ? state.reports[seat.id] : undefined;
    return seat.id === state.leader
      ? emptyTiles('投票へ',['顔を合わせて話し合いましょう。',report].filter(Boolean).join('\n'),'＋1分')
      : {k:'wait',title:'大画面を見てください',body:report ?? '大画面を見てください'};
  }
  if (state.phase === 'exec' && seat.id === state.leader) return emptyTiles('つづける',state.announce);
  if (!seat.alive) return {k:'wait',title:'村の行方を見守りましょう'};
  if (state.phase === 'night' || state.phase === 'vote') {
    if (seat.id in state.picks) return {k:'wait',title:'全員の決定を待っています'};
    if (state.phase === 'night' && state.showRole[seat.id]) return emptyTiles('かくす',roleText(state,seat));
    const targets = living(state).filter((s)=>s.id !== seat.id && (state.phase !== 'vote' || !state.runoff || state.candidates.includes(s.id)));
    return {k:'tiles',tiles:targets.map((s)=>({id:tileId(state,seat.id,s.id),label:[...s.name].slice(0,12).join('')})),min:targets.length ? 1 : 0,max:targets.length ? 1 : 0,
      ok:state.phase === 'night' ? '決定' : '投票する',pass:state.phase === 'night' ? '役を見る' : '棄権',
      note:state.phase === 'night' ? '相手を1人選んで決定してください。' : '投票先を1人選んでください。'};
  }
  return {k:'wait',title:'大画面を見てください'};
}

/** @param {GameState|null} before @param {GameState} next @param {number|undefined} [forceSeat] @returns {Transition} */
function transition(before,next,forceSeat) {
  next = {...next,epochs:{...next.epochs}};
  /** @type {GameEffect[]} */
  const effects = [];
  const newDecision = before && (before.phase !== next.phase || before.runoff !== next.runoff || before.day !== next.day);
  for (const seat of next.seats) {
    const old = before?.seats.find((s)=>s.id === seat.id);
    if (!before || !old || newDecision || forceSeat === seat.id || JSON.stringify(padFor(before,old)) !== JSON.stringify(padFor(next,seat))) {
      next.revision++;
      next.epochs[seat.id] = next.revision;
      effects.push({t:'pad',to:seat.id,spec:padFor(next,seat)});
    }
  }
  for (const p of next.players) if (!next.seats.some((s)=>s.id === p.id) && !before?.players.some((s)=>s.id === p.id)) effects.push({t:'pad',to:p.id,spec:{k:'wait',title:'次の勝負から参加できます'}});
  if (before && before.phase !== next.phase) {
    if (before.phase === 'night' && next.reports !== before.reports) effects.push({t:'cue',name:'dawn'});
    if (before.phase === 'vote' && next.votes !== before.votes) effects.push({t:'cue',name:'reveal'},...(next.seats.some((s,i)=>before.seats[i]?.alive && !s.alive && !s.left) ? [/** @type {GameEffect} */ ({t:'cue',name:'execute'})] : []));
    if (next.phase === 'night') effects.push({t:'cue',name:'night'});
    if (next.phase === 'vote') effects.push({t:'cue',name:'vote'});
  } else if (before && !before.runoff && next.runoff) effects.push({t:'cue',name:'reveal'},{t:'cue',name:'vote'});
  if (next.phase === 'ended' && before?.phase !== 'ended') {
    effects.push({t:'cue',name:next.winner === 'wolf' ? 'lose' : 'win'});
    effects.push({t:'end',results:next.seats.map((s)=>{
      const side = s.role === 'wolf' || s.role === 'madman' ? 'wolf' : 'village';
      const won = side === next.winner;
      const role = s.role ? ROLE_NAMES[s.role]+(s.role === 'madman' ? '（人狼側）' : s.role === 'seer' || s.role === 'knight' ? '（村人側）' : '') : '';
      return {p:s.id,score:won ? 1 : 0,ranked:next.outcome === 'complete' && !s.left,label:s.role ? `${role}・${next.outcome === 'incomplete' ? '未成立' : won ? '勝ち' : '負け'}` : '記録なし'};
    }),options:{display:'record',outcome:next.outcome,note:next.outcome === 'incomplete' ? '残った参加者が2人未満のため、今回は勝敗なしです。' : `${next.winner === 'wolf' ? '人狼' : '村人'}側の勝ちです。`}});
  }
  return {state:next,effects};
}

/** 公開する情報を列挙し、内部の役や未確定の選択は渡さない。 @param {GameState} state */
export function publicView(state) {
  const roleCounts = state.phase === 'intro' && state.seats.length >= 4 && state.seats.length <= 8
    ? Object.fromEntries([...new Set(rolesFor(state.seats.length))].map((role)=>[role,rolesFor(state.seats.length).filter((r)=>r === role).length])) : null;
  return {phase:state.phase,day:state.day,roleCounts,seats:state.seats.map(({id,name,alive,left,online})=>({id,name,alive,left,online})),announce:state.announce,
    timer:state.phase === 'day' || state.phase === 'night' || state.phase === 'vote' ? {remaining:state.remaining,total:state.total} : null,
    decided:state.phase === 'reveal' ? {count:living(state).filter((s)=>state.checked[s.id] === 'done').length,total:living(state).length} : state.phase === 'night' || state.phase === 'vote' ? {count:living(state).filter((s)=>s.id in state.picks).length,total:living(state).length} : null,
    votes:state.votes?.map((v)=>({...v})) ?? null,
    reveal:state.phase === 'ended' && state.seats.some((s)=>s.role) ? state.seats.map((s)=>({id:s.id,role:s.role})) : null,
    leader:state.leader,canBegin:canBegin(state),outcome:state.outcome};
}
/** @typedef {ReturnType<typeof publicView>} GameViewModel */
