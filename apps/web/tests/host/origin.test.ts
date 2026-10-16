import { describe, expect, it } from 'vitest';
import { canonicalHref, isLoopback, publicOrigin } from '../../src/host/origin';

const at = (url: string) => {
  const u = new URL(url);
  return { origin: u.origin, hostname: u.hostname };
};

describe('部屋の案内に出すオリジン', () => {
  it('ループバックで開いていて、canonical が別の公開オリジンなら、canonical を使う', () => {
    expect(publicOrigin(at('http://127.0.0.1:8787/'), 'https://irori.example/')).toEqual({ origin: 'https://irori.example', loopback: false });
    expect(publicOrigin(at('http://localhost:8787/'), 'http://192.168.1.5:8787/')).toEqual({ origin: 'http://192.168.1.5:8787', loopback: false });
    expect(publicOrigin(at('http://[::1]:8787/'), 'https://irori.example/')).toEqual({ origin: 'https://irori.example', loopback: false });
  });

  it('ループバックしか無いときは、そのまま使い、警告を出す印を立てる', () => {
    expect(publicOrigin(at('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787/')).toEqual({ origin: 'http://127.0.0.1:8787', loopback: true });
    expect(publicOrigin(at('http://localhost:8787/'), null)).toEqual({ origin: 'http://localhost:8787', loopback: true });
    expect(publicOrigin(at('http://127.0.0.1:8787/'), 'javascript:alert(1)')).toEqual({ origin: 'http://127.0.0.1:8787', loopback: true });
    expect(publicOrigin(at('http://127.0.0.1:8787/'), 'http://localhost:9000/')).toEqual({ origin: 'http://127.0.0.1:8787', loopback: true });
  });

  it('ふつうの公開アドレスで開いたときは、いまのオリジンのまま（canonical が違っても変えない）', () => {
    expect(publicOrigin(at('https://irori.example/'), 'https://other.example/')).toEqual({ origin: 'https://irori.example', loopback: false });
    expect(publicOrigin(at('http://192.168.1.5:8787/'), 'https://irori.example/')).toEqual({ origin: 'http://192.168.1.5:8787', loopback: false });
  });

  it('ループバックの見分け方と、canonical の読み方', () => {
    expect(['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]'].every(isLoopback)).toBe(true);
    expect(['192.168.1.5', 'irori.example', '10.0.0.1', '128.0.0.1'].some(isLoopback)).toBe(false);
    document.head.replaceChildren();
    expect(canonicalHref(document)).toBeNull();
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.setAttribute('href', 'https://irori.example/');
    document.head.append(link);
    expect(canonicalHref(document)).toBe('https://irori.example/');
    document.head.replaceChildren();
  });
});
