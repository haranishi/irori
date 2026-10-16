import { describe, expect, it } from 'vitest';
import { FRAME_ALLOW, isLocalHostname, parseDevParam, resolveEntry } from '../src/index';

const CONSOLE = 'https://irori.example';

describe('resolveEntry：同梱', () => {
  it('/games/<id>/index.html を、allow-scripts だけの枠で開く（allow-same-origin を付けない）', () => {
    const r = resolveEntry({ bundled: 'games/hello-pad/' }, CONSOLE);
    expect(r).toEqual({
      ok: true,
      frame: {
        kind: 'bundled',
        src: 'https://irori.example/games/hello-pad/index.html',
        sandbox: 'allow-scripts',
        allow: 'autoplay',
        referrerPolicy: 'no-referrer',
        loading: 'eager',
        origin: 'null',
        host: null,
      },
    });
    if (r.ok) expect(r.frame.sandbox.split(/\s+/)).not.toContain('allow-same-origin');
  });

  it.each(['games/hello-pad', '../games/x/', 'games/X/', 'games/x/../../', 'games/a b/', '/games/x/', 'games//'])('形の違う bundled（%s）は拒む', (bundled) => {
    expect(resolveEntry({ bundled }, CONSOLE)).toEqual({ ok: false, reason: 'bad-entry' });
  });

  it('bundled と url の両方・どちらもない・オブジェクトでない entry は拒む', () => {
    expect(resolveEntry({ bundled: 'games/x/', url: 'https://g.example/' }, CONSOLE)).toEqual({ ok: false, reason: 'bad-entry' });
    expect(resolveEntry({}, CONSOLE)).toEqual({ ok: false, reason: 'bad-entry' });
    expect(resolveEntry('games/x/', CONSOLE)).toEqual({ ok: false, reason: 'bad-entry' });
    expect(resolveEntry({ bundled: 'games/x/' }, 'not a url')).toEqual({ ok: false, reason: 'bad-console-origin' });
  });
});

describe('resolveEntry：外部', () => {
  it('https の別オリジンは、allow-same-origin つきで開き、ホスト名を返す', () => {
    const r = resolveEntry({ url: 'https://games.example:8443/party/?x=1' }, CONSOLE);
    expect(r).toEqual({
      ok: true,
      frame: {
        kind: 'external',
        src: 'https://games.example:8443/party/?x=1',
        sandbox: 'allow-scripts allow-same-origin',
        allow: FRAME_ALLOW,
        referrerPolicy: 'no-referrer',
        loading: 'eager',
        origin: 'https://games.example:8443',
        host: 'games.example:8443',
      },
    });
  });

  it.each(['https://irori.example/games/evil/', 'HTTPS://IRORI.EXAMPLE/x', 'https://irori.example:443/x', ' https://irori.example/x '])('コンソールと同じオリジン（%s）は拒む', (url) => {
    expect(resolveEntry({ url }, CONSOLE)).toEqual({ ok: false, reason: 'same-origin' });
  });

  it('開発用の localhost でも、コンソールと同じオリジンは拒む', () => {
    expect(resolveEntry({ url: 'http://127.0.0.1:5191/games/x/' }, 'http://127.0.0.1:5191', { allowLocalhost: true })).toEqual({
      ok: false,
      reason: 'same-origin',
    });
  });

  it.each(['http://games.example/', 'javascript:alert(1)', 'data:text/html,hi', 'blob:https://games.example/1', 'file:///etc/passwd', 'ftp://games.example/'])(
    'https でないもの（%s）は拒む',
    (url) => {
      expect(resolveEntry({ url }, CONSOLE)).toEqual({ ok: false, reason: 'insecure' });
    },
  );

  it('http は allowLocalhost のときの localhost と 127.0.0.1 だけ', () => {
    const opts = { allowLocalhost: true };
    expect(resolveEntry({ url: 'http://localhost:5173/' }, CONSOLE).ok).toBe(false);
    expect(resolveEntry({ url: 'http://localhost:5173/' }, CONSOLE, opts).ok).toBe(true);
    expect(resolveEntry({ url: 'http://127.0.0.1:5173/' }, CONSOLE, opts).ok).toBe(true);
    for (const url of ['http://192.168.1.5:5173/', 'http://[::1]:5173/', 'http://localhost.example/', 'http://127.0.0.2/']) {
      expect(resolveEntry({ url }, CONSOLE, opts), url).toEqual({ ok: false, reason: 'insecure' });
    }
  });

  it.each(['https://user@games.example/', 'https://user:pass@games.example/', 'https://:pass@games.example/', 'https://irori.example@games.example/'])(
    '認証情報つきのURL（%s）は拒む',
    (url) => {
      expect(resolveEntry({ url }, CONSOLE)).toEqual({ ok: false, reason: 'credentials' });
    },
  );

  it('URLとして読めないものは拒む', () => {
    expect(resolveEntry({ url: 'https://' }, CONSOLE)).toEqual({ ok: false, reason: 'bad-url' });
    expect(resolveEntry({ url: 42 }, CONSOLE)).toEqual({ ok: false, reason: 'bad-entry' });
  });
});

describe('parseDevParam', () => {
  const dev = '?dev=http%3A%2F%2Flocalhost%3A5173%2F';
  it.each(['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.5', '169.254.3.4', '[::1]', '[fd00::1]', '[fe80::1]', 'mypc.local', 'app.localhost'])(
    'コンソールが %s なら有効',
    (hostname) => {
      expect(parseDevParam({ search: dev, hostname })).toBe('http://localhost:5173/');
    },
  );

  it.each(['irori.example', '8.8.8.8', '172.32.0.1', '192.169.0.1', '[2001:db8::1]', 'local', 'evil-local.com'])('コンソールが %s なら null（公開サーバーでは無視）', (hostname) => {
    expect(parseDevParam({ search: dev, hostname })).toBeNull();
    expect(isLocalHostname(hostname)).toBe(false);
  });

  it('URLでないもの・http(s)でないもの・認証情報つき・指定なしは null', () => {
    const hostname = 'localhost';
    for (const search of ['', '?dev=', '?dev=not%20a%20url', '?dev=javascript%3Aalert(1)', '?dev=https%3A%2F%2Fu%3Ap%40g.example%2F', '?mock=3']) {
      expect(parseDevParam({ search, hostname }), search).toBeNull();
    }
    expect(parseDevParam({ search: '?dev=https%3A%2F%2Fgames.example%2Fa', hostname })).toBe('https://games.example/a');
  });
});
