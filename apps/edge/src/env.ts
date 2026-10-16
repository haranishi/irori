import type { Limiter } from './limiter';
import type { Room } from './room';

/** バインディングの名前は wrangler.jsonc と同じ（ASSETS・ROOM・LIMITER）。 */
export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace<Room>;
  LIMITER: DurableObjectNamespace<Limiter>;
  PUBLIC_URL?: string;
  MAX_ROOMS_PER_DAY?: string;
  ALLOW_TEST_OVERRIDES?: string;
  /** 開発用（tools/dev.mjs が渡す）。"1" のときだけ、HTML の CSP の frame-src に http: を足す。wrangler.jsonc には書かない。 */
  DEV_FRAMES?: string;
}
