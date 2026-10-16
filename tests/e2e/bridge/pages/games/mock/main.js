// 単体で開いたときの仮想プレイヤーを確かめるゲーム。window.parent === window なので、SDK は仮想プレイヤーになる。
// キーボードの入力を window.__inputs に貯め、席1のボタンを押したら end を呼ぶ（結果の画面が出る）。
import { connect } from '/sdk/irori.js';

window.__inputs = [];
const irori = await connect();
window.__mode = irori.mode;
window.__players = irori.players.length;

irori.on('input', (p, i) => {
  window.__inputs.push([p, i]);
  if (i.k === 'btn' && i.id === 'jump' && i.d === 1 && p === 1) {
    irori.end([{ p: 1, score: 3, label: 'P1' }, { p: 2, score: 1 }]);
  }
});

irori.setPad({ k: 'pad', stick: 'stick', buttons: [{ id: 'jump', label: 'ジャンプ' }] });
irori.ready();
