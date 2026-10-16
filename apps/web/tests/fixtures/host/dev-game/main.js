// 試験用の外部ゲーム（?dev= で読み込む）。握手して ready を呼び、「おわる」が押されたら end する。
// 通し試験が読めるよう、いまの参加者の席（#msg）と、受け取ったボタンの入力（#log、「席:id:押す/離す」）を画面に書く。
import { connect } from './irori.js';

const irori = await connect();
const seen = [];
const show = () => {
  document.getElementById('msg').textContent = `players: ${irori.players.map((x) => x.id).join(',')}`;
  document.getElementById('log').textContent = seen.join(' ');
};
irori.setPad({ k: 'pad', stick: 'none', buttons: [{ id: 'end', label: 'おわる' }, { id: 'poke', label: 'おす' }] });
irori.on('players', show);
irori.on('input', (p, i) => {
  if (i.k === 'btn') seen.push(`${p}:${i.id}:${i.d}`);
  show();
  if (i.k === 'btn' && i.id === 'end' && i.d === 1) irori.end(irori.players.map((x) => ({ p: x.id, score: 7, label: 'dev' })));
});
show();
irori.ready();
