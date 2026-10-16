// 試験だけで使うゲーム（棚の本番には並ばない。試験の前処理が、ビルドの写しに足す）。
// 席の番号の順に、定型の6種（と十字キーの pad）を1つずつ出し、届いた入力と席の一覧の変化を記録する。
// 記録は document.documentElement の data-log / data-players に JSON で置く（試験が枠の中から読む）。
// pad の「おわる」（id: end）で end。得点は、その席から届いた入力の数。
import { connect } from './irori.js';

const KINDS = [
  { k: 'wait', title: '試験の待機', body: 'この席は待つだけです' },
  { k: 'pad', stick: 'stick', hint: 'スティックとボタン', buttons: [{ id: 'a', label: 'A' }, { id: 'end', label: 'おわる', color: 'gray' }] },
  { k: 'buzzer', label: '押す', hint: '早押しのボタン' },
  { k: 'choices', hint: '1つ選ぶ', options: [{ id: 'x', label: 'ア' }, { id: 'y', label: 'イ' }, { id: 'z', label: 'ウ', color: 'blue' }] },
  { k: 'touch', hint: '面をなぞる' },
  { k: 'tilt', hint: '傾けて操作', buttons: [{ id: 'fire', label: '発射' }] },
  { k: 'pad', stick: 'dpad', hint: '十字キー', buttons: [{ id: 'a', label: 'A' }] },
];

const irori = await connect();
const root = document.documentElement;
/** @type {{ p: number, i: unknown }[]} */
const log = [];
/** @type {[number, boolean][][]} */
const seen = [];
const order = [...irori.players].sort((a, b) => a.id - b.id);
const kindOf = new Map(order.map((p, n) => [p.id, KINDS[n % KINDS.length]]));

function render() {
  root.dataset.phase = 'play';
  root.dataset.log = JSON.stringify(log.slice(-300));
  root.dataset.players = JSON.stringify(seen.slice(-50));
  const list = document.getElementById('seats');
  list.replaceChildren(
    ...order.map((p) => {
      const li = document.createElement('li');
      li.textContent = `席${p.id}：${kindOf.get(p.id)?.k ?? '?'}`;
      return li;
    }),
  );
  const last = log.at(-1);
  document.getElementById('last').textContent = last ? `最後の入力：席${last.p} ${JSON.stringify(last.i)}` : '入力はまだありません';
}

for (const [p, spec] of kindOf) irori.setPad(spec, p);
irori.on('input', (p, i) => {
  log.push({ p, i });
  render();
  if (i.k === 'btn' && i.id === 'end' && i.d === 1) {
    irori.end(order.map((s) => ({ p: s.id, score: log.filter((e) => e.p === s.id).length, label: `${kindOf.get(s.id)?.k}` })));
  }
});
irori.on('players', (players) => {
  seen.push(players.map((p) => [p.id, p.online]));
  render();
});
render();
irori.ready();
