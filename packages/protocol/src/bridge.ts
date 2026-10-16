// ゲーム（iframeの中）とホストの画面（コンソール）の間の取り決め。意味と理由は docs/sdk.md。
// 握手だけ window.postMessage、その後は受け取った MessagePort の上で話す。

import type { GamePadSpec, InputEvent, PlayerId, PlayerInfo } from './types';

export const BRIDGE_VERSION = 1 as const;

/** ゲーム → 親（コンソール）。最初の1通。親は event.source が自分の iframe か確かめる。 */
export interface BridgeHello {
  irori: 'hello';
  v: typeof BRIDGE_VERSION;
}

/** 親 → ゲーム。ports[0] に MessagePort を載せて返す。 */
export interface BridgePort {
  irori: 'port';
  v: typeof BRIDGE_VERSION;
}

export interface GameResult {
  p: PlayerId;
  score: number;
  /** 順位の横に出す短い文字（例: 「3.2秒」）。 */
  label?: string;
}

/** ゲーム → ホスト（MessagePort 上） */
export type GameToHost =
  | { m: 'ready' }
  | { m: 'setPad'; to: PlayerId | '*'; spec: GamePadSpec }
  | { m: 'vibrate'; to: PlayerId | '*'; ms: number[] }
  | { m: 'end'; results?: GameResult[] }
  | { m: 'store.get'; id: number; key: string }
  | { m: 'store.set'; id: number; key: string; value: string };

/** ホスト → ゲーム（MessagePort 上） */
export type HostToGame =
  | {
      m: 'init';
      sdk: typeof BRIDGE_VERSION;
      players: PlayerInfo[];
      leader: PlayerId | null;
      locale: string;
      paused: boolean;
    }
  | { m: 'players'; players: PlayerInfo[]; leader: PlayerId | null }
  | { m: 'input'; p: PlayerId; i: InputEvent; T: number }
  | { m: 'pause' }
  | { m: 'resume' }
  | { m: 'store.res'; id: number; value: string | null; error?: string };

/** ゲームごとの保存量の上限。ホストの localStorage を使うので小さく切る。 */
export const STORAGE_LIMITS = {
  KEY_MAX_LENGTH: 64,
  VALUE_MAX_BYTES: 16_384,
  TOTAL_MAX_BYTES: 65_536,
} as const;
