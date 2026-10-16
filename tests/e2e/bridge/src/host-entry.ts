// ホストの画面の代わり（試験の土台）。本物の host-bridge を使って枠を作り、イベントを集め、Playwright から
// window.H 経由で操作する。モックにしないため、ここは esbuild で host-bridge の実ソースごと1つに束ねて配る。
import {
  createGameStorage,
  GameFrame,
  parseDevParam,
  resolveEntry,
  validateGameToHost,
  validateManifestEntry,
} from '@irori/host-bridge';
import type { GameFrameInit, HostMessage } from '@irori/host-bridge';

type Rec = { name: string; at: number; detail: unknown };
interface Entry {
  frame: GameFrame;
  events: Rec[];
}

const frames = new Map<string, Entry>();
const evilReports: { origin: string; report: unknown }[] = [];
const gameMsgs: Record<string, unknown>[] = [];

window.addEventListener('message', (e) => {
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return;
  if (d.__evil_report__) evilReports.push({ origin: e.origin, report: d.__evil_report__ });
  else if (d.__game__) gameMsgs.push({ origin: e.origin, ...d });
});

export interface StartOptions {
  id: string;
  entry: unknown;
  consoleOrigin?: string;
  allowLocalhost?: boolean;
  init?: GameFrameInit;
  handshakeTimeoutMs?: number;
  readyTimeoutMs?: number;
  maxMessagesPerSec?: number;
}

const DEFAULT_INIT: GameFrameInit = {
  players: [{ id: 1, name: 'あ', online: true }],
  leader: 1,
  locale: 'ja',
  paused: false,
};

const H = {
  resolveEntry,
  parseDevParam,
  validateGameToHost,
  validateManifestEntry,
  consoleOrigin: () => location.origin,

  start(opts: StartOptions): { ok: boolean; reason?: string; source?: unknown } {
    const r = resolveEntry(opts.entry, opts.consoleOrigin ?? location.origin, { allowLocalhost: opts.allowLocalhost === true });
    if (!r.ok) return { ok: false, reason: r.reason };
    const container = document.createElement('div');
    container.id = `frame-${opts.id}`;
    document.body.append(container);
    const events: Rec[] = [];
    const frame = new GameFrame({
      container,
      source: r.frame,
      init: opts.init ?? DEFAULT_INIT,
      storage: createGameStorage(`e2e-${opts.id}`, window.localStorage),
      ...(opts.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: opts.handshakeTimeoutMs }),
      ...(opts.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: opts.readyTimeoutMs }),
      ...(opts.maxMessagesPerSec === undefined ? {} : { maxMessagesPerSec: opts.maxMessagesPerSec }),
    });
    for (const name of ['ready', 'setPad', 'vibrate', 'end', 'store', 'timeout', 'error'] as const) {
      frame.on(name, (detail?: unknown) => events.push({ name, at: performance.now(), detail: detail ?? null }));
    }
    frame.start();
    frames.set(opts.id, { frame, events });
    return { ok: true, source: r.frame };
  },

  post(id: string, msg: HostMessage): void {
    frames.get(id)?.frame.post(msg);
  },
  events(id: string): Rec[] {
    return frames.get(id)?.events ?? [];
  },
  names(id: string): string[] {
    return (frames.get(id)?.events ?? []).map((e) => e.name);
  },
  state(id: string): string | null {
    return frames.get(id)?.frame.state ?? null;
  },
  dropped(id: string): number {
    return frames.get(id)?.frame.dropped ?? -1;
  },
  destroy(id: string): void {
    frames.get(id)?.frame.destroy();
  },
  frameConnected(id: string): boolean {
    return document.querySelector(`#frame-${id} iframe`) !== null;
  },
  /** 枠の実際の sandbox 属性（撤去や allow-same-origin の付与を、DOM 側で確かめるため）。 */
  sandboxAttr(id: string): string | null {
    return document.querySelector(`#frame-${id} iframe`)?.getAttribute('sandbox') ?? null;
  },

  evilReports: () => evilReports,
  gameMsgs: () => gameMsgs,
  // なりすましの枠。同梱の枠（オリジンが空）と同じく allow-same-origin なしの sandbox にして、
  // オリジンを 'null' にそろえる。こうすると、握手の判別は event.source だけが頼りになる。
  addRogue(url: string): void {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.src = url;
    f.id = 'rogue';
    document.body.append(f);
  },
};

(window as unknown as { H: typeof H }).H = H;
(window as unknown as { __ready: boolean }).__ready = true;
