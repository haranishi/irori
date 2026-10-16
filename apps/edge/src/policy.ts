// 応答のヘッダーと、絶対URLの組み立て。Worker の型に頼らない純粋な関数にしてある。
// 静的配信（Worker を通らない /games/*・/sdk/*・/assets/* など）のヘッダーは apps/web/public/_headers にある。

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// 強い権限は既定で拒む。全画面と画面の消灯の防止（Wake Lock）は、遊ぶのに要るので並べない（既定は自分だけに許可）。
const DENIED = [
  'camera',
  'display-capture',
  'geolocation',
  'hid',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

/** スマホの画面だけ、傾きに要る加速度と角速度を自分に許す。 */
export function permissionsPolicy(pathname: string): string {
  const sensors = pathname === '/pad' || pathname.startsWith('/pad/') ? '(self)' : '()';
  return [`accelerometer=${sensors}`, `gyroscope=${sensors}`, ...DENIED.map((f) => `${f}=()`)].join(', ');
}

/**
 * HTML の CSP。Safari は 'self' に ws: を含めないことがあるので、接続先のホストを明示する。
 * devFrames は開発のときだけ真にする（http://localhost などで動かしているゲームを、?dev= で枠に入れるため）。
 */
export function htmlCsp(host: string, devFrames = false): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ws://${host} wss://${host}`,
    devFrames ? "frame-src 'self' https: http:" : "frame-src 'self' https:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** canonical と OGP の基になるオリジン。PUBLIC_URL が http/https として正しければそれ、でなければリクエストのオリジン。 */
export function publicOrigin(publicUrl: unknown, requestOrigin: string): string {
  if (typeof publicUrl !== 'string' || publicUrl === '') return requestOrigin;
  try {
    const u = new URL(publicUrl);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return requestOrigin;
    return u.origin;
  } catch {
    return requestOrigin;
  }
}

/** "/" で始まる相対の値だけを絶対URLにする。"//" で始まるもの（別のホストを指す）と、もとから絶対のものは触らない。 */
export function absolutize(value: string | null, origin: string): string | null {
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return null;
  return new URL(value, origin).href;
}

/** IPv6 を8つの組に広げる。IPv4（::ffff: 付きを含む）や形の崩れたものは null。 */
function ipv6Groups(ip: string): string[] | null {
  if (!ip.includes(':') || /^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0') : [];
  const groups = [...left, ...fill, ...right];
  return groups.length === 8 ? groups.map((g) => g.replace(/^0+(?=.)/, '')) : null;
}

const norm = (raw: string | null | undefined) => (raw ?? '').trim().toLowerCase();

/** 接続元の数え方。IPv6 は利用者ごとに /64 を持つことが多いので、上位64ビットで1人と数える。 */
export function ipKey(raw: string | null | undefined): string {
  const ip = norm(raw);
  if (ip === '') return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const groups = ipv6Groups(ip);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

/** IPv6 の /48。/48 は無料のトンネルでも得られ、/64 だけで数えると6.5万人分になるので、こちらでも数える。IPv4 は null。 */
export function ipKey48(raw: string | null | undefined): string | null {
  const groups = ipv6Groups(norm(raw));
  return groups ? `${groups.slice(0, 3).join(':')}::/48` : null;
}

/** Origin があって、リクエストのホストと違う（別のサイトのページから送られた）。Origin のない curl や Node は通す。 */
export function crossOrigin(origin: string | null, host: string): boolean {
  if (origin === null) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null"（隔離した枠やファイル）など
  }
}
