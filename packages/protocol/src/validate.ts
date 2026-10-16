// 受け取ったフレームの検証（docs/protocol.md「検証と上限」）。ゲームもスマホもサーバーも、ここでは信用しない。
// 未知のキーは拒む。スマホの `in` に `p` があれば拒む（席番号のなりすましを、形の段階で止める）。
// 通ったフレームは、知っているキーだけで組み直した新しいオブジェクトで返し、数値は範囲に丸める。

import { isValidCode } from './code';
import { LIMITS } from './limits';
import { countCodePoints, fitsCodePoints, utf8Length } from './names';
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  type ButtonSpec,
  type ColorName,
  type ErrorCode,
  type HostFrame,
  type InputEvent,
  type PadFrame,
  type PadSpec,
  type PlayerId,
  type PlayerInfo,
  type ToHostFrame,
  type ToPadFrame,
} from './types';

export type ParseResult<T> = { ok: true; frame: T } | { ok: false; reason: string };
export type HostHello = Extract<HostFrame, { t: 'hello' }>;
export type PadHello = Extract<PadFrame, { t: 'hello' }>;

/**
 * 接続の生存確認。中継は Durable Object を起こさずに自動で答える（setWebSocketAutoResponse）。
 * 自動応答は文字列の完全一致なので、送る側も受ける側もこの定数を使う。型のフレームには含めない。
 */
export const HEARTBEAT_PING = '{"t":"ping"}';
export const HEARTBEAT_PONG = '{"t":"pong"}';

/** 失敗の理由。違反として数える前に、版の違いだけは見分けられるようにする（閉じるコードが違うため）。 */
export const REASON_VERSION = 'version';

// 鍵と再開の札は、長さだけ縛る。形の誤りを「形式の違反」にすると、壊れた札を持つ端末が
// 再試行し続ける（4001は再試行の対象）。照合の失敗として扱えば、鍵は 4007、札は新しい参加になる。
const KEY_MAX_CHARS = 256;
const RESUME_MAX_CHARS = 256;
const ID_RE = new RegExp(`^[a-z0-9_-]{1,${LIMITS.ID_MAX_LENGTH}}$`);
const COLORS: readonly ColorName[] = ['red', 'blue', 'green', 'yellow', 'gray'];
const STICKS = ['none', 'dpad', 'stick'] as const;
const ORIENTS = ['any', 'landscape', 'portrait'] as const;
const TOUCH_MODES = ['area', 'swipe'] as const;
const PHASES = ['s', 'm', 'e'] as const;
const LEFT_WHY = ['bye', 'timeout', 'kick'] as const;
const ERROR_CODES = Object.keys(CLOSE_CODES) as ErrorCode[];

type Obj = Record<string, unknown>;

// 検証の失敗。Error を継ぐとスタックを取る分だけ遅くなるので、軽い値を投げて attempt で受ける。
class Reject {
  constructor(readonly reason: string) {}
}

function reject(reason: string): never {
  throw new Reject(reason);
}

function attempt<T>(fn: () => T): ParseResult<T> {
  try {
    return { ok: true, frame: fn() };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.reason };
    throw e;
  }
}

function parseObject(raw: unknown): Obj {
  if (typeof raw !== 'string') reject('not-text');
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    reject('json');
  }
  return obj(v, 'frame');
}

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) reject(`${where}: object`);
  return v as Obj;
}

function onlyKeys(o: Obj, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) reject(`${where}: unknown key ${k.slice(0, 24)}`);
  }
}

// 画面の文字は符号位置で数える。書記素の数え方は ICU の版で違い、送り手と受け手で判定が食い違うと、
// 正しいフレームを「違反」として捨ててしまうため（上限の数は書記素の上限と同じ。日本語は同じ数になる）。
function text(v: unknown, max: number, where: string): string {
  if (typeof v !== 'string') reject(`${where}: string`);
  if (!fitsCodePoints(v, max)) reject(`${where}: longer than ${max}`);
  return v;
}

/** 名前の受け手の検査。lenient では長さを見ない（中継が整えた名簿を、名前の長さだけで捨てないため）。 */
function playerName(v: unknown, where: string, lenient: boolean): string {
  if (typeof v !== 'string') reject(`${where}: string`);
  if (!lenient && (countCodePoints(v) > LIMITS.NAME_MAX_CODEPOINTS || utf8Length(v) > LIMITS.NAME_MAX_BYTES)) {
    reject(`${where}: longer than ${LIMITS.NAME_MAX_CODEPOINTS} code points or ${LIMITS.NAME_MAX_BYTES} bytes`);
  }
  return v;
}

function ident(v: unknown, where: string): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) reject(`${where}: id`);
  return v;
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') reject(`${where}: boolean`);
  return v;
}

function num(v: unknown, where: string): number {
  // JSON から NaN は来ないが、1e999 は Infinity になる。範囲に丸めれば端の値になる。
  if (typeof v !== 'number' || Number.isNaN(v)) reject(`${where}: number`);
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  const c = v < lo ? lo : v > hi ? hi : v;
  return c === 0 ? 0 : c; // -0 を 0 にそろえる
}

function oneOf<T extends string>(v: unknown, values: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) reject(`${where}: one of ${values.join('|')}`);
  return v as T;
}

function seat(v: unknown, where: string): PlayerId {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > LIMITS.MAX_PLAYERS) reject(`${where}: seat`);
  return v;
}

function target(v: unknown, where: string): PlayerId | '*' {
  return v === '*' ? '*' : seat(v, where);
}

// ---- 入力 ----

function axis(v: unknown, where: string): number {
  return clamp(Math.round(clamp(num(v, where), -1, 1) * 100) / 100, -1, 1);
}

function inputEvent(v: unknown, where: string): InputEvent {
  const o = obj(v, where);
  switch (o.k) {
    case 'btn': {
      onlyKeys(o, ['k', 'id', 'd'], where);
      const d = o.d;
      if (d !== 0 && d !== 1) reject(`${where}.d: 0 or 1`);
      return { k: 'btn', id: ident(o.id, `${where}.id`), d: d === 1 ? 1 : 0 };
    }
    case 'axis':
      onlyKeys(o, ['k', 'id', 'x', 'y'], where);
      return { k: 'axis', id: ident(o.id, `${where}.id`), x: axis(o.x, `${where}.x`), y: axis(o.y, `${where}.y`) };
    case 'ptr':
      onlyKeys(o, ['k', 'id', 'x', 'y', 'ph'], where);
      return {
        k: 'ptr',
        id: ident(o.id, `${where}.id`),
        x: clamp(num(o.x, `${where}.x`), 0, 1),
        y: clamp(num(o.y, `${where}.y`), 0, 1),
        ph: oneOf(o.ph, PHASES, `${where}.ph`),
      };
    case 'pick':
      onlyKeys(o, ['k', 'id'], where);
      return { k: 'pick', id: ident(o.id, `${where}.id`) };
    case 'tilt':
      onlyKeys(o, ['k', 'a', 'b', 'g'], where);
      return {
        k: 'tilt',
        a: clamp(num(o.a, `${where}.a`), 0, 360),
        b: clamp(num(o.b, `${where}.b`), -180, 180),
        g: clamp(num(o.g, `${where}.g`), -90, 90),
      };
    case 'menu':
      onlyKeys(o, ['k'], where);
      return { k: 'menu' };
    default:
      return reject(`${where}.k: unknown`);
  }
}

// ---- コントローラーの画面 ----

function labeled(v: unknown, where: string): ButtonSpec {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'label', 'color'], where);
  const out: ButtonSpec = { id: ident(o.id, `${where}.id`), label: text(o.label, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.label`) };
  if (o.color !== undefined) out.color = oneOf(o.color, COLORS, `${where}.color`);
  return out;
}

function labeledList(v: unknown, min: number, max: number, where: string): ButtonSpec[] {
  if (!Array.isArray(v)) reject(`${where}: array`);
  if (v.length < min || v.length > max) reject(`${where}: ${min}..${max} items`);
  return v.map((item, i) => labeled(item, `${where}[${i}]`));
}

function hint(o: Obj, where: string): string | undefined {
  return o.hint === undefined ? undefined : text(o.hint, LIMITS.HINT_MAX_GRAPHEMES, `${where}.hint`);
}

function padSpec(v: unknown, allowRemote: boolean, where: string): PadSpec {
  const o = obj(v, where);
  switch (o.k) {
    case 'wait': {
      onlyKeys(o, ['k', 'title', 'body'], where);
      const s: Extract<PadSpec, { k: 'wait' }> = { k: 'wait' };
      if (o.title !== undefined) s.title = text(o.title, LIMITS.TITLE_MAX_GRAPHEMES, `${where}.title`);
      if (o.body !== undefined) s.body = text(o.body, LIMITS.BODY_MAX_GRAPHEMES, `${where}.body`);
      return s;
    }
    case 'pad': {
      onlyKeys(o, ['k', 'stick', 'buttons', 'hint', 'orient'], where);
      const s: Extract<PadSpec, { k: 'pad' }> = { k: 'pad' };
      if (o.stick !== undefined) s.stick = oneOf(o.stick, STICKS, `${where}.stick`);
      if (o.buttons !== undefined) s.buttons = labeledList(o.buttons, 0, LIMITS.BUTTONS_MAX, `${where}.buttons`);
      const h = hint(o, where);
      if (h !== undefined) s.hint = h;
      if (o.orient !== undefined) s.orient = oneOf(o.orient, ORIENTS, `${where}.orient`);
      return s;
    }
    case 'buzzer': {
      onlyKeys(o, ['k', 'label', 'color', 'disabled', 'hint'], where);
      const s: Extract<PadSpec, { k: 'buzzer' }> = { k: 'buzzer', label: text(o.label, LIMITS.LABEL_MAX_GRAPHEMES, `${where}.label`) };
      if (o.color !== undefined) s.color = oneOf(o.color, COLORS, `${where}.color`);
      if (o.disabled !== undefined) s.disabled = bool(o.disabled, `${where}.disabled`);
      const h = hint(o, where);
      if (h !== undefined) s.hint = h;
      return s;
    }
    case 'choices': {
      onlyKeys(o, ['k', 'options', 'disabled', 'hint'], where);
      const s: Extract<PadSpec, { k: 'choices' }> = {
        k: 'choices',
        options: labeledList(o.options, LIMITS.CHOICES_MIN, LIMITS.CHOICES_MAX, `${where}.options`),
      };
      if (o.disabled !== undefined) s.disabled = bool(o.disabled, `${where}.disabled`);
      const h = hint(o, where);
      if (h !== undefined) s.hint = h;
      return s;
    }
    case 'touch': {
      onlyKeys(o, ['k', 'mode', 'hint'], where);
      const s: Extract<PadSpec, { k: 'touch' }> = { k: 'touch' };
      if (o.mode !== undefined) s.mode = oneOf(o.mode, TOUCH_MODES, `${where}.mode`);
      const h = hint(o, where);
      if (h !== undefined) s.hint = h;
      return s;
    }
    case 'tilt': {
      onlyKeys(o, ['k', 'buttons', 'hint'], where);
      const s: Extract<PadSpec, { k: 'tilt' }> = { k: 'tilt' };
      if (o.buttons !== undefined) s.buttons = labeledList(o.buttons, 0, LIMITS.BUTTONS_MAX, `${where}.buttons`);
      const h = hint(o, where);
      if (h !== undefined) s.hint = h;
      return s;
    }
    case 'remote': {
      if (!allowRemote) reject(`${where}.k: remote is console only`);
      onlyKeys(o, ['k', 'hint'], where);
      const s: Extract<PadSpec, { k: 'remote' }> = { k: 'remote' };
      const h = hint(o, where);
      if (h !== undefined) s.hint = h;
      return s;
    }
    default:
      return reject(`${where}.k: unknown`);
  }
}

function fxPattern(v: unknown, where: string): number[] {
  if (!Array.isArray(v)) reject(`${where}: array`);
  if (v.length > LIMITS.FX_PATTERN_MAX) reject(`${where}: at most ${LIMITS.FX_PATTERN_MAX}`);
  return v.map((n, i) => Math.round(clamp(num(n, `${where}[${i}]`), 0, LIMITS.FX_MS_MAX)));
}

// ---- 握手 ----

function hostHello(o: Obj): HostHello {
  if (o.v !== PROTOCOL_VERSION) reject(REASON_VERSION);
  onlyKeys(o, ['t', 'v', 'role', 'key'], 'hello');
  if (o.role !== 'host') reject('hello.role');
  if (typeof o.key !== 'string' || o.key.length > KEY_MAX_CHARS) reject('hello.key');
  return { t: 'hello', v: PROTOCOL_VERSION, role: 'host', key: o.key };
}

function padHello(o: Obj): PadHello {
  if (o.v !== PROTOCOL_VERSION) reject(REASON_VERSION);
  onlyKeys(o, ['t', 'v', 'role', 'name', 'resume'], 'hello');
  if (o.role !== 'pad') reject('hello.role');
  const f: PadHello = { t: 'hello', v: PROTOCOL_VERSION, role: 'pad' };
  // 名前は中継の側で sanitizeName を通す。ここでは型だけ見る（大きさはフレームの上限が縛る）。
  if (o.name !== undefined) {
    if (typeof o.name !== 'string') reject('hello.name');
    f.name = o.name;
  }
  if (o.resume !== undefined) {
    if (typeof o.resume !== 'string' || o.resume.length > RESUME_MAX_CHARS) reject('hello.resume');
    f.resume = o.resume;
  }
  return f;
}

// ---- フレーム ----

function hostFrame(o: Obj): HostFrame {
  switch (o.t) {
    case 'hello':
      return hostHello(o);
    case 'pad':
      onlyKeys(o, ['t', 'to', 'spec'], 'pad');
      return { t: 'pad', to: target(o.to, 'pad.to'), spec: padSpec(o.spec, true, 'pad.spec') };
    case 'fx':
      onlyKeys(o, ['t', 'to', 'ms'], 'fx');
      return { t: 'fx', to: target(o.to, 'fx.to'), ms: fxPattern(o.ms, 'fx.ms') };
    case 'kick':
      onlyKeys(o, ['t', 'p'], 'kick');
      return { t: 'kick', p: seat(o.p, 'kick.p') };
    case 'lock':
      onlyKeys(o, ['t', 'on'], 'lock');
      return { t: 'lock', on: bool(o.on, 'lock.on') };
    case 'close':
      onlyKeys(o, ['t'], 'close');
      return { t: 'close' };
    default:
      return reject('t: unknown');
  }
}

function padFrame(o: Obj): PadFrame {
  switch (o.t) {
    case 'hello':
      return padHello(o);
    case 'in':
      onlyKeys(o, ['t', 'i'], 'in');
      return { t: 'in', i: inputEvent(o.i, 'in.i') };
    case 'bye':
      onlyKeys(o, ['t'], 'bye');
      return { t: 'bye' };
    default:
      return reject('t: unknown');
  }
}

function playerInfo(v: unknown, where: string, lenient: boolean): PlayerInfo {
  const o = obj(v, where);
  onlyKeys(o, ['id', 'name', 'online'], where);
  return {
    id: seat(o.id, `${where}.id`),
    name: playerName(o.name, `${where}.name`, lenient),
    online: bool(o.online, `${where}.online`),
  };
}

function errorCode(v: unknown, where: string): ErrorCode {
  return oneOf(v, ERROR_CODES, where);
}

function toHostFrame(o: Obj, lenient: boolean): ToHostFrame {
  switch (o.t) {
    case 'welcome': {
      onlyKeys(o, ['t', 'role', 'code', 'players', 'max', 'locked'], 'welcome');
      if (o.role !== 'host') reject('welcome.role');
      if (!isValidCode(o.code)) reject('welcome.code');
      if (!Array.isArray(o.players) || o.players.length > LIMITS.MAX_PLAYERS) reject('welcome.players');
      return {
        t: 'welcome',
        role: 'host',
        code: o.code,
        players: o.players.map((p, i) => playerInfo(p, `welcome.players[${i}]`, lenient)),
        max: seat(o.max, 'welcome.max'),
        locked: bool(o.locked, 'welcome.locked'),
      };
    }
    case 'joined':
      onlyKeys(o, ['t', 'p'], 'joined');
      return { t: 'joined', p: playerInfo(o.p, 'joined.p', lenient) };
    case 'left':
      onlyKeys(o, ['t', 'p', 'why'], 'left');
      return { t: 'left', p: seat(o.p, 'left.p'), why: oneOf(o.why, LEFT_WHY, 'left.why') };
    case 'online':
      onlyKeys(o, ['t', 'p', 'on'], 'online');
      return { t: 'online', p: seat(o.p, 'online.p'), on: bool(o.on, 'online.on') };
    case 'in': {
      onlyKeys(o, ['t', 'p', 'i', 'T'], 'in');
      const T = num(o.T, 'in.T');
      if (!Number.isFinite(T) || T < 0) reject('in.T');
      return { t: 'in', p: seat(o.p, 'in.p'), i: inputEvent(o.i, 'in.i'), T };
    }
    case 'pad?':
      onlyKeys(o, ['t', 'p'], 'pad?');
      return { t: 'pad?', p: seat(o.p, 'pad?.p') };
    case 'err':
      onlyKeys(o, ['t', 'code'], 'err');
      return { t: 'err', code: errorCode(o.code, 'err.code') };
    default:
      return reject('t: unknown');
  }
}

function toPadFrame(o: Obj, lenient: boolean): ToPadFrame {
  switch (o.t) {
    case 'welcome': {
      onlyKeys(o, ['t', 'role', 'you', 'resume', 'host'], 'welcome');
      if (o.role !== 'pad') reject('welcome.role');
      if (typeof o.resume !== 'string' || o.resume.length > RESUME_MAX_CHARS) reject('welcome.resume');
      return { t: 'welcome', role: 'pad', you: playerInfo(o.you, 'welcome.you', lenient), resume: o.resume, host: bool(o.host, 'welcome.host') };
    }
    case 'pad':
      onlyKeys(o, ['t', 'spec'], 'pad');
      return { t: 'pad', spec: padSpec(o.spec, true, 'pad.spec') };
    case 'fx':
      onlyKeys(o, ['t', 'ms'], 'fx');
      return { t: 'fx', ms: fxPattern(o.ms, 'fx.ms') };
    case 'host':
      onlyKeys(o, ['t', 'on'], 'host');
      return { t: 'host', on: bool(o.on, 'host.on') };
    case 'kicked':
      onlyKeys(o, ['t'], 'kicked');
      return { t: 'kicked' };
    case 'closed':
      onlyKeys(o, ['t'], 'closed');
      return { t: 'closed' };
    case 'err':
      onlyKeys(o, ['t', 'code'], 'err');
      return { t: 'err', code: errorCode(o.code, 'err.code') };
    default:
      return reject('t: unknown');
  }
}

// ---- 入口 ----

/** ホスト → サーバー。 */
export function parseHostFrame(raw: string): ParseResult<HostFrame> {
  return attempt(() => hostFrame(parseObject(raw)));
}

/** スマホ → サーバー。 */
export function parsePadFrame(raw: string): ParseResult<PadFrame> {
  return attempt(() => padFrame(parseObject(raw)));
}

/** 役割がまだ決まっていない接続の、最初のフレーム。版が違うときは reason が REASON_VERSION になる。 */
export function parseHelloFrame(raw: string): ParseResult<HostHello | PadHello> {
  return attempt(() => {
    const o = parseObject(raw);
    if (o.t !== 'hello') reject('t: not hello');
    if (o.v !== PROTOCOL_VERSION) reject(REASON_VERSION);
    if (o.role === 'host') return hostHello(o);
    if (o.role === 'pad') return padHello(o);
    return reject('hello.role');
  });
}

export interface ClientParseOptions {
  /**
   * 名簿（welcome・joined）の名前を、長さだけでは拒まない。room-client はこれを使う。
   * 中継と受け手の版が違っても、名前1つで名簿を丸ごと捨てて部屋に戻れなくならないようにするため。表示の側で切る。
   */
  lenientNames?: boolean;
}

/** サーバー → ホスト。クライアントの側で使う。 */
export function parseToHostFrame(raw: string, opts: ClientParseOptions = {}): ParseResult<ToHostFrame> {
  return attempt(() => toHostFrame(parseObject(raw), opts.lenientNames === true));
}

/** サーバー → スマホ。クライアントの側で使う。 */
export function parseToPadFrame(raw: string, opts: ClientParseOptions = {}): ParseResult<ToPadFrame> {
  return attempt(() => toPadFrame(parseObject(raw), opts.lenientNames === true));
}

/** コントローラーの画面だけを検査する。ゲームから来たものは allowRemote を false にする（remote はコンソール専用）。 */
export function validatePadSpec(value: unknown, allowRemote = false): ParseResult<PadSpec> {
  return attempt(() => padSpec(value, allowRemote, 'spec'));
}
