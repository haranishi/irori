// 上限値の正本。理由は docs/protocol.md「上限と費用」。
// 数を変えるときは、費用の見積もり（docs/operate.md）と試験の期待値も一緒に直す。

export const LIMITS = {
  MAX_PLAYERS: 8,

  /** 母音を除き、0/1/O/I に似た文字も避ける。母音がないので、単語になって困る文字列が出にくい。 */
  CODE_ALPHABET: '23456789BCDFGHJKLMNPQRSTVWXYZ',
  CODE_LENGTH: 4,

  NAME_MAX_GRAPHEMES: 12,
  /**
   * 受け手が名前を検査するときの上限。書記素の数え方は実行環境（ICU の版）で違うので、受け手は環境に依らない
   * 符号位置とバイトで縛る。中継の sanitizeName は、12書記素・32符号位置・96バイトの、先に届いたところで切る。
   */
  NAME_MAX_CODEPOINTS: 32,
  NAME_MAX_BYTES: 96,
  ID_MAX_LENGTH: 24,
  /** 画面の文字の上限（ボタン・ヒント・見出し・本文）。受け手の検査は符号位置で数える（日本語は書記素と同じ数）。 */
  LABEL_MAX_GRAPHEMES: 12,
  HINT_MAX_GRAPHEMES: 40,
  TITLE_MAX_GRAPHEMES: 24,
  BODY_MAX_GRAPHEMES: 120,
  BUTTONS_MAX: 4,
  CHOICES_MIN: 2,
  CHOICES_MAX: 6,
  FX_PATTERN_MAX: 8,
  FX_MS_MAX: 1000,

  /** 最初のフレーム（hello）を待つ時間。 */
  HELLO_TIMEOUT_MS: 5_000,
  /** スマホの接続が切れてから席を空けるまで。 */
  PAD_GRACE_MS: 60_000,
  /** ホストの接続が切れてから部屋を閉じるまで。 */
  HOST_GRACE_MS: 90_000,
  /** 何のフレームも流れない時間がこれを超えたら閉じる。 */
  ROOM_IDLE_MS: 20 * 60_000,
  ROOM_MAX_MS: 12 * 60 * 60_000,
  /** 部屋を作ってから、ホストが最初につながるまで。 */
  CREATE_TTL_S: 60,

  FRAME_MAX_BYTES: { pad: 512, host: 16_384 },
  /** 1秒あたりの持続量と、瞬間的に許す量。超えた分は捨て、続けば切る。 */
  RATE: {
    pad: { perSec: 60, burst: 120 },
    host: { perSec: 40, burst: 80 },
  },
  /** 規則違反（形式・速さ）が5秒の窓でこの回数に達したら接続を切る。大きさの違反は数えず、その場で切る（4002）。 */
  VIOLATIONS_BEFORE_CLOSE: 20,

  /** 同じIPから部屋を作れる回数。 */
  CREATE_PER_IP: { perMinute: 6, perHour: 60 },
  /** 部屋の存在確認と、存在しない部屋への接続。コードの総当たりを止める。 */
  LOOKUP_PER_IP: { perMinute: 30 },
  /** WebSocket の接続の受け付け（部屋があってもなくても数える）。家の8台が一斉に入り直しても通る大きさ。 */
  WS_CONNECT_PER_IP: { perMinute: 60 },
  /** IPv6 は /64 を1人と数え、/48 でも数える（/48 は /64 の上限のこの倍）。/48 は無料のトンネルでも得られるため。 */
  IPV6_48_FACTOR: 4,
  /** 部屋ごとの上限。hello 前の接続の同時の数、新しい席（札での入り直しは除く）とロックの切り替えの1分あたりの数。 */
  ROOM_MAX_PENDING: 16,
  ROOM_NEW_SEATS_PER_MINUTE: 40,
  ROOM_LOCKS_PER_MINUTE: 20,
  /** デプロイ全体で1日（UTC）に作れる部屋の数。費用の暴走を止める最後の栓。 */
  DEFAULT_MAX_ROOMS_PER_DAY: 2_000,

  HOST_KEY_BYTES: 32,
  RESUME_TOKEN_BYTES: 16,
} as const;

/**
 * スマホが入力を出す頻度の上限。pad-ui が間引き、値が変わらないあいだは送らない（最後の値は必ず送る）。
 * Cloudflare は、Durable Object が受け取るメッセージ20通を1リクエストとして課金する。
 * 公式も、小さなメッセージを50〜100ミリ秒ごとにまとめるよう勧めている。
 */
export const SEND_RATE_HZ = {
  axis: 20,
  ptr: 20,
  tilt: 15,
} as const;

/**
 * 押している間の連続入力（axis と ptr）は、値が変わらなくても、この間隔で同じ値を送り直す。
 * 離した知らせが届かないまま接続が死んでも、ゲームが「しばらく来なければ止める」と判断できるようにするため
 * （ゲームの目安は、この間隔の3倍＝3秒）。btn（押した・離した）と tilt（変化だけ）には使わない。
 */
export const HELD_REPEAT_MS = 1000;
