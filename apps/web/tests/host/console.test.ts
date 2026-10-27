// @vitest-environment-options {"settings":{"enableIframePageLoading":true}}
// 司令塔の配線を、作り物の部屋の WebSocket で確かめる（画面の配置を測れないので、移動はクリックで代える）。
// 実物の Worker・実ブラウザでの通しは host.e2e.ts。
import type { HostToGame, PadSpec, PlayerInfo } from '@irori/protocol';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sounds } from '../../src/host/audio';
import { Console } from '../../src/host/console';
import { registerHostMessages } from '../../src/host/messages';
import registry from '../fixtures/host/registry.json';
import { busy, connectGameFrame, created, FakeSocket, memoryStorage, SocketFactory, useJapanese } from './fakes';

beforeAll(() => {
  useJapanese();
  registerHostMessages();
});

const ORIGIN = 'https://irori.example';
const flush = () => new Promise((r) => setTimeout(r, 5));
const p = (id: number, name: string, online = true): PlayerInfo => ({ id, name, online });

interface Setup {
  origin?: string;
  rooms?: Array<() => Response>;
  share?: (data: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
  session?: Storage;
}

async function setup(o: Setup = {}) {
  const root = document.createElement('div');
  root.id = 'app';
  document.body.replaceChildren(root);
  const rooms = [...(o.rooms ?? [created('XN7Q')])];
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/registry/index.json') return new Response(JSON.stringify(registry), { status: 200 });
    if (url === '/api/rooms' && init?.method === 'POST') {
      const r = rooms.length > 1 ? rooms.shift() : rooms[0];
      if (!r) throw new TypeError('network');
      return r();
    }
    throw new TypeError(`想定外の読み込み: ${url}`);
  }) as typeof fetch;
  const sockets = new SocketFactory();
  const nav = { getGamepads: () => [], clipboard: { writeText: o.writeText ?? vi.fn(async () => undefined) }, ...(o.share ? { share: o.share } : {}) };
  const origin = o.origin ?? ORIGIN;
  const win = Object.assign(new EventTarget(), {
    navigator: nav,
    location: { search: '', hostname: new URL(origin).hostname, reload: vi.fn() },
    requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number,
  }) as unknown as Window;
  const session = o.session ?? memoryStorage();
  new Console({ root, win, doc: document, fetch: fetchFn, session, local: memoryStorage(), origin, makeSocket: sockets.make }).start();
  await flush();
  return { root, sockets, calls, nav, win, session, state: () => root.dataset.state };
}

async function welcomed(o: Setup = {}, players: PlayerInfo[] = []) {
  const s = await setup(o);
  s.sockets.last.welcome('XN7Q', players);
  await flush();
  return { ...s, sock: s.sockets.last };
}

function padsTo(sock: FakeSocket, seat: number): PadSpec[] {
  return sock.sent.filter((f): f is { t: 'pad'; to: number; spec: PadSpec } => (f as { t?: string }).t === 'pad' && (f as { to?: number }).to === seat).map((f) => f.spec);
}

const click = (sel: string) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`見つからない: ${sel}`);
  el.click();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('部屋とホーム', () => {
  it('起動 → 部屋を作る → welcome でホーム。コードは data-code に出る', async () => {
    const s = await setup();
    expect(s.state()).toBe('connecting');
    expect(s.calls).toContain('POST /api/rooms');
    s.sockets.last.welcome('XN7Q');
    await flush();
    expect(s.state()).toBe('home');
    expect(s.root.dataset.code).toBe('XN7Q');
    expect(document.querySelector('.join__qr')?.getAttribute('data-url')).toBe(`${ORIGIN}/pad#XN7Q`);
  });

  it('リーダーにリモコン、ほかの席に「{名前}が選んでいます」。pad? には同じ画面を送り直す', async () => {
    const { sock } = await welcomed();
    sock.frame({ t: 'joined', p: p(1, 'たろう') });
    sock.frame({ t: 'joined', p: p(2, 'はなこ') });
    await flush();
    expect(padsTo(sock, 1).at(-1)).toMatchObject({ k: 'remote' });
    expect(padsTo(sock, 2).at(-1)).toMatchObject({ k: 'wait', title: 'たろうが選んでいます' });
    const before = padsTo(sock, 2).length;
    sock.frame({ t: 'pad?', p: 2 });
    await flush();
    expect(padsTo(sock, 2)).toHaveLength(before + 1);
    expect(padsTo(sock, 2).at(-1)).toMatchObject({ k: 'wait' });
  });

  it('リーダーが切れたら、次の席にリモコンが移る', async () => {
    const { sock, root } = await welcomed({}, [p(1, 'たろう'), p(2, 'はなこ')]);
    expect(root.dataset.leader).toBe('1');
    sock.frame({ t: 'online', p: 1, on: false });
    await flush();
    expect(root.dataset.leader).toBe('2');
    expect(padsTo(sock, 2).at(-1)).toMatchObject({ k: 'remote' });
    sock.frame({ t: 'online', p: 1, on: true });
    await flush();
    expect(padsTo(sock, 1).at(-1)).toMatchObject({ k: 'wait', title: 'はなこが選んでいます' });
  });

  it('ホームでのスマホの menu は無視する（一時停止はゲーム中だけ）', async () => {
    const { sock, state } = await welcomed({}, [p(1, 'たろう')]);
    sock.frame({ t: 'in', p: 1, i: { k: 'menu' }, T: 1 });
    await flush();
    expect(state()).toBe('home');
  });

  it('ロックの切り替えを送り、QRの上に案内を出す', async () => {
    const { sock } = await welcomed({}, [p(1, 'たろう')]);
    click('[data-action="lock"]');
    await flush();
    expect(sock.sent).toContainEqual({ t: 'lock', on: true });
    expect(document.querySelector('.join')?.getAttribute('data-locked')).toBe('true');
  });

  it('参加者を外す：席を押す → 確かめ → kick', async () => {
    const { sock, root } = await welcomed({}, [p(1, 'たろう'), p(2, 'はなこ')]);
    click('.seat[data-seat="2"]');
    await flush();
    expect(root.dataset.modal).toBe('kick');
    expect(document.querySelector('[data-layer="kick"] .dialog__title')?.textContent).toBe('はなこを外しますか？');
    click('[data-nav="kick:ok"]');
    await flush();
    expect(sock.sent).toContainEqual({ t: 'kick', p: 2 });
    expect(root.dataset.modal).toBe('');
  });
});

describe('ゲームを開く前', () => {
  it('外部のゲームは、開く前に「{ホスト名} のサーバーに接続します」と確かめる。やめるで詳細に戻る', async () => {
    const { root, state } = await welcomed({}, [p(1, 'たろう')]);
    click('.card[data-game="fixture-far"]');
    await flush();
    expect(state()).toBe('detail');
    click('[data-nav="detail:start"]');
    await flush();
    expect(root.dataset.modal).toBe('confirm');
    expect(document.querySelector('[data-layer="confirm"] .dialog__title')?.textContent).toBe('games.example.invalid のサーバーに接続します');
    expect(document.querySelector('.stage iframe')).toBeNull();
    click('[data-nav="confirm:cancel"]');
    await flush();
    expect(root.dataset.modal).toBe('');
    expect(state()).toBe('detail');
    click('[data-nav="detail:back"]');
    await flush();
    expect(state()).toBe('home');
  });

  it('人数が足りないゲームは、詳細の「はじめる」が押せず、理由が出る', async () => {
    const { state } = await welcomed({}, [p(1, 'たろう')]);
    click('.card[data-game="fixture-race"]');
    await flush();
    expect(state()).toBe('detail');
    const start = document.querySelector<HTMLButtonElement>('[data-nav="detail:start"]');
    expect(start?.disabled).toBe(true);
    expect(document.querySelector('[data-layer="detail"]')?.textContent).toContain('あと1人で遊べます');
  });
});

describe('共有', () => {
  it('共有の板：X・LINE・リンクのコピー。どれもサイトのURL（部屋のURLではない）', async () => {
    const writeText = vi.fn(async () => undefined);
    await welcomed({ writeText }, [p(1, 'たろう')]);
    click('[data-action="share"]');
    await flush();
    const layer = document.querySelector('[data-layer="share"]');
    expect(layer?.querySelector('.share__url')?.textContent).toBe(`${ORIGIN}/`);
    const x = new URL(layer?.querySelector('a[data-share="x"]')?.getAttribute('href') ?? '');
    expect(x.searchParams.get('url')).toBe(`${ORIGIN}/`);
    const line = new URL(layer?.querySelector('a[data-share="line"]')?.getAttribute('href') ?? '');
    expect(line.searchParams.get('url')).toBe(`${ORIGIN}/`);
    expect(layer?.querySelector('[data-nav="share:native"]')).toBeNull();
    expect(layer?.textContent).toContain('Instagram と YouTube');
    click('[data-nav="share:copy"]');
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/`);
    expect(document.querySelector('.toast')?.textContent).toBe('コピーしました');
  });

  it('端末の共有シートは、navigator.share があるときだけ出し、サイトのURLを渡す', async () => {
    const share = vi.fn(async () => undefined);
    await welcomed({ share });
    click('[data-action="share"]');
    await flush();
    click('[data-nav="share:native"]');
    await flush();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${ORIGIN}/` }));
  });
});

describe('切断・取って代わられた・部屋を作れない・閉じた', () => {
  it('replaced：案内と「ここで続ける」。自動では入り直さず、押したときだけ入り直す', async () => {
    const { sock, state } = await welcomed({}, [p(1, 'たろう')]);
    sock.fail('replaced');
    await flush();
    expect(state()).toBe('replaced');
    expect(document.querySelector('[data-layer="cover"] .dialog__title')?.textContent).toBe('別のタブで開かれました');
    await new Promise((r) => setTimeout(r, 30));
    expect(sock.reconnects).toBe(0);
    click('[data-nav="cover:replaced"]');
    await flush();
    expect(sock.reconnects).toBe(1);
    expect(document.querySelector<HTMLButtonElement>('[data-nav="cover:replaced"]')?.disabled).toBe(true);
    sock.welcome('XN7Q', [p(1, 'たろう')]);
    await flush();
    expect(state()).toBe('home');
  });

  it('画面に戻ったら probe() を呼ぶ（死んだ接続を30秒待たずに捨てる）', async () => {
    const { sock } = await welcomed();
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sock.probes).toBe(0);
    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sock.probes).toBe(1);
    vis.mockRestore();
  });

  it('切れて入り直しているあいだは offline。つながったら元の画面へ', async () => {
    const { sock, state } = await welcomed({}, [p(1, 'たろう')]);
    sock.fail('network', false);
    await flush();
    expect(state()).toBe('offline');
    expect(document.querySelector('[data-layer="cover"] .dialog__title')?.textContent).toBe('接続が切れました');
    sock.welcome('XN7Q', [p(1, 'たろう')]);
    await flush();
    expect(state()).toBe('home');
  });

  it('503：理由といつ試すかを1文で（「…上限に達したので、約10分後に、自動でもう一度試します」）。「いますぐ試す」で作り直す。やり方はリンクで案内する', async () => {
    const { state, calls, sockets } = await setup({ rooms: [busy(503, 600), created('BCDF')] });
    expect(state()).toBe('busy');
    const text = document.querySelector('.status')?.textContent ?? '';
    expect(document.querySelector('.status__wait')?.textContent).toBe('今日作れる部屋の数が上限に達したので、約10分後に、自動でもう一度試します');
    expect(text).not.toContain('docs/');
    const howto = document.querySelector('a[data-nav="busy:howto"]');
    expect(howto?.textContent).toBe('やり方を見る');
    expect(howto?.getAttribute('target')).toBe('_blank');
    expect(howto?.getAttribute('rel')).toBe('noopener noreferrer');
    click('[data-nav="busy:now"]');
    await flush();
    expect(calls.filter((c) => c === 'POST /api/rooms')).toHaveLength(2);
    expect(sockets.last.url).toContain('/BCDF/');
    expect(state()).toBe('connecting');
  });

  it('待ち時間が長いときは、時間で出す（「約301分」と出さない）', async () => {
    await setup({ rooms: [busy(503, 5 * 3600)] });
    expect(document.querySelector('.status__wait')?.textContent).toBe('今日作れる部屋の数が上限に達したので、約5時間後に、自動でもう一度試します');
  });

  it('closed：「新しい部屋を作る」で作り直す', async () => {
    const { sock, state, calls } = await welcomed({ rooms: [created('XN7Q'), created('BCDF')] });
    sock.fail('closed');
    await flush();
    expect(state()).toBe('closed');
    click('[data-nav="closed:new"]');
    await flush();
    expect(calls.filter((c) => c === 'POST /api/rooms')).toHaveLength(2);
  });

  it('音のオン/オフ（M キーと道具のボタン）', async () => {
    const { root, win } = await welcomed();
    expect(root.dataset.sound).toBe('true');
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    expect(root.dataset.sound).toBe('false');
    click('[data-action="sound"]');
    expect(root.dataset.sound).toBe('true');
  });
});

describe('部屋の案内のアドレス（QR・手入力・共有）', () => {
  it('127.0.0.1 で開いていて、canonical が公開URLなら、QRと共有はそちら。通信はいま開いているオリジンのまま', async () => {
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.setAttribute('href', 'https://irori.example/');
    document.head.append(link);
    try {
      const s = await setup({ origin: 'http://127.0.0.1:8787' });
      s.sockets.last.welcome('XN7Q');
      await flush();
      expect(document.querySelector('.join__qr')?.getAttribute('data-url')).toBe('https://irori.example/pad#XN7Q');
      expect(document.querySelector('.join__type')?.textContent).toContain('irori.example/pad');
      expect(document.querySelector('[data-loopback]')).toBeNull();
      expect(s.sockets.last.url).toBe('ws://127.0.0.1:8787/api/rooms/XN7Q/ws');
      click('[data-action="share"]');
      await flush();
      expect(document.querySelector('.share__url')?.textContent).toBe('https://irori.example/');
    } finally {
      link.remove();
    }
  });

  it('ループバックのアドレスしか無いときは、QRの近くに警告を出す', async () => {
    const s = await setup({ origin: 'http://127.0.0.1:8787' });
    s.sockets.last.welcome('XN7Q');
    await flush();
    expect(document.querySelector('.join__qr')?.getAttribute('data-url')).toBe('http://127.0.0.1:8787/pad#XN7Q');
    expect(document.querySelector('[data-loopback]')).not.toBeNull();
  });
});

describe('実物のGameFrameへの結果と環境の連携', () => {
  const sockets: FakeSocket[] = [];
  const peers: Awaited<ReturnType<typeof connectGameFrame>>[] = [];
  const iframeSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')?.set;

  beforeEach(() => {
    // ゲームの文書の取得は通し試験の担当。ここでは実物の窓とMessagePortをabout:blankで用意する。
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLIFrameElement) { iframeSrc?.call(this, 'about:blank'); });
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.fail('closed');
    for (const peer of peers.splice(0)) peer.close();
    vi.restoreAllMocks();
  });

  async function launched(players = [p(1, 'たろう'), p(2, 'はなこ')], options: Setup = {}) {
    const s = await welcomed(options, players);
    sockets.push(s.sock);
    click('.card[data-game="fixture-race"]');
    click('[data-nav="detail:start"]');
    return s;
  }

  async function connect(root: HTMLElement) {
    const peer = await connectGameFrame(root);
    peers.push(peer);
    peer.send({ m: 'ready' });
    await flush();
    return peer;
  }

  const updates = (messages: HostToGame[]) => messages.filter((m) => m.m !== 'init');

  it('cueは前面・消音解除・音の解除がそろうときだけSoundsへ渡す', async () => {
    const cue = vi.spyOn(Sounds.prototype, 'cue').mockImplementation(() => {});
    const on = vi.spyOn(Sounds.prototype, 'on', 'get').mockReturnValue(true);
    const unlocked = vi.spyOn(Sounds.prototype, 'unlocked', 'get').mockReturnValue(true);
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { root, sock } = await launched();
    const game = await connect(root);
    const send = async (name: 'tick' | 'confirm' | 'deny' | 'turn' | 'win' | 'lose' | 'go' | 'deal' | 'flip') => {
      game.send({ m: 'cue', name, v: 0.4 }); await flush();
    };
    await send('tick');
    expect(cue).toHaveBeenLastCalledWith('tick', 0.4);
    on.mockReturnValue(false); await send('confirm'); on.mockReturnValue(true);
    unlocked.mockReturnValue(false); await send('deny'); unlocked.mockReturnValue(true);
    visible.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
    await send('turn');
    visible.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
    sock.frame({ t: 'in', p: 1, i: { k: 'menu' }, T: 1 }); await flush();
    expect(root.dataset.phase).toBe('paused');
    await send('win');
    click('[data-nav="menu:continue"]'); await flush();
    sock.setState('reconnecting'); await flush();
    await send('lose');
    expect(cue).toHaveBeenCalledTimes(1);
    sock.welcome('XN7Q', [p(1, 'たろう'), p(2, 'はなこ')]); await flush();
    await send('go'); expect(cue).toHaveBeenCalledTimes(2);
    sock.frame({ t: 'in', p: 1, i: { k: 'menu' }, T: 2 }); await flush();
    await send('deal'); expect(cue).toHaveBeenCalledTimes(2);
    game.send({ m: 'end' }); await flush();
    await send('flip'); expect(cue).toHaveBeenCalledTimes(2);
  });


  it('非表示で開いた初期値とcapabilityを握手時に渡す', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { root } = await launched();
    const game = await connect(root);
    expect(game.messages[0]).toMatchObject({ m: 'init', paused: false, capabilities: ['result-options-v1', 'host-environment-v1', 'pad-tiles-v1', 'cue-v1'], environment: { connected: true, visible: false } });
  });

  it('握手前の切断と非表示を最新initへ保持する', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { root, sock } = await launched();
    sock.fail('network', false);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const game = await connect(root);
    expect(game.messages[0]).toMatchObject({ m: 'init', paused: false, environment: { connected: false, visible: false } });
  });

  it.each([false, true])('切断→同じ処理内で復帰してもfalseを失わず、照合済み名簿→trueの順にする（名簿変化:%s）', async (changed) => {
    const { root, sock } = await launched([p(1, 'たろう'), p(2, 'はなこ'), p(3, 'じろう')]);
    const game = await connect(root);
    sock.fail('network', false);
    const players = changed ? [p(1, '別の人'), p(2, 'はなこ'), p(3, 'じろう')] : [p(1, 'たろう'), p(2, 'はなこ'), p(3, 'じろう')];
    sock.welcome('XN7Q', players);
    await flush();
    expect(updates(game.messages)).toEqual([
      { m: 'environment', environment: { connected: false, visible: true } },
      { m: 'players', players: changed ? players.slice(1) : players, leader: changed ? 2 : 1 },
      { m: 'environment', environment: { connected: true, visible: true } },
    ]);
    expect(root.dataset.phase).toBe('playing');
  });

  it.each(['replaced', 'offline'] as const)('%sを直ちに通知し、onlineやソケットのopenだけでは接続済みにしない', async (reason) => {
    const { root, sock, win } = await launched();
    const game = await connect(root);
    if (reason === 'replaced') sock.fail('replaced');
    else win.dispatchEvent(new Event('offline'));
    sock.setState('connecting');
    sock.setState('open');
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(updates(game.messages)).toEqual([{ m: 'environment', environment: { connected: false, visible: true } }]);
    sock.welcome('XN7Q', [p(1, 'たろう'), p(2, 'はなこ')]);
    await flush();
    expect(updates(game.messages).at(-1)).toEqual({ m: 'environment', environment: { connected: true, visible: true } });
    expect(updates(game.messages).some((m) => m.m === 'resume')).toBe(false);
  });

  it.each([false, true])('メニュー・切断・非表示が重なり、解除順を変えても再開を合成しない（表示が先:%s）', async (showFirst) => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { root, sock, win } = await launched();
    const game = await connect(root);
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    sock.fail('network', false);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const show = () => {
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    };
    if (showFirst) show();
    sock.welcome('XN7Q', [p(1, 'たろう'), p(2, 'はなこ')]);
    if (!showFirst) show();
    await flush();
    expect(root.dataset.phase).toBe('paused');
    const log = updates(game.messages);
    expect(log.slice(0, 3)).toEqual([
      { m: 'pause' },
      { m: 'environment', environment: { connected: false, visible: true } },
      { m: 'environment', environment: { connected: false, visible: false } },
    ]);
    expect(log.some((m) => m.m === 'resume')).toBe(false);
    expect(padsTo(sock, 1).at(-1)).toMatchObject({ k: 'remote' });
    sock.frame({ t: 'in', p: 1, i: { k: 'btn', id: 'stop', d: 1 }, T: 1 });
    await flush();
    expect(updates(game.messages).some((m) => m.m === 'input')).toBe(false);
    click('[data-nav="menu:continue"]');
    await flush();
    expect(updates(game.messages).filter((m) => m.m === 'resume')).toEqual([{ m: 'resume' }]);
    expect(root.dataset.phase).toBe('playing');
  });

  it('endの記録・同順位・退出・注記を結果画面へ渡し、共有には行データを含めない', async () => {
    const share = vi.fn(async () => undefined);
    const { root, sock } = await launched([p(1, 'たろう'), p(2, 'はなこ'), p(3, 'じろう'), p(4, '元の名前')], { share });
    const game = await connect(root);
    sock.frame({ t: 'left', p: 4, why: 'bye' });
    sock.frame({ t: 'joined', p: p(4, '別の人') });
    game.send({ m: 'end', results: [
      { p: 4, score: 0, label: 'ズレ1.0秒', ranked: false },
      { p: 3, score: -8, label: 'ズレ0.8秒' },
      { p: 2, score: -2, label: 'ズレ0.2秒' },
      { p: 1, score: -2, label: 'ズレ0.2秒' },
    ], options: { display: 'record', note: '通信の遅れを含む目安です' } });
    await flush();
    expect(root.dataset.state).toBe('results');
    expect([...root.querySelectorAll('.result__rank')].map((r) => r.textContent)).toEqual(['1位', '1位', '3位', '—']);
    expect(root.querySelector('[data-seat="4"] .result__name')?.textContent).toBe('元の名前');
    expect(root.querySelector('[data-seat="4"] .result__gone')?.textContent).toBe('（退出）');
    expect(root.querySelector('.result__score')).toBeNull();
    expect(root.querySelector('.results__note')?.textContent).toBe('通信の遅れを含む目安です');
    click('[data-nav="results:share"]');
    const panel = root.querySelector('[data-layer="share"]');
    expect(panel?.textContent).not.toMatch(/たろう|はなこ|じろう|名前|0\.2|目安|XN7Q/);
    for (const a of panel?.querySelectorAll<HTMLAnchorElement>('[data-share]') ?? []) expect(decodeURIComponent(a.href)).not.toMatch(/たろう|はなこ|じろう|名前|0\.2|目安|XN7Q/);
    click('[data-nav="share:native"]');
    await flush();
    expect(share).toHaveBeenCalledWith({ title: 'irori', text: expect.any(String), url: `${ORIGIN}/` });
    expect(JSON.stringify(share.mock.calls)).not.toMatch(/たろう|はなこ|じろう|名前|0\.2|目安|XN7Q/);
  });

  it('勝敗なしから再戦・ホームへ進め、新しい旧形式の結果へ設定を持ち越さない', async () => {
    const { root } = await launched();
    const first = await connect(root);
    first.send({ m: 'end', results: [{ p: 1, score: -2, label: 'ズレ0.2秒' }, { p: 2, score: -3, label: 'ズレ0.3秒' }], options: { display: 'record', outcome: 'incomplete', note: '人数が足りません' } });
    await flush();
    expect(root.querySelector('.results__outcome')?.textContent).toBe('勝敗なし');
    expect(root.querySelector('.result--top')).toBeNull();
    click('[data-nav="results:again"]');
    const second = await connect(root);
    expect(root.dataset.state).toBe('playing');
    second.send({ m: 'end', results: [{ p: 1, score: 42 }, { p: 2, score: 0 }] });
    await flush();
    expect(root.querySelector('.result__score')?.textContent).toBe('42点');
    expect(root.querySelector('.results__outcome, .results__note')).toBeNull();
    expect(root.querySelector('.result--top .result__rank')?.textContent).toBe('1位');
    click('[data-nav="results:home"]');
    expect(root.dataset.state).toBe('home');
    expect(root.querySelector('.results, iframe')).toBeNull();
  });

  it('同じ部屋の保存情報で再読込しても、一勝負は復元せずホームへ戻る', async () => {
    const original = await launched();
    await connect(original.root);
    original.sock.setState('closed');
    const reload = await setup({ session: original.session });
    sockets.push(reload.sockets.last);
    reload.sockets.last.welcome('XN7Q', [p(1, 'たろう'), p(2, 'はなこ')]);
    await flush();
    expect(reload.state()).toBe('home');
    expect(reload.calls).not.toContain('POST /api/rooms');
    expect(reload.root.querySelector('iframe, .results')).toBeNull();
  });
});
