// 試験から window.H（ホストの土台）と、仮想プレイヤーのゲームが置く値を型で扱えるようにする。
interface HostApi {
  start(o: {
    id: string;
    entry: unknown;
    consoleOrigin?: string;
    allowLocalhost?: boolean;
    init?: unknown;
    handshakeTimeoutMs?: number;
    readyTimeoutMs?: number;
    maxMessagesPerSec?: number;
  }): { ok: boolean; reason?: string; source?: { kind: string; sandbox: string; allow: string; origin: string; host: string | null } };
  post(id: string, msg: unknown): void;
  events(id: string): { name: string; at: number; detail: unknown }[];
  names(id: string): string[];
  state(id: string): string | null;
  dropped(id: string): number;
  destroy(id: string): void;
  frameConnected(id: string): boolean;
  sandboxAttr(id: string): string | null;
  evilReports(): { origin: string; report: Record<string, { escaped: boolean | string; note: string }> }[];
  gameMsgs(): Record<string, unknown>[];
  addRogue(url: string): void;
  resolveEntry(entry: unknown, origin: string, opts?: { allowLocalhost?: boolean }): { ok: boolean; reason?: string };
  consoleOrigin(): string;
}

interface Window {
  H: HostApi;
  __ready?: boolean;
  __mode?: string;
  __players?: number;
  __inputs?: [number, Record<string, unknown>][];
}
