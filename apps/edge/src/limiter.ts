// 上限の栓。デプロイ全体で1つの Durable Object が、IPごとの回数と1日の総数を数える。
// IP は保存しない。日ごとに替わる塩を付けたハッシュだけを数え、日が変われば塩も数も捨てる（仮名化）。
// 作成の回数は保存する（1時間の窓と1日の総数は、休止をまたいで数える必要がある）。
// 存在確認と WebSocket の受け付けは1分の窓なので、メモリだけで数える（総当たりのたびに書き込みを増やさないため）。
// IPv6 は /64 を1人と数え、/48 でも上限の IPV6_48_FACTOR 倍で数える。

import { DurableObject } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import { LIMITS } from '@irori/protocol';
import { readSettings } from './config';
import type { Env } from './env';
import { ipKey, ipKey48 } from './policy';

export type Verdict = { ok: true } | { ok: false; status: 429 | 503; retryAfterSec: number };
/** create：部屋の作成。lookup：存在確認と、存在しない部屋への接続。ws：WebSocket の接続の受け付け。 */
export type LimitKind = 'create' | 'lookup' | 'ws';

interface Day {
  day: string;
  salt: string;
  total: number;
}

interface CreateCount {
  minute: number;
  inMinute: number;
  hour: number;
  inHour: number;
}

interface Window {
  minute: number;
  counts: Map<string, number>;
}

/** 数える単位。factor は上限の倍率（/48 は /64 の4倍まで）。 */
interface Who {
  id: string;
  factor: number;
}

const DAY_KEY = 'day';

function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export class Limiter extends DurableObject<Env> {
  private today: Day | null = null;
  private readonly windows: Record<'lookup' | 'ws', Window> = {
    lookup: { minute: -1, counts: new Map() },
    ws: { minute: -1, counts: new Map() },
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.today = (await ctx.storage.get<Day>(DAY_KEY)) ?? null;
    });
  }

  /** 1回分を数える。ip は CF-Connecting-IP の値そのもの（鍵はここで作る）。 */
  async take(kind: LimitKind, ip: string): Promise<Verdict> {
    const now = Date.now();
    const day = await this.dayOf(now);
    const limits = readSettings(this.env).limiter;
    const who = this.whoOf(day.salt, ip);
    const minute = Math.floor(now / 60_000);
    const nextMinute = secondsUntil((minute + 1) * 60_000, now);

    if (kind !== 'create') {
      const per = kind === 'lookup' ? limits.lookupPerMinute : limits.wsPerMinute;
      const w = this.windows[kind];
      if (w.minute !== minute) {
        w.counts.clear();
        w.minute = minute;
      }
      if (who.some((k) => (w.counts.get(k.id) ?? 0) >= per * k.factor)) return { ok: false, status: 429, retryAfterSec: nextMinute };
      for (const k of who) w.counts.set(k.id, (w.counts.get(k.id) ?? 0) + 1);
      return { ok: true };
    }

    if (day.total >= limits.maxRoomsPerDay) return { ok: false, status: 503, retryAfterSec: secondsUntil(nextUtcMidnight(now), now) };
    const hour = Math.floor(now / 3_600_000);
    const keys = who.map((k) => `c:${k.id}`);
    const prev = await this.ctx.storage.get<CreateCount>(keys);
    const next: Record<string, CreateCount | Day> = { [DAY_KEY]: day };
    for (const [i, k] of who.entries()) {
      const p = prev.get(keys[i]!);
      const inMinute = p?.minute === minute ? p.inMinute : 0;
      const inHour = p?.hour === hour ? p.inHour : 0;
      if (inMinute >= limits.createPerMinute * k.factor) return { ok: false, status: 429, retryAfterSec: nextMinute };
      if (inHour >= limits.createPerHour * k.factor) return { ok: false, status: 429, retryAfterSec: secondsUntil((hour + 1) * 3_600_000, now) };
      next[keys[i]!] = { minute, inMinute: inMinute + 1, hour, inHour: inHour + 1 };
    }
    day.total++;
    await this.ctx.storage.put(next);
    return { ok: true };
  }

  private whoOf(salt: string, ip: string): Who[] {
    const hash = (key: string) => createHash('sha256').update(salt).update('|').update(key).digest('base64url').slice(0, 22);
    const out: Who[] = [{ id: hash(ipKey(ip)), factor: 1 }];
    const wide = ipKey48(ip);
    if (wide !== null) out.push({ id: hash(wide), factor: LIMITS.IPV6_48_FACTOR });
    return out;
  }

  private async dayOf(now: number): Promise<Day> {
    const d = new Date(now).toISOString().slice(0, 10);
    if (this.today?.day === d) return this.today;
    // 日が変わったら、前の日の数と塩を捨てる。同じIPでも、日をまたぐと別のハッシュになる。
    await this.ctx.storage.deleteAll();
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.today = { day: d, salt, total: 0 };
    for (const w of Object.values(this.windows)) w.counts.clear();
    await this.ctx.storage.put(DAY_KEY, this.today);
    return this.today;
  }
}
