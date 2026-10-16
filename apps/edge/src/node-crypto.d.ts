// nodejs_compat で使える node:crypto のうち、使う2つだけの型。
// @types/node を丸ごと入れると、Worker にない Node の大域の型まで型検査を通ってしまうため。
declare module 'node:crypto' {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: 'base64url' | 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
  export function timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
}
