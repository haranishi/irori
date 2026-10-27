// 実ホスト・実Worker・席ごとの独立文脈を通す下書き。実行はメインに引き継ぐ。
import { expect, test, type Host, type Pad } from './fixtures';
import { HOST } from './lib/tags';
import type { PadSpec } from '../../../packages/protocol/src/types';

type Tiles = Extract<PadSpec, { k: 'tiles' }>;
const NAMES = ['あさぎ', 'こはく', 'つばき', 'すみれ', 'わかば'];
const ROLES = ['村人', '人狼', '占い師', '騎士', '狂人'];
const cardWords = (text: string): string[] => text.match(/ジョーカー[12]|[♠♥♦♣](?:10|[2-9JQKA])|\bJK\b/g) ?? [];
const unique = (values: string[]): string[] => [...new Set(values)];
/** 大画面の文字と、読み上げの名前（札の絵は role=img の aria-label で札の名前を持ち、innerText には出ない）。 */
const hostSurface = (host: Host): Promise<string | null> => host.inGame(() => [document.body.innerText, ...[...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '')].join('\n'));
const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings)
  : value !== null && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const latest = (pad: Pad): PadSpec | undefined => pad.receivedFrames().at(-1);
const hand = (spec: PadSpec | undefined, game: 'daifugo' | 'old-maid'): string[] => {
  if (!spec) return [];
  if (game === 'daifugo') return spec.k === 'tiles' ? spec.tiles.map((tile) => tile.label) : [];
  // 引く札は位置番号。本人の手札はnote/bodyの「あなた：」以降だけ。
  return cardWords(strings(spec).find((s) => s.startsWith('あなた：')) ?? '');
};

/** 札の境界で比較する。♠3が♠10の部分一致になる検査にはしない。 */
function cardLeaks(spec: PadSpec, foreignCards: string[], foreignIds: string[], allowed: string[]): string[] {
  const text = strings(spec).join('\n');
  const rawId = (label: string): string => label.startsWith('ジョーカー') ? `jk${label.slice(-1)}`
    : label === 'JK' ? 'jk' : `${({ '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' } as Record<string, string>)[label[0]!] ?? ''}${label.slice(1).toLowerCase()}`;
  return unique([
    ...cardWords(text).filter((word) => foreignCards.includes(word) && !allowed.includes(word)),
    ...strings(spec).filter((word) => foreignIds.includes(word)),
    ...foreignCards.filter((card) => !allowed.includes(card) && strings(spec).some((s) => new RegExp(`(^|[^a-z0-9])${rawId(card)}($|[^a-z0-9])`).test(s))),
  ]);
}

/** この対戦の受信履歴をカーソルで走査。一手の前後で移動した札と公開済みの場を区別する。 */
class CardPrivacy {
  private readonly cursors: number[];
  private previous: string[][];
  constructor(private readonly game: 'daifugo' | 'old-maid', private readonly pads: Pad[]) {
    this.cursors = pads.map((pad) => Math.max(0, pad.receivedFrames().length - 1));
    this.previous = pads.map(() => []);
  }
  async scan(host: Host, drawer?: Pad): Promise<void> {
    let snapshots: (PadSpec | undefined)[] = [];
    let hands: string[][] = [];
    // 一手のあとは、引いた席と引かれた席の画面の届く時刻がずれる。ずれの間は、同じ札が2席に見えることがある。そろうまで待つ。
    await expect.poll(() => {
      snapshots = this.pads.map((pad) => latest(pad));
      hands = snapshots.map((spec) => hand(spec, this.game));
      return unique(hands.flat()).length === hands.flat().length;
    }, { timeout: 5_000, message: '同じ札を複数席の手札に含めない' }).toBe(true);
    const hostText = await hostSurface(host);
    const ended = await host.state() === 'results' || await host.phase() === 'ended';
    const publicCards = cardWords(hostText ?? '');
    for (const [i, pad] of this.pads.entries()) {
      const own = unique([...(this.previous[i] ?? []), ...hands[i]!]);
      const foreign = unique(hands.flatMap((cards, j) => i === j ? [] : [...cards, ...(this.previous[j] ?? [])]));
      const foreignIds = snapshots.flatMap((spec, j) => i !== j && this.game === 'daifugo' && spec?.k === 'tiles' ? spec.tiles.map((t) => t.id) : []);
      const frames = pad.receivedFrames();
      expect(frames.length, '全席にpad指定が届いている').toBeGreaterThan(0);
      for (const spec of frames.slice(this.cursors[i])) {
        // 引いた本人にだけ、引いた札の中身が届く（設計どおり）。それ以外の席には、下の検査で届かないことを確かめる。
        const drawn = pad === drawer ? cardWords(strings(spec).filter((text) => text.includes('ひいた札：')).join(' ')) : [];
        expect(cardLeaks(spec, foreign, foreignIds, [...own, ...publicCards, ...drawn]), `${pad.label}: 他席の手札`).toEqual([]);
        if (this.game === 'old-maid' && drawer && pad !== drawer) {
          expect(strings(spec).some((s) => s.includes('ひいた札：')), '引いた中身の通知は引いた本人だけ').toBe(false);
        }
      }
      this.cursors[i] = frames.length;
      // 大画面には手札の中身を出さない。既に公開された場・ペアは現在の手札に含まれない。
      // 終了時のジョーカー公開はババ抜きの設計に含まれる。
      if (!ended) {
        expect(hostText).not.toBeNull();
        expect(cardWords(hostText ?? '').filter((card) => hands.flat().includes(card)), '大画面の手札漏えい').toEqual([]);
      }
    }
    this.previous = hands;
  }
}

/** 許可表の文だけを取り除き、残る役職語を全フィールドで探す。 */
function roleLeaks(spec: PadSpec, ownText: string | undefined, seerReport: string | undefined, ended: boolean): string[] {
  if (ended) return [];
  return strings(spec).flatMap((s) => {
    // 自分の役の文と、占い師への結果の文は、許される開示。ほかの文（リーダーの夜明けの発表と同じ画面に混ざる場合も）に残る役職語だけを見る。
    let remaining = s;
    for (const allowed of [ownText, seerReport]) if (allowed) remaining = remaining.split(allowed).join('');
    return ROLES.filter((role) => remaining.includes(role));
  });
}

class RolePrivacy {
  private readonly cursors: number[];
  readonly ownText = new Map<Pad, string>();
  readonly targets = new Map<Pad, string>();
  constructor(private readonly pads: Pad[]) { this.cursors = pads.map((pad) => Math.max(0, pad.receivedFrames().length - 1)); }
  async scan(host: Host, phase: string): Promise<void> {
    const ended = phase === 'ended';
    for (const [i, pad] of this.pads.entries()) {
      const own = this.ownText.get(pad);
      const target = this.targets.get(pad);
      const reports = own?.includes('【占い師】') && target && (phase === 'dawn' || ended)
        ? [`${target}さんは人狼です。`, `${target}さんは人狼ではないです。`] : [];
      const frames = pad.receivedFrames();
      expect(frames.length).toBeGreaterThan(0);
      for (const spec of frames.slice(this.cursors[i])) {
        const report = reports.find((text) => strings(spec).some((s) => s.includes(text)));
        expect(roleLeaks(spec, own, report, ended), `${pad.label}: 許可表にない役の開示`).toEqual([]);
      }
      this.cursors[i] = frames.length;
    }
    if (!ended) {
      const body = await hostSurface(host);
      expect(body).not.toBeNull();
      for (const role of ROLES) expect(body).not.toContain(role);
    }
  }
}

// rigを要求しない純粋な試験。ブラウザなしで秘匿検査そのものと変異を確かめられる。
test('秘匿走査：途中の漏えい・札ID・役の許可範囲を見逃さない', HOST, async () => {
  expect(cardLeaks({ k: 'wait', title: '♠3' }, ['♠3'], [], [])).toContain('♠3');
  expect(cardLeaks({ k: 'wait', title: 'dnonce_1_s3' }, [], ['dnonce_1_s3'], [])).toContain('dnonce_1_s3');
  expect(cardLeaks({ k: 'wait', title: 's3' }, ['♠3'], [], [])).toContain('♠3');
  expect(cardLeaks({ k: 'wait', title: '♠3' }, ['♠3'], [], ['♠3'])).toEqual([]);
  expect(cardLeaks({ k: 'wait', title: '♠10' }, ['♠3'], [], [])).toEqual([]);
  const own = 'あなたは【村人】。話し合いで人狼を探します。';
  const report = 'こはくさんは人狼ではないです。';
  expect(roleLeaks({ k: 'wait', title: own }, own, undefined, false)).toEqual([]);
  expect(roleLeaks({ k: 'wait', title: '騎士' }, own, undefined, false)).toContain('騎士');
  expect(roleLeaks({ k: 'wait', title: `${own}こはく：騎士` }, own, undefined, false)).toContain('騎士');
  expect(roleLeaks({ k: 'wait', title: report }, undefined, report, false)).toEqual([]);
  expect(roleLeaks({ k: 'wait', title: `${report}つばき：狂人` }, undefined, report, false)).toContain('狂人');
  expect(roleLeaks({ k: 'wait', title: '騎士' }, undefined, undefined, true)).toEqual([]);
  const specs = (id: string, label: string): Tiles => ({ k: 'tiles', tiles: [{ id, label }], ok: '出す' });
  const frames: PadSpec[][] = [[specs('dnonce_1_s3', '♠3')], [specs('dnonce_1_h4', '♥4')]];
  const pads = frames.map((f, i) => ({ label: `席${i + 1}`, receivedFrames: () => [...f] }) as Pad);
  const host = { inGame: async () => '', state: async () => 'playing', phase: async () => 'play' } as unknown as Host;
  const privacy = new CardPrivacy('daifugo', pads);
  await privacy.scan(host);
  frames[0]!.push({ k: 'wait', title: '♥4' }, specs('dnonce_1_s3', '♠3'));
  // 最後の画面が正常でも、間に届いた1枚のフレームを捨ててはいけない。
  await expect(privacy.scan(host)).rejects.toThrow();
});

async function start(pad: Pad): Promise<void> {
  await pad.expectKind('pad');
  const control = pad.page.locator('.irori-pad__btn[data-id]');
  await expect(control).toHaveCount(1);
  await expect(control).toBeEnabled();
  await control.tap();
}

/** いまのリーダーのスマホ（結果画面のリモコンが出ている端末）。途中の切断で、リーダーは次の席へ移ることがある。 */
async function remoteLeader(pads: Pad[]): Promise<Pad> {
  let found: Pad | undefined;
  await expect.poll(async () => {
    for (const pad of pads) if (await pad.kind() === 'remote') { found = pad; return true; }
    return false;
  }, { timeout: 15_000, message: '結果画面のリモコンが出ている端末（いまのリーダー）' }).toBe(true);
  return found!;
}

async function replay(host: Host, pads: Pad | Pad[]): Promise<Pad> {
  await host.expectState('results');
  const leader = Array.isArray(pads) ? await remoteLeader(pads) : pads;
  await leader.tap('ok');
  await host.expectState('playing');
  await host.expectPhase('intro');
  return leader;
}

async function shortMode(leader: Pad): Promise<void> {
  await leader.expectKind('choices');
  const option = leader.page.locator('.irori-pad__choice[data-id$="_5"]');
  await expect(option).toHaveCount(1);
  await leader.choose((await option.getAttribute('data-id'))!);
}

async function strike(host: Host, pad: Pad): Promise<void> {
  await host.expectPhase('aim');
  // 報告の撮影手順：startX=-0.68、hook=0.6、power=0.7。
  await pad.swipe(0.10, 0.15, 0.31, 0.711, 200);
  await host.expectPhase('rolling');
  await expect.poll(async () => {
    await host.advance(100, { pause: 0 });
    return host.phase();
  }, { intervals: [0], timeout: 15_000 }).toBe('settled');
}

async function nextThrow(host: Host): Promise<void> {
  await expect.poll(async () => {
    if (await host.state() === 'results') return 'done';
    await host.advance(100, { pause: 0 });
    return await host.state() === 'results' || await host.phase() === 'aim' ? 'done' : 'waiting';
  }, { intervals: [0], timeout: 15_000 }).toBe('done');
}

async function turn(host: Host, pads: Pad[], selector: string): Promise<Pad> {
  const frame = (await host.gameFrame())!;
  await expect(frame.locator(selector)).toHaveCount(1);
  const seat = Number(await frame.locator(selector).getAttribute('data-seat'));
  const pad = pads.find((p) => pads.indexOf(p) + 1 === seat);
  expect(pad, `公開画面の番席${seat}に対応するスマホ`).toBeDefined();
  return pad!;
}

test('ストライク横丁：2台で投球・字幕・次の席まで進む', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, NAMES.slice(0, 2));
  await host.choose('strike-alley', pads[0]);
  await host.expectPhase('intro');
  await shortMode(pads[0]!);
  await strike(host, pads[0]!);
  await expect((await host.gameFrame())!.locator('[data-seat="1"] .ball-mark.strike')).toHaveCount(1);
  await nextThrow(host);
  await host.expectPhase('aim');
  const frame = (await host.gameFrame())!;
  await expect(frame.locator('.row.is-turn')).toHaveAttribute('data-seat', '2');
  await pads[1]!.expectKind('touch');
});

test('ストライク横丁：1人の5フレーム満点150・結果・再戦', HOST, async ({ rig }) => {
  const host = await rig.openHost({ clock: true });
  const [pad] = await rig.join(host, NAMES.slice(0, 1));
  await host.choose('strike-alley', pad);
  await shortMode(pad!);
  for (let ball = 0; ball < 7; ball++) {
    await strike(host, pad!);
    await nextThrow(host);
  }
  expect((await host.results()).map(({ seat, rank, score }) => ({ seat, rank, score }))).toEqual([{ seat: 1, rank: 1, score: 150 }]);
  await replay(host, pad!);
});

test('ストライク横丁：番の切断・再接続・一時停止・退出の未成立', HOST, async ({ rig }) => {
  rig.allowSocketErrors();
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, NAMES.slice(0, 2), { line: true });
  await host.choose('strike-alley', pads[0]);
  await shortMode(pads[0]!);
  await host.expectPhase('aim');
  pads[0]!.cut();
  await pads[0]!.expectLink('lost');
  await host.advance(500); // ゲーム中のホスト画面には座席の一覧が出ない。切断中は待つ（段階が変わらない）ことを、続く確認で見る。
  await host.advance(1_000);
  await host.expectPhase('aim');
  pads[0]!.restore();
  await pads[0]!.expectLink('open');
  await pads[0]!.expectKind('touch');
  await host.key('Escape');
  await host.expectState('paused');
  await host.advance(2_000);
  await host.expectPhase('aim');
  await host.key('Escape');
  await host.expectState('playing');
  await strike(host, pads[0]!);
  await pads[1]!.leave();
  await host.expectState('results');
  await expect(host.page.locator('.results [data-seat][data-rank="null"]')).toHaveCount(2);
});

// 人数不足はchoose（開始まで進める道具）を使わず、棚→詳細で止める。
async function detail(host: Host, id: string): Promise<void> {
  await host.expectState('home');
  await host.page.locator(`.card[data-game="${id}"]`).click();
  await host.expectState('detail');
}

test('大富豪：2台では開始不可・不足1人を示す', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  await rig.join(host, NAMES.slice(0, 2));
  await detail(host, 'daifugo');
  const begin = host.page.locator('[data-nav="detail:start"]');
  await expect(begin).toBeDisabled();
  const describedBy = await begin.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  // 数値のみを検査し、案内の文言そのものをセレクタにはしない。
  await expect(host.page.locator(`[id="${describedBy}"]`)).toContainText('1');
  await begin.click({ force: true });
  await host.expectState('detail');
  await expect(host.page.locator('.stage iframe')).toHaveCount(0);
});

function dealSignature(pads: Pad[]): string[][] {
  return pads.map((pad) => hand(latest(pad), 'daifugo').sort());
}

test('大富豪：4台で弱い単札・パス・秘匿・退出・配り直し', HOST, async ({ rig }) => {
  const host = await rig.openHost();
  const pads = await rig.join(host, NAMES.slice(0, 4));
  await host.choose('daifugo', pads[0]);
  const privacy = new CardPrivacy('daifugo', pads);
  await privacy.scan(host);
  await start(pads[0]!);
  await host.expectPhase('play');
  for (const pad of pads) await pad.expectKind('tiles');
  const initial = dealSignature(pads);
  expect(initial.flat()).toHaveLength(54);
  await privacy.scan(host);
  let plays = 0;
  let passes = 0;
  for (let move = 0; move < 16 && (plays < 3 || passes < 1); move++) {
    const pad = await turn(host, pads, '.seat[aria-current="step"][data-seat]');
    const spec = latest(pad) as Tiles;
    expect(spec.k).toBe('tiles');
    expect(spec.disabled).toBe(false);
    const before = JSON.stringify(spec);
    const available = spec.tiles.filter((tile) => !tile.off);
    // 手札の順序は強さ順。革命中だけ数の順を逆にし、ジョーカーは常に最強。
    const reversed = await host.inGame(() => document.getElementById('stage')?.dataset.revolution === 'true');
    const strength = (label: string): number => {
      if (label.startsWith('ジョーカー')) return 99;
      const rank = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'].indexOf(label.slice(1));
      return reversed ? 12 - rank : rank;
    };
    available.sort((a, b) => strength(a.label) - strength(b.label));
    if (spec.pass && (plays >= 3 || available.length === 0)) { await pad.tiles({ pass: true }); passes++; }
    else { expect(available.length).toBeGreaterThan(0); await pad.tiles([available[0]!.id]); plays++; }
    await expect.poll(() => JSON.stringify(latest(pad))).not.toBe(before);
    await privacy.scan(host);
  }
  expect(plays).toBeGreaterThanOrEqual(3);
  expect(passes).toBeGreaterThanOrEqual(1);
  await pads[3]!.leave();
  await privacy.scan(host);
  await pads[2]!.leave();
  // 4→2席では継続する設計。未成立に必要な最後の退出も省略しない。
  await host.expectState('playing');
  await privacy.scan(host);
  await pads[1]!.leave();
  await host.expectState('results');
  await expect(host.page.locator('.results [data-seat][data-rank="null"]')).toHaveCount(4);
  for (const pad of pads.slice(1)) {
    // 同じURL（/pad#コード）への移動は、再読み込みにならないことがある。空白を挟み、退出した画面から確実に入り直す。
    await pad.page.goto('about:blank');
    await pad.join(await host.code(), NAMES[pads.indexOf(pad)]);
  }
  await start(await replay(host, pads));
  await host.expectPhase('play');
  for (const pad of pads) await pad.expectKind('tiles');
  expect(dealSignature(pads), 'nonceだけでなく札そのものが配り直される').not.toEqual(initial);
  await new CardPrivacy('daifugo', pads).scan(host);
});

test('大富豪：握手から能力を除いた旧ホストの更新案内', HOST, async ({ rig }) => {
  const host = await rig.openHost({ init: async (context) => {
    await context.addInitScript(() => {
      const send = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const m = message as { m?: string; capabilities?: unknown } | null;
        const outgoing = m?.m === 'init' ? { ...m, capabilities: [] } : message;
        // 実際のMessagePortとホストは保ち、能力の広告だけを古い形にする。
        if (Array.isArray(transfer)) send.call(this, outgoing, { transfer });
        else send.call(this, outgoing, transfer ?? {});
      };
    });
  } });
  const pads = await rig.join(host, NAMES.slice(0, 3));
  await host.choose('daifugo', pads[0]);
  await host.expectPhase('unsupported');
  for (const pad of pads) await pad.expectKind('wait');
  await expect((await host.gameFrame())!.locator('.message-title')).toBeVisible();
});

async function oldTurn(host: Host, pads: Pad[]): Promise<Pad> {
  let actor: Pad | undefined;
  await expect.poll(async () => {
    await host.advance(150, { pause: 0 });
    const frame = await host.gameFrame();
    const seat = Number(await frame?.locator('.seat[data-role="from"]').getAttribute('data-seat').catch(() => null));
    actor = pads[seat - 1];
    const spec = actor && latest(actor);
    return spec?.k === 'tiles' && !spec.disabled && !(await actor!.page.locator('.irori-pad__tiles').getAttribute('data-sent') !== null);
  }, { intervals: [0], timeout: 10_000 }).toBe(true);
  return actor!;
}

test('ババ抜き：3台で先頭を引き切る・秘匿・再接続・最下位1人・再戦', HOST, async ({ rig }) => {
  test.setTimeout(175_000);
  rig.allowSocketErrors();
  const host = await rig.openHost({ clock: true });
  await host.page.emulateMedia({ reducedMotion: 'reduce' });
  const pads = await rig.join(host, NAMES.slice(0, 3), { line: true });
  await host.choose('old-maid', pads[0]);
  const privacy = new CardPrivacy('old-maid', pads);
  await privacy.scan(host);
  await start(pads[0]!);
  await host.expectPhase('play');
  let actor = await oldTurn(host, pads);
  await privacy.scan(host);
  const beforeCut = hand(latest(actor), 'old-maid').sort();
  actor.cut();
  await actor.expectLink('lost');
  await host.advance(500); // ゲーム中のホスト画面には座席の一覧が出ない。切断中は待つ（段階が変わらない）ことを、続く確認で見る。
  await privacy.scan(host);
  actor.restore();
  await actor.expectLink('open');
  actor = await oldTurn(host, pads);
  await actor.expectKind('tiles');
  expect(hand(latest(actor), 'old-maid').sort()).toEqual(beforeCut);
  await privacy.scan(host);
  for (let move = 0; move < 400 && await host.phase() !== 'ended'; move++) {
    actor = await oldTurn(host, pads);
    const before = JSON.stringify(latest(actor));
    await actor.tiles('first');
    await expect.poll(async () => ({ phase: await host.phase(), changed: JSON.stringify(latest(actor)) !== before }))
      .toMatchObject({ changed: true });
    await privacy.scan(host, actor);
  }
  await host.expectPhase('ended');
  await host.advance(3_000);
  const rows = await host.results();
  expect(rows).toHaveLength(3);
  expect(rows.filter((row) => row.rank === 3)).toHaveLength(1);
  expect(rows.filter((row) => row.label === '最下位')).toHaveLength(1);
  expect(rows.map((row) => row.rank).sort()).toEqual([1, 2, 3]);
  await start(await replay(host, pads));
  await host.expectPhase('play');
  await oldTurn(host, pads);
  await new CardPrivacy('old-maid', pads).scan(host);
});

async function nightShape(host: Host, pads: Pad[]): Promise<void> {
  const aliveNames = await (await host.gameFrame())!.locator('.resident:not(.resident--out) .resident-name').allTextContents();
  const shapes = [];
  for (const [i, pad] of pads.entries()) {
    if (!aliveNames.includes(NAMES[i]!)) continue;
    await pad.expectKind('tiles');
    await expect.poll(() => { const s = latest(pad); return s?.k === 'tiles' ? s.tiles.length : -1; }).toBe(aliveNames.length - 1);
    const spec = latest(pad) as Tiles;
    shapes.push({ count: spec.tiles.length, min: spec.min, max: spec.max, ok: spec.ok, pass: spec.pass, off: spec.tiles.map((t) => !!t.off) });
  }
  const alive = aliveNames.length;
  expect(shapes).toHaveLength(alive);
  expect(shapes.length).toBeGreaterThan(1);
  for (const shape of shapes) {
    expect(shape.count).toBe(alive - 1);
    expect(shape.off.every((off) => !off)).toBe(true);
  }
  for (const shape of shapes) expect(shape).toEqual(shapes[0]);
}

test('月あかりの寄り合い：5台で役確認・夜・再接続・議論・投票・処刑・全役公開・再戦', HOST, async ({ rig }) => {
  test.setTimeout(175_000);
  rig.allowSocketErrors();
  const host = await rig.openHost({ clock: true });
  const pads = await rig.join(host, NAMES, { line: true });
  await host.choose('moon-village', pads[0]);
  const privacy = new RolePrivacy(pads);
  await privacy.scan(host, 'intro');
  await start(pads[0]!);
  await host.expectPhase('reveal');
  for (const pad of pads) {
    await pad.tiles([]);
    await expect.poll(() => { const s = latest(pad); return s?.k === 'tiles' ? s.note : ''; }).toMatch(/あなたは【/);
    const spec = latest(pad) as Tiles;
    const own = spec.note!;
    const role = /あなたは【([^】]+)】/.exec(own)?.[1];
    expect(ROLES).toContain(role);
    // 自席の役の説明は完全一致で許す。他席の役を追記しても通る許可にしない。
    const jobs: Record<string, string> = { 村人: '話し合いで人狼を探します。', 人狼: '夜に1人を襲います。', 占い師: '夜に1人が人狼か占います。', 騎士: '自分以外を守ります。同じ人は2夜続けて守れません。', 狂人: '人間として数えますが、人狼の勝ちを願います。' };
    expect(own).toBe(`あなたは【${role}】。${jobs[role!]}`); // 5人では仲間の人狼はいない。
    privacy.ownText.set(pad, own);
    await privacy.scan(host, 'reveal');
    await pad.tiles([]);
    await privacy.scan(host, (await host.phase())!);
  }
  await host.expectPhase('night');
  await nightShape(host, pads);
  const reconnecting = pads[4]!;
  reconnecting.cut();
  await reconnecting.expectLink('lost');
  await host.advance(500); // ゲーム中のホスト画面には座席の一覧が出ない。切断中は待つ（段階が変わらない）ことを、続く確認で見る。
  await privacy.scan(host, 'night');
  reconnecting.restore();
  await reconnecting.expectLink('open');
  await pads[0]!.tiles([]); // 再接続後の明示的な再開。
  await reconnecting.expectKind('tiles');
  await nightShape(host, pads);
  await privacy.scan(host, 'night');
  let nights = 0;
  let votes = 0;
  let dawns = 0;
  let days = 0;
  let executions = 0;
  for (let step = 0; step < 40 && await host.state() !== 'results'; step++) {
    const phase = (await host.phase())!;
    if (phase === 'ended') {
      // 終わりの見せ場（約8秒）の間は、画面は ended でも、コンソールはまだ playing。時計を進めて、結果へ進むのを待つ。
      await host.advance(9_000);
      await host.expectState('results');
      break;
    }
    if (phase === 'night' || phase === 'vote') {
      if (phase === 'night') { nights++; await nightShape(host, pads); }
      else votes++;
      // 大画面が替わった直後は、直前に「投票へ」などを押したリーダーのスマホだけ、新しい画面が少し遅れて届く。
      // 決定ボタンの文字が替わった画面（夜は「決定」、投票は「投票する」）だけを、操作の対象にする。
      const actionOk = phase === 'night' ? '決定' : '投票する';
      const isActing = (p: Pad): boolean => { const spec = latest(p); return spec?.k === 'tiles' && spec.ok === actionOk; };
      // 画面の届く時刻は席ごとに少しずれる。いま操作できる席から先に進め、残りは次の周回で扱う。
      await expect.poll(() => pads.filter(isActing).length, { timeout: 10_000 }).toBeGreaterThan(0);
      const acting = pads.filter(isActing);
      for (const pad of acting) {
        const spec = latest(pad) as Tiles;
        if (phase === 'night') privacy.targets.set(pad, spec.tiles[0]!.label);
        const before = JSON.stringify(spec);
        await pad.tiles(spec.tiles.length ? 'first' : []);
        await expect.poll(() => JSON.stringify(latest(pad))).not.toBe(before);
        const now = await host.state() === 'results' ? 'ended' : (await host.phase())!;
        await privacy.scan(host, now);
      }
    } else if (phase === 'dawn') {
      dawns++;
      // 進行は、リーダーのスマホの「つづける」で行う（大画面は見るための画面で、押さない）。
      await pads[0]!.tiles([]);
      await host.expectPhase('day');
      await privacy.scan(host, 'day');
    } else if (phase === 'day' || phase === 'exec') {
      if (phase === 'day') days++; else executions++;
      await pads[0]!.tiles([]);
      await host.expectPhase(phase === 'day' ? 'vote' : 'night');
      await privacy.scan(host, await host.state() === 'results' ? 'ended' : (await host.phase())!);
    } else throw new Error(`進行を想定していないphase: ${phase}`);
  }
  expect(nights).toBeGreaterThan(0);
  expect(votes).toBeGreaterThan(0);
  expect(dawns).toBeGreaterThan(0);
  expect(days).toBeGreaterThan(0);
  // 最初の処刑で勝敗が決まった場合、execは同じ遷移でendedへ進む。
  test.info().annotations.push({ type: '進行', description: `夜${nights}回・投票${votes}回・継続する処刑${executions}回` });
  const rows = await host.results();
  expect(rows).toHaveLength(5);
  expect(rows.some((row) => row.label.endsWith('・勝ち'))).toBe(true);
  expect(rows.some((row) => row.label.endsWith('・負け'))).toBe(true);
  const expectedRoles = pads.map((pad, i) => `${NAMES[i]}：${/【([^】]+)】/.exec(privacy.ownText.get(pad)!)![1]}`);
  // 終了直後の全役公開フレームは、結果リモコンへの差し替え前も含めて確認する。
  for (const pad of pads) {
    // 結果の画面が先に出て、スマホへの配信は少し遅れることがある（WebKit）。届くのを待つ。
    await expect.poll(() => pad.receivedFrames().some((spec) => spec.k === 'wait' && expectedRoles.every((role) => spec.body?.includes(role))),
      { timeout: 5_000, message: `${pad.label}: 全員の役を載せた画面が届く` }).toBe(true);
  }
  await privacy.scan(host, 'ended');
  await replay(host, pads);
  await new RolePrivacy(pads).scan(host, 'intro');
});
