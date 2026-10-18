// 公開APIの型。手書きの irori.d.ts と同じ形にする（tests/types が tsc で突き合わせる）。
import type { GameEndOptions, GamePadSpec, GameResult, HostCapability, HostEnvironment, InputEvent, PlayerId, PlayerInfo } from '@irori/protocol';
import type { Look } from '@irori/pad-ui';

/** ゲームに届く入力。メニューの依頼（menu）はコンソールが受け取り、ゲームには届かない。 */
export type GameInput = Exclude<InputEvent, { k: 'menu' }>;

/** 席番号か、全員（'all'）。 */
export type Target = PlayerId | 'all';

export interface IroriEvents {
  players: (players: readonly PlayerInfo[], leader: PlayerId | null) => void;
  input: (p: PlayerId, input: GameInput, T: number) => void;
  pause: () => void;
  resume: () => void;
  environment: (value: Readonly<HostEnvironment>) => void;
}

export interface IroriStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Irori {
  /** host＝コンソールの中、mock＝単体で開いた（仮想プレイヤー）。 */
  readonly mode: 'host' | 'mock';
  readonly players: readonly PlayerInfo[];
  readonly leader: PlayerId | null;
  readonly paused: boolean;
  readonly locale: string;
  readonly capabilities: readonly HostCapability[];
  readonly environment: Readonly<HostEnvironment> | null;
  on<K extends keyof IroriEvents>(name: K, fn: IroriEvents[K]): () => void;
  setPad(spec: GamePadSpec, to?: Target): void;
  vibrate(ms: number | readonly number[], to?: Target): void;
  look(id: PlayerId): Look;
  ready(): void;
  end(results?: readonly GameResult[], options?: GameEndOptions): void;
  readonly storage: IroriStorage;
}

export interface ConnectOptions {
  /** 握手を待つ時間（ミリ秒）。既定 3000。 */
  timeoutMs?: number;
  /** 単体で開いたときの仮想プレイヤーの人数（1〜8）。URL の ?mock=N が優先。既定 2。 */
  mockPlayers?: number;
}
