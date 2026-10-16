/// <reference types="node" />
// 試験用の小さな世界。時計を自分で進め、RoomCore の効果を「接続ごとの受信箱」「閉じた接続」「保存」「目覚まし」に写す。
// Durable Object と同じく、接続の付属情報を覚えておき、休止からの復帰を再現できる。

import { createHash } from 'node:crypto';
import { CLOSE_CODES, utf8Length, type ToHostFrame, type ToPadFrame } from '@irori/protocol';
import {
  RoomCore,
  type ConnAttachment,
  type ConnId,
  type Effect,
  type RoomDeps,
  type RoomLimits,
  type RoomState,
} from '../src/index';

export type Frame = ToHostFrame | ToPadFrame;
export const T0 = 1_760_000_000_000;

export function seededBytes(seed: number): (n: number) => Uint8Array {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return (n) => Uint8Array.from({ length: n }, () => next() & 255);
}

export const sha = (s: string) => createHash('sha256').update(s).digest('base64url');

export class World {
  now = T0;
  core: RoomCore;
  readonly key: string;
  readonly deps: RoomDeps;
  readonly inbox = new Map<ConnId, Frame[]>();
  readonly closed = new Map<ConnId, { code: number; reason: string }>();
  readonly attachments = new Map<ConnId, ConnAttachment>();
  persisted: RoomState | null = null;
  persists = 0;
  alarm: number | null = null;
  alarms = 0;
  destroyed = false;
  private seq = 0;

  constructor(limits: Partial<RoomLimits> = {}, seed = 1) {
    this.deps = { rand: seededBytes(seed), hash: sha, timingSafeEqual: (a, b) => a === b, limits };
    const { core, key, effects } = RoomCore.create('BCDF', this.now, this.deps);
    this.core = core;
    this.key = key;
    this.apply(effects);
  }

  apply(effects: Effect[]): Effect[] {
    for (const e of effects) {
      switch (e.type) {
        case 'send':
          if (this.closed.has(e.conn)) throw new Error(`閉じた接続 ${e.conn} へ送ろうとした: ${JSON.stringify(e.frame)}`);
          this.box(e.conn).push(structuredClone(e.frame));
          break;
        case 'close':
          this.closed.set(e.conn, { code: e.code, reason: e.reason });
          this.attachments.delete(e.conn);
          break;
        case 'persist':
          this.persisted = structuredClone(e.state);
          this.persists++;
          break;
        case 'alarm':
          this.alarm = e.at;
          this.alarms++;
          break;
        case 'destroy':
          this.destroyed = true;
          this.persisted = null;
          this.alarm = null;
          break;
      }
    }
    for (const id of this.inbox.keys()) {
      const att = this.core.attachment(id);
      if (att && !this.closed.has(id)) this.attachments.set(id, att);
    }
    return effects;
  }

  dispatch(ev: Parameters<RoomCore['handle']>[0]): Effect[] {
    return this.apply(this.core.handle(ev));
  }

  box(conn: ConnId): Frame[] {
    let b = this.inbox.get(conn);
    if (!b) this.inbox.set(conn, (b = []));
    return b;
  }

  open(): ConnId {
    const id = `c${++this.seq}`;
    this.box(id);
    this.dispatch({ type: 'open', conn: id, now: this.now });
    return id;
  }

  raw(conn: ConnId, text: string, bytes = utf8Length(text)): Effect[] {
    return this.dispatch({ type: 'frame', conn, raw: text, bytes, now: this.now });
  }

  send(conn: ConnId, frame: unknown): Effect[] {
    return this.raw(conn, JSON.stringify(frame));
  }

  binary(conn: ConnId, bytes: number): Effect[] {
    return this.dispatch({ type: 'frame', conn, raw: '', bytes, binary: true, now: this.now });
  }

  drop(conn: ConnId): Effect[] {
    this.closed.set(conn, { code: 1006, reason: 'dropped' });
    this.attachments.delete(conn);
    return this.dispatch({ type: 'close', conn, now: this.now });
  }

  /** 時計を進める。途中で鳴る目覚ましは、鳴る時刻に順に鳴らす（Durable Object の alarm と同じ）。 */
  advance(ms: number): void {
    const target = this.now + ms;
    let spins = 0;
    while (!this.destroyed && this.alarm !== null && this.alarm <= target) {
      // 期限の処理が進まないと、過去の時刻の目覚ましが鳴り続ける。黙って回り続けず、ここで落とす。
      if (this.alarm <= this.now && ++spins > 1000) throw new Error(`目覚ましが同じ時刻（${this.alarm}）で鳴り続けている`);
      this.now = Math.max(this.now, this.alarm);
      this.alarm = null;
      this.dispatch({ type: 'tick', now: this.now });
    }
    this.now = target;
  }

  /** 受信箱を取り出して空にする。 */
  take(conn: ConnId): Frame[] {
    const b = this.box(conn);
    const out = [...b];
    b.length = 0;
    return out;
  }

  /** ホストとしてつなぐ。 */
  host(key = this.key): ConnId {
    const c = this.open();
    this.send(c, { t: 'hello', v: 1, role: 'host', key });
    return c;
  }

  /** スマホとしてつなぎ、welcome の中身を返す（入れなかったときは null）。 */
  pad(opts: { name?: string; resume?: string } = {}): { conn: ConnId; seat: number; resume: string } | { conn: ConnId; seat: null; resume: null } {
    const c = this.open();
    this.send(c, { t: 'hello', v: 1, role: 'pad', ...opts });
    const w = this.box(c).find((f) => f.t === 'welcome');
    if (!w || w.t !== 'welcome' || w.role !== 'pad') return { conn: c, seat: null, resume: null };
    return { conn: c, seat: w.you.id, resume: w.resume };
  }

  /** 休止からの復帰。保存した状態と、閉じていない接続の付属情報だけを渡す。 */
  hibernate(lost: ConnId[] = []): void {
    if (!this.persisted) throw new Error('保存された状態がない');
    for (const c of lost) {
      this.closed.set(c, { code: 1006, reason: 'lost' });
      this.attachments.delete(c);
    }
    const sockets = [...this.attachments].map(([conn, att]) => ({ conn, att }));
    this.core = RoomCore.restore(structuredClone(this.persisted), sockets, this.deps);
  }

  closeCode(conn: ConnId): number | undefined {
    return this.closed.get(conn)?.code;
  }
}

export { CLOSE_CODES };
