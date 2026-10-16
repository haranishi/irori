// 正常なゲーム。本物の /sdk/irori.js を使い、入力の id に応じて setPad・vibrate・storage・end を呼ぶ。
// ホスト側（host-bridge）がこれらを受けて GameFrame のイベントにするので、試験はホスト側で確かめる。
// __game__ の postMessage は、ゲームしか知らないこと（mode・players の受信）を試験へ渡すための道具。
import { connect } from '/sdk/irori.js';

const tell = (data) => window.parent.postMessage({ __game__: true, ...data }, '*');

const irori = await connect({ timeoutMs: 8000 });
tell({ kind: 'connected', mode: irori.mode });

irori.on('players', (list, leader) => tell({ kind: 'players', n: list.length, leader }));
irori.on('pause', () => tell({ kind: 'pause' }));
irori.on('resume', () => tell({ kind: 'resume' }));

irori.on('input', async (p, i) => {
  if (i.k !== 'btn' || i.d !== 1) return;
  if (i.id === 'good') irori.setPad({ k: 'wait', title: `got ${p}` }, p);
  else if (i.id === 'buzz') irori.vibrate([40, 20, 40], p);
  else if (i.id === 'save') {
    try {
      await irori.storage.set('score', '7');
      tell({ kind: 'stored', value: await irori.storage.get('score') });
    } catch (e) {
      tell({ kind: 'stored', error: String(e && e.code) });
    }
  } else if (i.id === 'end') {
    irori.end([{ p, score: 10, label: '10pt' }]);
  }
});

irori.setPad({ k: 'pad', stick: 'stick', buttons: [{ id: 'good', label: 'よし' }, { id: 'end', label: 'おわる' }] });
irori.ready();
