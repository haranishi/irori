// ゲームの制作者が書くコードの例。irori.d.ts だけを見て、型が通ること・誤りが誤りとして出ることを確かめる。
import { connect, IroriError } from '../../irori.js';
import type { HostCapability, HostEnvironment, Irori, Look, PadSpec, PlayerInfo } from '../../irori.js';

export async function game(): Promise<void> {
  let irori: Irori;
  try {
    irori = await connect({ timeoutMs: 5000, mockPlayers: 3 });
  } catch (e) {
    if (e instanceof IroriError && e.code === 'handshake-timeout') return;
    throw e;
  }

  const pad: PadSpec = { k: 'pad', stick: 'stick', buttons: [{ id: 'jump', label: 'ジャンプ', color: 'red' }], orient: 'landscape' };
  irori.setPad(pad);
  irori.setPad({ k: 'choices', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], disabled: true }, 2);
  irori.setPad({ k: 'wait', title: 'よーい' }, 'all');
  // @ts-expect-error remote はコンソール専用で、ゲームからは指定できない
  irori.setPad({ k: 'remote' });
  // @ts-expect-error 色は名前だけ
  irori.setPad({ k: 'buzzer', label: '押せ', color: '#ff0000' });
  // @ts-expect-error 自由なHTMLは持ち込めない
  irori.setPad({ k: 'html', html: '<b>x</b>' });

  const off = irori.on('input', (p, i, T) => {
    const seat: number = p;
    const at: number = T;
    if (i.k === 'axis') {
      const x: number = i.x;
      void x;
    }
    // @ts-expect-error メニューの依頼はゲームに届かない
    if (i.k === 'menu') return;
    void seat;
    void at;
  });
  off();
  irori.on('players', (list: readonly PlayerInfo[], leader) => {
    const first: string | undefined = list[0]?.name;
    const who: number | null = leader;
    void first;
    void who;
  });
  irori.on('pause', () => {});
  const capabilities: readonly HostCapability[] = irori.capabilities;
  const environment: Readonly<HostEnvironment> | null = irori.environment;
  irori.on('environment', (value) => {
    const connected: boolean = value.connected;
    void connected;
    // @ts-expect-error 環境の通知は読み取り専用
    value.visible = true;
  });
  // @ts-expect-error 能力一覧は読み取り専用
  capabilities.push('result-options-v1');
  // @ts-expect-error 能力の追加はホストだけが決める
  irori.capabilities = [];
  // @ts-expect-error 環境のgetterは読み取り専用
  irori.environment = null;
  if (environment) {
    // @ts-expect-error 環境は読み取り専用
    environment.connected = false;
  }
  // @ts-expect-error 知らないイベント
  irori.on('chat', () => {});

  irori.vibrate([100, 50, 100]);
  irori.vibrate(200, 1);
  // @ts-expect-error 宛先は席番号か 'all'（'*' はコンソールの中の書き方）
  irori.vibrate(100, '*');

  const look: Look = irori.look(1);
  const shape: 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross' | 'hexagon' | 'ring' = look.shape;
  void shape;
  irori.ready();
  irori.end([{ p: 1, score: 10, label: '1位' }, { p: 2, score: 3 }]);
  irori.end([{ p: 1, score: -12, label: 'ズレ1.2秒', ranked: false }], { display: 'record', outcome: 'incomplete', note: '通信の遅れを含む目安です' });
  // @ts-expect-error 順位対象はbooleanのみ
  irori.end([{ p: 1, score: 10, ranked: 'yes' }]);
  // @ts-expect-error 表示の種類は固定
  irori.end([], { display: 'html' });
  // @ts-expect-error score は数
  irori.end([{ p: 1, score: '10' }]);

  const best: string | null = await irori.storage.get('best');
  await irori.storage.set('best', String(Number(best ?? 0) + 1));
  const mode: 'host' | 'mock' = irori.mode;
  const paused: boolean = irori.paused;
  void mode;
  void paused;
  // @ts-expect-error players は読み取り専用
  irori.players = [];
}
