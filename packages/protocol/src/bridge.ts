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
  /** false は記録だけを残し、順位・優勝の対象にしない。省略時は true。 */
  ranked?: boolean;
}

export interface GameEndOptions {
  display?: 'points' | 'record';
  outcome?: 'complete' | 'incomplete';
  note?: string;
}

export interface HostEnvironment { connected: boolean; visible: boolean }
export type HostCapability = 'result-options-v1' | 'host-environment-v1' | 'pad-tiles-v1' | 'cue-v1';

/**
 * ゲームが頼める効果音の名前（`cue-v1`）。音そのものはコンソールが自前で合成して鳴らす。
 * ゲームは音のファイルも音の部品も持たない。名前を足すときは、コンソールの合成と試験も足す。
 */
export const CUES = [
  'tick', 'confirm', 'deny', 'turn', 'win', 'lose', 'count', 'go',
  'deal', 'flip', 'place', 'sweep', 'revolution',
  'roll', 'pins', 'strike', 'spare', 'gutter',
  'night', 'dawn', 'vote', 'execute', 'reveal',
] as const;
export type CueName = (typeof CUES)[number];

/** ゲーム → ホスト（MessagePort 上） */
export type GameToHost =
  | { m: 'ready' }
  | { m: 'setPad'; to: PlayerId | '*'; spec: GamePadSpec }
  | { m: 'vibrate'; to: PlayerId | '*'; ms: number[] }
  /** 効果音の依頼。`v` は強さ（0〜1、省略時は0.7）。能力 `cue-v1` が要る。 */
  | { m: 'cue'; name: CueName; v?: number }
  | { m: 'end'; results?: GameResult[]; options?: GameEndOptions }
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
      capabilities?: HostCapability[];
      environment?: HostEnvironment;
    }
  | { m: 'players'; players: PlayerInfo[]; leader: PlayerId | null }
  | { m: 'input'; p: PlayerId; i: InputEvent; T: number }
  | { m: 'pause' }
  | { m: 'resume' }
  | { m: 'environment'; environment: HostEnvironment }
  | { m: 'store.res'; id: number; value: string | null; error?: string };

/** ゲームごとの保存量の上限。ホストの localStorage を使うので小さく切る。 */
export const STORAGE_LIMITS = {
  KEY_MAX_LENGTH: 64,
  VALUE_MAX_BYTES: 16_384,
  TOTAL_MAX_BYTES: 65_536,
} as const;
