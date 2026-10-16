// 部屋の状態機械の入出力。RoomCore はネットワークも時計も持たず、イベントを受けて「やること」の一覧を返す。

import { LIMITS, type ToHostFrame, type ToPadFrame } from '@irori/protocol';

/** 接続の名前。Durable Object が接続ごとに付け、付属情報に保存する。 */
export type ConnId = string;
export type Role = 'pending' | 'host' | 'pad';

export type RoomEvent =
  /** 接続を受けた。hello が来るまで役割はない。 */
  | { type: 'open'; conn: ConnId; now: number }
  /** テキストを受けた。bytes は UTF-8 のバイト数。binary はバイナリを受けたとき（形式の違反）。 */
  | { type: 'frame'; conn: ConnId; raw: string; bytes: number; now: number; binary?: boolean }
  /** 相手が閉じた、または切れた。 */
  | { type: 'close'; conn: ConnId; now: number }
  /** 目覚まし（alarm）が鳴った。 */
  | { type: 'tick'; now: number };

export type Effect =
  | { type: 'send'; conn: ConnId; frame: ToHostFrame | ToPadFrame }
  | { type: 'close'; conn: ConnId; code: number; reason: string }
  /** 保存の書き込み。これが出たときだけ書く。 */
  | { type: 'persist'; state: RoomState }
  /** 次に起こす時刻。null なら目覚ましを消す。 */
  | { type: 'alarm'; at: number | null }
  /** 部屋を消す（保存も目覚ましも消す）。 */
  | { type: 'destroy' };

export interface SeatState {
  id: number;
  name: string;
  /** 再開の札のハッシュ。札そのものは持たない。 */
  resumeHash: string;
  online: boolean;
  /** 切れた時刻。猶予はここから数える。 */
  offAt: number | null;
}

/** 保存する最小の状態。入力は保存しない。 */
export interface RoomState {
  v: 1;
  code: string;
  keyHash: string;
  createdAt: number;
  lastActivity: number;
  locked: boolean;
  /** ホストが一度でもつながったか（作成後の猶予と、不在の猶予を分けるため）。 */
  hostSeen: boolean;
  /** ホストが切れた時刻。休止をはさんでも90秒を数えられるように保存する。 */
  hostOffAt: number | null;
  seats: SeatState[];
}

/** 接続ごとの付属情報（serializeAttachment）。休止から起きたとき、名簿をここから組み直す。 */
export interface ConnAttachment {
  role: Role;
  seat: number | null;
  openedAt: number;
  /**
   * この接続の最後の操作の時刻（5秒刻みに切り下げ）。保存した最終操作は1分に1回しか書かないので、
   * 復元のときにこちらと照らし合わせ、休止をはさんで無操作の20分が早く切れないようにする。
   */
  seen?: number;
}

export interface SocketSnapshot {
  conn: ConnId;
  att: ConnAttachment | null;
}

export interface Rate {
  perSec: number;
  burst: number;
}

export interface RoomLimits {
  MAX_PLAYERS: number;
  HELLO_TIMEOUT_MS: number;
  PAD_GRACE_MS: number;
  HOST_GRACE_MS: number;
  ROOM_IDLE_MS: number;
  ROOM_MAX_MS: number;
  CREATE_TTL_S: number;
  FRAME_MAX_BYTES: { pad: number; host: number };
  RATE: { pad: Rate; host: Rate };
  VIOLATIONS_BEFORE_CLOSE: number;
  /** hello 前の接続の同時の数。超えた新しい接続はすぐ閉じる（4003）。 */
  MAX_PENDING: number;
  /** 新しい席の1分あたりの数（札での入り直しは数えない）。超えた入室は 4003 で断る。 */
  NEW_SEATS_PER_MINUTE: number;
  /** ロックの切り替えの1分あたりの数。超えた分は無視して違反に数える。 */
  LOCKS_PER_MINUTE: number;
  /** 違反を数える窓。 */
  VIOLATION_WINDOW_MS: number;
  /** 最終操作の時刻は、この間隔より細かく保存しない（入力のたびに書き込まないため）。 */
  ACTIVITY_PERSIST_MS: number;
  HOST_KEY_BYTES: number;
  RESUME_TOKEN_BYTES: number;
}

export const ROOM_LIMITS: RoomLimits = {
  MAX_PLAYERS: LIMITS.MAX_PLAYERS,
  HELLO_TIMEOUT_MS: LIMITS.HELLO_TIMEOUT_MS,
  PAD_GRACE_MS: LIMITS.PAD_GRACE_MS,
  HOST_GRACE_MS: LIMITS.HOST_GRACE_MS,
  ROOM_IDLE_MS: LIMITS.ROOM_IDLE_MS,
  ROOM_MAX_MS: LIMITS.ROOM_MAX_MS,
  CREATE_TTL_S: LIMITS.CREATE_TTL_S,
  FRAME_MAX_BYTES: { ...LIMITS.FRAME_MAX_BYTES },
  RATE: { pad: { ...LIMITS.RATE.pad }, host: { ...LIMITS.RATE.host } },
  VIOLATIONS_BEFORE_CLOSE: LIMITS.VIOLATIONS_BEFORE_CLOSE,
  MAX_PENDING: LIMITS.ROOM_MAX_PENDING,
  NEW_SEATS_PER_MINUTE: LIMITS.ROOM_NEW_SEATS_PER_MINUTE,
  LOCKS_PER_MINUTE: LIMITS.ROOM_LOCKS_PER_MINUTE,
  VIOLATION_WINDOW_MS: 5_000,
  ACTIVITY_PERSIST_MS: 60_000,
  HOST_KEY_BYTES: LIMITS.HOST_KEY_BYTES,
  RESUME_TOKEN_BYTES: LIMITS.RESUME_TOKEN_BYTES,
};

export interface RoomDeps {
  /** n バイトの乱数。 */
  rand: (n: number) => Uint8Array;
  /** 鍵と札のハッシュ。同じ入力には同じ値を返すこと。 */
  hash: (s: string) => string;
  /** 時間の差で中身を推測されない比較。 */
  timingSafeEqual: (a: string, b: string) => boolean;
  /** 上限の上書き（試験と ALLOW_TEST_OVERRIDES 用）。 */
  limits?: Partial<RoomLimits>;
}
