// 部屋の案内（QR・手入力の案内・共有の宛先）に出すオリジンを決める。
// 大画面を localhost や 127.0.0.1 で開くと、location.origin はほかの端末から開けないアドレスになる。
// Worker は <link rel="canonical"> を、運営者の決めた公開URL（PUBLIC_URL。npm run dev ならLANのアドレス）に書き換えるので、
// ループバックで開かれていて、canonical が別のオリジンなら、そちらを案内に使う。
// 通信（WebSocket・API・ゲームの配信）は、いま開いているオリジンのまま使う。ここで決めるのは表示と共有の宛先だけ。

export interface PublicOrigin {
  origin: string;
  /** 案内のアドレスが、ほかの端末から開けないループバックのまま。 */
  loopback: boolean;
}

export function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(h) || h === '[::1]' || h === '::1';
}

export function publicOrigin(loc: { origin: string; hostname: string }, canonical: string | null): PublicOrigin {
  if (isLoopback(loc.hostname) && canonical) {
    try {
      const u = new URL(canonical, loc.origin);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !isLoopback(u.hostname) && u.origin !== loc.origin) {
        return { origin: u.origin, loopback: false };
      }
    } catch {
      // 壊れた canonical は使わない
    }
  }
  return { origin: loc.origin, loopback: isLoopback(loc.hostname) };
}

export function canonicalHref(doc: Pick<Document, 'querySelector'>): string | null {
  return doc.querySelector('link[rel~="canonical"]')?.getAttribute('href') ?? null;
}
