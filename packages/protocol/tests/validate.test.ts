import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  LIMITS,
  REASON_VERSION,
  parseHelloFrame,
  parseHostFrame,
  parsePadFrame,
  parseToHostFrame,
  parseToPadFrame,
  utf8Length,
  validatePadSpec,
} from '../src/index';

const J = JSON.stringify;
const ok = <T>(r: { ok: true; frame: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(`拒否された: ${r.reason}`);
  return r.frame;
};
const FAMILY = '👨\u{200d}👩\u{200d}👧'; // 3人の家族。符号単位は8つだが、1書記素
const rep = (s: string, n: number) => s.repeat(n);

describe('ホスト → サーバー', () => {
  const valid: Array<[string, unknown, unknown?]> = [
    ['hello', { t: 'hello', v: 1, role: 'host', key: 'k'.repeat(43) }],
    ['全員に画面', { t: 'pad', to: '*', spec: { k: 'wait', title: '待って', body: '次のゲーム' } }],
    ['1人に画面', { t: 'pad', to: 3, spec: { k: 'buzzer', label: '押す', color: 'red', disabled: false, hint: '早押し' } }],
    ['remote はコンソールから送れる', { t: 'pad', to: 8, spec: { k: 'remote', hint: '選ぶ' } }],
    ['振動', { t: 'fx', to: '*', ms: [100, 50, 100] }],
    ['振動を止める（空）', { t: 'fx', to: 2, ms: [] }],
    // 1e999 は JSON.parse で Infinity になる。JSON.stringify では書けないので、生の文字列で渡す。
    ['振動は範囲に丸める', '{"t":"fx","to":1,"ms":[-5,0.4,1000.6,5000,1e999]}', { t: 'fx', to: 1, ms: [0, 0, 1000, 1000, 1000] }],
    ['外す', { t: 'kick', p: 8 }],
    ['ロック', { t: 'lock', on: true }],
    ['閉じる', { t: 'close' }],
  ];
  it.each(valid)('通る: %s', (_name, input, expected) => {
    const raw = typeof input === 'string' ? input : J(input);
    expect(ok(parseHostFrame(raw))).toEqual(expected ?? input);
  });

  const invalid: Array<[string, string]> = [
    ['JSONでない', '{t:'],
    ['配列', '[1]'],
    ['null', 'null'],
    ['文字列', '"pad"'],
    ['未知の種類', J({ t: 'boom' })],
    ['未知のキー', J({ t: 'close', x: 1 })],
    ['__proto__', '{"t":"close","__proto__":{"x":1}}'],
    ['宛先0', J({ t: 'pad', to: 0, spec: { k: 'wait' } })],
    ['宛先9', J({ t: 'pad', to: 9, spec: { k: 'wait' } })],
    ['宛先が小数', J({ t: 'pad', to: 1.5, spec: { k: 'wait' } })],
    ['宛先が文字の数', J({ t: 'pad', to: '1', spec: { k: 'wait' } })],
    ['振動が9個', J({ t: 'fx', to: '*', ms: [1, 1, 1, 1, 1, 1, 1, 1, 1] })],
    ['振動が数でない', J({ t: 'fx', to: '*', ms: ['1'] })],
    ['外す席が範囲外', J({ t: 'kick', p: 0 })],
    ['ロックが真偽でない', J({ t: 'lock', on: 1 })],
    ['hello の鍵がない', J({ t: 'hello', v: 1, role: 'host' })],
    ['hello の鍵が長すぎる', J({ t: 'hello', v: 1, role: 'host', key: 'k'.repeat(257) })],
    ['hello の役割がスマホ', J({ t: 'hello', v: 1, role: 'pad' })],
    ['スマホの入力はホストから送れない', J({ t: 'in', i: { k: 'menu' } })],
  ];
  it.each(invalid)('拒む: %s', (_name, raw) => {
    expect(parseHostFrame(raw).ok).toBe(false);
  });

  it('版が違う hello は、理由で見分けられる', () => {
    const r = parseHostFrame(J({ t: 'hello', v: 2, role: 'host', key: 'k', extra: true }));
    expect(r).toEqual({ ok: false, reason: REASON_VERSION });
  });
});

describe('スマホ → サーバー', () => {
  const inputs: Array<[string, unknown, unknown?]> = [
    ['ボタン', { k: 'btn', id: 'jump', d: 1 }],
    ['ボタンを離す', { k: 'btn', id: 'a-b_9', d: 0 }],
    ['スティックは小数2桁', { k: 'axis', id: 'stick', x: 0.123456, y: -0.995 }, { k: 'axis', id: 'stick', x: 0.12, y: -0.99 }],
    ['スティックは -1〜1', { k: 'axis', id: 'stick', x: 5, y: -7 }, { k: 'axis', id: 'stick', x: 1, y: -1 }],
    ['-0 は 0', { k: 'axis', id: 'dpad', x: -0, y: -0.001 }, { k: 'axis', id: 'dpad', x: 0, y: 0 }],
    ['タッチは 0〜1', { k: 'ptr', id: 'area', x: -0.5, y: 1.5, ph: 'm' }, { k: 'ptr', id: 'area', x: 0, y: 1, ph: 'm' }],
    ['選ぶ', { k: 'pick', id: 'c2' }],
    ['傾き', { k: 'tilt', a: 400, b: -200, g: 95 }, { k: 'tilt', a: 360, b: -180, g: 90 }],
    ['傾きの内側はそのまま', { k: 'tilt', a: 12.5, b: -33.25, g: 0 }],
    ['メニュー', { k: 'menu' }],
  ];
  it.each(inputs)('入力が通る: %s', (_name, i, expected) => {
    expect(ok(parsePadFrame(J({ t: 'in', i })))).toEqual({ t: 'in', i: expected ?? i });
  });

  const invalid: Array<[string, unknown]> = [
    ['席番号を名乗る（なりすまし）', { t: 'in', p: 1, i: { k: 'menu' } }],
    ['入力の中で席番号を名乗る', { t: 'in', i: { k: 'btn', id: 'a', d: 1, p: 1 } }],
    ['受信時刻を名乗る', { t: 'in', i: { k: 'menu' }, T: 1 }],
    ['ボタンが 2', { t: 'in', i: { k: 'btn', id: 'a', d: 2 } }],
    ['ボタンが真偽', { t: 'in', i: { k: 'btn', id: 'a', d: true } }],
    ['id が大文字', { t: 'in', i: { k: 'pick', id: 'A' } }],
    ['id が空', { t: 'in', i: { k: 'pick', id: '' } }],
    ['id が25文字', { t: 'in', i: { k: 'pick', id: 'a'.repeat(25) } }],
    ['id に記号', { t: 'in', i: { k: 'pick', id: 'a.b' } }],
    ['座標が文字', { t: 'in', i: { k: 'axis', id: 's', x: '0', y: 0 } }],
    ['段階が不明', { t: 'in', i: { k: 'ptr', id: 's', x: 0, y: 0, ph: 'x' } }],
    ['入力の種類が不明', { t: 'in', i: { k: 'key', id: 's' } }],
    ['ホスト専用（外す）', { t: 'kick', p: 1 }],
    ['ホスト専用（画面）', { t: 'pad', to: 1, spec: { k: 'wait' } }],
    ['hello の名前が数', { t: 'hello', v: 1, role: 'pad', name: 3 }],
    ['hello に鍵', { t: 'hello', v: 1, role: 'pad', key: 'x' }],
  ];
  it.each(invalid)('拒む: %s', (_name, input) => {
    expect(parsePadFrame(J(input)).ok).toBe(false);
  });

  it('JSON の 1e999（Infinity）も範囲の端に丸める', () => {
    expect(ok(parsePadFrame('{"t":"in","i":{"k":"axis","id":"s","x":1e999,"y":-1e999}}'))).toEqual({
      t: 'in',
      i: { k: 'axis', id: 's', x: 1, y: -1 },
    });
  });

  it('hello の名前は生のまま渡す（掃除は中継の仕事）', () => {
    const f = ok(parsePadFrame(J({ t: 'hello', v: 1, role: 'pad', name: ' <b>x</b> ', resume: 'abc' })));
    expect(f).toEqual({ t: 'hello', v: 1, role: 'pad', name: ' <b>x</b> ', resume: 'abc' });
  });

  it('文字列でない入力は、例外を投げずに拒む', () => {
    expect(parsePadFrame(123 as unknown as string).ok).toBe(false);
    expect(parsePadFrame(undefined as unknown as string).ok).toBe(false);
  });
});

describe('最初のフレーム', () => {
  it('役割ごとに hello を返す', () => {
    expect(ok(parseHelloFrame(J({ t: 'hello', v: 1, role: 'host', key: 'abc' })))).toEqual({ t: 'hello', v: 1, role: 'host', key: 'abc' });
    expect(ok(parseHelloFrame(J({ t: 'hello', v: 1, role: 'pad' })))).toEqual({ t: 'hello', v: 1, role: 'pad' });
  });
  it('hello 以外・役割なし・版違いを分ける', () => {
    expect(parseHelloFrame(J({ t: 'in', i: { k: 'menu' } })).ok).toBe(false);
    expect(parseHelloFrame(J({ t: 'hello', v: 1, role: 'admin' })).ok).toBe(false);
    expect(parseHelloFrame(J({ t: 'hello', role: 'pad' }))).toEqual({ ok: false, reason: REASON_VERSION });
    expect(parseHelloFrame(J({ t: 'hello', v: '1', role: 'pad' }))).toEqual({ ok: false, reason: REASON_VERSION });
  });
});

describe('コントローラーの画面', () => {
  const html = '<img src=x onerror=alert(1)>';
  const valid: Array<[string, unknown]> = [
    ['待ち（空）', { k: 'wait' }],
    ['待ち（上限ちょうど）', { k: 'wait', title: rep('あ', 24), body: rep('あ', 120) }],
    ['絵文字は符号位置で数える（家族の絵文字は5つ）', { k: 'buzzer', label: `${FAMILY}${FAMILY}` }],
    ['HTMLらしい文字も文字として通す', { k: 'wait', title: '<b>x</b>', body: html }],
    ['パッド', { k: 'pad', stick: 'dpad', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', color: 'blue' }], hint: 'h', orient: 'landscape' }],
    ['パッド（ボタン4つ）', { k: 'pad', buttons: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, label: rep('字', 12) })) }],
    ['パッド（空のボタン）', { k: 'pad', stick: 'none', buttons: [] }],
    ['早押し', { k: 'buzzer', label: '', color: 'gray' }],
    ['選択（2つ）', { k: 'choices', options: [{ id: 'y', label: 'はい' }, { id: 'n', label: 'いいえ', color: 'green' }], disabled: true }],
    ['選択（6つ）', { k: 'choices', options: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `c${n}`, label: `${n}` })) }],
    ['なぞる', { k: 'touch', mode: 'swipe', hint: rep('ヒ', 40) }],
    ['傾き', { k: 'tilt', buttons: [{ id: 'fire', label: '発射', color: 'yellow' }] }],
  ];
  it.each(valid)('通る: %s', (_name, spec) => {
    expect(ok(validatePadSpec(spec))).toEqual(spec);
  });

  const invalid: Array<[string, unknown]> = [
    ['種類が不明', { k: 'html', html: '<div>' }],
    ['見出しが25字', { k: 'wait', title: rep('あ', 25) }],
    ['本文が121字', { k: 'wait', body: rep('あ', 121) }],
    ['書記素では12でも、符号位置で13を超える', { k: 'buzzer', label: rep(FAMILY, 3) }],
    ['ヒントが41字', { k: 'touch', hint: rep('ヒ', 41) }],
    ['ボタンの文字が13字', { k: 'buzzer', label: rep('字', 13) }],
    ['ボタンが5つ', { k: 'pad', buttons: [1, 2, 3, 4, 5].map((n) => ({ id: `b${n}`, label: 'x' })) }],
    ['選択肢が1つ', { k: 'choices', options: [{ id: 'a', label: 'a' }] }],
    ['選択肢が7つ', { k: 'choices', options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `c${n}`, label: 'x' })) }],
    ['色が名前でない', { k: 'buzzer', label: 'x', color: '#f00' }],
    ['色がCSS', { k: 'buzzer', label: 'x', color: 'red;background:url(x)' }],
    ['ボタンの id が大文字', { k: 'pad', buttons: [{ id: 'A', label: 'x' }] }],
    ['ボタンに未知のキー', { k: 'pad', buttons: [{ id: 'a', label: 'x', html: '<b>' }] }],
    ['画面に未知のキー', { k: 'wait', style: 'color:red' }],
    ['スティックの種類が不明', { k: 'pad', stick: 'wheel' }],
    ['向きが不明', { k: 'pad', orient: 'up' }],
    ['無効が文字', { k: 'buzzer', label: 'x', disabled: 'true' }],
    ['ボタンの文字がない', { k: 'buzzer' }],
    ['ゲームは remote を指定できない', { k: 'remote' }],
    ['null の省略可能項目', { k: 'wait', title: null }],
  ];
  it.each(invalid)('拒む: %s', (_name, spec) => {
    expect(validatePadSpec(spec).ok).toBe(false);
  });

  it('コンソールは remote を指定できる', () => {
    expect(ok(validatePadSpec({ k: 'remote', hint: 'x' }, true))).toEqual({ k: 'remote', hint: 'x' });
  });
});

describe('サーバー → クライアント', () => {
  const players = [{ id: 1, name: 'たろう', online: true }, { id: 2, name: 'プレイヤー2', online: false }];
  const toHost: unknown[] = [
    { t: 'welcome', role: 'host', code: 'BCDF', players, max: 8, locked: false },
    { t: 'joined', p: { id: 3, name: FAMILY, online: true } },
    { t: 'left', p: 3, why: 'timeout' },
    { t: 'online', p: 1, on: false },
    { t: 'in', p: 2, i: { k: 'btn', id: 'ok', d: 1 }, T: 1_760_000_000_000 },
    { t: 'pad?', p: 4 },
    { t: 'err', code: 'rate' },
  ];
  it.each(toHost.map((f) => [J(f), f]))('ホストが受け取る: %s', (raw, f) => {
    expect(ok(parseToHostFrame(raw))).toEqual(f);
  });

  const toPad: unknown[] = [
    { t: 'welcome', role: 'pad', you: { id: 2, name: 'はなこ', online: true }, resume: 'abc_-', host: false },
    { t: 'pad', spec: { k: 'remote' } },
    { t: 'fx', ms: [200] },
    { t: 'host', on: true },
    { t: 'kicked' },
    { t: 'closed' },
    { t: 'err', code: 'replaced' },
  ];
  it.each(toPad.map((f) => [J(f), f]))('スマホが受け取る: %s', (raw, f) => {
    expect(ok(parseToPadFrame(raw))).toEqual(f);
  });

  it.each([
    ['ホスト: 版の違う役割', parseToHostFrame, { t: 'welcome', role: 'pad', code: 'BCDF', players: [], max: 8, locked: false }],
    ['ホスト: コードが不正', parseToHostFrame, { t: 'welcome', role: 'host', code: 'AEIO', players: [], max: 8, locked: false }],
    ['ホスト: 名前が33符号位置', parseToHostFrame, { t: 'joined', p: { id: 1, name: rep('あ', 33), online: true } }],
    ['ホスト: 名前が96バイトを超える', parseToHostFrame, { t: 'joined', p: { id: 1, name: rep('😀', 25), online: true } }],
    ['スマホ: 自分の名前が長すぎる', parseToPadFrame, { t: 'welcome', role: 'pad', you: { id: 1, name: rep('あ', 33), online: true }, resume: 'r', host: true }],
    ['ホスト: 受信時刻が負', parseToHostFrame, { t: 'in', p: 1, i: { k: 'menu' }, T: -1 }],
    ['ホスト: 未知の誤り', parseToHostFrame, { t: 'err', code: 'oops' }],
    ['スマホ: 未知の種類', parseToPadFrame, { t: 'pong' }],
    ['スマホ: 振動が多すぎる', parseToPadFrame, { t: 'fx', ms: [1, 1, 1, 1, 1, 1, 1, 1, 1] }],
  ] as const)('拒む: %s', (_name, parse, f) => {
    expect(parse(J(f)).ok).toBe(false);
  });

  it('名前は符号位置32・96バイトまで。ちょうどなら通る', () => {
    expect(parseToHostFrame(J({ t: 'joined', p: { id: 1, name: rep('あ', 32), online: true } })).ok).toBe(true);
    expect(parseToHostFrame(J({ t: 'joined', p: { id: 1, name: rep('😀', 24), online: true } })).ok).toBe(true);
  });

  it('lenientNames では、名簿の名前を長さだけでは拒まない（形の誤りは拒む）', () => {
    const long = { t: 'joined', p: { id: 1, name: rep('あ', 200), online: true } };
    expect(parseToHostFrame(J(long)).ok).toBe(false);
    expect(ok(parseToHostFrame(J(long), { lenientNames: true }))).toEqual(long);
    const welcome = { t: 'welcome', role: 'host', code: 'BCDF', players: [{ id: 1, name: rep('ဩ', 99), online: true }], max: 8, locked: false };
    expect(ok(parseToHostFrame(J(welcome), { lenientNames: true }))).toEqual(welcome);
    const you = { t: 'welcome', role: 'pad', you: { id: 2, name: rep('あ', 50), online: true }, resume: 'r', host: false };
    expect(ok(parseToPadFrame(J(you), { lenientNames: true }))).toEqual(you);
    expect(parseToHostFrame(J({ t: 'joined', p: { id: 1, name: 5, online: true } }), { lenientNames: true }).ok).toBe(false);
    expect(parseToHostFrame(J({ t: 'joined', p: { id: 9, name: 'a', online: true } }), { lenientNames: true }).ok).toBe(false);
  });

  it('生存確認は型のフレームに含めない（自動応答の文字列は完全一致）', () => {
    expect(HEARTBEAT_PING).toBe('{"t":"ping"}');
    expect(HEARTBEAT_PONG).toBe('{"t":"pong"}');
    expect(parseToHostFrame(HEARTBEAT_PONG).ok).toBe(false);
    expect(parseHostFrame(HEARTBEAT_PING).ok).toBe(false);
  });
});

describe('バイト数', () => {
  it.each(['', 'abc', 'é', '漢字', '😀', FAMILY, 'a\u{10ffff}b'])('UTF-8 の長さが TextEncoder と一致: %s', (s) => {
    expect(utf8Length(s)).toBe(new TextEncoder().encode(s).byteLength);
  });
  it('対のないサロゲートは置換文字（3バイト）として数える', () => {
    const lone = String.fromCharCode(0xd800);
    expect(utf8Length(lone)).toBe(new TextEncoder().encode(lone).byteLength);
    expect(utf8Length(`a${lone}b`)).toBe(5);
  });
  it('上限の値は LIMITS と同じ', () => {
    expect(LIMITS.FRAME_MAX_BYTES).toEqual({ pad: 512, host: 16_384 });
  });
});

describe('tilesの境界', () => {
  const tiles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, label: '札', sub: '補助', color: 'red', off: false }));
  const spec = { k: 'tiles', tiles: tiles(20), ok: '出す', pass: 'パス', min: 1, max: 8, note: '状況', hint: '選ぶ' };
  it('20枚・8枚選択・空札・全offを通し、任意キーを補わない', () => {
    expect(ok(validatePadSpec(spec))).toEqual(spec);
    expect(ok(parseHostFrame(J({ t: 'pad', to: 1, spec })))).toEqual({ t: 'pad', to: 1, spec });
    for (const list of [[], tiles(1).map((t) => ({ ...t, off: true }))]) {
      expect(ok(validatePadSpec({ k: 'tiles', tiles: list, ok: '確認' }))).toEqual({ k: 'tiles', tiles: list, ok: '確認' });
    }
    for (const i of [{ k: 'tiles', ids: tiles(8).map((t) => t.id) }, { k: 'tiles', ids: [], pass: true }, { k: 'tiles', ids: [] }]) {
      expect(ok(parsePadFrame(J({ t: 'in', i })))).toEqual({ t: 'in', i });
    }
  });
  it.each([
    { tiles: tiles(21) }, { tiles: [tiles(1)[0], tiles(1)[0]] }, { max: 9 }, { min: 9 }, { min: -1 }, { max: 1.5 },
    { tiles: [{ id: 'a', label: 'A', off: true }], max: 1 }, { tiles: [], min: 1 }, { min: 2, max: 1 },
    { ok: 'あ'.repeat(13) }, { pass: 'あ'.repeat(13) }, { note: 'あ'.repeat(121) }, { hint: 'あ'.repeat(41) },
    { tiles: [{ id: 'A', label: 'A' }] }, { tiles: [{ id: 'a'.repeat(25), label: 'A' }] },
    { tiles: [{ id: 'a', label: 'あ'.repeat(13) }] }, { tiles: [{ id: 'a', label: 'A', sub: 'あ'.repeat(13) }] },
    { tiles: [{ id: 'a', label: 'A', color: 'pink' }] }, { tiles: [{ id: 'a', label: 'A', off: 1 }] },
    { tiles: [{ id: 'a', label: 'A', html: 'x' }] }, { disabled: 'yes' }, { extra: 1 },
  ])('不正な指定を拒む %j', (patch) => {
    expect(validatePadSpec({ ...spec, ...patch }).ok).toBe(false);
  });
  it.each([
    { ids: ['a', 'a'] }, { ids: tiles(9).map((t) => t.id) }, { ids: ['A'] }, { ids: ['a'.repeat(25)] }, { ids: 'a' },
    { ids: [], pass: false }, { ids: ['a'], pass: true }, { ids: [], pass: 1 }, { ids: [], x: 1 },
  ])('不正な入力を拒む %j', (patch) => {
    expect(parsePadFrame(J({ t: 'in', i: { k: 'tiles', ...patch } })).ok).toBe(false);
  });
  it('最長の8識別子の入力も512バイト以内', () => {
    const raw = J({ t: 'in', i: { k: 'tiles', ids: tiles(8).map((_, i) => `t${i}`.padEnd(24, 'a')) } });
    expect(utf8Length(raw)).toBeLessThanOrEqual(512);
    expect(parsePadFrame(raw).ok).toBe(true);
  });
});
