// 枠の中での握手の単体試験。親の窓を偽物にして、SDK 側の規則（親からだけ受ける・時間切れ・メッセージの形）を見る。
// 本物の親（host-bridge）との握手は、実ブラウザの試験（tests/e2e/bridge）で確かめる。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectHost } from '../src/host';
import type { HostWindow } from '../src/host';
import { STORAGE_TIMEOUT_MS } from '../src/core';

function fakeWindow() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const hellos: unknown[] = [];
  const parent = { postMessage: (m: unknown) => void hellos.push(m) };
  const win = {
    parent,
    addEventListener: (_t: string, fn: (e: MessageEvent) => void) => void listeners.add(fn),
    removeEventListener: (_t: string, fn: (e: MessageEvent) => void) => void listeners.delete(fn),
  } as unknown as HostWindow;
  const deliver = (data: unknown, source: unknown = parent, ports: MessagePort[] = []) => {
    for (const fn of [...listeners]) fn({ data, source, ports } as unknown as MessageEvent);
  };
  return { win, parent, hellos, deliver, listeners };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const INIT = { m: 'init', sdk: 1, players: [{ id: 1, name: 'あ', online: true }, { id: 3, name: 'う', online: false }], leader: 1, locale: 'en-US', paused: true };

const channels: MessageChannel[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

async function connected(init: unknown = INIT) {
  const f = fakeWindow();
  const p = connectHost(f.win, 3000);
  const ch = new MessageChannel();
  channels.push(ch);
  const fromGame: unknown[] = [];
  ch.port1.onmessage = (e) => fromGame.push(e.data);
  f.deliver({ irori: 'port', v: 1 }, f.parent, [ch.port2]);
  ch.port1.postMessage(init);
  const irori = await p;
  return { ...f, irori, ch, fromGame };
}

describe('握手', () => {
  it('hello を送り、親から来た port と init で、席・リーダー・一時停止・言語を受け取る', async () => {
    const { irori, hellos, listeners } = await connected();
    expect(hellos[0]).toEqual({ irori: 'hello', v: 1 });
    expect(irori.mode).toBe('host');
    expect(irori.players).toEqual([{ id: 1, name: 'あ', online: true }, { id: 3, name: 'う', online: false }]);
    expect(Object.isFrozen(irori.players)).toBe(true);
    expect(irori.leader).toBe(1);
    expect(irori.paused).toBe(true);
    expect(irori.locale).toBe('en-US');
    expect(irori.look(1).label).toBe('orange circle');
    expect(listeners.size).toBe(0);
  });

  it('親でない送り主・形の違う port・版の違いは無視する', async () => {
    const f = fakeWindow();
    const p = connectHost(f.win, 3000);
    const ch = new MessageChannel();
    channels.push(ch);
    let initSeenBy = 0;
    ch.port1.onmessage = () => initSeenBy++;
    f.deliver({ irori: 'port', v: 1 }, { postMessage() {} }, [ch.port2]);
    f.deliver({ irori: 'port', v: 2 }, f.parent, [ch.port2]);
    f.deliver({ irori: 'port', v: 1 }, f.parent, []);
    f.deliver({ irori: 'hello', v: 1 }, f.parent, [ch.port2]);
    const real = new MessageChannel();
    channels.push(real);
    f.deliver({ irori: 'port', v: 1 }, f.parent, [real.port2]);
    ch.port1.postMessage(INIT);
    await tick();
    let settled = false;
    void p.then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    real.port1.postMessage(INIT);
    const irori = await p;
    expect(irori.players).toHaveLength(2);
    expect(initSeenBy).toBe(0);
  });

  it('3秒以内に init が来なければ handshake-timeout。そのあいだ hello を送り直す', async () => {
    vi.useFakeTimers();
    const f = fakeWindow();
    const p = connectHost(f.win, 3000);
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2999);
    expect(f.hellos.length).toBeGreaterThan(5);
    await vi.advanceTimersByTimeAsync(1);
    const err = (await caught) as { code?: string };
    expect(err.code).toBe('handshake-timeout');
    const n = f.hellos.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.hellos.length).toBe(n);
    expect(f.listeners.size).toBe(0);
  });
});

describe('つながったあと', () => {
  it('旧ホストでは能力が空・環境はnull。旧endの各形式は追加キーなしで送る', async () => {
    for (const results of [undefined, [], [{ p: 1, score: 3, label: '3秒' }]]) {
      const { irori, fromGame } = await connected();
      expect(irori.capabilities).toEqual([]);
      expect(irori.environment).toBeNull();
      irori.end(results);
      await tick();
      expect(fromGame).toEqual([results === undefined ? { m: 'end' } : { m: 'end', results }]);
    }
  });

  it.each([{ capabilities: [] }, { capabilities: ['host-environment-v1'] }])('result-options-v1がないホスト($capabilities)への拡張endを送信前に拒み、拒否後も旧endを送れる', async ({ capabilities }) => {
    const { irori, fromGame } = await connected({ ...INIT, capabilities });
    expect(() => irori.end([], {})).toThrow(/unsupported-feature/);
    expect(() => irori.end([{ p: 1, score: 3, ranked: false }])).toThrow(/unsupported-feature/);
    expect(() => irori.end([{ p: 1, score: 3, ranked: true }])).toThrow(/unsupported-feature/);
    await tick();
    expect(fromGame).toEqual([]);
    irori.end([{ p: 1, score: 3 }]);
    await tick();
    expect(fromGame).toEqual([{ m: 'end', results: [{ p: 1, score: 3 }] }]);
  });

  it('対応ホストへ結果なしのoptionsを渡してもresultsキーを補わない', async () => {
    const { irori, fromGame } = await connected({ ...INIT, capabilities: ['result-options-v1'] });
    irori.end(undefined, { outcome: 'incomplete' });
    await tick();
    expect(fromGame).toEqual([{ m: 'end', options: { outcome: 'incomplete' } }]);
  });

  it('JavaScriptから能力一覧を差し替えても非対応ホストへの拡張endを許可しない', async () => {
    const { irori, fromGame } = await connected();
    const capabilities = irori.capabilities;
    expect(() => irori.end([], { outcome: 'incomplete' })).toThrow(/unsupported-feature/);
    expect(Reflect.set(irori, 'capabilities', ['result-options-v1'])).toBe(false);
    expect(irori.capabilities).toBe(capabilities);
    expect(irori.capabilities).toEqual([]);
    expect(Object.isFrozen(irori.capabilities)).toBe(true);
    expect(() => irori.end([], { outcome: 'incomplete' })).toThrow(/unsupported-feature/);
    await tick();
    expect(fromGame).toEqual([]);
    irori.end();
    await tick();
    expect(fromGame).toEqual([{ m: 'end' }]);
  });

  it('対応能力だけを読み取り専用で保持し、拡張endを検証・コピーして送る', async () => {
    const { irori, fromGame } = await connected({ ...INIT, capabilities: ['result-options-v1', 'future', 'result-options-v1'] });
    expect(irori.capabilities).toEqual(['result-options-v1']);
    expect(Object.isFrozen(irori.capabilities)).toBe(true);
    const rows = [{ p: 1, score: -12, label: 'ズレ1.2秒', ranked: false }];
    const options = { display: 'record' as const, outcome: 'incomplete' as const, note: '<b>目安</b>' };
    expect(() => irori.end(rows, { ...options, html: 'x' } as never)).toThrow(/bad-results/);
    expect(() => irori.end([{ p: 1, score: 2 }], options)).toThrow(/bad-results/);
    irori.end(rows, options);
    rows[0]!.score = 999;
    options.note = 'changed';
    await tick();
    expect(fromGame).toEqual([{ m: 'end', results: [{ p: 1, score: -12, label: 'ズレ1.2秒', ranked: false }], options: { display: 'record', outcome: 'incomplete', note: '<b>目安</b>' } }]);
  });

  it('初期環境を購読前にも読め、環境変化はpause/resumeと独立して一件ずつ届く', async () => {
    const { irori, ch } = await connected({ ...INIT, capabilities: ['host-environment-v1'], environment: { connected: false, visible: false } });
    const first = irori.environment;
    expect(first).toEqual({ connected: false, visible: false });
    expect(Object.isFrozen(first)).toBe(true);
    const log: unknown[] = [];
    const off = irori.on('environment', (value) => {
      expect(value).toBe(irori.environment);
      expect(Object.isFrozen(value)).toBe(true);
      log.push(value);
    });
    irori.on('pause', () => log.push('pause'));
    irori.on('resume', () => log.push('resume'));
    for (const environment of [{ connected: true, visible: false }, { connected: false, visible: false }, { connected: true, visible: true }, { connected: true, visible: true }]) {
      ch.port1.postMessage({ m: 'environment', environment });
    }
    await tick();
    expect(log).toEqual([{ connected: true, visible: false }, { connected: false, visible: false }, { connected: true, visible: true }]);
    expect(irori.paused).toBe(true);
    expect(first).toEqual({ connected: false, visible: false });
    off();
    ch.port1.postMessage({ m: 'environment', environment: { connected: false, visible: true } });
    await tick();
    expect(log).toHaveLength(3);
    expect(irori.environment).toEqual({ connected: false, visible: true });
  });

  it('未知キーや型が不正な環境通知は捨て、旧ホストの未知通知も適用しない', async () => {
    const { irori, ch } = await connected({ ...INIT, capabilities: ['host-environment-v1'], environment: { connected: true, visible: true } });
    const seen = vi.fn();
    irori.on('environment', seen);
    for (const environment of [null, [], { connected: false }, { connected: false, visible: 1 }, { connected: false, visible: false, extra: true }]) {
      ch.port1.postMessage({ m: 'environment', environment });
    }
    ch.port1.postMessage({ m: 'environment', environment: { connected: false, visible: false }, extra: true });
    ch.port1.postMessage({ m: 'future', environment: { connected: false, visible: false } });
    await tick();
    expect(seen).not.toHaveBeenCalled();
    expect(irori.environment).toEqual({ connected: true, visible: true });
    const old = await connected();
    old.ch.port1.postMessage({ m: 'environment', environment: { connected: false, visible: false } });
    await tick();
    expect(old.irori.environment).toBeNull();
  });

  it('initの不正な能力・環境は無効にする', async () => {
    const bad = await connected({ ...INIT, capabilities: 'host-environment-v1', environment: { connected: true, visible: true } });
    expect(bad.irori.capabilities).toEqual([]);
    expect(bad.irori.environment).toBeNull();
    const broken = await connected({ ...INIT, capabilities: ['host-environment-v1'], environment: { connected: true, visible: true, extra: true } });
    expect(broken.irori.environment).toBeNull();
  });

  it('ホストからの players・input・pause・resume を届ける。menu の入力はゲームに渡さない', async () => {
    const { irori, ch } = await connected();
    const log: unknown[] = [];
    irori.on('players', (list, leader) => log.push(['players', list.length, leader]));
    const off = irori.on('input', (p, i, T) => log.push(['input', p, i, T]));
    irori.on('pause', () => log.push('pause'));
    irori.on('resume', () => log.push('resume'));
    ch.port1.postMessage({ m: 'players', players: [{ id: 2, name: 'い', online: true }], leader: 2 });
    ch.port1.postMessage({ m: 'input', p: 2, i: { k: 'btn', id: 'jump', d: 1 }, T: 123 });
    ch.port1.postMessage({ m: 'input', p: 2, i: { k: 'menu' }, T: 124 });
    ch.port1.postMessage({ m: 'pause' });
    ch.port1.postMessage({ m: 'resume' });
    ch.port1.postMessage({ m: 'resume' });
    await tick();
    off();
    ch.port1.postMessage({ m: 'input', p: 2, i: { k: 'btn', id: 'jump', d: 0 }, T: 125 });
    await tick();
    expect(log).toEqual([['players', 1, 2], ['input', 2, { k: 'btn', id: 'jump', d: 1 }, 123], 'resume']);
    expect(irori.leader).toBe(2);
  });

  it('setPad・vibrate・ready・end を、ホストの形で port に送る。宛先 all は * になる', async () => {
    const { irori, fromGame } = await connected();
    irori.setPad({ k: 'pad', stick: 'stick' });
    irori.setPad({ k: 'wait' }, 3);
    irori.vibrate(80.6, 2);
    irori.ready();
    irori.ready();
    irori.end([{ p: 1, score: 3 }]);
    irori.end();
    await tick();
    expect(fromGame).toEqual([
      { m: 'setPad', to: '*', spec: { k: 'pad', stick: 'stick' } },
      { m: 'setPad', to: 3, spec: { k: 'wait' } },
      { m: 'vibrate', to: 2, ms: [81] },
      { m: 'ready' },
      { m: 'end', results: [{ p: 1, score: 3 }] },
    ]);
  });

  it('保存は id で答えを待ち、エラーは IroriError に、答えがなければ時間切れにする', async () => {
    const { irori, ch, fromGame } = await connected();
    const got = irori.storage.get('best');
    const set = irori.storage.set('best', '9').then(
      () => 'resolved',
      (e: unknown) => e,
    );
    await tick();
    const [g, s] = fromGame as { id: number }[];
    expect(fromGame).toEqual([
      { m: 'store.get', id: g?.id, key: 'best' },
      { m: 'store.set', id: s?.id, key: 'best', value: '9' },
    ]);
    ch.port1.postMessage({ m: 'store.res', id: s?.id, value: null, error: 'quota' });
    ch.port1.postMessage({ m: 'store.res', id: g?.id, value: '7' });
    expect(await got).toBe('7');
    expect(await set).toMatchObject({ code: 'storage-quota' });
    vi.useFakeTimers();
    const lost = irori.storage.get('x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
    expect(await lost).toMatchObject({ code: 'storage-timeout' });
  });
});
