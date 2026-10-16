// 巨大・不正なメッセージを、受け取ったポートへ連投するゲーム。SDK は生のポートを渡さないので、自分で握手する。
// host-bridge は、形の違うものを捨てつつ、1秒100通を超えたら枠を止める（error reason 'rate'）。
const huge = 'x'.repeat(200_000);
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.irori !== 'port' || e.ports.length !== 1) return;
  const port = e.ports[0];
  for (let i = 0; i < 300; i += 1) {
    port.postMessage({ m: 'setPad', to: '*', spec: { k: 'wait', junk: i }, huge });
  }
});
window.parent.postMessage({ irori: 'hello', v: 1 }, '*');
