// @vitest-environment happy-dom
// @ts-check
import {afterEach, expect, it, vi} from 'vitest';
import {createGame, modeId, publicView, updateGame} from './logic.js';
import {createView} from './view.js';

afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();});

it('短いボタンだけでは長さの説明がなくなるため、導入本文にも5・10フレームを示す', ()=>{
  // 描画の採点はブラウザ担当へ渡す。ここでは実際の公開モデルから説明が出ることだけを見る。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({setTransform:vi.fn()});
  const stage=document.createElement('main');
  const status=document.createElement('p');
  document.body.append(stage,status);
  const view=createView({stage,status});
  const state=createGame({players:[{id:1,name:'席1',online:true}],leader:1,environment:{connected:true,visible:true},paused:false,nonce:'length1'}).state;
  view.update(publicView(state),new Map());
  expect(stage.querySelector('.length-guide').textContent).toContain('ふつう10フレーム・みじかめ5フレーム');
  const started=updateGame(state,{t:'input',p:1,input:{k:'pick',id:modeId(state,5)}});
  view.update(publicView(started.state),new Map());
  expect(stage.querySelector('.length-guide')).toBeNull();
  view.dispose();
});
