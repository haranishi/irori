// ヘッダーと HTML の書き換え。Worker を通る応答（/ と /pad と /api）と、静的配信（_headers）の両方を見る。
import { describe, expect, it } from 'vitest';
import { edge } from './client';

const get = (url: string, init?: RequestInit) => fetch(url, { redirect: 'manual', ...init });
const DENIED =
  'camera=(), display-capture=(), geolocation=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), serial=(), usb=(), xr-spatial-tracking=()';

function htmlCsp(host: string): string {
  return `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws://${host} wss://${host}; frame-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}

function attr(html: string, selector: RegExp): string | undefined {
  return selector.exec(html)?.[1];
}

describe('HTML（Worker を通る）', () => {
  it('/ は index.html。CSP・Permissions-Policy・no-cache を付け、Set-Cookie を返さない', async () => {
    const base = edge().main;
    const r = await get(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(r.headers.get('Content-Security-Policy')).toBe(htmlCsp(new URL(base).host));
    expect(r.headers.get('Permissions-Policy')).toBe(`accelerometer=(), gyroscope=(), ${DENIED}`);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.get('Cache-Control')).toBe('no-cache');
    expect(r.headers.get('Set-Cookie')).toBeNull();
    expect(await r.text()).toContain('host page');
  });

  it('/pad は pad.html。加速度と角速度だけを自分に許す', async () => {
    const r = await get(`${edge().main}/pad`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('pad page');
    expect(r.headers.get('Permissions-Policy')).toBe(`accelerometer=(self), gyroscope=(self), ${DENIED}`);
    expect(r.headers.get('Set-Cookie')).toBeNull();
  });

  it('HEAD でも同じヘッダー', async () => {
    const base = edge().main;
    const r = await get(`${base}/`, { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Security-Policy')).toBe(htmlCsp(new URL(base).host));
  });

  it('HTML のファイルを直接開くと、Worker を通る道へ転送する', async () => {
    const base = edge().main;
    const a = await get(`${base}/index.html`);
    expect(a.status).toBe(307);
    expect(a.headers.get('Location')).toBe('/');
    const b = await get(`${base}/pad.html`);
    expect(b.status).toBe(307);
    expect(b.headers.get('Location')).toBe('/pad');
  });

  it('相対の canonical・og:url・og:image・twitter:image を、リクエストのオリジンで絶対URLにする', async () => {
    const base = edge().main;
    const html = await (await get(`${base}/`)).text();
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(`${base}/`);
    expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe(`${base}/`);
    expect(attr(html, /<meta property="og:image" content="([^"]*)"/)).toBe(`${base}/og.png`);
    expect(attr(html, /<meta name="twitter:image" content="([^"]*)"/)).toBe(`${base}/og.png`);
    // 対象外の要素は触らない
    expect(attr(html, /<meta property="og:image:alt" content="([^"]*)"/)).toBe('/not-a-url');
    expect(attr(html, /<link rel="alternate" href="([^"]*)"/)).toBe('/feed');
    expect(attr(html, /<meta name="twitter:image:src" content="([^"]*)"/)).toBe('/keep');
  });

  it('"//" で始まる値・絶対URL・"/" で始まらない相対は書き換えない。rel が複数でも canonical は書き換える', async () => {
    const base = edge().main;
    const html = await (await get(`${base}/pad`)).text();
    expect(attr(html, /<link rel="canonical alternate" href="([^"]*)"/)).toBe(`${base}/pad`);
    expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe('//elsewhere.example/pad');
    expect(attr(html, /<meta property="og:image" content="([^"]*)"/)).toBe('https://cdn.example/og.png');
    expect(attr(html, /<meta name="twitter:image" content="([^"]*)"/)).toBe('og.png');
  });

  it('PUBLIC_URL があれば、それを基にする（CSP の接続先はリクエストのホストのまま）', async () => {
    const base = edge().plain;
    const r = await get(`${base}/`);
    const html = await r.text();
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe('https://irori.example/');
    expect(attr(html, /<meta property="og:image" content="([^"]*)"/)).toBe('https://irori.example/og.png');
    expect(r.headers.get('Content-Security-Policy')).toBe(htmlCsp(new URL(base).host));
  });

  it('frame-src の http: は、開発用の DEV_FRAMES が "1" のときだけ足す', async () => {
    const csp = async (base: string) => (await get(`${base}/`)).headers.get('Content-Security-Policy') ?? '';
    const prod = await csp(edge().main); // DEV_FRAMES なし（本番と同じ）
    expect(prod).toContain("frame-src 'self' https:;");
    expect(prod).not.toMatch(/frame-src[^;]* http:/);
    expect(await csp(edge().plain)).not.toMatch(/frame-src[^;]* http:/); // DEV_FRAMES=true は "1" ではない
    const dev = await csp(edge().caps); // DEV_FRAMES=1
    expect(dev).toContain("frame-src 'self' https: http:;");
    // 違いは http: の1語だけ（接続先のホストは、それぞれのリクエストのホスト）
    expect(dev.replace(' http:;', ';')).toBe(prod.replaceAll(new URL(edge().main).host, new URL(edge().caps).host));
  });

  it('PUBLIC_URL が http/https として正しくなければ、リクエストのオリジンに戻る', async () => {
    const base = edge().caps;
    const html = await (await get(`${base}/`)).text();
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(`${base}/`);
  });
});

describe('API', () => {
  it('/api/* は no-store の JSON。Set-Cookie を返さない', async () => {
    const r = await get(`${edge().main}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.get('Set-Cookie')).toBeNull();
  });

  it.each([
    ['GET', '/api/rooms', 405],
    ['DELETE', '/api/rooms/BCDF', 405],
    ['POST', '/api/health', 405],
    ['GET', '/api/nothing', 404],
    ['GET', '/api/rooms/BCDF/ws', 426],
  ])('%s %s → %i', async (method, path, code) => {
    const r = await get(`${edge().main}${path}`, { method });
    expect(r.status).toBe(code);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('静的配信（_headers）', () => {
  const GAMES_CSP =
    "sandbox allow-scripts; default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'";

  it.each(['/games/sample/', '/games/sample/game.js'])('%s は sandbox の CSP と、どこからでも読める CORS', async (path) => {
    const r = await get(`${edge().main}${path}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Security-Policy')).toBe(GAMES_CSP);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Set-Cookie')).toBeNull();
  });

  it('/sdk/* は CORS を許す', async () => {
    const r = await get(`${edge().main}/sdk/v1/irori.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(r.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('ハッシュ付きのアセットは長くキャッシュする', async () => {
    const r = await get(`${edge().main}/assets/app-AbCd1234.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('そのほかの静的ファイルにも共通の守りを付け、CORS は付けない', async () => {
    const r = await get(`${edge().main}/favicon.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.get('Permissions-Policy')).toBe(`accelerometer=(), gyroscope=(), ${DENIED}`);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(r.headers.get('Set-Cookie')).toBeNull();
  });

  it('_headers そのものは配らない。ないものは 404', async () => {
    expect((await get(`${edge().main}/_headers`)).status).toBe(404);
    const r = await get(`${edge().main}/no-such-file`);
    expect(r.status).toBe(404);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
