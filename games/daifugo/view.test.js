// @vitest-environment happy-dom
// @ts-check
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createView} from './view.js';

const hooks=vi.hoisted(()=>({connect:vi.fn(),createGame:vi.fn(),updateGame:vi.fn(),publicView:vi.fn()}));
vi.mock('./irori.js',()=>({connect:hooks.connect}));
vi.mock('./logic.js',()=>({createGame:hooks.createGame,updateGame:hooks.updateGame,publicView:hooks.publicView}));
const logic=await vi.importActual('./logic.js');
const {legalPlays}=await vi.importActual('./cards.js');
const players=(n=3)=>Array.from({length:n},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));
const initial=(n=3)=>logic.createGame({players:players(n),leader:1,environment:{connected:true,visible:true},paused:false,nonce:'view1234',seed:9});
const started=(n=3)=>{
  const {state}=initial(n);
  return logic.updateGame(state,{t:'input',p:1,input:{k:'btn',id:state.control.id,d:1}}).state;
};
const looks=new Map(players(8).map((p)=>[p.id,{color:'#E69F00',shape:'circle',label:'橙の丸',path:'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2'}]));
let stage,status;
const disposals=[];
function fixture() {
  const view=createView(stage,status);disposals.push(view.dispose);return view;
}
function model(n=3) {return logic.publicView(started(n));}

beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();
  hooks.createGame.mockImplementation(logic.createGame);
  hooks.updateGame.mockImplementation(logic.updateGame);
  hooks.publicView.mockImplementation(logic.publicView);
  document.body.replaceChildren();
  const availability=document.createElement('p');availability.id='availability';availability.hidden=true;
  stage=document.createElement('main');stage.id='stage';
  status=document.createElement('p');status.id='status';
  document.body.append(availability,stage,status);
  delete document.documentElement.dataset.phase;delete document.documentElement.dataset.blocker;
});
afterEach(()=>{
  dispatchEvent(new Event('pagehide'));
  disposals.splice(0).forEach((dispose)=>dispose());
  vi.restoreAllMocks();
});

describe('公開モデルの全段階',()=>{
  for (const n of [3,8]) {
    it(`${n}人のintroで開始案内と参加者を描く`,()=>{
      fixture().render(logic.publicView(initial(n).state),looks);
      expect(document.documentElement.dataset.phase).toBe('intro');
      expect(stage.textContent).toContain('手札を先に、出し切ろう。');
      expect(stage.textContent).toContain('参加者1さんのスマホで「はじめる」');
      expect(stage.querySelectorAll('.seat')).toHaveLength(n);
    });
    it(`${n}人のplayで番と空の場を描く`,()=>{
      const value=model(n);fixture().render(value,looks);
      expect(document.documentElement.dataset.phase).toBe('play');
      expect(stage.querySelector('.turn-heading').textContent).toBe(`参加者${value.turn}さんの番`);
      expect(stage.querySelector('.table-empty').hidden).toBe(false);
      expect(stage.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(stage.querySelector('[aria-current="step"]').dataset.seat).toBe(String(value.turn));
    });
    for (const outcome of ['complete','incomplete']) it(`${n}人のended（${outcome}）を描く`,()=>{
      const state=started(n);state.phase='ended';state.turn=null;state.outcome=outcome;
      state.seats.forEach((seat,i)=>{seat.rank=outcome === 'complete' ? i+1 : null;seat.hand=i<n-1 ? [] : seat.hand;});
      fixture().render(logic.publicView(state),looks);
      expect(document.documentElement.dataset.phase).toBe('ended');
      expect(stage.querySelector('.turn-heading').textContent).toBe(outcome === 'complete' ? '勝負がつきました' : '今回は、勝敗なし');
      expect(stage.querySelector('.table-area').hidden).toBe(true);
      expect(stage.querySelector('.turn-ring').hidden).toBe(true);
      expect(stage.querySelectorAll('.rank-badge:not([hidden])')).toHaveLength(outcome === 'complete' ? n : 0);
    });
  }
  it('人数不足と接続待ちを区別する',()=>{
    const view=fixture();view.render(logic.publicView(initial(2).state));
    expect(stage.textContent).toContain('3〜8人そろうと遊べます');
    const state=initial().state;state.seats[1].online=false;
    view.render(logic.publicView(state));expect(stage.textContent).toContain('スマホのつなぎ直しを待っています');
  });
  it('場の4柄と数、灯のジョーカーを文字と自作図形で示す',()=>{
    const view=fixture();const value=model();
    value.table={cards:['s7','h7','d7','c7'],n:4,by:1};view.render(value,looks);
    expect([...stage.querySelectorAll('.table-cards .playing-card')].map((node)=>node.getAttribute('aria-label'))).toEqual(['♠7','♥7','♦7','♣7']);
    expect(stage.querySelectorAll('.table-cards .playing-card--red')).toHaveLength(2);
    value.table={cards:['jk1','jk2'],n:2,by:2};view.render(value,looks);
    expect(stage.querySelectorAll('.table-cards .playing-card--joker svg')).toHaveLength(2);
    expect(stage.querySelector('.table-cards').textContent).toContain('灯');
    expect(stage.querySelector('.table-cards').getAttribute('aria-label')).toBeNull();
    expect(stage.querySelector('.table-empty').hidden).toBe(true);
  });
  it('公開モデルに私有情報が紛れても手札や制御IDをDOMへ出さない',()=>{
    const state=started(8);const value=logic.publicView(state);
    // 全体のJSONを描いたり、手札を画面へ転送する退行を検出する。
    value.hand=['秘密の手札'];value.control={id:'secret_control'};
    fixture().render(value,looks);
    const output=`${stage.outerHTML}${status.outerHTML}`;
    for (const seat of state.seats) for (const id of seat.hand) {
      expect(output).not.toContain(logic.cardLabel(id));
      expect(output).not.toContain(logic.cardId(state,id));
    }
    expect(output).not.toContain('秘密の手札');expect(output).not.toContain('secret_control');
  });
  it('名前やイベントの文字をHTMLとして解釈しない',()=>{
    const value=model();value.seats[0].name='<img src=x onerror=alert(1)>';
    value.events=[{seq:1,type:'pass',p:1}];fixture().render(value);
    expect(stage.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(status.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(stage.querySelector('img')).toBeNull();expect(stage.querySelector('script')).toBeNull();
  });
  it('パス・上がり・退出・接続待ちを色以外でも区別する',()=>{
    const value=model(8);
    value.seats[0].passed=true;value.seats[1].rank=1;value.seats[1].count=0;
    value.seats[2].left=true;value.seats[2].rank=null;value.seats[3].online=false;
    value.seats[4].rank=8;value.seats[4].count=2;
    fixture().render(value,looks);
    expect(stage.querySelector('[data-seat="1"] .seat-note').textContent).toBe('パス');
    expect(stage.querySelector('[data-seat="2"] .rank-badge').textContent).toBe('1位 · 大富豪');
    expect(stage.querySelector('[data-seat="3"] .seat-count').textContent).toBe('退出');
    expect(stage.querySelector('[data-seat="4"] .seat-note').textContent).toBe('接続待ち');
    expect(stage.querySelector('[data-seat="5"]').classList.contains('seat--last')).toBe(true);
    expect(stage.querySelectorAll('svg[aria-label="橙の丸"]')).toHaveLength(8);
  });
  it('新しい公開イベントだけを反映し、変わらない札と席は保持する',()=>{
    const view=fixture();const value=model();value.table={cards:['s7'],n:1,by:1};
    view.render(value,looks);
    const row=stage.querySelector('[data-seat="2"]');const card=stage.querySelector('.table-cards .playing-card');
    const watcher=new MutationObserver(()=>{});watcher.observe(row,{childList:true,subtree:true,attributes:true});
    value.events=[{seq:1,type:'pass',p:3}];value.seats[2].passed=true;view.render(value,looks);
    expect(stage.querySelector('[data-seat="2"]')).toBe(row);
    expect(stage.querySelector('.table-cards .playing-card')).toBe(card);
    expect(watcher.takeRecords()).toHaveLength(0);watcher.disconnect();
    const banner=stage.querySelector('.event-label');view.render(structuredClone(value),looks);
    expect(stage.querySelector('.event-label')).toBe(banner);
    value.events.push({seq:2,type:'sweep',p:1,reason:'eight'});value.table=null;view.render(value,looks);
    expect(stage.querySelector('.event-banner').textContent).toBe('8切り！');
    expect(stage.querySelector('.table-trail--swept .playing-card')).not.toBeNull();
    expect(stage.querySelector('.table-trail').getAttribute('aria-hidden')).toBe('true');
  });
  it('革命と8切りが重なっても両方を示し、革命中の印を常設する',()=>{
    const view=fixture();const value=model();value.revolution=true;
    value.events=[{seq:1,type:'play',p:1,cards:['s8','h8','d8','c8']},{seq:2,type:'revolution',p:1,revolution:true},{seq:3,type:'sweep',p:1,reason:'eight'}];
    view.render(value,looks);
    expect(stage.querySelector('.event-banner').textContent).toContain('革命！');
    expect(stage.querySelector('.event-banner').textContent).toContain('8切り！');
    expect(stage.querySelector('.strength-order').textContent).toContain('革命中');
    expect(stage.dataset.revolution).toBe('true');
    // 8切りは場が空のまま更新されるので、前の場だけを見ると出した8が描かれなかった。
    expect(stage.querySelectorAll('.table-trail .playing-card')).toHaveLength(4);
    expect(stage.querySelector('.table-trail .playing-card').getAttribute('aria-label')).toBe('♠8');
    value.revolution=false;value.events.push({seq:4,type:'revolution',p:2,revolution:false});view.render(value);
    expect(stage.querySelector('.event-banner').textContent).toBe('革命が戻りました！');
    expect(stage.querySelector('.strength-order').textContent).toContain('通常');
  });
  it('席の追加・消失・名前と番の変更を反映する',()=>{
    const view=fixture();const value=model();view.render(value);
    value.seats[0].name='新しい名前';value.turn=2;view.render(value);
    expect(stage.querySelector('[data-seat="1"] .seat-name').textContent).toBe('新しい名前');
    expect(stage.querySelector('[aria-current="step"]').dataset.seat).toBe('2');
    value.seats=value.seats.slice(1);view.render(value);
    expect(stage.querySelector('[data-seat="1"]')).toBeNull();
    expect(stage.querySelectorAll('.seat')).toHaveLength(2);
  });
});

function fakeHost() {
  const listeners=new Map();const pads=new Map();
  return {
    players:players(),leader:1,environment:{connected:true,visible:true},paused:false,
    capabilities:['pad-tiles-v1','result-options-v1','host-environment-v1'],
    look:vi.fn((id)=>looks.get(id)),ready:vi.fn(),cue:vi.fn(),vibrate:vi.fn(),end:vi.fn(),
    setPad:vi.fn((spec,to)=>pads.set(to,spec)),
    on:vi.fn((name,fn)=>{listeners.set(name,fn);return vi.fn(()=>listeners.delete(name));}),
    emit:(name,...args)=>listeners.get(name)?.(...args),listeners,pads,
  };
}
async function boot(host,phase='intro') {
  hooks.connect.mockResolvedValue(host);await import('./main.js');
  await vi.waitFor(()=>expect(document.documentElement.dataset.phase).toBe(phase));
}
function startHost(host) {
  const pad=host.pads.get(1);
  host.emit('input',1,{k:'btn',id:pad.buttons[0].id,d:1});
}
describe('mainと画面・判定・SDKの接続',()=>{
  it('最初に描いてreadyし、全初期値と新しいnonce・種を判定へ渡す',async()=>{
    const host=fakeHost();host.ready.mockImplementation(()=>expect(stage.querySelector('h1').textContent).toBe('大富豪'));
    await boot(host);
    expect(host.ready).toHaveBeenCalledTimes(1);
    expect(hooks.createGame).toHaveBeenCalledWith(expect.objectContaining({players:host.players,leader:1,environment:host.environment,paused:false,nonce:expect.stringMatching(/^[a-z0-9]{1,8}$/),seed:expect.any(Number)}));
    const first=hooks.createGame.mock.calls[0][0];
    dispatchEvent(new Event('pagehide'));vi.resetModules();await boot(fakeHost());
    expect(hooks.createGame.mock.calls[1][0].nonce).not.toBe(first.nonce);
  });
  for (const missing of ['pad-tiles-v1','result-options-v1','host-environment-v1']) it(`${missing}が無ければwaitとreadyだけで待つ`,async()=>{
    const host=fakeHost();host.capabilities=host.capabilities.filter((cap)=>cap !== missing);
    await boot(host,'unsupported');
    expect(stage.textContent).toContain('更新が必要です');
    expect(host.setPad).toHaveBeenCalledExactlyOnceWith({k:'wait',title:'更新が必要です'});
    expect(host.ready).toHaveBeenCalledTimes(1);expect(host.on).not.toHaveBeenCalled();expect(hooks.createGame).not.toHaveBeenCalled();
  });
  it('接続失敗をerror画面にする',async()=>{
    hooks.connect.mockRejectedValue(new Error('unavailable'));await import('./main.js');
    await vi.waitFor(()=>expect(document.documentElement.dataset.phase).toBe('error'));
    expect(stage.textContent).toContain('つながりませんでした');
  });
  it('padを本人だけへ送り、公開モデルから描画し、cueがなくても遊べる',async()=>{
    const host=fakeHost();delete host.cue;await boot(host);
    expect(host.setPad.mock.calls.every(([,to])=>typeof to === 'number')).toBe(true);
    startHost(host);
    expect(document.documentElement.dataset.phase).toBe('play');
    expect(host.pads.size).toBe(3);expect(host.setPad.mock.calls.every(([,to])=>typeof to === 'number')).toBe(true);
    for (const spec of host.pads.values()) expect(spec.k).toBe('tiles');
    const output=stage.outerHTML;
    for (const spec of host.pads.values()) for (const tile of spec.tiles) {
      expect(output).not.toContain(tile.label);expect(output).not.toContain(tile.id);
    }
    expect(hooks.publicView).toHaveBeenCalled();
  });
  it('pause/resume・環境・playersを判定へ渡し、停止を独立して保つ',async()=>{
    const host=fakeHost();await boot(host);startHost(host);
    host.emit('pause');expect(hooks.updateGame).toHaveBeenLastCalledWith(expect.any(Object),{t:'menu',paused:true});
    expect(document.documentElement.dataset.blocker).toBe('menu');
    expect(document.getElementById('availability').textContent).toContain('一時停止中');
    host.emit('environment',{connected:true,visible:false});
    host.emit('resume');expect(document.documentElement.dataset.blocker).toBe('hidden');
    host.emit('environment',{connected:false,visible:true});expect(document.documentElement.dataset.blocker).toBe('offline');
    host.emit('environment',{connected:true,visible:true});expect(document.getElementById('availability').hidden).toBe(true);
    const offline=host.players.map((p)=>({...p,online:false}));host.emit('players',offline,2);
    expect(hooks.updateGame).toHaveBeenLastCalledWith(expect.any(Object),{t:'players',players:offline,leader:2});
    expect(stage.textContent).toContain('番の人のスマホが戻るまで');
    host.emit('players',host.players,1);expect(stage.textContent).not.toContain('番の人のスマホが戻るまで');
  });
  it('開始時から停止・接続切れならその表示を保つ',async()=>{
    const host=fakeHost();host.paused=true;host.environment={connected:false,visible:true};await boot(host);
    expect(document.documentElement.dataset.blocker).toBe('menu');
    expect(host.pads.get(1).k).toBe('wait');
    host.emit('resume');expect(document.documentElement.dataset.blocker).toBe('offline');
  });
  it('cueと振動を引数のまま実行し、endを一度だけ送り購読を解除する',async()=>{
    const host=fakeHost();await boot(host);
    const state=hooks.createGame.mock.results[0].value.state;
    const results=[{p:1,score:1,label:'大富豪'}];const options={display:'record',outcome:'complete'};
    hooks.updateGame.mockReturnValueOnce({state,effects:[{t:'cue',name:'revolution',v:.4},{t:'vibrate',ms:[30,20,30],to:2},{t:'end',results,options},{t:'end',results,options}]});
    host.emit('input',1,{k:'btn',id:'test',d:1});
    expect(host.cue).toHaveBeenCalledExactlyOnceWith('revolution',.4);
    expect(host.vibrate).toHaveBeenCalledExactlyOnceWith([30,20,30],2);
    expect(host.end).toHaveBeenCalledExactlyOnceWith(results,options);
    expect(host.listeners.size).toBe(0);
  });
  it.each([3,8])('%i人の実際の判定とpadのtokenで配札から終了まで通る',async(n)=>{
    const host=fakeHost();host.players=players(n);await boot(host);startHost(host);
    let turns=0;
    while (!host.end.mock.calls.length && turns++<2000) {
      const padEntry=[...host.pads].find(([,pad])=>pad.k === 'tiles' && !pad.disabled);
      expect(padEntry).toBeDefined();const [id,pad]=padEntry;
      const state=hooks.updateGame.mock.results.at(-1).value.state;
      const seat=state.seats.find((item)=>item.id === id);
      const choices=legalPlays(seat.hand,state.table,state.revolution);
      const play=choices.at(-1);
      host.emit('input',id,play ? {k:'tiles',t:pad.token,ids:play.map((card)=>logic.cardId(state,card))} : {k:'tiles',t:pad.token,ids:[],pass:true});
    }
    expect(turns).toBeLessThan(2000);expect(document.documentElement.dataset.phase).toBe('ended');
    expect(host.end).toHaveBeenCalledTimes(1);expect(host.end.mock.calls[0][1].outcome).toBe('complete');
    expect(host.cue.mock.calls.map(([name])=>name)).toContain('deal');
    expect(host.cue.mock.calls.map(([name])=>name)).toContain('place');
    expect(host.cue.mock.calls.map(([name])=>name)).toContain('lose');
    expect(host.listeners.size).toBe(0);
  });
  it('pagehideで購読を解除し、以後の入力を処理しない',async()=>{
    const host=fakeHost();await boot(host);const input=host.listeners.get('input');
    dispatchEvent(new Event('pagehide'));expect(host.listeners.size).toBe(0);
    input(1,{k:'btn',id:'unused',d:1});expect(hooks.updateGame).not.toHaveBeenCalled();
  });
});
