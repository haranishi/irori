// irori SDK の型（手で書いた公開API）。使い方は docs/sdk.md、画面の種類は docs/pad.md。
// ゲームのフォルダに irori.js と一緒に写して使う（tools/sync-sdk.mjs）。
// packages/sdk/src の実装と同じ形であることを、packages/sdk/tests/types が tsc で確かめる。

export type PlayerId = number;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** 接続が切れても猶予の間は席が残る。その間は false。 */
  online: boolean;
}

/**
 * ゲームに届く入力。座標は画面の向き（右と下が正）。
 * - btn：押した瞬間に d:1、離すと d:0。画面の差し替えのときも d:0 が補われる。早押しの id は 'buzzer'。
 * - axis：十字は id 'dpad'（x・y は -1・0・1）、スティックは id 'stick'（-1〜1、不感帯0.1）。離すと 0,0。
 * - ptr：なぞる面（id 'touch'）。x・y は面の内側の0〜1、ph は s（始まり）・m（途中）・e（終わり）。
 * - pick：選択肢の id。
 * - tilt：傾き（度）。a は0〜360、b は-180〜180、g は-90〜90。
 */
export type GameInput =
  | { k: 'btn'; id: string; d: 0 | 1 }
  | { k: 'axis'; id: string; x: number; y: number }
  | { k: 'ptr'; id: string; x: number; y: number; ph: 's' | 'm' | 'e' }
  | { k: 'pick'; id: string }
  | { k: 'tiles'; ids: string[]; pass?: true; t?: string }
  | { k: 'tilt'; a: number; b: number; g: number };

/** 色は名前だけ。任意のCSSは流し込めない。 */
export type ColorName = 'red' | 'blue' | 'green' | 'yellow' | 'gray';

/** id は英小文字・数字・_- の24文字まで。label は12文字まで。 */
export interface ButtonSpec {
  id: string;
  label: string;
  color?: ColorName;
}

export interface ChoiceSpec {
  id: string;
  label: string;
  color?: ColorName;
}

/**
 * スマホに出すコントローラーの画面（定型7種）。ヒント40・見出し24・本文120文字まで（書記素で数える）。
 * pad の stick は省略すると十字（'dpad'）。ボタンは4つまで、選択肢は2〜6個。
 */
export interface TileSpec {
  id: string;
  label: string;
  sub?: string;
  color?: ColorName;
  off?: boolean;
}

export type PadSpec =
  | { k: 'wait'; title?: string; body?: string }
  | {
      k: 'pad';
      stick?: 'none' | 'dpad' | 'stick';
      buttons?: ButtonSpec[];
      hint?: string;
      orient?: 'any' | 'landscape' | 'portrait';
    }
  | { k: 'buzzer'; label: string; color?: ColorName; disabled?: boolean; hint?: string }
  | { k: 'choices'; options: ChoiceSpec[]; disabled?: boolean; hint?: string }
  | { k: 'tiles'; token?: string; tiles: TileSpec[]; ok: string; pass?: string; min?: number; max?: number; note?: string; hint?: string; disabled?: boolean }
  | { k: 'touch'; mode?: 'area' | 'swipe'; hint?: string }
  | { k: 'tilt'; buttons?: ButtonSpec[]; hint?: string };

export interface GameResult {
  p: PlayerId;
  score: number;
  /** 順位の横に出す短い文字（例: 「3.2秒」）。12文字まで。 */
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

export type CueName = 'tick' | 'confirm' | 'deny' | 'turn' | 'win' | 'lose' | 'count' | 'go'
  | 'deal' | 'flip' | 'place' | 'sweep' | 'revolution' | 'roll' | 'pins' | 'strike' | 'spare' | 'gutter'
  | 'night' | 'dawn' | 'vote' | 'execute' | 'reveal';

export type ShapeName = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross' | 'hexagon' | 'ring';

/** 席の色と形。色だけで区別しないよう、必ず両方を描く。 */
export interface Look {
  /** #RRGGBB */
  color: string;
  shape: ShapeName;
  /** 読み上げや凡例に使う名前（例「橙の丸」）。 */
  label: string;
  /** 24×24 の枠に収まる形の SVG パス。canvas では `ctx.fill(new Path2D(path))` で塗れる。 */
  path: string;
}

/** 席番号か、全員（'all'）。 */
export type Target = PlayerId | 'all';

export interface IroriEvents {
  players: (players: readonly PlayerInfo[], leader: PlayerId | null) => void;
  /** T はサーバーが受け取った時刻（ミリ秒）。早押しの順番はこれで見る。 */
  input: (p: PlayerId, input: GameInput, T: number) => void;
  /** コンソールのメニューが前面に出た。タイマーとアニメーションを止める。 */
  pause: () => void;
  resume: () => void;
  /** 接続・表示の変化。一時停止・再開の通知とは独立して届く。 */
  environment: (value: Readonly<HostEnvironment>) => void;
}

/** ゲーム専用の小さな保存。鍵は64文字まで、値は1つ16KB、合計64KBまで。 */
export interface IroriStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Irori {
  /** host＝コンソールの中、mock＝単体で開いた（開発用の仮想プレイヤー）。 */
  readonly mode: 'host' | 'mock';
  readonly players: readonly PlayerInfo[];
  readonly leader: PlayerId | null;
  readonly paused: boolean;
  /** コンソールの言語（例 'ja'）。 */
  readonly locale: string;
  readonly capabilities: readonly HostCapability[];
  readonly environment: Readonly<HostEnvironment> | null;
  /** 購読する。戻り値の関数で解除する。 */
  on<K extends keyof IroriEvents>(name: K, fn: IroriEvents[K]): () => void;
  /** 形が上限に合わなければ IroriError('bad-pad') を投げる（ホストでも同じ検査で捨てられる）。 */
  setPad(spec: PadSpec, to?: Target): void;
  /** 振動のパターン（ミリ秒、1〜8個、各0〜1000）。iOS では鳴らない。 */
  vibrate(ms: number | readonly number[], to?: Target): void;
  /** コンソールの合成音。cue-v1 が無ければ無視。強さ0〜1、既定0.7。 */
  cue(name: CueName, v?: number): void;
  look(id: PlayerId): Look;
  /** 最初の画面が出せたら呼ぶ。10秒以内に呼ばないと、コンソールが中断を勧める。 */
  ready(): void;
  /** 終わりを知らせる。結果画面と「もう一度」はコンソールが出す。results は8件まで。 */
  end(results?: readonly GameResult[], options?: GameEndOptions): void;
  readonly storage: IroriStorage;
}

export interface ConnectOptions {
  /** 握手を待つ時間（ミリ秒）。既定 3000。 */
  timeoutMs?: number;
  /** 単体で開いたときの仮想プレイヤーの人数（1〜8）。URL の ?mock=N が優先。既定 2。 */
  mockPlayers?: number;
}

export type IroriErrorCode =
  | 'handshake-timeout'
  | 'bad-pad'
  | 'bad-target'
  | 'bad-vibrate'
  | 'bad-results'
  | 'unsupported-feature'
  | 'storage-key'
  | 'storage-too-large'
  | 'storage-quota'
  | 'storage-unavailable'
  | 'storage-timeout';

export declare class IroriError extends Error {
  readonly code: IroriErrorCode;
  constructor(code: IroriErrorCode, message?: string);
}

/**
 * 枠の中ならコンソールと握手し、単体で開いたなら仮想プレイヤーになる（?mock=N で人数）。
 * 握手が timeoutMs 以内に終わらなければ IroriError('handshake-timeout') で失敗する。何度呼んでも同じものを返す。
 */
export declare function connect(options?: ConnectOptions): Promise<Irori>;
