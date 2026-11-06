// @ts-check
import {connect} from './irori.js';
import {createGame,publicView,updateGame,viewFor} from './logic.js';
import {fillSeats,CPU_LOOK} from './cpu.js';
import {createCpuDriver} from './cpu-driver.js';
import {createView} from './view.js';

const stage=/** @type {HTMLElement} */ (document.getElementById('stage'));
const status=/** @type {HTMLElement} */ (document.getElementById('status'));
const view=createView(stage,status);

async function boot() {
  const irori=await connect();
  if (!irori.capabilities.includes('result-options-v1') || !irori.capabilities.includes('host-environment-v1')) {
    view.showMessage('もう少しで遊べます','iroriを新しくして開き直してね');
    document.documentElement.dataset.phase='unsupported';
    irori.setPad({k:'wait',title:'iroriを新しくして開き直してね'});
    irori.ready();
    return;
  }
  /** @type {Map<number,import('./irori.js').Look>} */
  const looks=new Map(irori.players.map((p)=>[p.id,irori.look(p.id)]));
  const cpus=fillSeats(irori.players.length);
  const cpuIds=new Set(cpus.map(p=>p.id));
  const human=(/** @type {number} */ id)=>!cpuIds.has(id);
  for(const cpu of cpus) looks.set(cpu.id,CPU_LOOK);
  const seed=crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(4)),(n)=>n.toString(16).padStart(2,'0')).join('');
  const initial=createGame({players:[...irori.players,...cpus],leader:irori.leader,environment:irori.environment,paused:irori.paused,nonce});
  /** @type {import('./logic.js').GameState|null} */
  let state=initial.state;
  const cpu=createCpuDriver(cpus.map(p=>p.id),seed,(p)=>{
    if(!state) throw new Error('終了した局です');
    return viewFor(state,p);
  },(p,input)=>dispatch({t:'input',p,input}));
  /** @type {(()=>void)[]} */
  const subscriptions=[];
  let disposed=false;
  function dispose() {
    if (disposed) return;
    disposed=true;cpu.cancel();
    for (const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide',dispose);
    state=null;
    looks.clear();
    view.dispose();
  }
  /** @param {readonly import('./logic.js').GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed) return;
      if (effect.t === 'pad') {if(human(effect.to)) irori.setPad(effect.spec,effect.to);}
      else {dispose();irori.end(effect.results.filter(r=>human(r.p)),effect.options);}
    }
  }
  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if (!state || disposed) return;
    const next=updateGame(state,event);
    state=next.state;
    view.render(publicView(state),looks);
    apply(next.effects);
    if(!disposed) cpu.sync();
  }
  subscriptions.push(
    irori.on('input',(p,input)=>dispatch({t:'input',p,input})),
    irori.on('players',(players,leader)=>{for(const p of players) if(!looks.has(p.id)) looks.set(p.id,irori.look(p.id));dispatch({t:'players',players:[...players,...cpus],leader});}),
    irori.on('pause',()=>dispatch({t:'menu',paused:true})),
    irori.on('resume',()=>dispatch({t:'menu',paused:false})),
    irori.on('environment',(value)=>dispatch({t:'environment',value})),
  );
  addEventListener('pagehide',dispose,{once:true});
  view.render(publicView(state),looks);
  apply(initial.effects);
  cpu.sync();
  irori.ready();
}
void boot().catch(()=>{view.showMessage('つながりませんでした','ゲームを開き直してください');document.documentElement.dataset.phase='error';});
