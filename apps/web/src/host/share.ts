// 共有：端末の共有シート・X・LINE・リンクのコピー。
// 共有するのはサイトのURL（origin + '/'）。部屋のURLを広めると、知らない人が部屋に入ってくるため。
// Instagram と YouTube には、Webから投稿画面を開く公式の仕組みがないので、ボタンは作らず、画面に一行で書く。

export interface ShareLinks {
  url: string;
  x: string;
  line: string;
}

export function shareLinks(origin: string, text: string): ShareLinks {
  const url = new URL('/', origin).href;
  return {
    url,
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    line: `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`,
  };
}

type ShareNavigator = { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };

export function canNativeShare(nav: ShareNavigator | undefined): boolean {
  return typeof nav?.share === 'function';
}

/** 端末の共有シート。閉じられた（AbortError）ときは cancelled。 */
export async function nativeShare(nav: ShareNavigator, data: ShareData): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await nav.share?.(data);
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export interface CopyDeps {
  clipboard?: { writeText(text: string): Promise<void> } | undefined;
  document: Document;
}

/** クリップボードへ書く。使えない・断られたときは、隠した textarea と execCommand で試す。 */
export async function copyText(text: string, deps: CopyDeps): Promise<boolean> {
  try {
    if (deps.clipboard) {
      await deps.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 次の方法へ
  }
  const doc = deps.document;
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'host-copy-buffer';
  doc.body.append(ta);
  try {
    ta.select();
    return typeof doc.execCommand === 'function' && doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
