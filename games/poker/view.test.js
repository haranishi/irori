// @vitest-environment happy-dom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createGame,publicView,updateGame,viewFor} from './logic.js';
import {createView,short,eventText,cardFace} from './view.js';
const players=Array.from({length:8},(_,i)=>({id:i+1,name:`参加者${i+1}`,online:true}));
const initial=()=>createGame({players,leader:1,seed:19,nonce:'view',environment:{connected:true,visible:true}}).state;
let view,stage,status,listeners;
beforeEach(()=>{document.body.replaceChildren();listeners=new Set();vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)}));stage=document.createElement('main');status=document.createElement('p');document.body.append(stage,status);view=createView(stage,status);});
afterEach(()=>{view.dispose();vi.unstubAllGlobals();});
describe('公開の卓',()=>{
  it('勝負前の手札をDOMへ出さず、公開された席だけ描く',()=>{
    let s=initial();const pad=viewFor(s,1).pad;s=updateGame(s,{t:'input',p:1,input:{k:'tiles',ids:[pad.tiles[0].id],t:pad.token}}).state;
    s.seats.forEach((seat,i)=>{seat.hand=[`s${i+2}`,`h${i+2}`];});
    view.render(publicView(s));expect(stage.querySelector('.face')).toBeNull();expect(stage.querySelectorAll('.back')).toHaveLength(16);
    const before=stage.innerHTML;s.seats[0].hand=['d14','c14'];view.render(publicView(s));expect(stage.innerHTML).toBe(before);
    s.phase='showdown';s.board=['s10','s11','s12','s13','s14'];s.revealed=[2];s.winners=[2];view.render(publicView(s));
    expect(stage.querySelectorAll('.hand .face')).toHaveLength(2);expect(stage.querySelector('[data-id="1"] .face')).toBeNull();expect(stage.querySelector('[data-id="2"]').dataset.winner).toBe('true');
  });
  it('文字を制限してHTMLを解釈せず、札は自作の図形で描く',()=>{
    const s=initial();s.seats[0].name='<img src=x>'.repeat(10);view.render(publicView(s));expect([...stage.querySelector('.name').textContent]).toHaveLength(12);expect(stage.querySelector('img')).toBeNull();expect(short('😀'.repeat(20),12)).toHaveLength(24);
    expect(eventText(publicView(s),{p:1,type:'raise',amount:40}).length).toBeLessThanOrEqual(64);const face=cardFace('h14');expect(face.querySelectorAll('svg')).toHaveLength(2);expect(face.textContent).toBe('');expect(face.getAttribute('aria-label')).toContain('A');
  });
  it('CPUの図形と全席の結果と直近4件、停止と動きの設定を示す',()=>{
    const s=initial();s.seats[1].cpu=true;s.phase='result';s.seats.forEach(v=>v.rank=1);s.events=Array.from({length:6},(_,i)=>({seq:i,p:1,type:'check',amount:0}));view.render(publicView(s));
    expect(stage.querySelectorAll('.robot')).toHaveLength(1);expect(stage.querySelectorAll('.results li')).toHaveLength(8);expect(stage.querySelector('.results').textContent).toContain('1位(CPUこみ)');expect(stage.querySelectorAll('.events li')).toHaveLength(4);expect(stage.dataset.motion).toBe('reduce');view.hold(true);expect(stage.dataset.frozen).toBe('true');view.dispose();expect(listeners.size).toBe(0);
    s.outcome='incomplete';s.seats.forEach(v=>v.rank=null);view.render(publicView(s));expect(stage.textContent).toContain('勝負なし');expect(stage.querySelector('.results').textContent).not.toContain('位');
  });
});
