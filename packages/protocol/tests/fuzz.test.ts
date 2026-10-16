// 乱数の入力で「例外を投げない」「通ったものは上限を超えない」を確かめる。種は固定（落ちたら同じ入力で再現できる）。
// 上限の確かめ方は、検証の実装を使わずに、ここで規則を書き直したもので見る（実装の誤りを同じ誤りで見逃さないため）。
import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  parseHelloFrame,
  parseHostFrame,
  parsePadFrame,
  parseToHostFrame,
  parseToPadFrame,
  type ParseResult,
} from '../src/index';
import { int, mulberry32, nastyString, pick, type Rng } from './random';

const ITERATIONS = 3000;
// 受け手の検査は、環境に依らない符号位置とバイトで数える（文字列の反復は符号位置ごと）。
const codePoints = (s: string) => [...s].length;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

// ---- 入力を作る ----
// 種類ごとに「ほぼ正しい」フレームを作り、一部を壊す。でたらめな値だけだと、ほとんどが入口で拒まれて、
// 「通ったものが上限を守るか」を確かめる件数が足りなくなるため。

const ATOMS: unknown[] = [0, 1, -1, 2, 8, 9, 0.5, -0.5, 1.000001, 360, 361, -181, 1e21, 1000, 1001, -0, true, false, null, '', '*', 'a', 'A', 'a'.repeat(24), 'a'.repeat(25), 'red', 'pink', 'host', 'pad', 'btn', 's', 'z'];
const EXTRA_KEYS = ['p', 'T', 'x', '__proto__', 'constructor', 'style', 'html'];
const IDS = ['a', 'b_1', 'jump', 'stick', 'dpad', 'x-1', 'a'.repeat(24), 'A', '', 'a'.repeat(25), 'a.b'];

const bool = (rng: Rng) => rng() < 0.5;
const text = (rng: Rng, parts: number) => (rng() < 0.85 ? nastyString(rng, parts) : (pick(rng, ATOMS) as string));
const seat = (rng: Rng) => (rng() < 0.85 ? int(rng, 1, 8) : pick(rng, [0, 9, 1.5, '1', -1]));
const seatOrAll = (rng: Rng) => (rng() < 0.3 ? '*' : seat(rng));
const ident = (rng: Rng) => (rng() < 0.85 ? pick(rng, IDS.slice(0, 7)) : pick(rng, IDS));
const anyNum = (rng: Rng, lo: number, hi: number) => (rng() < 0.9 ? lo + rng() * (hi - lo) : pick(rng, ATOMS));

function val(rng: Rng, depth = 0): unknown {
  const r = rng();
  if (r < 0.5 || depth > 2) return pick(rng, ATOMS);
  if (r < 0.75) return text(rng, 30);
  if (r < 0.88) return Array.from({ length: int(rng, 0, 9) }, () => val(rng, depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = int(rng, 0, 4); i > 0; i--) o[pick(rng, ['k', 'id', 't', 'label', ...EXTRA_KEYS])] = val(rng, depth + 1);
  return o;
}

function corrupt(rng: Rng, o: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(o);
  const r = rng();
  if (r < 0.35) o[pick(rng, EXTRA_KEYS)] = val(rng);
  else if (r < 0.6 && keys.length) delete o[pick(rng, keys)];
  else if (keys.length) o[pick(rng, keys)] = val(rng);
  return o;
}

const maybe = <T extends Record<string, unknown>>(rng: Rng, o: T, p = 0.25): T => (rng() < p ? (corrupt(rng, o) as T) : o);

function button(rng: Rng): Record<string, unknown> {
  const b: Record<string, unknown> = { id: ident(rng), label: text(rng, 14) };
  if (bool(rng)) b.color = pick(rng, ['red', 'blue', 'green', 'yellow', 'gray', 'gray', 'pink']);
  return maybe(rng, b, 0.1);
}

function buttons(rng: Rng, min: number, max: number): Record<string, unknown>[] {
  return Array.from({ length: int(rng, min, max) }, () => button(rng));
}

function spec(rng: Rng): Record<string, unknown> {
  const k = pick(rng, ['wait', 'pad', 'buzzer', 'choices', 'touch', 'tilt', 'remote', 'html']);
  const s: Record<string, unknown> = { k };
  const opt = (key: string, make: () => unknown) => {
    if (bool(rng)) s[key] = make();
  };
  if (k === 'wait') {
    opt('title', () => text(rng, 28));
    opt('body', () => text(rng, 130));
  }
  if (k === 'pad') {
    opt('stick', () => pick(rng, ['none', 'dpad', 'stick', 'wheel']));
    opt('buttons', () => buttons(rng, 0, 5));
    opt('orient', () => pick(rng, ['any', 'landscape', 'portrait', 'up']));
  }
  if (k === 'buzzer') {
    s.label = text(rng, 14);
    opt('color', () => pick(rng, ['red', 'blue', 'pink']));
    opt('disabled', () => pick(rng, [true, false, 'true']));
  }
  if (k === 'choices') {
    s.options = buttons(rng, 1, 7);
    opt('disabled', () => bool(rng));
  }
  if (k === 'touch') opt('mode', () => pick(rng, ['area', 'swipe', 'x']));
  if (k === 'tilt') opt('buttons', () => buttons(rng, 0, 5));
  if (k !== 'wait') opt('hint', () => text(rng, 45));
  return maybe(rng, s, 0.15);
}

function input(rng: Rng): Record<string, unknown> {
  const k = pick(rng, ['btn', 'axis', 'ptr', 'pick', 'tilt', 'menu', 'key']);
  let i: Record<string, unknown>;
  if (k === 'btn') i = { k, id: ident(rng), d: rng() < 0.9 ? int(rng, 0, 1) : pick(rng, [2, true, '1']) };
  else if (k === 'axis') i = { k, id: ident(rng), x: anyNum(rng, -2, 2), y: anyNum(rng, -2, 2) };
  else if (k === 'ptr') i = { k, id: ident(rng), x: anyNum(rng, -1, 2), y: anyNum(rng, -1, 2), ph: pick(rng, ['s', 'm', 'e', 'q']) };
  else if (k === 'pick') i = { k, id: ident(rng) };
  else if (k === 'tilt') i = { k, a: anyNum(rng, -200, 600), b: anyNum(rng, -400, 400), g: anyNum(rng, -200, 200) };
  else i = { k };
  return maybe(rng, i, 0.15);
}

function player(rng: Rng): Record<string, unknown> {
  return maybe(rng, { id: seat(rng), name: text(rng, 14), online: bool(rng) }, 0.1);
}

const FRAMES: Array<(rng: Rng) => Record<string, unknown>> = [
  // ホスト → サーバー
  (rng) => ({ t: 'hello', v: rng() < 0.9 ? 1 : 2, role: 'host', key: text(rng, 50) }),
  (rng) => ({ t: 'pad', to: seatOrAll(rng), spec: spec(rng) }),
  (rng) => ({ t: 'fx', to: seatOrAll(rng), ms: Array.from({ length: int(rng, 0, 10) }, () => anyNum(rng, -100, 2000)) }),
  (rng) => ({ t: 'kick', p: seat(rng) }),
  (rng) => ({ t: 'lock', on: rng() < 0.9 ? bool(rng) : 1 }),
  () => ({ t: 'close' }),
  // スマホ → サーバー
  (rng) => {
    const f: Record<string, unknown> = { t: 'hello', v: rng() < 0.9 ? 1 : '1', role: 'pad' };
    if (bool(rng)) f.name = text(rng, 30);
    if (bool(rng)) f.resume = text(rng, 30);
    return f;
  },
  (rng) => ({ t: 'in', i: input(rng) }),
  () => ({ t: 'bye' }),
  // サーバー → ホスト
  (rng) => ({
    t: 'welcome', role: 'host', code: pick(rng, ['BCDF', '2345', 'ZZZZ', 'AEIO', 'bcdf']),
    players: Array.from({ length: int(rng, 0, 9) }, () => player(rng)), max: seat(rng), locked: bool(rng),
  }),
  (rng) => ({ t: 'joined', p: player(rng) }),
  (rng) => ({ t: 'left', p: seat(rng), why: pick(rng, ['bye', 'timeout', 'kick', 'x']) }),
  (rng) => ({ t: 'online', p: seat(rng), on: bool(rng) }),
  (rng) => ({ t: 'in', p: seat(rng), i: input(rng), T: pick(rng, [0, 1_760_000_000_000, 12.5, -1, 'x']) }),
  (rng) => ({ t: 'pad?', p: seat(rng) }),
  (rng) => ({ t: 'err', code: pick(rng, ['rate', 'full', 'replaced', 'oops']) }),
  // サーバー → スマホ
  (rng) => ({ t: 'welcome', role: 'pad', you: player(rng), resume: text(rng, 30), host: bool(rng) }),
  (rng) => ({ t: 'pad', spec: spec(rng) }),
  (rng) => ({ t: 'fx', ms: Array.from({ length: int(rng, 0, 10) }, () => anyNum(rng, -100, 2000)) }),
  (rng) => ({ t: 'host', on: bool(rng) }),
  () => ({ t: 'kicked' }),
  () => ({ t: 'closed' }),
  (rng) => ({ t: pick(rng, ['ping', 'pong', 'boom']) }),
];

function raw(rng: Rng): string {
  const r = rng();
  if (r < 0.06) return nastyString(rng, 20); // JSON でないもの
  if (r < 0.1) return JSON.stringify(val(rng));
  let s = JSON.stringify(maybe(rng, pick(rng, FRAMES)(rng), 0.2));
  if (rng() < 0.05) s = s.replace(/:(-?\d+(\.\d+)?)/, ':1e999'); // JSON.parse で Infinity になる数
  return s;
}

// ---- 規則を書き直したもの ----

const ID = /^[a-z0-9_-]{1,24}$/;
const COLORS = ['red', 'blue', 'green', 'yellow', 'gray'];

function within(problems: string[], where: string, v: unknown, max: number): void {
  if (typeof v !== 'string' || codePoints(v) > max) problems.push(`${where}: ${String(v).slice(0, 20)} が ${max} 符号位置を超える`);
}

function nameWithin(problems: string[], where: string, v: unknown): void {
  if (typeof v !== 'string' || codePoints(v) > LIMITS.NAME_MAX_CODEPOINTS || bytes(v) > LIMITS.NAME_MAX_BYTES) {
    problems.push(`${where}: 名前 ${String(v).slice(0, 20)} が上限を超える`);
  }
}

function keysOnly(problems: string[], where: string, o: object, allowed: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) problems.push(`${where}: 未知のキー ${k}`);
}

function isSeat(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LIMITS.MAX_PLAYERS;
}

function checkButtons(problems: string[], where: string, list: unknown, min: number, max: number): void {
  if (!Array.isArray(list) || list.length < min || list.length > max) {
    problems.push(`${where}: 個数`);
    return;
  }
  list.forEach((b: Record<string, unknown>, i) => {
    keysOnly(problems, `${where}[${i}]`, b, ['id', 'label', 'color']);
    if (typeof b.id !== 'string' || !ID.test(b.id)) problems.push(`${where}[${i}].id`);
    within(problems, `${where}[${i}].label`, b.label, LIMITS.LABEL_MAX_GRAPHEMES);
    if (b.color !== undefined && !COLORS.includes(b.color as string)) problems.push(`${where}[${i}].color`);
  });
}

function checkSpec(problems: string[], s: Record<string, unknown>): void {
  const allowed: Record<string, string[]> = {
    wait: ['k', 'title', 'body'], pad: ['k', 'stick', 'buttons', 'hint', 'orient'], buzzer: ['k', 'label', 'color', 'disabled', 'hint'],
    choices: ['k', 'options', 'disabled', 'hint'], touch: ['k', 'mode', 'hint'], tilt: ['k', 'buttons', 'hint'], remote: ['k', 'hint'],
  };
  const keys = allowed[s.k as string];
  if (!keys) {
    problems.push(`spec.k: ${String(s.k)}`);
    return;
  }
  keysOnly(problems, 'spec', s, keys);
  if (s.title !== undefined) within(problems, 'spec.title', s.title, LIMITS.TITLE_MAX_GRAPHEMES);
  if (s.body !== undefined) within(problems, 'spec.body', s.body, LIMITS.BODY_MAX_GRAPHEMES);
  if (s.hint !== undefined) within(problems, 'spec.hint', s.hint, LIMITS.HINT_MAX_GRAPHEMES);
  if (s.k === 'buzzer') within(problems, 'spec.label', s.label, LIMITS.LABEL_MAX_GRAPHEMES);
  if (s.buttons !== undefined) checkButtons(problems, 'spec.buttons', s.buttons, 0, LIMITS.BUTTONS_MAX);
  if (s.k === 'choices') checkButtons(problems, 'spec.options', s.options, LIMITS.CHOICES_MIN, LIMITS.CHOICES_MAX);
  if (s.color !== undefined && !COLORS.includes(s.color as string)) problems.push('spec.color');
}

function checkInput(problems: string[], i: Record<string, unknown>): void {
  const allowed: Record<string, string[]> = {
    btn: ['k', 'id', 'd'], axis: ['k', 'id', 'x', 'y'], ptr: ['k', 'id', 'x', 'y', 'ph'], pick: ['k', 'id'], tilt: ['k', 'a', 'b', 'g'], menu: ['k'],
  };
  const keys = allowed[i.k as string];
  if (!keys) return void problems.push(`i.k: ${String(i.k)}`);
  keysOnly(problems, 'i', i, keys);
  if (keys.includes('id') && (typeof i.id !== 'string' || !ID.test(i.id))) problems.push('i.id');
  const inRange = (name: string, lo: number, hi: number) => {
    const v = i[name];
    if (typeof v !== 'number' || !(v >= lo && v <= hi)) problems.push(`i.${name}: ${String(v)}`);
  };
  if (i.k === 'btn' && i.d !== 0 && i.d !== 1) problems.push('i.d');
  if (i.k === 'axis') {
    inRange('x', -1, 1);
    inRange('y', -1, 1);
    for (const n of ['x', 'y']) if (Math.abs(Math.round((i[n] as number) * 100) - (i[n] as number) * 100) > 1e-9) problems.push(`i.${n}: 小数2桁を超える`);
  }
  if (i.k === 'ptr') {
    inRange('x', 0, 1);
    inRange('y', 0, 1);
  }
  if (i.k === 'tilt') {
    inRange('a', 0, 360);
    inRange('b', -180, 180);
    inRange('g', -90, 90);
  }
}

function checkFrame(kind: 'host' | 'pad' | 'toHost' | 'toPad', f: Record<string, unknown>): string[] {
  const p: string[] = [];
  const t = f.t as string;
  const allowed: Record<string, Record<string, string[]>> = {
    host: { hello: ['t', 'v', 'role', 'key'], pad: ['t', 'to', 'spec'], fx: ['t', 'to', 'ms'], kick: ['t', 'p'], lock: ['t', 'on'], close: ['t'] },
    pad: { hello: ['t', 'v', 'role', 'name', 'resume'], in: ['t', 'i'], bye: ['t'] },
    toHost: {
      welcome: ['t', 'role', 'code', 'players', 'max', 'locked'], joined: ['t', 'p'], left: ['t', 'p', 'why'], online: ['t', 'p', 'on'],
      in: ['t', 'p', 'i', 'T'], 'pad?': ['t', 'p'], err: ['t', 'code'],
    },
    toPad: { welcome: ['t', 'role', 'you', 'resume', 'host'], pad: ['t', 'spec'], fx: ['t', 'ms'], host: ['t', 'on'], kicked: ['t'], closed: ['t'], err: ['t', 'code'] },
  };
  const keys = allowed[kind]?.[t];
  if (!keys) return [`${kind}: 種類 ${t}`];
  keysOnly(p, kind, f, keys);
  if (kind === 'pad' && 'p' in f) p.push('スマホのフレームに p がある（なりすまし）');
  if (f.spec !== undefined) checkSpec(p, f.spec as Record<string, unknown>);
  if (f.i !== undefined) checkInput(p, f.i as Record<string, unknown>);
  if (f.ms !== undefined) {
    const ms = f.ms as unknown[];
    if (ms.length > LIMITS.FX_PATTERN_MAX) p.push('ms: 個数');
    for (const n of ms) if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > LIMITS.FX_MS_MAX) p.push(`ms: ${String(n)}`);
  }
  if (f.to !== undefined && f.to !== '*' && !isSeat(f.to)) p.push('to');
  if (typeof f.p === 'number' && !isSeat(f.p)) p.push('p');
  if (f.t === 'hello' && f.v !== 1) p.push('v');
  const named = [...((f.players as Array<{ name?: unknown }> | undefined) ?? []), f.you, kind === 'toHost' && f.t === 'joined' ? f.p : undefined];
  for (const pl of named) if (pl && typeof pl === 'object') nameWithin(p, `${kind}.${String(f.t)}.name`, (pl as { name?: unknown }).name);
  return p;
}

const parsers: Array<[string, (raw: string) => ParseResult<unknown>, 'host' | 'pad' | 'toHost' | 'toPad']> = [
  ['parseHostFrame', parseHostFrame, 'host'],
  ['parsePadFrame', parsePadFrame, 'pad'],
  ['parseToHostFrame', parseToHostFrame, 'toHost'],
  ['parseToPadFrame', parseToPadFrame, 'toPad'],
];

describe('乱数の入力（固定の種）', () => {
  it(`${ITERATIONS}通りの入力で、例外を投げず、通ったものは上限を超えない`, () => {
    const rng = mulberry32(0x1d0);
    const accepted = new Map<string, number>(parsers.map(([name]) => [name, 0]));
    for (let n = 0; n < ITERATIONS; n++) {
      const text = raw(rng);
      for (const [name, parse, kind] of parsers) {
        let r: ParseResult<unknown>;
        try {
          r = parse(text);
        } catch (e) {
          throw new Error(`${name} が例外を投げた: ${String(e)} 入力=${text}`);
        }
        if (!r.ok) continue;
        accepted.set(name, (accepted.get(name) ?? 0) + 1);
        const problems = checkFrame(kind, r.frame as Record<string, unknown>);
        expect(problems, `${name} 入力=${text}`).toEqual([]);
        // 通ったものは、もう一度通しても同じ（丸めた値が丸めの対象にならない）
        const again = parse(JSON.stringify(r.frame));
        expect(again, `${name} の再検証 入力=${text}`).toEqual({ ok: true, frame: r.frame });
      }
      expect(() => parseHelloFrame(text)).not.toThrow();
    }
    // すべて拒む検証は、この試験を素通りしてしまう。通ったものが一定数あることも確かめる。
    for (const [name, count] of accepted) expect(count, name).toBeGreaterThan(30);
  });
});
