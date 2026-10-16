// 画面の文言は、日本語（既定）と英語の2言語。足りない文言は日本語、それもなければキーを返す。

export type Locale = 'ja' | 'en';
type Messages = Record<string, string>;

const dict: Record<Locale, Messages> = { ja: {}, en: {} };

export function addMessages(locale: Locale, messages: Messages): void {
  Object.assign(dict[locale], messages);
}

export function getLocale(): Locale {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'ja' || q === 'en') return q;
  } catch {
    // location が読めない環境（試験）では、次へ進む。
  }
  const nav = typeof navigator === 'undefined' ? 'ja' : navigator.language;
  return nav.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = dict[getLocale()][key] ?? dict.ja[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
