// 形の検査の小さな補助。文字数と大きさの数え方は、中継と同じものを protocol から使う。

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** 許したキー以外を持っていたら、その名前を返す。 */
export function unknownKey(o: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const k in o) if (Object.hasOwn(o, k) && !allowed.includes(k)) return k;
  return null;
}
