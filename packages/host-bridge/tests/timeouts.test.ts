// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"enableIframePageLoading":true}}
import { CUES } from '@irori/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_HANDSHAKE_TIMEOUT_MS, GameFrame, HANDSHAKE_TIMEOUT_MS, handshakeTimeoutFor } from '../src/index';
import type { GameFrameEvents, GameFrameInit, HostMessage } from '../src/index';
import { connectHost } from '../../sdk/src/host';
import type { HostWindow } from '../../sdk/src/host';

const frames: GameFrame[] = [];
const ports: MessagePort[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
afterEach(() => {
  for (const f of frames.splice(0)) f.destroy();
  for (const p of ports.splice(0)) p.close();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function frame(init: Partial<GameFrameInit> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const f = new GameFrame({ container, source: {
    kind: 'bundled', src: 'about:blank', sandbox: 'allow-scripts', allow: 'autoplay',
    referrerPolicy: 'no-referrer', loading: 'eager', origin: 'null', host: null,
  }, init: { players: [{ id: 1, name: 'あ', online: true }], leader: 1, locale: 'ja', ...init } });
  frames.push(f);
  f.start();
  const child = f.element!.contentWindow!;
  const listeners = new Set<(e: MessageEvent) => void>();
  const parent = { postMessage: (data: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: child }));
  } };
  vi.spyOn(child, 'postMessage').mockImplementation(((data: unknown, _origin: unknown, transfer?: Transferable[]) => {
    const received = (transfer ?? []) as MessagePort[];
    ports.push(...received);
    for (const fn of [...listeners]) fn({ data, source: parent, ports: received } as unknown as MessageEvent);
  }) as Window['postMessage']);
  const win = { parent,
    addEventListener: (_name: string, fn: (e: MessageEvent) => void) => void listeners.add(fn),
    removeEventListener: (_name: string, fn: (e: MessageEvent) => void) => void listeners.delete(fn),
  } as unknown as HostWindow;
  return { f, connect: () => connectHost(win, 3000) };
}

describe('GameFrameと実SDKの追加契約', () => {
  it('両capabilityを広告し、握手前のplayers/pause/environmentは最新initに保持する', async () => {
    const { f, connect } = frame({ environment: { connected: true, visible: true } });
    f.post({ m: 'players', players: [{ id: 2, name: 'い', online: true }], leader: 2 });
    f.post({ m: 'pause' });
    f.post({ m: 'environment', environment: { connected: false, visible: true } });
    f.post({ m: 'environment', environment: { connected: false, visible: false } });
    f.post({ m: 'environment', environment: { connected: true, visible: 'broken' } } as never);
    const irori = await connect();
    expect(irori.capabilities).toEqual(['result-options-v1', 'host-environment-v1', 'pad-tiles-v1', 'cue-v1']);
    expect(irori.environment).toEqual({ connected: false, visible: false });
    expect(irori.players.map((p) => p.id)).toEqual([2]);
    expect(irori.leader).toBe(2);
    expect(irori.paused).toBe(true);
  });

  it('有効な環境変化を順に渡し、未知キーを捨てる。pause/resumeを合成しない', async () => {
    const { f, connect } = frame({ environment: { connected: true, visible: true } });
    const irori = await connect();
    const log: unknown[] = [];
    irori.on('environment', (env) => log.push(env));
    irori.on('pause', () => log.push('pause'));
    irori.on('resume', () => log.push('resume'));
    f.post({ m: 'environment', environment: { connected: false, visible: true } });
    f.post({ m: 'environment', environment: { connected: true, visible: true } });
    f.post({ m: 'environment', environment: { connected: false, visible: false, unknown: true } } as never);
    await tick();
    expect(log).toEqual([{ connected: false, visible: true }, { connected: true, visible: true }]);
    expect(irori.paused).toBe(false);
  });

  it('ranked/optionsをendイベントまで保持し、旧endイベントにはoptionsキーを増やさない', async () => {
    for (const extended of [false, true]) {
      const { f, connect } = frame();
      const ends: Parameters<GameFrameEvents['end']>[0][] = [];
      f.on('end', (e) => ends.push(e));
      const irori = await connect();
      const rows = [{ p: 1, score: -3, label: 'ズレ0.3秒', ...(extended ? { ranked: false } : {}) }];
      const options = { display: 'record' as const, outcome: 'incomplete' as const, note: '通信の遅れを含む目安です' };
      irori.end(rows, extended ? options : undefined);
      await tick();
      expect(ends).toEqual([extended ? { results: rows, options } : { results: rows }]);
      expect(f.state).toBe('ended');
      f.post({ m: 'resume' } satisfies HostMessage);
    }
  });
});

describe('握手の既定の待ち時間', () => {
  it('同梱は同じ配信元から読むので短く、外部は遠いサーバーを見込んで登録の検査と同じ10秒まで待つ', () => {
    expect(handshakeTimeoutFor('bundled')).toBe(HANDSHAKE_TIMEOUT_MS);
    expect(handshakeTimeoutFor('external')).toBe(EXTERNAL_HANDSHAKE_TIMEOUT_MS);
    expect(EXTERNAL_HANDSHAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(HANDSHAKE_TIMEOUT_MS).toBeLessThan(EXTERNAL_HANDSHAKE_TIMEOUT_MS);
  });
});


it('実SDKのcueが橋へ届き、終了後は捨てる', async () => {
  const { f, connect } = frame();
  const heard: unknown[] = [];
  f.on('cue', (cue) => heard.push(cue));
  const irori = await connect();
  irori.cue('pins', 0.4);
  await tick();
  expect(heard).toEqual([{ name: 'pins', v: 0.4 }]);
  irori.end();
  irori.cue('confirm');
  await tick();
  expect(heard).toHaveLength(1);
});

it('SDKを通さないcueも検証し、過剰頻度は違反に数えず捨てる', async () => {
  const { f, connect } = frame();
  await connect();
  const port = ports.at(-1)!;
  const heard: unknown[] = [];
  f.on('cue', (cue) => heard.push(cue));
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  port.postMessage({ m: 'cue', name: 'bad' });
  port.postMessage({ m: 'cue', name: 'tick', v: 2 });
  port.postMessage({ m: 'cue', name: 'tick', extra: 1 });
  await tick();
  expect(f.dropped).toBe(3);
  port.postMessage({ m: 'cue', name: 'tick' });
  await tick();
  expect(heard).toEqual([{ name: 'tick', v: 0.7 }]);
  for (let i = 0; i < 150; i++) port.postMessage({ m: 'cue', name: 'tick' });
  await tick();
  expect(f.state).toBe('connected');
  expect(f.dropped).toBe(3);
  expect(heard).toHaveLength(1);
  now = 49; port.postMessage({ m: 'cue', name: 'tick' }); await tick();
  expect(heard).toHaveLength(1);
  now = 50; port.postMessage({ m: 'cue', name: 'tick' }); await tick();
  expect(heard).toHaveLength(2);
});


it('橋のcueも移動する1秒窓で20件を上限にする', async () => {
  const { f, connect } = frame(); await connect();
  const port = ports.at(-1)!;
  const heard: unknown[] = [];
  f.on('cue', (cue) => heard.push(cue));
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  CUES.forEach((name) => port.postMessage({ m: 'cue', name })); await tick();
  expect(heard).toHaveLength(20);
  now = 999; port.postMessage({ m: 'cue', name: 'reveal' }); await tick();
  expect(heard).toHaveLength(20);
  now = 1000; port.postMessage({ m: 'cue', name: 'reveal' }); await tick();
  expect(heard).toHaveLength(21); expect(f.dropped).toBe(0);
});
