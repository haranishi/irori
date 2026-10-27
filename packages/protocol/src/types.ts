// 通信の型の正本。意味と理由は docs/protocol.md と docs/pad.md にある。
// フレームはすべて JSON のテキスト。`t` が種類、短い名前にして帯域と課金を抑える。

export const PROTOCOL_VERSION = 1 as const;

/** 席番号（1〜LIMITS.MAX_PLAYERS）。色と形は席番号から画面側が決める。 */
export type PlayerId = number;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** 接続が切れても猶予の間は席が残る。その間は false。 */
  online: boolean;
}

/** スマホからホストへ届く入力。受け取る側は必ず検証を通す。 */
export type InputEvent =
  | { k: 'btn'; id: string; d: 0 | 1 }
  | { k: 'axis'; id: string; x: number; y: number }
  | { k: 'ptr'; id: string; x: number; y: number; ph: 's' | 'm' | 'e' }
  | { k: 'pick'; id: string }
  /** `tiles` の「決定」か「パス」を押したときに1回だけ届く。`pass` が真なら `ids` は空。 */
  | { k: 'tiles'; ids: string[]; pass?: true }
  | { k: 'tilt'; a: number; b: number; g: number }
  | { k: 'menu' };

/** 色は名前だけ許す。任意のCSSをゲームから流し込ませないため。 */
export type ColorName = 'red' | 'blue' | 'green' | 'yellow' | 'gray';

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

/** `tiles` の1枚。手札の1枚や、投票先の1人。`off` は「いまは選べない」で、薄く出す。 */
export interface TileSpec {
  id: string;
  label: string;
  /** 小さな補助文字（例「×2」「生存」）。 */
  sub?: string;
  color?: ColorName;
  off?: boolean;
}

/** ゲームが指定できるコントローラー画面。種類は固定で、自由なHTMLは持ち込めない。 */
export type GamePadSpec =
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
  /**
   * 札や人を並べ、`min`〜`max` 個を選んで「決定」する（手札の提出・投票）。能力 `pad-tiles-v1` が要る。
   * `min` の既定は1、`max` の既定は1（選べる札が無ければ0）。札が空なら「文と決定ボタンだけ」の画面になる。
   * `disabled` は見るだけ（決定とパスは出さない）。
   */
  | {
      k: 'tiles';
      tiles: TileSpec[];
      ok: string;
      pass?: string;
      min?: number;
      max?: number;
      note?: string;
      hint?: string;
      disabled?: boolean;
    }
  | { k: 'touch'; mode?: 'area' | 'swipe'; hint?: string }
  | { k: 'tilt'; buttons?: ButtonSpec[]; hint?: string };

/** `remote` はホストの画面（コンソール）だけが使う。ゲームからは指定できない。 */
export type PadSpec = GamePadSpec | { k: 'remote'; hint?: string };

export type ErrorCode =
  | 'bad-frame'
  | 'too-large'
  | 'rate'
  | 'no-room'
  | 'full'
  | 'locked'
  | 'auth'
  | 'kicked'
  | 'replaced'
  | 'closed'
  | 'timeout'
  | 'version';

/** WebSocket を閉じるときのコード。4000番台はアプリ独自に使える範囲。 */
export const CLOSE_CODES: Readonly<Record<ErrorCode, number>> = {
  'bad-frame': 4001,
  'too-large': 4002,
  rate: 4003,
  'no-room': 4004,
  full: 4005,
  locked: 4006,
  auth: 4007,
  kicked: 4008,
  replaced: 4009,
  closed: 4010,
  timeout: 4011,
  version: 4012,
};

// ---- フレーム ----

/** ホスト → サーバー */
export type HostFrame =
  | { t: 'hello'; v: typeof PROTOCOL_VERSION; role: 'host'; key: string }
  | { t: 'pad'; to: PlayerId | '*'; spec: PadSpec }
  | { t: 'fx'; to: PlayerId | '*'; ms: number[] }
  | { t: 'kick'; p: PlayerId }
  | { t: 'lock'; on: boolean }
  | { t: 'close' };

/** スマホ → サーバー */
export type PadFrame =
  | { t: 'hello'; v: typeof PROTOCOL_VERSION; role: 'pad'; name?: string; resume?: string }
  | { t: 'in'; i: InputEvent }
  | { t: 'bye' };

/** サーバー → ホスト */
export type ToHostFrame =
  | { t: 'welcome'; role: 'host'; code: string; players: PlayerInfo[]; max: number; locked: boolean }
  | { t: 'joined'; p: PlayerInfo }
  | { t: 'left'; p: PlayerId; why: 'bye' | 'timeout' | 'kick' }
  | { t: 'online'; p: PlayerId; on: boolean }
  /** T はサーバーが受け取った時刻（ミリ秒）。早押しの順番に使える。 */
  | { t: 'in'; p: PlayerId; i: InputEvent; T: number }
  /** 再接続したスマホに、いまの画面をもう一度送ってほしいという依頼。 */
  | { t: 'pad?'; p: PlayerId }
  | { t: 'err'; code: ErrorCode };

/** サーバー → スマホ */
export type ToPadFrame =
  | { t: 'welcome'; role: 'pad'; you: PlayerInfo; resume: string; host: boolean }
  | { t: 'pad'; spec: PadSpec }
  | { t: 'fx'; ms: number[] }
  | { t: 'host'; on: boolean }
  | { t: 'kicked' }
  | { t: 'closed' }
  | { t: 'err'; code: ErrorCode };

// ---- HTTP ----

/** POST /api/rooms の応答。key はホストだけが持つ。サーバーにはハッシュだけを残す。 */
export interface CreateRoomResponse {
  code: string;
  key: string;
  /** 部屋を作ってからホストが接続するまでの猶予（秒）。 */
  ttl: number;
}

/** GET /api/rooms/:code の応答。部屋の中身は返さない。 */
export interface RoomStatus {
  exists: boolean;
  locked: boolean;
  players: number;
  max: number;
}

/** 日次の上限などで受け付けられないとき（HTTP 503）。 */
export interface BusyResponse {
  error: 'busy';
  retryAfterSec: number;
}
