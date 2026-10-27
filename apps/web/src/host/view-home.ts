// ホーム：主役は選択中のゲームのカード1枚。その下に棚（4:3のカード）と、選び方の案内の1行。QRとコードは右の1か所。
// 参加者は下の帯（色と形・名前・接続中か・リーダー）。最初の1人が入るまで、帯の場所に3手順の案内（はじめかた）を出す。
// 狭い画面では、置き場所はそのままに、見る順を CSS の order で「参加の板 → 参加者 → 主役 → 棚 → 案内 → はじめかた」にする。
// 文言はすべて文節のあいだでだけ折り返す（tx）。スマホから来た名前は textContent で入れる（nameEl・withName）。
import type { PlayerId } from '@irori/protocol';
import { h, type Child } from '../shared/dom';
import { t } from '../shared/i18n';
import type { GameEntry } from './catalog';
import { icon, logoMark, type IconName } from './icons';
import { padUrl, qrSvg } from './qr';
import { fit, type Fit, type Roster } from './roster';
import { button, link, nameEl, seatLabel, seatMark, sentences, tx, withName } from './ui';

/** 音の状態。locked＝オンだが、ブラウザが最初の操作を待っていて、まだ鳴らない。 */
export type SoundState = 'on' | 'off' | 'locked';
/** 音の案内の出し方。touch＝狭い画面（指で触る）向けの文。 */
export type SoundHint = 'click' | 'touch' | null;

export interface HomeData {
  games: readonly GameEntry[];
  catalog: 'loading' | 'ok' | 'error';
  selected: number;
  roster: Roster;
  code: string | null;
  /** 部屋の案内に出すオリジン（origin.ts）。 */
  origin: string;
  /** 案内のアドレスが、ほかの端末から開けない。 */
  loopback: boolean;
  sound: SoundState;
  soundHint: SoundHint;
}

export interface HomeHandlers {
  select(index: number): void;
  open(index: number): void;
  /** from＝押したときに見えていた状態。locked（まだ鳴らない）なら、切り替えずに音を出し始める。 */
  toggleSound(from?: SoundState): void;
  toggleLock(): void;
  share(): void;
  retryCatalog(): void;
  kick(id: PlayerId): void;
}

/** 参加の板の状態。full＝満員（n/max人）。 */
export interface JoinState {
  locked: boolean;
  loopback: boolean;
  full: { n: number; max: number } | null;
}

const PAD_ICON: Record<string, IconName> = { pad: 'pad', buzzer: 'buzzer', choices: 'choices', tiles: 'tiles', touch: 'touch', tilt: 'tilt', wait: 'wait' };

export function playersText(g: GameEntry): string {
  return g.players.min === g.players.max ? t('host.game.playersOne', { n: g.players.min }) : t('host.game.players', { min: g.players.min, max: g.players.max });
}

export function fitText(f: Fit): string | null {
  if (f.ok) return null;
  return f.why === 'need' ? t('host.game.need', { n: f.n }) : t('host.game.over', { max: f.max });
}

/** 上の道具の音のボタン。音の状態を示すのは、このボタンの1か所だけ（最初の操作の前は「音：クリックで開始」）。 */
export function soundLabel(s: SoundState, hint: SoundHint = 'click'): string {
  if (s === 'off') return t('host.tool.soundOff');
  if (s === 'locked') return hint === 'touch' ? t('host.tool.soundStartTouch') : t('host.tool.soundStart');
  return t('host.tool.soundOn');
}

/** 音の案内の文（音が鳴らないあいだだけ出す）。 */
export function soundHintText(h: Exclude<SoundHint, null>): string {
  return h === 'touch' ? t('host.audio.hintTouch') : t('host.audio.hint');
}

/** サムネイル。無いとき（開発中のゲームなど）は、火の印で代わりの絵を描く。 */
export function thumb(g: GameEntry, cls: string): HTMLElement {
  if (g.thumb) {
    return h('div', { class: `${cls} thumb` }, h('img', { attrs: { src: g.thumb, alt: '', decoding: 'async', draggable: 'false' } }));
  }
  return h('div', { class: `${cls} thumb thumb--blank` }, logoMark('thumb__mark'));
}

export function padChips(g: GameEntry): HTMLElement {
  const list = h('ul', { class: 'pads', attrs: { 'aria-label': t('host.pads.title') } });
  for (const k of g.pads) {
    if (k === 'wait') continue;
    const name = PAD_ICON[k];
    if (!name) continue;
    list.append(h('li', { class: 'pad-chip', data: { pad: k } }, icon(name), h('span', {}, t(`host.pads.${k}`))));
  }
  return list;
}

/** 作者・ライセンス・素材。主役のカードには出さず、詳細の窓の下のほうにだけ出す。 */
export function gameMeta(g: GameEntry): HTMLElement {
  const assets = g.assets === 'original' ? t('host.game.assetsOriginal') : g.assets;
  const rows: Child[] = [
    h('div', { class: 'meta__row' }, h('dt', {}, t('host.game.by')), h('dd', {}, g.authors.join(t('host.sep')))),
    h('div', { class: 'meta__row' }, h('dt', {}, t('host.game.license')), h('dd', {}, g.license)),
    h('div', { class: 'meta__row' }, h('dt', {}, t('host.game.assets')), h('dd', {}, assets)),
  ];
  return h('dl', { class: 'meta' }, ...rows);
}

export function externalNote(g: GameEntry): HTMLElement | null {
  if (!g.host) return null;
  return h('p', { class: 'note note--external', data: { external: g.host } }, icon('external'), h('span', {}, ...tx(t('host.game.external', { host: g.host }))));
}

/** 狭い画面の道具のボタンに添える、短い名前（読み上げには、長い名前のほうを使う）。 */
function short(el: HTMLElement, key: string): HTMLElement {
  el.append(h('span', { class: 'btn__short', attrs: { 'aria-hidden': 'true' } }, t(key)));
  return el;
}

/** 「ライセンスとクレジット」。狭い画面では、紙の絵と短い名前のボタンにたたむ（長い名前は読み上げに残す）。 */
function licensesLink(): HTMLElement {
  const a = link(t('host.licenses'), '/licenses.txt', 'tool:licenses', 'link toolbar__link');
  a.prepend(icon('doc', 'icon toolbar__doc'));
  return short(a, 'host.tool.short.licenses');
}

export class HomeView {
  readonly el: HTMLElement;
  private readonly top: HTMLElement;
  private readonly hero: HTMLElement;
  private readonly shelf: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly people: HTMLElement;
  private readonly guide: HTMLElement;
  private readonly join: HTMLElement;
  private readonly keys = { top: '', hero: '', shelf: '', prompt: '', people: '', guide: '', join: '' };

  constructor(private readonly on: HomeHandlers) {
    this.top = h('header', { class: 'home__top' });
    this.hero = h('section', { class: 'home__hero', attrs: { 'aria-live': 'polite' } });
    this.shelf = h('section', { class: 'home__shelf', attrs: { 'aria-label': t('host.shelf.title') } });
    this.prompt = h('section', { class: 'home__prompt' });
    this.people = h('section', { class: 'home__people' });
    this.guide = h('section', { class: 'home__guide' });
    this.join = h('aside', { class: 'home__join', attrs: { 'aria-label': t('host.join.title') } });
    this.el = h('main', { class: 'screen home' }, this.top, h('div', { class: 'home__main' }, this.hero, this.shelf, this.prompt, this.people, this.guide), this.join);
  }

  update(d: HomeData): void {
    const r = d.roster;
    const count = r.players.length;
    const game = d.games[d.selected];
    const full = count >= r.max ? { n: count, max: r.max } : null;
    const leader = r.players.find((p) => p.id === r.leader)?.name;
    this.patch('top', `${d.sound}|${r.locked}|${d.soundHint}|${d.loopback}|${count === 0}`, () => this.renderTop(d));
    if (count === 0) this.el.dataset.empty = '';
    else delete this.el.dataset.empty;
    this.patch('hero', `${d.catalog}|${game?.id ?? ''}|${count}`, () => this.renderHero(d, game, count));
    this.patch('shelf', `${d.catalog}|${d.games.map((g) => g.id).join(',')}|${count}`, () => this.renderShelf(d, count));
    const f = game ? fit(game.players, count) : null;
    this.patch('prompt', `${leader ?? '\u0000'}|${JSON.stringify(f)}`, () => this.renderPrompt(f ? leader : undefined, f));
    this.patch('people', JSON.stringify([r.players, r.leader, r.max]), () => this.renderPeople(d));
    this.patch('guide', `${count === 0}|${d.loopback}`, () => this.renderGuide(count === 0, d.loopback));
    this.patch('join', `${d.code}|${r.locked}|${d.origin}|${d.loopback}|${full?.n ?? ''}`, () => this.renderJoin(d, full));
    for (const card of this.shelf.querySelectorAll<HTMLElement>('[data-game]')) {
      if (card.dataset.index === String(d.selected)) card.dataset.selected = '';
      else delete card.dataset.selected;
    }
  }

  private patch(part: keyof HomeView['keys'], key: string, build: () => void): void {
    if (this.keys[part] === key) return;
    this.keys[part] = key;
    build();
  }

  private renderTop(d: HomeData): void {
    const locked = d.roster.locked;
    // このページをスマホで開いた人のための、参加のページへの細い帯（広い画面では CSS で隠す）。部屋のコードは付けない。
    // ほかの端末から開けないアドレスのときは、スマホでは参加できないので出さない（代わりに警告の帯）。
    const padlink = d.loopback ? null : h('a', { class: 'padlink', attrs: { href: '/pad' } }, h('span', {}, ...tx(t('host.padlink'))), icon('arrow', 'icon padlink__arrow'));
    // ほかの端末から開けないアドレスのとき、狭い画面では、最初の画面の上にも短く知らせる（板の中の警告と同じ意味）。
    const loopBand = d.loopback ? h('p', { class: 'loop-band', attrs: { role: 'note' } }, icon('alert'), h('span', {}, ...tx(t('host.join.loopbackBand')))) : null;
    // 音の状態は、下の音のボタンの1か所だけで示す（帯は出さない）。まだ鳴らないあいだは「音：クリックで開始」。
    const sound = d.sound;
    this.top.replaceChildren(
      ...(padlink ? [padlink] : []),
      ...(loopBand ? [loopBand] : []),
      h('div', { class: 'brand' }, logoMark(), h('div', { class: 'brand__text' }, h('h1', { class: 'brand__name' }, 'irori'), h('p', { class: 'brand__tag' }, ...tx(t('host.tagline'))))),
      h(
        'nav',
        { class: 'toolbar', attrs: { 'aria-label': t('host.tool.label') } },
        short(
          button(soundLabel(sound, d.soundHint), {
            nav: 'tool:sound',
            action: 'sound',
            iconName: sound === 'on' ? 'soundOn' : 'soundOff',
            onPress: () => this.on.toggleSound(sound),
            extraClass: sound === 'on' ? '' : sound === 'locked' ? 'is-off is-start' : 'is-off',
          }),
          'host.tool.short.sound',
        ),
        // 絵は押したときの結果（締め切る＝閉じた錠、再開＝開いた錠）。いまの状態は、枠の明るさで示す。
        // 参加者が0人のときは、締め切っても意味がないので押せない（締め切ったまま0人になったら、再開だけは押せる）。
        short(
          button(locked ? t('host.tool.lockOn') : t('host.tool.lockOff'), {
            nav: 'tool:lock',
            action: 'lock',
            iconName: locked ? 'unlock' : 'lock',
            onPress: () => this.on.toggleLock(),
            extraClass: locked ? 'is-on' : '',
            disabled: !locked && d.roster.players.length === 0,
          }),
          locked ? 'host.tool.short.unlock' : 'host.tool.short.lock',
        ),
        short(button(t('host.tool.share'), { nav: 'tool:share', action: 'share', iconName: 'share', onPress: () => this.on.share() }), 'host.tool.short.share'),
        licensesLink(),
      ),
    );
    const lockBtn = this.top.querySelector('[data-action="lock"]');
    lockBtn?.setAttribute('aria-pressed', String(locked));
    lockBtn?.setAttribute('title', locked ? t('host.tool.unlockHint') : t('host.tool.lockHint'));
    this.top.querySelector('[data-action="sound"]')?.setAttribute('aria-pressed', String(d.sound !== 'off'));
  }

  private renderHero(d: HomeData, g: GameEntry | undefined, count: number): void {
    if (!g) {
      const msg = d.catalog === 'loading' ? t('host.shelf.loading') : d.catalog === 'error' ? t('host.shelf.error') : t('host.shelf.empty');
      this.hero.replaceChildren(h('div', { class: 'hero hero--empty' }, logoMark('hero__mark'), h('p', { class: 'hero__summary' }, ...tx(msg))));
      return;
    }
    const f = fit(g.players, count);
    const reason = fitText(f);
    // 選び方の案内は、棚の下の1行（renderPrompt）だけに出す。ここには、遊べない理由だけを印と文字で出す。
    this.hero.replaceChildren(
      h(
        'article',
        { class: 'hero', data: { game: g.id, playable: String(f.ok) } },
        thumb(g, 'hero__thumb'),
        h(
          'div',
          { class: 'hero__info' },
          h('h2', { class: 'hero__title' }, ...tx(g.title)),
          h('p', { class: 'hero__summary' }, ...sentences(g.summary)),
          h('div', { class: 'hero__chips' }, h('span', { class: 'players-chip' }, icon('people'), h('span', {}, playersText(g))), padChips(g)),
          externalNote(g),
          reason && !f.ok ? h('p', { class: 'fit fit--no', data: { fit: f.why } }, icon('info'), h('span', {}, ...tx(reason))) : null,
        ),
      ),
    );
  }

  private renderShelf(d: HomeData, count: number): void {
    const title = h('h2', { class: 'section-title' }, t('host.shelf.title'));
    if (d.catalog === 'error') {
      this.shelf.replaceChildren(title, h('div', { class: 'shelf shelf--msg' }, h('p', {}, ...tx(t('host.shelf.error'))), button(t('host.shelf.retry'), { nav: 'shelf:retry', onPress: () => this.on.retryCatalog() })));
      return;
    }
    const row = h('ul', { class: 'shelf' });
    d.games.forEach((g, i) => {
      const f = fit(g.players, count);
      const reason = fitText(f);
      const card = h(
        'button',
        {
          class: 'card',
          attrs: { type: 'button', 'aria-label': `${g.title}${t('host.sep')}${reason ?? playersText(g)}` },
          data: { nav: `game:${g.id}`, game: g.id, index: String(i), playable: String(f.ok) },
          on: { focus: () => this.on.select(i), click: () => this.on.open(i) },
        },
        thumb(g, 'card__thumb'),
        h('span', { class: 'card__caption' }, h('span', { class: 'card__title' }, g.title), h('span', { class: reason ? 'card__sub card__sub--no' : 'card__sub' }, reason ?? playersText(g))),
      );
      row.append(h('li', { class: 'shelf__item' }, card));
    });
    this.shelf.replaceChildren(title, row);
  }

  /**
   * 選び方の案内（棚の下の1行）。リーダーがいて、棚にゲームがあるときだけ。
   * 遊べるときだけ「{名前}さんのスマホの［決定］か、キーボードの［Enter］で、このゲームを選びます」。
   * 遊べないときは、選べない理由（あと何人か）を出す。狭い画面では、キーボードの部分を CSS で隠す。
   */
  private renderPrompt(leader: string | undefined, f: Fit | null): void {
    if (leader === undefined || !f) {
      this.prompt.replaceChildren();
      return;
    }
    if (!f.ok) {
      const text = f.why === 'need' ? t('host.start.need', { n: f.n }) : t('host.start.over', { max: f.max });
      this.prompt.replaceChildren(h('p', { class: 'start-prompt start-prompt--wait', data: { prompt: f.why } }, ...tx(text)));
      return;
    }
    // 広い画面の文と、指で触る狭い画面の文（キーボードの部分なし）を両方置き、CSS で片方だけ見せる。
    // 1つの文の中で一部を隠すと、「［決定］／で、」のように句の途中で折れるため、文ごと分けて文節で折る。
    this.prompt.replaceChildren(
      h(
        'p',
        { class: 'start-prompt', data: { prompt: '' } },
        h('span', { class: 'start-prompt__wide' }, ...withName('host.start.prompt', leader)),
        h('span', { class: 'start-prompt__touch' }, ...withName('host.start.promptTouch', leader)),
      ),
    );
  }

  private renderPeople(d: HomeData): void {
    const r = d.roster;
    if (r.players.length === 0) {
      this.people.replaceChildren();
      return;
    }
    const list = h('ul', { class: 'roster' });
    for (const p of r.players) {
      const leader = p.id === r.leader;
      const chip = h(
        'button',
        {
          class: 'seat',
          attrs: {
            type: 'button',
            'aria-label': [t('host.player.label', { name: p.name, look: seatLabel(p.id) }), leader ? t('host.player.leader') : '', p.online ? '' : t('host.player.offline')]
              .filter(Boolean)
              .join(t('host.sep')),
          },
          data: { nav: `seat:${p.id}`, seat: String(p.id), online: String(p.online), ...(leader ? { leader: '' } : {}) },
          on: { click: () => this.on.kick(p.id) },
        },
        seatMark(p.id, 28),
        nameEl(p.name, 'seat__name'),
        leader ? h('span', { class: 'badge badge--leader' }, icon('crown'), h('span', {}, t('host.player.leader'))) : null,
        // 狭い幅の2列の札には「つながっていません」が入りきらないので、短い「切断中」を見せる（読み上げは札の名前に入っている）。
        p.online
          ? null
          : h(
              'span',
              { class: 'seat__off' },
              icon('plug', 'icon icon--small'),
              h('span', { class: 'seat__off-long' }, t('host.player.offline')),
              h('span', { class: 'seat__off-short', attrs: { 'aria-hidden': 'true' } }, t('host.player.offlineShort')),
            ),
      );
      list.append(h('li', {}, chip));
    }
    // 外し方の案内は、札を選んでいるあいだだけ、見出しの行に出す（CSS）。札の上に浮かべると、上の段の札に重なるため。
    this.people.replaceChildren(
      h(
        'div',
        { class: 'people__head' },
        h('h2', { class: 'section-title' }, t('host.players.title')),
        h('span', { class: 'people__count', data: { count: String(r.players.length) } }, t('host.players.count', { n: r.players.length, max: r.max })),
        h('span', { class: 'people__hint', attrs: { 'aria-hidden': 'true' } }, t('host.player.kickHint')),
      ),
      list,
    );
  }

  /** はじめかた（最初の1人が入るまで）。ほかの端末から開けないアドレスのときは、①を「参加できない」に差し替える。 */
  private renderGuide(show: boolean, loopback: boolean): void {
    if (!show) {
      this.guide.replaceChildren();
      return;
    }
    // 警告は、広い画面では右の参加の板、縦に積む画面では上にある。どちらを指すかは CSS で出し分ける。
    const first: Child[] = loopback
      ? [...tx(t('host.guide.step1Loopback')), h('span', { class: 'pp-nw guide__where guide__where--right' }, t('host.guide.seeRight')), h('span', { class: 'pp-nw guide__where guide__where--above' }, t('host.guide.seeAbove'))]
      : tx(t('host.guide.step1'));
    const after = (key: string): Child[] => (loopback ? [...tx(t(key)), h('span', { class: 'pp-nw guide__after' }, t('host.guide.afterFix'))] : tx(t(key)));
    const steps: Child[][] = [first, after('host.guide.step2'), after('host.guide.step3')];
    this.guide.replaceChildren(
      h(
        'div',
        { class: 'guide', data: { guide: '' } },
        h('h2', { class: 'section-title' }, t('host.guide.title')),
        h(
          'ol',
          { class: 'guide__steps' },
          ...steps.map((s, i) => {
            // 警告のときは、①の丸を「!」にし、②③は「開き直したあと」の手順として淡くする。
            const alert = loopback && i === 0;
            const cls = loopback ? (alert ? 'guide__step guide__step--alert' : 'guide__step guide__step--later') : 'guide__step';
            return h('li', { class: cls }, h('span', { class: 'guide__num', attrs: { 'aria-hidden': 'true' } }, alert ? '!' : String(i + 1)), h('span', { class: 'guide__text' }, ...s));
          }),
        ),
      ),
    );
  }

  private renderJoin(d: HomeData, full: JoinState['full']): void {
    this.join.replaceChildren(joinPanel(d.code, d.origin, { locked: d.roster.locked, loopback: d.loopback, full }));
  }
}

/** 「{host}/pad で、このコードを入力」。URLの部分は途中で折り返さない。 */
function typeLine(host: string): Child[] {
  const text = t('host.join.type', { host: '\u0000' });
  const [before = '', after = ''] = text.split('\u0000/pad');
  return [...tx(before), h('span', { class: 'join__url mono' }, `${host}/pad`), ...tx(after)];
}

/** 「npm run dev が表示する「大画面で開くURL」で、開き直してください」。コマンドと「大画面で開くURL」は、途中で折らない。 */
function fixLine(): Child[] {
  const text = t('host.join.loopbackFix', { cmd: '\u0000', label: '\u0001' });
  const out: Child[] = [];
  let tail = '';
  for (const part of text.split(/(\u0000|\u0001)/u)) {
    if (part === '\u0000') out.push(h('span', { class: 'mono pp-nw' }, 'npm run dev'));
    else if (part === '\u0001') {
      // 直後の助詞と読点（「で、」）は、行の頭に来ないよう、同じ塊に入れる。
      const rest = text.slice(text.indexOf('\u0001') + 1).split('\u0000')[0] ?? '';
      tail = /^[^、。\s]{0,2}[、。]/u.exec(rest)?.[0] ?? '';
      out.push(h('span', { class: 'pp-nw' }, `${t('host.join.loopbackLabel')}${tail}`));
    } else if (part) out.push(...tx(tail && part.startsWith(tail) ? part.slice(tail.length) : part));
  }
  return out;
}

/**
 * 参加の板（QR・コード・入力の案内）。ホームの右と、メニューの「QRを表示」で同じものを使う。
 * 読んでも入れないとき（締め切り・満員・ほかの端末から開けないアドレス）は、QRを薄くして理由を重ね、「カメラでQRを読む」を出さない。
 * ほかの端末から開けないアドレスのときは、警告を板の全幅に出し、手入力の案内を「開き直す先」に差し替える。
 */
export function joinPanel(code: string | null, origin: string, s: JoinState): HTMLElement {
  const host = new URL(origin).host;
  const cls = ['join', s.locked ? 'join--locked' : '', s.full ? 'join--full' : '', s.loopback ? 'join--loopback' : ''].filter(Boolean).join(' ');
  const panel = h('div', { class: cls, data: { code: code ?? '', locked: String(s.locked), ...(s.full ? { full: '' } : {}) } });
  const title = s.loopback ? t('host.join.loopbackTitle') : s.full ? t('host.join.full', { n: s.full.n, max: s.full.max }) : t('host.join.title');
  const note = s.full || s.loopback ? null : h('p', { class: 'join__note' }, ...tx(t('host.join.note')));
  panel.append(h('div', { class: 'join__head' }, h('h2', { class: 'join__title' }, ...tx(title)), note));
  if (!code) {
    panel.append(h('div', { class: 'join__qr join__qr--empty', attrs: { 'aria-hidden': 'true' } }), h('p', { class: 'join__code join__code--empty' }, '····'));
    return panel;
  }
  const url = padUrl(origin, code);
  const qr = h('div', { class: 'join__qr', data: { url } }, qrSvg(url, { dark: '#1a1411', light: '#fbf4ea', label: t('host.join.qr', { url }) }));
  const over = s.locked
    ? h('div', { class: 'join__lock' }, icon('lock'), h('span', {}, ...tx(t('host.join.locked'))))
    : s.full
      ? h('div', { class: 'join__lock join__lock--full', data: { fullnote: '' } }, icon('people'), h('span', {}, ...tx(t('host.join.fullNote'))))
      : s.loopback
        ? h('div', { class: 'join__lock join__lock--alert' }, icon('alert'))
        : null;
  if (over) qr.append(h('div', { class: 'join__cover' }, over));
  const parts: HTMLElement[] = [h('div', { class: 'join__body' }, qr, over ? null : h('p', { class: 'join__scan' }, ...tx(t('host.join.scan'))))];
  if (s.loopback) parts.push(h('p', { class: 'join__warn', data: { loopback: '' }, attrs: { role: 'note' } }, icon('alert'), h('span', {}, ...tx(t('host.join.loopback')))));
  parts.push(
    h(
      'div',
      { class: 'join__codebox' },
      h('p', { class: 'join__label' }, t('host.join.code')),
      h('p', { class: 'join__code', attrs: { 'aria-label': [...code].join(' ') } }, code),
      s.loopback
        ? h('p', { class: 'join__type join__type--fix', data: { fix: '' } }, ...fixLine())
        : s.full
          ? h('p', { class: 'join__type' }, ...tx(t('host.join.fullType')))
          : h('p', { class: 'join__type' }, ...typeLine(host)),
    ),
  );
  panel.append(...parts);
  return panel;
}
