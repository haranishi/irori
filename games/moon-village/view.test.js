// @vitest-environment happy-dom
// @ts-check
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createView} from './view.js';
import {assignRoles} from './roles.js';
import {createGame, publicView, updateGame} from './logic.js';

const sdk = vi.hoisted(()=>({connect:vi.fn()}));
vi.mock('./irori.js', ()=>sdk);
vi.mock('./logic.js', async (original)=>{
  const actual = await original();
  return {...actual, createGame:vi.fn(actual.createGame), updateGame:vi.fn(actual.updateGame)};
});

const players = (n = 8)=>Array.from({length:n}, (_, i)=>({id:i+1, name:`灯${i+1}`, online:true}));
const init = (n = 8)=>({players:players(n), leader:1, environment:{connected:true, visible:true}, paused:false, nonce:'moon1234', seed:42});
function model(phase, overrides = {}) {
  const state = createGame(init()).state;
  const roleList = ['wolf', 'wolf', 'seer', 'knight', 'madman', 'villager', 'villager', 'villager'];
  const announce = {intro:'役を確かめて、月あかりの寄り合いを始めましょう', reveal:'スマホで自分の役を確認してください', night:'夜です。スマホで行動を決めてください', dawn:'今朝は誰も襲われませんでした', day:'顔を合わせて話し合いましょう', vote:'スマホで投票してください', exec:'灯8さんが処刑されました', ended:'灯8さんが処刑されました'};
  return publicView({...state, phase, day:phase === 'intro' ? 0 : 1, remaining:180000, total:180000, announce:announce[phase], seats:state.seats.map((s, i)=>({...s, role:roleList[i], alive:phase !== 'ended' || i >= 2})), ...overrides});
}
function mount() {
  document.body.replaceChildren();
  const stage = document.createElement('main');
  stage.id = 'stage';
  const status = document.createElement('p');
  status.id = 'status';
  status.setAttribute('aria-live', 'polite');
  document.body.append(stage, status);
  return {stage, status, view:createView(stage, status)};
}
function noRoles() {
  // Scan hidden markup and accessibility attributes too; visible text alone missed leaks.
  expect(document.body.outerHTML).not.toMatch(/人狼|占い師|騎士|狂人|村人|\b(?:wolf|seer|knight|madman|villager)\b/);
}

afterEach(()=>{
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('公開モデルだけで全段階を描く', ()=>{
  it.each([
    ['intro', '月あかりの寄り合い'], ['reveal', 'スマホで自分の役を確認'],
    ['night', 'スマホで行動を決めてください'], ['dawn', '今朝は誰も襲われませんでした'],
    ['day', '3:00'], ['vote', '0 / 8人が決定'], ['exec', '灯8さんが処刑されました'], ['ended', '村人側の勝ち'],
  ])('%sの必要な文とphaseが出る', (phase, expected)=>{
    const {stage, view} = mount();
    const value = model(phase);
    Object.freeze(value);
    expect(()=>view.render(value)).not.toThrow();
    expect(stage.textContent).toContain(expected);
    expect(document.documentElement.dataset.phase).toBe(phase);
    if (phase !== 'ended' && phase !== 'intro') noRoles();
  });

  it('導入に勝ち方と人数別内訳がなく、読み上げで句点が重なっていた', ()=>{
    const {stage,status,view}=mount();
    const value=publicView(createGame(init(5)).state);
    view.render(value);
    expect(stage.textContent).toContain('勝ち方：人狼を全員見つければ村の勝ち。人狼が生きている人間と同じ数になれば人狼の勝ち');
    expect(stage.textContent).toContain('いまの人数の役：人狼1・占い師1・騎士1・村人2');
    expect(stage.querySelectorAll('.role-card')).toHaveLength(0);
    expect(status.textContent).not.toContain('。。');
    view.render(model('night'));
    expect(stage.querySelector('.intro-details').hidden).toBe(true);
    noRoles();
  });
  it('役をかくした人数を大画面で確認できなかった', ()=>{
    const {stage,view}=mount();
    view.render(model('reveal',{checked:{1:'done',2:'done',3:'shown'}}));
    expect(stage.querySelector('.decided').textContent).toBe('2 / 8人が確認');
    expect(stage.querySelector('.progress').hidden).toBe(false);
  });
  it('段階と発表を読み上げるときに文末の句点を二重に付けない', ()=>{
    const {status,view}=mount();
    for(const phase of ['intro','reveal','night','dawn','day','vote','exec','ended']){
      view.render(model(phase,{announce:'お知らせ。'}));
      expect(status.textContent).not.toContain('。。');
    }
  });

  it('公開された名前と発表はHTMLに解釈しない', ()=>{
    const {stage, status, view} = mount();
    const value = model('dawn');
    value.seats[0].name = '<img src=x onerror=alert(1)>';
    value.announce = '<script>危険な発表</script>';
    view.render(value);
    expect(stage.textContent).toContain(value.seats[0].name);
    expect(status.textContent).toContain(value.announce);
    expect(stage.querySelector('img, script')).toBeNull();
  });

  it.each([4, 8])('%i人の夜は匿名の決定灯だけが消える', (n)=>{
    const {stage, view} = mount();
    const value = model('night');
    value.seats = value.seats.slice(0, n);
    value.decided = {count:2, total:n};
    view.render(value);
    expect(stage.querySelectorAll('.anonymous-light')).toHaveLength(n);
    expect(stage.querySelectorAll('.anonymous-light--out')).toHaveLength(2);
    expect(stage.querySelector('.anonymous-lights').textContent).toBe('');
    expect(stage.querySelector('.anonymous-lights').outerHTML).not.toMatch(/data-seat|灯[1-8]/);
    expect(stage.querySelector('.village').hidden).toBe(true);
    noRoles();
  });

  it('未確定の投票先は出さず、決選の確定済み投票と票数だけを出す', ()=>{
    const {stage, view} = mount();
    view.render(model('vote'));
    expect(stage.querySelector('.votes').hidden).toBe(true);
    expect(stage.querySelectorAll('.vote-arrow')).toHaveLength(0);
    view.render(model('vote', {announce:'同数のため、決選投票です', votes:[{from:1, to:3}, {from:2, to:3}, {from:3, to:null}]}));
    expect(stage.textContent).toContain('決選投票');
    expect(stage.querySelector('.votes').hidden).toBe(false);
    expect(stage.textContent).toContain('灯1 → 灯3');
    expect(stage.textContent).toContain('灯3 → 棄権');
    expect(stage.textContent).toContain('灯3 2票');
    noRoles();
  });

  it('処刑なしと襲撃の発表、生存・脱落・退出・接続待ちを文字でも示す', ()=>{
    const {stage, view} = mount();
    const value = model('exec', {announce:'今回は処刑しません'});
    value.seats[1].alive = false;
    value.seats[2].left = true;
    value.seats[3].online = false;
    view.render(value);
    for (const word of ['今回は処刑しません', '生存', '脱落', '退出', '接続待ち']) expect(stage.textContent).toContain(word);
    view.render(model('dawn', {announce:'灯8さんが襲われました'}));
    expect(stage.textContent).toContain('灯8さんが襲われました');
    noRoles();
  });

  it('時計と延長を更新しても席・ボタン・読み上げを作り直さない', ()=>{
    const {stage, status, view} = mount();
    view.render(model('day'));
    const resident = stage.querySelector('.resident');
    const button = stage.querySelector('button');
    const originalStatus = status.textContent;
    view.render(model('day', {remaining:179000}));
    expect(stage.querySelector('.clock-time').textContent).toBe('2:59');
    expect(stage.querySelector('.resident')).toBe(resident);
    expect(stage.querySelector('button')).toBe(button);
    expect(status.textContent).toBe(originalStatus);
    view.render(model('day', {remaining:239000, total:240000}));
    expect(stage.querySelector('.extension').textContent).toBe('延長 ＋1分');
  });

  it('補助ボタンは仮想プレイヤーの夜明けと処刑後だけ。本物のホストでは出さず、スマホの「つづける」へ案内する', ()=>{
    const {stage, view} = mount();
    view.render(model('dawn'), {assist:true});
    expect(stage.querySelector('button').hidden).toBe(false);
    view.render(model('exec', {votes:[{from:1, to:3}]}), {assist:true});
    expect(stage.querySelector('button').hidden).toBe(false);
    view.render(model('day'), {assist:true});
    expect(stage.querySelector('button').hidden).toBe(true);
    // 本物のホストでは枠がポインタを受けないため、押せないボタンを見せない。
    for (const phase of ['dawn', 'exec']) {
      view.render(model(phase));
      expect(stage.querySelector('button').hidden).toBe(true);
      expect(stage.querySelector('.guide').textContent).toBe('灯1さんのスマホで「つづける」');
    }
    view.render(model('night'));
    expect(stage.querySelectorAll('.vote-arrow')).toHaveLength(0);
    noRoles();
  });

  it('夜は見出しを短くし、同じ意味の文を繰り返さない。知らせは見出しにする', ()=>{
    const {stage, view} = mount();
    view.render(model('night'));
    expect(stage.querySelector('h1').textContent).toBe('夜です');
    expect(stage.querySelector('.copy').textContent).toBe('スマホで行動を決めてください');
    view.render(model('exec'));
    expect(stage.querySelector('h1').textContent).toBe('灯8さんが処刑されました');
    expect(stage.querySelector('.kicker').textContent).toBe('村の決定');
    view.render(model('day'));
    expect(stage.querySelector('.copy').hidden).toBe(true);
  });

  it('終了後だけ全役と勝ちの印を出し、未成立は勝者を作らない', ()=>{
    const {stage, view} = mount();
    view.render(model('ended'));
    for (const role of ['人狼', '占い師', '騎士', '狂人', '村人']) expect(stage.textContent).toContain(role);
    expect(stage.querySelectorAll('.role-card')).toHaveLength(8);
    expect(stage.querySelectorAll('.resident--winner')).toHaveLength(5);
    view.render(model('intro'));
    expect(stage.querySelectorAll('.role-card')).toHaveLength(0);
    expect(stage.querySelector('.composition').textContent).toBe('いまの人数の役：人狼2・占い師1・騎士1・狂人1・村人3');
    view.render(model('ended', {outcome:'incomplete'}));
    expect(stage.textContent).toContain('今回は、勝敗なし');
    expect(stage.querySelectorAll('.resident--winner')).toHaveLength(0);
    view.render(model('intro'));
    expect(stage.querySelectorAll('.role-card')).toHaveLength(0);
    expect(stage.querySelectorAll('.resident--winner')).toHaveLength(0);
  });

  it('終了時は公開された生存数から勝者を示し、退出した勝ち側を光らせない', ()=>{
    const {stage, view} = mount();
    const value = model('ended');
    value.seats.forEach((seat, i)=>{seat.alive = i < 4;});
    value.seats[4].left = true;
    view.render(value);
    expect(stage.querySelector('h1').textContent).toBe('人狼側の勝ち');
    expect(stage.querySelectorAll('.resident--winner')).toHaveLength(2);
  });

  it('本人の選びと未決定者の予告が大画面に漏れてはならない：夜・投票は人数だけを描く', ()=>{
    const {stage,status,view}=mount();
    for(const phase of ['night','vote']){
      const state=createGame(init(4)).state;
      const value=publicView({...state,phase,day:1,remaining:30000,total:120000,idleWarned:true,picks:{1:3},seats:state.seats.map((s,i)=>({...s,role:['wolf','seer','villager','villager'][i]}))});
      view.render(value);
      expect(stage.querySelector('.decided').textContent).toBe('1 / 4人が決定');
      expect(stage.querySelectorAll('.vote-arrow')).toHaveLength(0);
      expect(stage.outerHTML+status.outerHTML).not.toMatch(/あと30秒|あなたは|選びました|投票しました|棄権しました|idleWarned|picks/);
      noRoles();
    }
  });

  it.each(['unsupported', 'error'])('%sの案内を出せる', (phase)=>{
    const {stage, status, view} = mount();
    view.showMessage('更新が必要です', '開き直してください', phase);
    expect(document.documentElement.dataset.phase).toBe(phase);
    expect(stage.textContent).toContain('更新が必要です');
    expect(status.textContent).toContain('開き直してください');
  });
});

describe('SDKとの接続（小さな偽物＋実際の判定）', ()=>{
  let host;
  let handlers;
  let pads;
  let raf;
  let frameId;
  beforeEach(()=>{
    vi.resetModules();
    vi.clearAllMocks();
    mount();
    handlers = new Map();
    pads = new Map();
    raf = null;
    frameId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((fn)=>{raf = fn; return ++frameId;}));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(()=>{raf = null;}));
    host = {
      mode:'mock',
      capabilities:['pad-tiles-v1', 'result-options-v1', 'host-environment-v1'],
      players:players(4), leader:1, environment:{connected:true, visible:true}, paused:false,
      setPad:vi.fn((spec, seat)=>pads.set(seat, spec)), cue:vi.fn(), vibrate:vi.fn(), end:vi.fn(), ready:vi.fn(),
      on:vi.fn((name, fn)=>{handlers.set(name, fn); return ()=>handlers.delete(name);}),
    };
    sdk.connect.mockResolvedValue(host);
  });
  async function boot() {
    await import('./main.js');
    await Promise.resolve();
    return await import('./logic.js');
  }
  function emit(name, ...args) { handlers.get(name)?.(...args); }
  function frame(now) { const fn = raf; raf = null; fn?.(now); }
  function empty(p, pass = false) { const spec = pads.get(p); emit('input', p, {k:'tiles', ids:[], t:spec.token, ...(pass ? {pass:true} : {})}); }
  function choose(p, target) {
    const spec = pads.get(p);
    const tile = spec.tiles.find((t)=>t.label === `灯${target}`);
    expect(tile).toBeDefined();
    emit('input', p, {k:'tiles', ids:[tile.id], t:spec.token});
  }
  function startNight() {
    emit('input', 1, {k:'btn', id:pads.get(1).buttons[0].id, d:1});
    for (const p of host.players) {empty(p.id); empty(p.id);}
    expect(document.documentElement.dataset.phase).toBe('night');
  }
  function dawn() {
    startNight();
    for (const p of host.players) choose(p.id, p.id === 1 ? 2 : 1);
    expect(document.documentElement.dataset.phase).toBe('dawn');
  }
  function day() { dawn(); document.querySelector('[data-action="day"]').click(); expect(document.documentElement.dataset.phase).toBe('day'); }
  /** 見せ場の時計を ms だけ進める（1コマは最大1秒として数えるので、1秒ずつ送る）。 */
  function watch(ms, from = 10000) { frame(from); for (let t = 1000; t <= ms; t += 1000) frame(from+t); }

  it.each(['night','vote'])('%sの待機で相手も予告も見えなかった：本人の確認と未決定席の30秒予告をSDKへ届ける', async (phase)=>{
    await boot();
    if(phase==='night')startNight();else{day();empty(1);}
    choose(1,2);
    expect(pads.get(1)).toEqual({k:'wait',title:'全員の決定を待っています',body:phase==='night'?'あなたは灯2さんを選びました':'あなたは灯2さんに投票しました'});
    const before=pads.get(2).token;
    host.setPad.mockClear();
    watch(89000);
    expect(host.setPad).not.toHaveBeenCalled();
    frame(100000);
    expect(host.setPad.mock.calls.map(([,to])=>to)).toEqual([2,3,4]);
    expect(pads.get(2).token).not.toBe(before);
    for(const p of [2,3,4])expect(pads.get(p).note).toMatch(/^あと30秒で、決まっていない人は行動なし（棄権）になります\n/);
    expect(document.getElementById('stage').outerHTML+document.getElementById('status').outerHTML).not.toMatch(/あと30秒|あなたは|選びました|投票しました/);
    frame(101000);expect(host.setPad).toHaveBeenCalledTimes(3);
    choose(2,3);
    expect(pads.get(2).body).toBe(phase==='night'?'あなたは灯3さんを選びました':'あなたは灯3さんに投票しました');
    expect(pads.get(3).note).not.toContain('あと30秒');
  });

  it('昼の案内が二重で占いの否定文も不自然だった：SDKが本人だけへ昼の案内と自然な占い結果を送る', async ()=>{
    const logic=await boot();
    const roles=assignRoles(host.players.map((p)=>p.id),logic.createGame.mock.calls[0][0].seed);
    const seer=host.players.find((p)=>roles[p.id]==='seer').id;
    const target=host.players.find((p)=>roles[p.id]==='villager').id;
    startNight();
    for(const p of host.players)choose(p.id,p.id===seer?target:p.id===1?2:1);
    empty(1);
    for(const p of host.players){
      const spec=pads.get(p.id);
      const content=spec.body??spec.note;
      if(p.id===seer)expect(content).toContain(`灯${target}さんは人狼ではありません。`);
      else{expect(content).not.toMatch(/人狼|村人|占い師|騎士|狂人/);expect(content).toMatch(/顔を合わせて話し合いましょう/);}
      if(p.id!==1&&p.id!==seer)expect(spec.body).not.toBe(spec.title);
    }
  });

  it('退出した席の役と勝敗labelが退出印と食い違っていた：全役を表示し結果は記録なしで渡す', async ()=>{
    const logic=await boot();startNight();
    const roles=assignRoles(host.players.map((p)=>p.id),logic.createGame.mock.calls[0][0].seed);
    const wolf=host.players.find((p)=>roles[p.id]==='wolf').id;
    emit('players',host.players.filter((p)=>p.id!==wolf),host.players.find((p)=>p.id!==wolf).id);
    expect(document.querySelectorAll('.role-card')).toHaveLength(4);
    expect(document.getElementById('stage').textContent).toContain('退出');
    const {FINALE_MS}=await import('./main.js');watch(FINALE_MS);
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0][0].find((r)=>r.p===wolf)).toMatchObject({label:'記録なし',ranked:false});
  });

  it.each(['pad-tiles-v1', 'result-options-v1', 'host-environment-v1'])('%sなしではwaitとreadyだけを送り待つ', async (cap)=>{
    host.capabilities = host.capabilities.filter((c)=>c !== cap);
    const logic = await boot();
    expect(host.setPad).toHaveBeenCalledExactlyOnceWith({k:'wait', title:'更新が必要です'});
    expect(host.ready).toHaveBeenCalledTimes(1);
    expect(host.on).not.toHaveBeenCalled();
    expect(logic.createGame).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.phase).toBe('unsupported');
  });

  it('接続に失敗したらerrorを描き、readyを送らない', async ()=>{
    sdk.connect.mockRejectedValue(new Error('接続できない'));
    await boot();
    expect(document.documentElement.dataset.phase).toBe('error');
    expect(document.body.textContent).toContain('つながりませんでした');
    expect(host.ready).not.toHaveBeenCalled();
  });

  it('cryptoの種と新しいnonceを渡し、初期画面後にreadyを送る', async ()=>{
    let randomCalls = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array)=>{array.fill(++randomCalls); return array;});
    const logic = await boot();
    const initial = logic.createGame.mock.calls[0][0];
    expect(initial.nonce).toMatch(/^[a-z0-9]{1,8}$/);
    expect(Number.isInteger(initial.seed)).toBe(true);
    expect(initial).toMatchObject({players:host.players, leader:1, environment:host.environment, paused:false});
    expect(host.ready).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.phase).toBe('intro');
    expect(host.setPad.mock.calls.every(([, to])=>typeof to === 'number')).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    vi.resetModules();
    const nextLogic = await boot();
    expect(nextLogic.createGame.mock.calls.at(-1)[0].nonce).not.toBe(initial.nonce);
    expect(randomCalls).toBe(2);
  });

  it('実際の役確認→夜→夜明け→昼→投票→処刑→次夜→終了まで接続する', async ()=>{
    const logic = await boot();
    const {FINALE_MS} = await import('./main.js');
    day();
    noRoles();
    empty(1, true);
    expect(document.querySelector('.extension').textContent).toBe('延長 ＋1分');
    empty(1);
    expect(document.documentElement.dataset.phase).toBe('vote');
    const seed = logic.createGame.mock.calls[0][0].seed;
    const roles = assignRoles(host.players.map((p)=>p.id), seed);
    const wolf = host.players.find((p)=>roles[p.id] === 'wolf').id;
    const victim = host.players.find((p)=>roles[p.id] === 'villager').id;
    for (const p of host.players) choose(p.id, p.id === victim ? wolf : victim);
    expect(document.documentElement.dataset.phase).toBe('exec');
    noRoles();
    empty(1);
    const alive = host.players.filter((p)=>p.id !== victim);
    const target = alive.find((p)=>p.id !== wolf).id;
    for (const p of alive) choose(p.id, p.id === wolf ? target : wolf);
    expect(document.documentElement.dataset.phase).toBe('ended');
    // 全役の画面を先に送り、見せ場のあいだは end を待つ。
    expect(host.end).not.toHaveBeenCalled();
    expect([...pads.values()].every((spec)=>spec.k === 'wait' && spec.title === '勝負が終わりました')).toBe(true);
    watch(FINALE_MS);
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.setPad.mock.invocationCallOrder.at(-1)).toBeLessThan(host.end.mock.invocationCallOrder[0]);
    expect(host.end.mock.calls[0][0]).toHaveLength(4);
    expect(host.end.mock.calls[0][1]).toMatchObject({display:'record', outcome:'complete'});
    expect(host.cue.mock.calls.map(([name])=>name)).toEqual(expect.arrayContaining(['night', 'dawn', 'vote', 'reveal', 'execute', 'lose']));
    expect(handlers.size).toBe(0);
    expect(raf).toBeNull();
    emit('input', 1, {k:'tiles', ids:[]}); frame(999999);
    expect(host.end).toHaveBeenCalledTimes(1);
  });

  it.each(['pause', 'hidden', 'disconnected', 'player-offline'])('%s中と再開待ちにtickを送らず、中断時間を加算しない', async (reason)=>{
    const logic = await boot();
    day();
    frame(100); frame(1100);
    expect(document.querySelector('.clock-time').textContent).toBe('2:59');
    if (reason === 'pause') emit('pause');
    if (reason === 'hidden') emit('environment', {connected:true, visible:false});
    if (reason === 'disconnected') emit('environment', {connected:false, visible:true});
    if (reason === 'player-offline') emit('players', host.players.map((p)=>({...p, online:p.id !== 2})), 1);
    const tickCount = ()=>logic.updateGame.mock.calls.filter(([, e])=>e.t === 'tick').length;
    const stoppedAt = tickCount();
    frame(121100); frame(241100);
    expect(tickCount()).toBe(stoppedAt);
    expect(document.getElementById('stage').dataset.suspended).toBe('true');
    if (reason === 'pause') emit('resume');
    if (reason === 'hidden' || reason === 'disconnected') emit('environment', {connected:true, visible:true});
    if (reason === 'player-offline') emit('players', host.players, 1);
    frame(361100);
    expect(tickCount()).toBe(stoppedAt);
    empty(1);
    frame(500000); frame(501000);
    expect(document.querySelector('.clock-time').textContent).toBe('2:58');
    expect(document.getElementById('stage').dataset.suspended).toBe('false');
  });

  it('停止中の昼へを無効にし、再開後だけtoken付きの入力で進む', async ()=>{
    const logic = await boot();
    dawn(); emit('pause');
    const button = document.querySelector('[data-action="day"]');
    expect(button.disabled).toBe(true);
    button.click();
    expect(document.documentElement.dataset.phase).toBe('dawn');
    emit('resume'); empty(1);
    expect(button.disabled).toBe(false);
    button.click();
    const input = logic.updateGame.mock.calls.at(-1)[1];
    expect(input).toMatchObject({t:'input', p:1, input:{k:'tiles', ids:[]}});
    expect(input.input.t).toMatch(/^w[a-z0-9]{8}_[a-z0-9]+$/);
    expect(document.documentElement.dataset.phase).toBe('day');
  });

  it('席の消失を判定へ送り、未成立も一度だけ終了する', async ()=>{
    await boot(); startNight();
    const {FINALE_MS} = await import('./main.js');
    emit('players', [host.players[0]], 1);
    expect(document.querySelector('h1').textContent).toBe('今回は、勝敗なし');
    watch(FINALE_MS);
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(host.end.mock.calls[0][1].outcome).toBe('incomplete');
    expect(host.end.mock.calls[0][0]).toHaveLength(4);
    emit('players', [], null); watch(FINALE_MS, 90000);
    expect(host.end).toHaveBeenCalledTimes(1);
  });

  // 実ホストでは end の直後にスマホの画面が結果のリモコンへ替わり、同じ瞬間に送った全役の画面が届かなかった。
  it('終わりの見せ場は一時停止・非表示の間は数えず、見終えてから一度だけ end する', async ()=>{
    await boot(); startNight();
    const {FINALE_MS} = await import('./main.js');
    emit('players', [host.players[0]], 1);
    watch(FINALE_MS-2000);
    host.paused = true; emit('pause');
    watch(20000, 30000);
    expect(host.end).not.toHaveBeenCalled();
    expect(document.getElementById('stage').dataset.suspended).toBe('false');
    host.paused = false; emit('resume');
    host.environment = {connected:true, visible:false}; emit('environment', host.environment);
    watch(20000, 60000);
    expect(host.end).not.toHaveBeenCalled();
    host.environment = {connected:true, visible:true}; emit('environment', host.environment);
    watch(1000, 90000);
    expect(host.end).not.toHaveBeenCalled();
    watch(1000, 95000);
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(raf).toBeNull();
  });

  it('本物のホストでは大画面の補助ボタンを出さない', async ()=>{
    host.mode = 'host';
    await boot(); dawn();
    expect(document.querySelector('[data-action="day"]').hidden).toBe(true);
    expect(document.querySelector('.guide').textContent).toBe('灯1さんのスマホで「つづける」');
  });

  it('cueがないホストでも続行し、返された振動だけを指定席へ送る', async ()=>{
    host.cue = undefined;
    const logic = await boot();
    startNight();
    logic.updateGame.mockImplementationOnce((state)=>({state, effects:[{t:'vibrate', to:2, ms:[30, 40, 30]}]}));
    emit('input', 2, {k:'axis', id:'dpad', x:0, y:0});
    expect(host.vibrate).toHaveBeenCalledExactlyOnceWith([30, 40, 30], 2);
  });

  it('pagehideで購読と時計を破棄し、ゲームを勝手に終了しない', async ()=>{
    await boot(); day();
    window.dispatchEvent(new Event('pagehide'));
    expect(handlers.size).toBe(0);
    expect(raf).toBeNull();
    expect(host.end).not.toHaveBeenCalled();
  });
});
