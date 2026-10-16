import type { PlayerInfo } from '@irori/protocol';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseCatalog } from '../../src/host/catalog';
import { registerHostMessages } from '../../src/host/messages';
import { EMPTY_ROSTER, type Roster } from '../../src/host/roster';
import { HomeView, type HomeData } from '../../src/host/view-home';
import { confirmLayer, detailLayer, kickLayer, launchOverlay, menuLayer, resultsScreen } from '../../src/host/view-panels';
import registry from '../fixtures/host/registry.json';
import { useJapanese } from './fakes';

beforeAll(() => {
  useJapanese();
  registerHostMessages();
});

const games = () => parseCatalog(registry, 'ja');
const p = (id: number, name: string, online = true): PlayerInfo => ({ id, name, online });
const roster = (players: PlayerInfo[], leader: number | null = players[0]?.id ?? null, locked = false): Roster => ({ ...EMPTY_ROSTER, players, leader, locked });

function view(over: Partial<HomeData> = {}) {
  const on = { select: vi.fn(), open: vi.fn(), toggleSound: vi.fn(), toggleLock: vi.fn(), share: vi.fn(), retryCatalog: vi.fn(), kick: vi.fn() };
  const v = new HomeView(on);
  document.body.replaceChildren(v.el);
  v.update({ games: games(), catalog: 'ok', selected: 0, roster: EMPTY_ROSTER, code: 'XN7Q', origin: 'https://irori.example', loopback: false, sound: 'on', soundHint: null, ...over });
  return { v, on };
}

describe('ホームの描画', () => {
  it('主役のカード：題名・一言・人数・使うコントローラー（作者とライセンスは詳細だけ。選び方の案内は棚の下だけ）', () => {
    view({ roster: roster([p(1, 'a'), p(2, 'b')]) });
    const hero = document.querySelector('.hero');
    expect(hero?.getAttribute('data-game')).toBe('fixture-race');
    expect(hero?.querySelector('.hero__title')?.textContent).toBe('はやおしレース');
    expect(hero?.textContent).toContain('2〜8人');
    expect(hero?.querySelector('[data-pad="buzzer"]')?.textContent).toBe('早押し');
    expect(hero?.querySelector('[data-pad="wait"]')).toBeNull();
    expect(hero?.querySelector('.meta')).toBeNull();
    expect(hero?.textContent).not.toContain('Fixture Author');
    expect(hero?.querySelector('[data-fit]')).toBeNull();
    expect(hero?.textContent).not.toContain('選び');
    expect(hero?.getAttribute('data-playable')).toBe('true');
  });

  it('文言は文節のあいだでだけ折る（語の途中で折らない塊と、折ってよい位置）', () => {
    view({ roster: roster([p(1, 'a'), p(2, 'b')]) });
    const summary = document.querySelector('.hero__summary');
    expect(summary?.textContent).toBe('合図のあと、いちばん早く押した人が勝ち。');
    expect(summary?.querySelectorAll('.pp-nw').length).toBeGreaterThan(2);
    expect(summary?.querySelectorAll('wbr').length).toBe((summary?.querySelectorAll('.pp-nw').length ?? 0) - 1);
  });

  it('人数が足りない・多すぎるゲームは灰色にして、理由を1行出す', () => {
    view({ roster: roster([p(1, 'a')]) });
    const race = document.querySelector('.card[data-game="fixture-race"]');
    expect(race?.getAttribute('data-playable')).toBe('false');
    expect(race?.querySelector('.card__sub')?.textContent).toBe('あと1人で遊べます');
    expect(document.querySelector('.hero [data-fit="need"]')?.textContent).toBe('あと1人で遊べます');
    const five = roster([1, 2, 3, 4, 5].map((i) => p(i, `p${i}`)));
    view({ roster: five, selected: 1 });
    const solo = document.querySelector('.card[data-game="fixture-solo"]');
    expect(solo?.getAttribute('data-playable')).toBe('false');
    expect(solo?.querySelector('.card__sub')?.textContent).toBe('最大4人です');
    expect(document.querySelector('.card[data-game="fixture-race"]')?.getAttribute('data-playable')).toBe('true');
  });

  it('使うコントローラーの名前：スティックの画面は「スティックか十字キー」（ボタンが付くかはゲームごとなので書かない）', () => {
    view({ selected: 1 });
    expect(document.querySelector('.hero [data-pad="pad"]')?.textContent).toBe('スティックか十字キー');
  });

  it('外部のゲームは、ホスト名の注意を出す', () => {
    view({ selected: 2 });
    expect(document.querySelector('.hero [data-external]')?.textContent).toBe('games.example.invalid のサーバーで動くゲームです');
  });

  it('最初の1人が入るまで、3手順の案内を出す。入ったら参加者の帯に替わる', () => {
    const { v } = view();
    expect(document.querySelectorAll('.guide__step')).toHaveLength(3);
    expect(document.querySelector('.guide__step')?.textContent).toContain('スマホのカメラで、QRを読む');
    expect(document.querySelector('.roster')).toBeNull();
    v.update({ games: games(), catalog: 'ok', selected: 0, roster: roster([p(1, 'たろう')]), code: 'XN7Q', origin: 'https://irori.example', loopback: false, sound: 'on', soundHint: null });
    expect(document.querySelector('[data-guide]')).toBeNull();
    expect(document.querySelectorAll('.seat')).toHaveLength(1);
  });

  it('参加者の帯：色と形の印・名前・接続中か・リーダーの印', () => {
    view({ roster: roster([p(1, 'たろう'), p(2, 'はなこ', false)], 1) });
    const s1 = document.querySelector('.seat[data-seat="1"]');
    const s2 = document.querySelector('.seat[data-seat="2"]');
    expect(s1?.querySelector('.seat-mark')?.getAttribute('data-shape')).toBe('circle');
    expect(s1?.querySelector('.seat-mark')?.getAttribute('aria-label')).toBe('橙の丸');
    expect(s1?.hasAttribute('data-leader')).toBe(true);
    expect(s1?.querySelector('.badge--leader')?.textContent).toBe('リーダー');
    expect(s2?.getAttribute('data-online')).toBe('false');
    expect(s2?.textContent).toContain('つながっていません');
    expect(s2?.querySelector('.seat-mark')?.getAttribute('data-shape')).toBe('square');
    expect(document.querySelector('.people__count')?.textContent).toBe('2/8人');
  });

  it('名前は文字として描く。HTMLとして解釈しない（スマホから来た文字列）', () => {
    const evil = '<img src=x onerror=alert(1)>';
    view({ roster: roster([p(1, evil), p(2, '<b>太字</b>')]) });
    const chip = document.querySelector('.seat[data-seat="1"]');
    expect(chip?.querySelector('.seat__name')?.textContent).toBe(evil);
    expect(chip?.querySelector('img')).toBeNull();
    expect(document.querySelector('.roster b')).toBeNull();
    expect(document.querySelector('.seat[data-seat="2"] .seat__name')?.textContent).toBe('<b>太字</b>');
  });

  it('結果の名前とラベル（ゲームから来た文字列）も、文字として描く。点数に単位、記録に見出し', () => {
    const el = resultsScreen(null, [{ p: 1, rank: 1, score: 800, name: '<i>x</i>', label: '<u>y</u>', gone: false }], { again: vi.fn(), home: vi.fn(), share: vi.fn() });
    expect(el.querySelector('i')).toBeNull();
    expect(el.querySelector('u')).toBeNull();
    expect(el.querySelector('.result__name')?.textContent).toBe('<i>x</i>');
    expect(el.querySelector('.result__value')?.textContent).toBe('<u>y</u>');
    expect(el.querySelector('.result__caption')?.textContent).toBe('記録');
    expect(el.querySelector('.result__score')?.textContent).toBe('800点');
    expect(el.querySelector('.results__title')?.textContent).toBe('結果');
    expect(el.querySelector('[data-nav="results:share"]')?.textContent).toBe('irori を紹介');
  });

  it('QRとコードは右下の1か所：URLは /pad#CODE、コードは等幅の大きな文字', () => {
    view();
    const join = document.querySelector('.home__join .join');
    expect(join?.getAttribute('data-code')).toBe('XN7Q');
    expect(join?.querySelector('.join__qr')?.getAttribute('data-url')).toBe('https://irori.example/pad#XN7Q');
    expect(join?.querySelector('.join__code')?.textContent).toBe('XN7Q');
    expect(join?.querySelector('svg.qr rect')?.getAttribute('fill')).toBe('#fbf4ea');
    expect(join?.textContent).toContain('irori.example/pad で、このコードを入力');
  });

  it('参加を締め切ると、QRの上に「参加を締め切っています」。道具のボタンは「受け付けを再開」', () => {
    view({ roster: roster([p(1, 'a')], 1, true) });
    expect(document.querySelector('.join')?.getAttribute('data-locked')).toBe('true');
    expect(document.querySelector('.join__lock')?.textContent).toBe('参加を締め切っています');
    const lock = document.querySelector('[data-action="lock"]');
    expect(lock?.getAttribute('aria-pressed')).toBe('true');
    expect(lock?.querySelector('.btn__label')?.textContent).toBe('受け付けを再開');
    view({ roster: roster([p(1, 'a')], 1, false) });
    expect(document.querySelector('[data-action="lock"] .btn__label')?.textContent).toBe('参加を締め切る');
  });

  it('選び方の案内は、棚の下の1行だけ。遊べるときだけ「選びます」、遊べないときは「あと◯人そろうと始められます」', () => {
    view({ roster: roster([p(1, 'たろう'), p(2, 'はなこ')], 1) });
    const prompts = document.querySelectorAll('[data-prompt]');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.closest('.home__prompt')).not.toBeNull();
    expect(prompts[0]?.querySelector('.start-prompt__wide')?.textContent).toBe('たろうさんのスマホの［決定］か、キーボードの［Enter］で、このゲームを選びます');
    // 指で触る狭い画面向けの文（キーボードの部分なし）も置き、CSS で片方だけ見せる。
    expect(prompts[0]?.querySelector('.start-prompt__touch')?.textContent).toBe('たろうさんのスマホの［決定］で、このゲームを選びます');
    expect(prompts[0]?.querySelector('svg')).toBeNull();
    view({ roster: roster([p(1, 'たろう')], 1) });
    expect(document.querySelector('[data-prompt]')?.getAttribute('data-prompt')).toBe('need');
    expect(document.querySelector('[data-prompt]')?.textContent).toBe('あと1人そろうと始められます');
    view();
    expect(document.querySelector('[data-prompt]')).toBeNull();
  });

  it('ほかの端末から開けないアドレスのとき：QRを薄くして「!」、全幅の警告、手入力の案内とはじめかた①を差し替える', () => {
    view({ origin: 'http://127.0.0.1:8787', loopback: true });
    const join = document.querySelector('.home__join .join');
    expect(join?.querySelector('.join__qr')?.getAttribute('data-url')).toBe('http://127.0.0.1:8787/pad#XN7Q');
    expect(join?.classList.contains('join--loopback')).toBe(true);
    expect(join?.querySelector('.join__title')?.textContent).toBe('この画面からは参加できません');
    expect(join?.querySelector('.join__note')).toBeNull();
    expect(join?.querySelector('[data-loopback]')?.textContent).toBe('このアドレスは、ほかのスマホから開けません');
    expect(join?.querySelector('[data-loopback] [data-icon="alert"]')).not.toBeNull();
    expect(join?.querySelector('.join__cover [data-icon="alert"]')).not.toBeNull();
    expect(join?.querySelector('.join__scan')).toBeNull();
    expect(join?.querySelector('[data-fix]')?.textContent).toBe('npm run dev が表示する「大画面で開くURL」で、開き直してください');
    expect(join?.textContent).not.toContain('127.0.0.1:8787/pad で');
    const first = document.querySelector('.guide__step');
    expect(first?.textContent).toContain('この画面からは、スマホは参加できません');
    // 警告のある場所は、広い画面では右、縦に積む画面では上（CSS で片方だけ見せる）。①の丸は「!」、②③は開き直したあとの手順。
    expect(first?.querySelector('.guide__where--right')?.textContent).toBe('（右の警告）');
    expect(first?.querySelector('.guide__where--above')?.textContent).toBe('（上の警告）');
    expect(first?.querySelector('.guide__num')?.textContent).toBe('!');
    const later = [...document.querySelectorAll('.guide__step--later')];
    expect(later).toHaveLength(2);
    expect(later.every((el) => el.textContent?.endsWith('（開き直したあと）'))).toBe(true);
    expect(document.querySelector('.home__top .loop-band')?.textContent).toBe('このアドレスでは、スマホは参加できません');
    view({ origin: 'https://irori.example', loopback: false });
    expect(document.querySelector('[data-loopback]')).toBeNull();
    expect(document.querySelector('.loop-band')).toBeNull();
    expect(document.querySelector('.join__scan')?.textContent).toBe('カメラでQRを読む');
  });

  it('満員（8/8人）：見出しを「満員です（8/8人）」にし、QRを薄くして「だれかが抜けると入れます」を重ねる', () => {
    const eight = roster([1, 2, 3, 4, 5, 6, 7, 8].map((i) => p(i, `p${i}`)));
    view({ roster: eight });
    const join = document.querySelector('.home__join .join');
    expect(join?.hasAttribute('data-full')).toBe(true);
    expect(join?.querySelector('.join__title')?.textContent).toBe('満員です（8/8人）');
    expect(join?.querySelector('[data-fullnote]')?.textContent).toBe('だれかが抜けると入れます');
    expect(join?.querySelector('.join__scan')).toBeNull();
    expect(join?.querySelector('.join__type')?.textContent).toBe('空いたら、このコードで入れます');
    view({ roster: roster([1, 2, 3, 4, 5, 6, 7].map((i) => p(i, `p${i}`))) });
    expect(document.querySelector('.join')?.hasAttribute('data-full')).toBe(false);
    expect(document.querySelector('.join__title')?.textContent).toBe('スマホで参加');
  });

  it('音の状態は、上の音のボタンの1か所だけ（最初の操作の前は「音：クリックで開始」。帯は出さない）。メニューは「音を消す」「音を出す」', () => {
    view({ sound: 'on' });
    expect(document.querySelector('[data-action="sound"] .btn__label')?.textContent).toBe('音：オン');
    view({ sound: 'off' });
    expect(document.querySelector('[data-action="sound"] .btn__label')?.textContent).toBe('音：オフ');
    const { on } = view({ sound: 'locked', soundHint: 'click' });
    expect(document.querySelector('[data-action="sound"] .btn__label')?.textContent).toBe('音：クリックで開始');
    expect(document.querySelector('[data-hint="sound"]')).toBeNull();
    // 押すと「開始」の意味で渡す（切り替えて消さない）。
    document.querySelector<HTMLButtonElement>('[data-action="sound"]')?.click();
    expect(on.toggleSound).toHaveBeenCalledWith('locked');
    view({ sound: 'locked', soundHint: 'touch' });
    expect(document.querySelector('[data-action="sound"] .btn__label')?.textContent).toBe('音：タップで開始');
    const menu = (sound: 'on' | 'off' | 'locked') =>
      menuLayer(
        { view: 'main', game: null, sound, locked: false, players: [], code: 'XN7Q', origin: 'https://irori.example', loopback: false, full: null },
        { resume: vi.fn(), home: vi.fn(), sound: vi.fn(), lock: vi.fn(), view: vi.fn(), kick: vi.fn() },
      );
    expect(menu('on').querySelector('[data-nav="menu:sound"]')?.textContent).toBe('音を消す');
    // 並びは「続ける・ホームへ」のあとに設定（上下の移動は一周する）。
    expect([...menu('on').querySelectorAll('.menu__list [data-nav]')].map((el) => el.getAttribute('data-nav'))).toEqual([
      'menu:continue',
      'menu:home',
      'menu:sound',
      'menu:lock',
      'menu:qr',
      'menu:kick',
    ]);
    expect(menu('locked').querySelector('[data-nav="menu:sound"]')?.textContent).toBe('音を消す');
    expect(menu('off').querySelector('[data-nav="menu:sound"]')?.textContent).toBe('音を出す');
  });

  it('道具のボタンには、狭い画面で見せる短い名前を添える（読み上げの名前は長いほう）', () => {
    view({ roster: roster([p(1, 'たろう')]) });
    const shorts = ['sound', 'lock', 'share'].map((a) => document.querySelector(`[data-action="${a}"] .btn__short`));
    expect(shorts.map((el) => el?.textContent)).toEqual(['音', '締め切る', '共有']);
    expect(shorts.every((el) => el?.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(document.querySelector('a[data-nav="tool:licenses"] .btn__short')?.textContent).toBe('説明');
  });

  it('狭い画面で開いた人のための、参加のページ（/pad）への帯。部屋のコードは付けない', () => {
    view();
    const a = document.querySelector<HTMLAnchorElement>('.home__top a.padlink');
    expect(a?.getAttribute('href')).toBe('/pad');
    expect(a?.textContent).toBe('参加するスマホは、こちら');
    expect(a?.hasAttribute('target')).toBe(false);
  });

  it('外部のゲームを開く前の確かめは、接続先に加えて、ニックネームと操作が渡り、運営者のサーバーに送られうることを伝える', () => {
    const el = confirmLayer('games.example.invalid', { ok: vi.fn(), cancel: vi.fn() });
    expect(el.querySelector('.dialog__title')?.textContent).toBe('games.example.invalid のサーバーに接続します');
    expect(el.querySelector('.dialog__body')?.textContent).toBe('このゲームには、参加者のニックネームと操作が渡り、ゲームの運営者のサーバーに送られることがあります。');
  });

  it('メニューの開き方と音の案内は、ゲームの画面に重ねず、詳細の操作と開始前の覆いに出す', () => {
    const g = games()[0]!;
    const detail = detailLayer(g, { ok: true }, { start: vi.fn(), back: vi.fn() });
    expect(detail.querySelector('.detail__controls [data-hint="menu"]')?.textContent).toBe('メニュー：［Esc］か、スマホの右上の「…」から');
    const loading = launchOverlay(g, 'none', { wait: vi.fn(), home: vi.fn(), retry: vi.fn(), hints: { menu: 'メニュー：［Esc］か、スマホの右上の「…」から', sound: '音を出すには、この画面をクリックするか、キーを押してください' } });
    expect(loading.querySelector('[data-hint="menu"]')?.textContent).toBe('メニュー：［Esc］か、スマホの右上の「…」から');
    expect(loading.querySelector('[data-hint="sound"]')?.textContent).toBe('音を出すには、この画面をクリックするか、キーを押してください');
    const ready = launchOverlay(g, 'none', { wait: vi.fn(), home: vi.fn(), retry: vi.fn(), hints: { menu: 'メニュー', sound: null } });
    expect(ready.querySelector('[data-hint="sound"]')).toBeNull();
  });

  it('5人以上の結果は、行を詰めた形（.results--dense）。4人までは、ふつうの形', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ p: i + 1, rank: 1, score: 7, name: `p${i + 1}`, label: 'dev', gone: false }));
    const on = { again: vi.fn(), home: vi.fn(), share: vi.fn() };
    expect(resultsScreen(null, rows(4), on).classList.contains('results--dense')).toBe(false);
    expect(resultsScreen(null, rows(5), on).classList.contains('results--dense')).toBe(true);
    expect(resultsScreen(null, rows(8), on).classList.contains('results--dense')).toBe(true);
  });

  it('2文以上の本文は、文ごとの塊にする（行は文の切れ目で替わる）', () => {
    const kick = kickLayer(p(1, 'たろう'), { ok: vi.fn(), cancel: vi.fn() });
    const parts = [...kick.querySelectorAll('.dialog__body .sentence')].map((el) => el.textContent);
    expect(parts).toEqual(['外された人は、もう一度参加すれば戻れます。', '入れたくないときは、参加を締め切ってください。']);
  });

  it('参加者の札を選んでいるときだけ、見出しの行に「［Enter］で外す」（札の上に浮かべない）。外す確かめは、塗りの「やめる」が先', () => {
    view({ roster: roster([p(1, 'たろう')]) });
    expect(document.querySelector('.people__head .people__hint')?.textContent).toBe('［Enter］で外す');
    expect(document.querySelector('.seat .seat__hint')).toBeNull();
    const kick = kickLayer(p(1, 'たろう'), { ok: vi.fn(), cancel: vi.fn() });
    const buttons = [...kick.querySelectorAll('.dialog__actions button')];
    expect(buttons.map((b) => b.getAttribute('data-nav'))).toEqual(['kick:cancel', 'kick:ok']);
    expect(buttons[0]?.classList.contains('btn--primary')).toBe(true);
  });

  it('カードを押すと開き、選ぶ（フォーカス）と主役が替わる', () => {
    const { on } = view();
    const card = document.querySelector<HTMLButtonElement>('.card[data-index="1"]');
    card?.click();
    expect(on.open).toHaveBeenCalledWith(1);
    card?.dispatchEvent(new FocusEvent('focus'));
    expect(on.select).toHaveBeenCalledWith(1);
  });

  it('道具：音・締め切り・共有と、ライセンスとクレジット（新しいタブで /licenses.txt）。0人のときは締め切れない', () => {
    view();
    expect(document.querySelector<HTMLButtonElement>('[data-action="lock"]')?.disabled).toBe(true);
    view({ roster: roster([], null, true) });
    expect(document.querySelector<HTMLButtonElement>('[data-action="lock"]')?.disabled).toBe(false);
    const { on } = view({ roster: roster([p(1, 'a')]) });
    document.querySelector<HTMLButtonElement>('[data-action="share"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="sound"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="lock"]')?.click();
    expect(on.share).toHaveBeenCalled();
    expect(on.toggleSound).toHaveBeenCalled();
    expect(on.toggleLock).toHaveBeenCalled();
    const a = document.querySelector('a[data-nav="tool:licenses"]');
    expect(a?.getAttribute('href')).toBe('/licenses.txt');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('一覧が読めないときは、理由と読み込み直しのボタン', () => {
    const { on } = view({ games: [], catalog: 'error' });
    expect(document.querySelector('.home__shelf')?.textContent).toContain('ゲームの一覧を読み込めませんでした');
    document.querySelector<HTMLButtonElement>('[data-nav="shelf:retry"]')?.click();
    expect(on.retryCatalog).toHaveBeenCalled();
  });
});

describe('音の案内（ブラウザが音を止めているあいだ）', () => {
  it('ホームには帯を出さない。音のボタンの文が、最初の操作のあとで「音：オン」に替わる', () => {
    const { v } = view({ soundHint: 'click', sound: 'locked' });
    expect(document.querySelector('[data-hint="sound"]')).toBeNull();
    v.update({ games: games(), catalog: 'ok', selected: 0, roster: EMPTY_ROSTER, code: 'XN7Q', origin: 'https://irori.example', loopback: false, sound: 'on', soundHint: null });
    expect(document.querySelector('[data-action="sound"] .btn__label')?.textContent).toBe('音：オン');
  });
});
