// 司令塔の配線を、作り物の部屋の WebSocket で確かめる（画面の配置を測れないので、移動はクリックで代える）。
// 実物の Worker・実ブラウザでの通しは host.e2e.ts。
import type { PadSpec, PlayerInfo } from '@irori/protocol';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Console } from '../../src/host/console';
import { registerHostMessages } from '../../src/host/messages';
import registry from '../fixtures/host/registry.json';
import { busy, created, FakeSocket, memoryStorage, SocketFactory, useJapanese } from './fakes';

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
  new Console({ root, win, doc: document, fetch: fetchFn, session: memoryStorage(), local: memoryStorage(), origin, makeSocket: sockets.make }).start();
  await flush();
  return { root, sockets, calls, nav, win, state: () => root.dataset.state };
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
