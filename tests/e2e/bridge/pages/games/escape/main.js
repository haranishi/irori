// 悪意のあるゲーム。枠の外へ出ようと試み、各試みの結果（例外になった／無効だった）を __evil_report__ で親へ返す。
// 親（試験の土台）はこれを集めるが、host-bridge を通さない別の道具。危険な試み（親のDOM・画面遷移・ポップアップ・
// ダイアログ・なりすましのポート）が本当に止まったかは、試験が親側からも独立に確かめる。
import { connect } from '/sdk/irori.js';

const report = {};
async function check(name, fn) {
  try {
    const v = await fn();
    report[name] = { escaped: true, note: v === undefined ? 'no-throw' : String(v).slice(0, 40) };
  } catch (e) {
    report[name] = { escaped: false, note: (e && e.name) || 'threw' };
  }
}

// ホストから見ると普通のゲームとして振る舞い、握手と players は通る（＝枠は隔離しつつホストは動く）。
const irori = await connect({ timeoutMs: 8000 });
irori.on('players', (list) => window.parent.postMessage({ __game__: true, kind: 'players', n: list.length }, '*'));
irori.ready();

// 以下は、止まっていれば例外になる試み。例外が出れば escaped:false（＝守れている）。
await check('parentDocument', () => {
  const href = window.parent.document.location.href; // 親のDOMに触れたら危険
  return `read ${href}`;
});
await check('topLocation', () => {
  window.top.location = 'http://attacker.example/';
  return 'wrote top.location';
});
await check('windowOpen', () => {
  const w = window.open('http://attacker.example/', '_blank'); // sandbox にポップアップ許可が無ければ null
  if (w) return 'opened';
  throw new Error('BlockedBySandbox');
});
await check('localStorage', () => {
  window.localStorage.setItem('x', '1'); // オリジンが空だと SecurityError
  return `value ${window.localStorage.getItem('x')}`;
});
await check('cookie', () => {
  document.cookie = 'x=1'; // オリジンが空だと SecurityError
  if (document.cookie.includes('x=1')) return 'set';
  throw new Error('NoCookie');
});
await check('camera', async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('NoMediaDevices');
  await navigator.mediaDevices.getUserMedia({ video: true }); // allow に無ければ拒否
  return 'granted';
});

// 以下は、止まっても例外にならない（無言で無効になる）試み。親側から、画面遷移やダイアログが起きていないことを確かめる。
try {
  window.alert('owned');
  report.alert = { escaped: 'parent-verified', note: 'no-throw' };
} catch (e) {
  report.alert = { escaped: false, note: (e && e.name) || 'threw' };
}
try {
  const f = document.createElement('form');
  f.method = 'GET';
  f.action = 'http://attacker.example/';
  f.target = '_top'; // トップを乗っ取ろうとする。sandbox が無ければ遷移する
  document.body.appendChild(f);
  f.submit();
  report.formSubmit = { escaped: 'parent-verified', note: 'no-throw' };
} catch (e) {
  report.formSubmit = { escaped: false, note: (e && e.name) || 'threw' };
}

window.parent.postMessage({ __evil_report__: report }, '*');
