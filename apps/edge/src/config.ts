// 環境変数から設定を作る。時間や上限の上書きは ALLOW_TEST_OVERRIDES が "1" のときだけ読む
// （本番の設定に試験用の値が紛れても、効かないようにするため）。例外は MAX_ROOMS_PER_DAY で、
// 運営者が wrangler.jsonc の vars で決める値なので、いつも読む。WS_CONNECT_PER_IP_PER_MINUTE も同じ扱い
// （学校や会場のように、多くの端末が1つのIPの後ろにいる運営者が上げられるように）。Worker の型に頼らない純粋な関数。

import { LIMITS } from '@irori/protocol';
import type { RoomLimits } from '@irori/room';

export interface Settings {
  room: Partial<RoomLimits>;
  /** 作成の応答の ttl（秒）。 */
  createTtlS: number;
  maxPlayers: number;
  limiter: {
    createPerMinute: number;
    createPerHour: number;
    lookupPerMinute: number;
    wsPerMinute: number;
    maxRoomsPerDay: number;
  };
}

/** 上書きできる名前。これ以外は ALLOW_TEST_OVERRIDES があっても読まない。 */
export const OVERRIDE_KEYS = [
  'PAD_GRACE_MS',
  'HOST_GRACE_MS',
  'HELLO_TIMEOUT_MS',
  'ROOM_IDLE_MS',
  'CREATE_TTL_S',
  'CREATE_PER_IP_PER_MINUTE',
  'LOOKUP_PER_IP_PER_MINUTE',
  'MAX_PLAYERS',
] as const;

/** 1日の総数の上限として受け付ける最大の値。桁を間違えた設定で、費用の栓が無いのと同じにならないようにする。 */
export const MAX_ROOMS_PER_DAY_CEILING = 1_000_000;
/** WebSocket の受け付けの上限（IPごと・毎分）として受け付ける最大の値。 */
export const WS_PER_MINUTE_CEILING = 10_000;

function positiveInt(v: unknown): number | undefined {
  if (typeof v !== 'string' || !/^\d{1,12}$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 ? n : undefined;
}

/** 運営者の値。正の整数だけを受け、上限で丸める。空・文字・負・0 は既定に戻す（設定の誤りで止めない）。 */
function operatorInt(v: unknown, ceiling: number, fallback: number): number {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return fallback;
  const n = Number(v);
  return n >= 1 ? Math.min(n, ceiling) : fallback;
}

export function readSettings(env: object): Settings {
  const vars = env as Record<string, unknown>;
  const allow = vars.ALLOW_TEST_OVERRIDES === '1';
  const get = (key: (typeof OVERRIDE_KEYS)[number]) => (allow ? positiveInt(vars[key]) : undefined);

  const room: Partial<RoomLimits> = {};
  for (const key of ['PAD_GRACE_MS', 'HOST_GRACE_MS', 'HELLO_TIMEOUT_MS', 'ROOM_IDLE_MS', 'CREATE_TTL_S'] as const) {
    const n = get(key);
    if (n !== undefined) room[key] = n;
  }
  const maxPlayers = Math.min(LIMITS.MAX_PLAYERS, get('MAX_PLAYERS') ?? LIMITS.MAX_PLAYERS);
  room.MAX_PLAYERS = maxPlayers;

  return {
    room,
    createTtlS: room.CREATE_TTL_S ?? LIMITS.CREATE_TTL_S,
    maxPlayers,
    limiter: {
      createPerMinute: get('CREATE_PER_IP_PER_MINUTE') ?? LIMITS.CREATE_PER_IP.perMinute,
      createPerHour: LIMITS.CREATE_PER_IP.perHour,
      lookupPerMinute: get('LOOKUP_PER_IP_PER_MINUTE') ?? LIMITS.LOOKUP_PER_IP.perMinute,
      wsPerMinute: operatorInt(vars.WS_CONNECT_PER_IP_PER_MINUTE, WS_PER_MINUTE_CEILING, LIMITS.WS_CONNECT_PER_IP.perMinute),
      maxRoomsPerDay: operatorInt(vars.MAX_ROOMS_PER_DAY, MAX_ROOMS_PER_DAY_CEILING, LIMITS.DEFAULT_MAX_ROOMS_PER_DAY),
    },
  };
}
