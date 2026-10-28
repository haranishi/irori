// welcomeとjoinedは別の接続へ届くため、到着順を制御して試験用ホストの待ち合わせを確かめる。
import type { PlayerInfo } from '@irori/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestHost } from './host';

type ControlledSocket = {
  role: 'host' | 'pad';
  sent: unknown[];
  closed: boolean;
  emit: (frame: unknown) => void;
};
const sockets = vi.hoisted(() => [] as ControlledSocket[]);

vi.mock('@irori/room-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irori/room-client')>();
  return {
    ...actual,
    RoomSocket: class {
      readonly role: 'host' | 'pad';
      readonly sent: unknown[] = [];
      closed = false;
      private readonly listeners = new Map<string, Array<(frame: unknown) => void>>();
      constructor({ role }: { role: 'host' | 'pad' }) {
        this.role = role;
        sockets.push(this);
      }
      on(type: string, listener: (frame: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      emit(frame: unknown) {
        for (const listener of this.listeners.get('frame') ?? []) listener(frame);
      }
      connect() {
        if (this.role === 'host') this.emit({ t: 'welcome', role: 'host', code: 'BCDF', players: [], max: 8, locked: false });
      }
      send(frame: unknown) { this.sent.push(frame); return true; }
      close() { this.closed = true; }
    },
  };
});

const hosts: TestHost[] = [];
const player = (id: number, name: string): PlayerInfo => ({ id, name, online: true });
const welcome = (you: PlayerInfo) => ({ t: 'welcome', role: 'pad', you, resume: 'synthetic-resume', host: true });
const joined = (p: PlayerInfo) => ({ t: 'joined', p });
// 時間ではなく、すでに解決したPromiseの継続だけを進める。
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
async function createHost() {
  const host = await TestHost.create('https://irori.example');
  hosts.push(host);
  return host;
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'BCDF', key: 'synthetic-key' }), { status: 201 })));
});
afterEach(() => {
  for (const host of hosts.splice(0)) host.close();
  vi.unstubAllGlobals();
});

describe('Nodeのスマホ役の参加を両側で待つ', () => {
  it('welcomeのあと、同じ参加者のjoinedがホストへ届くまで戻らない。他の席では解除しない', async () => {
    const host = await createHost();
    const you = player(1, '今回の人');
    let returned = false;
    const pending = host.addNodePad(you.name).then((pad) => { returned = true; return pad; });
    const padSocket = sockets[1]!;
    padSocket.emit(welcome(you));
    await flush();
    const afterWelcome = returned;
    sockets[0]!.emit(joined(player(2, '別の人')));
    await flush();
    const afterOther = returned;
    sockets[0]!.emit(joined(you));
    const pad = await pending;
    expect([afterWelcome, afterOther]).toEqual([false, false]);
    expect(pad.id).toBe(1);
    expect(host.joined()).toEqual([player(2, '別の人'), you]);
    pad.leave();
    expect(padSocket.sent).toEqual([{ t: 'bye' }]);
    expect(padSocket.closed).toBe(true);
  });

  it('joinedが先でも、スマホ自身のwelcomeが届けば両側の待ち合わせが終わる', async () => {
    const host = await createHost();
    const you = player(1, '逆順の人');
    let returned = false;
    const pending = host.addNodePad(you.name).then((pad) => { returned = true; return pad; });
    sockets[0]!.emit(joined(you));
    await flush();
    const beforeWelcome = returned;
    sockets[1]!.emit(welcome(you));
    expect((await pending).id).toBe(1);
    expect(beforeWelcome).toBe(false);
    expect(host.joined()).toEqual([you]);
  });

  it('席番号が再利用されても、開始前に記録した古いjoinedを今回の到達と誤認しない', async () => {
    const host = await createHost();
    const previous = player(1, '前の人');
    sockets[0]!.emit(joined(previous));
    sockets[0]!.emit({ t: 'left', p: 1, why: 'bye' });
    const you = player(1, '新しい人');
    let returned = false;
    const pending = host.addNodePad(you.name).then((pad) => { returned = true; return pad; });
    sockets[1]!.emit(welcome(you));
    await flush();
    const afterWelcome = returned;
    sockets[0]!.emit(joined(you));
    expect((await pending).id).toBe(1);
    expect(afterWelcome).toBe(false);
    expect(host.joined()).toEqual([previous, you]);
  });

  it('並行して参加した2台も、それぞれ自分のjoinedを待つ', async () => {
    const host = await createHost();
    const first = player(1, '一人目');
    const second = player(2, '二人目');
    const returned: number[] = [];
    const pendingFirst = host.addNodePad(first.name).then((pad) => { returned.push(pad.id); return pad; });
    const pendingSecond = host.addNodePad(second.name).then((pad) => { returned.push(pad.id); return pad; });
    sockets[1]!.emit(welcome(first));
    sockets[2]!.emit(welcome(second));
    sockets[0]!.emit(joined(second));
    await pendingSecond;
    await flush();
    const beforeFirst = [...returned];
    sockets[0]!.emit(joined(first));
    await pendingFirst;
    expect(beforeFirst).toEqual([2]);
    expect(returned).toEqual([2, 1]);
  });
});
