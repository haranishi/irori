// 枠の中で、コンソールと握手する（packages/protocol の bridge.ts）。
// 親へ hello を送り、親から MessagePort を1つ受け取る。受け取るのは、送り主が親の窓のときだけ。
import { BRIDGE_VERSION } from '@irori/protocol';
import type { BridgeHello } from '@irori/protocol';
import { IroriCore } from './core';
import { isPlainObject } from './checks';
import { IroriError } from './errors';

/** 親が聞き始める前に hello を送ってしまっても、つながるように送り直す間隔。 */
const HELLO_RETRY_MS = 250;

export type HostWindow = Pick<Window, 'addEventListener' | 'removeEventListener'> & { readonly parent: Pick<Window, 'postMessage'> };

export function connectHost(win: HostWindow, timeoutMs: number): Promise<IroriCore> {
  return new Promise((resolve, reject) => {
    const parent = win.parent;
    const hello: BridgeHello = { irori: 'hello', v: BRIDGE_VERSION };
    let port: MessagePort | null = null;
    let core: IroriCore | null = null;

    const say = () => {
      try {
        parent.postMessage(hello, '*');
      } catch {
        // 親が閉じかけているなど。時間切れで失敗にする。
      }
    };
    const retry = setInterval(say, HELLO_RETRY_MS);
    const timer = setTimeout(() => {
      finish();
      port?.close();
      reject(new IroriError('handshake-timeout', `${timeoutMs}ミリ秒以内にコンソールと握手できませんでした`));
    }, timeoutMs);

    const finish = () => {
      clearInterval(retry);
      clearTimeout(timer);
      win.removeEventListener('message', onWindow);
    };

    const onPort = (e: MessageEvent) => {
      const m: unknown = e.data;
      if (core) {
        core.receive(m);
        return;
      }
      // 最初の1通は init。それより前の知らないメッセージは捨てる。
      if (!isPlainObject(m) || m.m !== 'init' || !port) return;
      const p = port;
      core = new IroriCore(
        'host',
        {
          players: Array.isArray(m.players) ? m.players : [],
          leader: typeof m.leader === 'number' ? m.leader : null,
          paused: m.paused === true,
          locale: typeof m.locale === 'string' ? m.locale : 'ja',
        },
        { send: (msg) => p.postMessage(msg) },
      );
      finish();
      resolve(core);
    };

    const onWindow = (ev: MessageEvent) => {
      if (ev.source !== parent || port) return;
      const d: unknown = ev.data;
      if (!isPlainObject(d) || d.irori !== 'port' || d.v !== BRIDGE_VERSION || ev.ports.length !== 1) return;
      port = ev.ports[0] as MessagePort;
      clearInterval(retry);
      port.onmessage = onPort;
    };

    win.addEventListener('message', onWindow as EventListener);
    say();
  });
}
