// ホームの上に重ねる板（詳細・外部の確かめ・共有・外す・メニュー・覆い）と、結果・起動中・部屋のない画面。
// 文言は文節のあいだでだけ折り返す（tx）。スマホやゲームから来た文字列は textContent で入れる（nameEl・withName）。
import type { PlayerId, PlayerInfo } from '@irori/protocol';
import { h, type Child } from '../shared/dom';
import { getLocale, t } from '../shared/i18n';
import type { GameEntry } from './catalog';
import { icon, logoMark } from './icons';
import type { Issue } from './machine';
import type { ResultRow } from './results';
import type { Fit } from './roster';
import type { ShareLinks } from './share';
import { button, dialog, link, nameEl, seatMark, sentences, tx, withName } from './ui';
import { externalNote, fitText, gameMeta, joinPanel, padChips, playersText, thumb, type JoinState, type SoundState } from './view-home';

/** 「やり方を見る」の行き先（自分のパソコンやLANで動かす手順がある README）。 */
export const HOWTO_URL = { ja: 'https://github.com/haranishi/irori/blob/main/README.ja.md', en: 'https://github.com/haranishi/irori#readme' } as const;

export function detailLayer(g: GameEntry, f: Fit, on: { start(): void; back(): void }): HTMLElement {
  const reason = fitText(f);
  const reasonId = 'detail-reason';
  return dialog(
    'detail',
    g.title,
    [
      h(
        'div',
        { class: 'detail', data: { game: g.id, playable: String(f.ok) } },
        thumb(g, 'detail__thumb'),
        h(
          'div',
          { class: 'detail__info' },
          h('p', { class: 'detail__summary' }, ...sentences(g.summary)),
          h('div', { class: 'hero__chips' }, h('span', { class: 'players-chip' }, icon('people'), h('span', {}, playersText(g))), padChips(g)),
          externalNote(g),
          reason ? h('p', { class: 'fit fit--no', attrs: { id: reasonId } }, icon('info'), h('span', {}, ...tx(reason))) : null,
          h(
            'div',
            { class: 'detail__controls' },
            h('p', { class: 'detail__controls-title' }, t('host.detail.controls')),
            h('p', {}, ...tx(t('host.detail.keyStart'))),
            h('p', {}, ...tx(t('host.detail.keyBack'))),
            // ゲームの最中は画面に案内を重ねないので、メニューの開き方は、ここ（と開始前の覆い）で伝える。
            h('p', { data: { hint: 'menu' } }, ...tx(t('host.play.menuHint'))),
          ),
          // 作者・ライセンス・素材は、遊ぶ人には硬い情報なので、いちばん下に小さく。
          gameMeta(g),
        ),
      ),
      h(
        'div',
        { class: 'dialog__actions' },
        button(t('host.detail.start'), { nav: 'detail:start', action: 'start', kind: 'primary', disabled: !f.ok, onPress: () => on.start(), ...(reason ? { describedBy: reasonId } : {}) }),
        button(t('host.detail.back'), { nav: 'detail:back', action: 'back', onPress: () => on.back() }),
      ),
    ],
    'dialog--wide',
  );
}

export function confirmLayer(host: string, on: { ok(): void; cancel(): void }): HTMLElement {
  return dialog(
    'confirm',
    t('host.confirm.title', { host }),
    [
      h('p', { class: 'dialog__body' }, ...sentences(t('host.confirm.body'))),
      h('p', { class: 'note note--external' }, icon('external'), h('span', { class: 'mono' }, host)),
      h(
        'div',
        { class: 'dialog__actions' },
        button(t('host.confirm.ok'), { nav: 'confirm:ok', action: 'confirm', kind: 'primary', onPress: () => on.ok() }),
        button(t('host.confirm.cancel'), { nav: 'confirm:cancel', action: 'cancel', onPress: () => on.cancel() }),
      ),
    ],
    'dialog--narrow',
  );
}

export function shareLayer(links: ShareLinks, native: boolean, on: { native(): void; copy(): void; close(): void }): HTMLElement {
  const items: HTMLElement[] = [];
  if (native) items.push(button(t('host.share.native'), { nav: 'share:native', action: 'native', iconName: 'device', onPress: () => on.native(), extraClass: 'share__btn' }));
  items.push(
    shareLink(t('host.share.x'), links.x, 'share:x', 'post'),
    shareLink(t('host.share.line'), links.line, 'share:line', 'chat'),
    button(t('host.share.copy'), { nav: 'share:copy', action: 'copy', iconName: 'copy', onPress: () => on.copy(), extraClass: 'share__btn' }),
  );
  return dialog('share', t('host.share.title'), [
    h('p', { class: 'dialog__body' }, ...sentences(t('host.share.body'))),
    h('p', { class: 'share__url mono', data: { url: links.url } }, links.url),
    h('div', { class: 'share__grid', data: { count: String(items.length) } }, ...items),
    h('p', { class: 'note' }, icon('info'), h('span', {}, ...sentences(t('host.share.note')))),
    h('div', { class: 'dialog__actions' }, button(t('host.share.close'), { nav: 'share:close', action: 'close', onPress: () => on.close() })),
  ]);
}

function shareLink(label: string, href: string, nav: string, iconName: 'post' | 'chat'): HTMLAnchorElement {
  const a = link(label, href, nav, 'btn btn--quiet share__btn');
  a.dataset.share = nav.slice('share:'.length);
  a.prepend(icon(iconName));
  return a;
}

/** 外す前の確かめ。取り消せない操作なので、塗りの主ボタンは「やめる」（ほかの窓と同じく左）、「外す」は輪郭だけにする。 */
export function kickLayer(p: PlayerInfo, on: { ok(): void; cancel(): void }): HTMLElement {
  return dialog(
    'kick',
    withName('host.kick.confirm', p.name),
    [
      h('p', { class: 'kick__who' }, seatMark(p.id, 32), nameEl(p.name, 'kick__name')),
      h('p', { class: 'dialog__body' }, ...sentences(t('host.kick.body'))),
      h(
        'div',
        { class: 'dialog__actions' },
        button(t('host.kick.cancel'), { nav: 'kick:cancel', action: 'cancel', kind: 'primary', onPress: () => on.cancel() }),
        button(t('host.kick.ok'), { nav: 'kick:ok', action: 'kick', kind: 'quiet', iconName: 'door', onPress: () => on.ok() }),
      ),
    ],
    'dialog--narrow',
  );
}

export type MenuView = 'main' | 'qr' | 'kick';

export interface MenuData {
  view: MenuView;
  game: GameEntry | null;
  sound: SoundState;
  locked: boolean;
  players: readonly PlayerInfo[];
  code: string | null;
  origin: string;
  loopback: boolean;
  full: JoinState['full'];
}

export interface MenuHandlers {
  resume(): void;
  home(): void;
  sound(): void;
  lock(): void;
  view(v: MenuView): void;
  kick(p: PlayerId): void;
}

export function menuLayer(d: MenuData, on: MenuHandlers): HTMLElement {
  const back = button(t('host.menu.back'), { nav: 'menu:back', action: 'back', iconName: 'arrow', onPress: () => on.view('main'), extraClass: 'btn--back' });
  if (d.view === 'qr') {
    return dialog(
      'menu',
      t('host.menu.qr'),
      [joinPanel(d.code, d.origin, { locked: d.locked, loopback: d.loopback, full: d.full }), h('p', { class: 'dialog__body' }, ...tx(t('host.menu.qrNote'))), h('div', { class: 'dialog__actions' }, back)],
      'dialog--menu',
    );
  }
  if (d.view === 'kick') {
    const list = h('div', { class: 'menu__list' });
    for (const p of d.players) {
      list.append(button(h('span', { class: 'menu__seat' }, seatMark(p.id, 28), nameEl(p.name, 'seat__name')), { nav: `menu:kick:${p.id}`, action: 'kick-seat', onPress: () => on.kick(p.id) }));
    }
    if (d.players.length === 0) list.append(h('p', { class: 'dialog__body' }, ...tx(t('host.kick.empty'))));
    return dialog('menu', t('host.kick.title'), [list, h('div', { class: 'dialog__actions' }, back)], 'dialog--menu');
  }
  // 項目はすべて絵を持ち、書き出しをそろえる。文言と絵は押したときの結果（「音を消す」「参加を締め切る」）。
  // よく使う「続ける」「ホームへ」を上の2つにし、区切り線のあとに設定を並べる（上下の移動は一周する。console.ts の wrap）。
  return dialog(
    'menu',
    t('host.menu.title'),
    [
      d.game ? h('p', { class: 'menu__game' }, d.game.title) : null,
      h(
        'div',
        { class: 'menu__list' },
        button(t('host.menu.continue'), { nav: 'menu:continue', action: 'continue', kind: 'primary', iconName: 'arrow', onPress: () => on.resume() }),
        button(t('host.home'), { nav: 'menu:home', action: 'home', iconName: 'home', onPress: () => on.home() }),
        h('hr', { class: 'menu__rule' }),
        button(d.sound === 'off' ? t('host.menu.soundOn') : t('host.menu.soundOff'), { nav: 'menu:sound', action: 'sound', iconName: d.sound === 'off' ? 'soundOn' : 'soundOff', onPress: () => on.sound() }),
        button(d.locked ? t('host.tool.lockOn') : t('host.tool.lockOff'), { nav: 'menu:lock', action: 'lock', iconName: d.locked ? 'unlock' : 'lock', onPress: () => on.lock() }),
        button(t('host.menu.qr'), { nav: 'menu:qr', action: 'qr', iconName: 'qr', onPress: () => on.view('qr') }),
        button(t('host.menu.kick'), { nav: 'menu:kick', action: 'kick', iconName: 'door', onPress: () => on.view('kick') }),
      ),
      h('p', { class: 'menu__hint' }, ...tx(t('host.menu.closeHint'))),
    ],
    'dialog--menu',
  );
}

export type CoverKind = 'offline' | 'replaced' | 'version';

/** 部屋とのつながりの覆い。部屋のない画面（statusScreen）と同じ組み方（中央揃え・ロゴつき）にする。 */
export function coverLayer(kind: CoverKind, on: { act(): void }, busy = false): HTMLElement {
  const label =
    kind === 'offline' ? t('host.error.offline.retry') : kind === 'replaced' ? (busy ? t('host.error.replaced.joining') : t('host.error.replaced.resume')) : t('host.error.version.reload');
  return dialog(
    'cover',
    t(`host.error.${kind}.title`),
    [
      h('p', { class: 'dialog__body' }, ...sentences(t(`host.error.${kind}.body`))),
      h('div', { class: 'dialog__actions' }, button(label, { nav: `cover:${kind}`, action: kind, kind: 'primary', disabled: busy, onPress: () => on.act() })),
    ],
    `dialog--cover dialog--${kind}`,
    h('div', { class: 'status__brand' }, logoMark(), h('span', { class: 'brand__name' }, 'irori')),
  );
}

export interface BusyView {
  reason: 'daily' | 'rate';
  /** 自動でもう一度試すまでの目安（「約5分」など）。 */
  eta: string;
}

/** 部屋のない画面（用意中・混雑・閉じた）。 */
export function statusScreen(kind: 'connecting' | 'busy' | 'closed', d: { slow?: boolean; busy?: BusyView }, on: { now(): void; fresh(): void }): HTMLElement {
  const body: Child[] = [];
  if (kind === 'connecting') {
    body.push(h('p', { class: 'status__title', attrs: { role: 'status' } }, t('host.connecting')), h('div', { class: 'ember-bar', attrs: { 'aria-hidden': 'true' } }));
    if (d.slow) body.push(h('p', { class: 'status__body' }, ...sentences(t('host.connecting.slow'))));
  } else if (kind === 'busy' && d.busy) {
    const b = d.busy;
    const howto = link(t('host.error.busy.howto'), getLocale() === 'en' ? HOWTO_URL.en : HOWTO_URL.ja, 'busy:howto', 'link status__link');
    body.push(
      h('h2', { class: 'status__title' }, ...tx(t('host.error.busy.title'))),
      // 理由と、いつ自動で試すかを、1文でつなぐ。
      h('p', { class: 'status__body status__wait', attrs: { role: 'status' } }, ...tx(t(b.reason === 'daily' ? 'host.error.busy.daily' : 'host.error.busy.rate', { eta: b.eta }))),
      h('div', { class: 'dialog__actions' }, button(t('host.error.busy.now'), { nav: 'busy:now', action: 'now', kind: 'primary', onPress: () => on.now() })),
      h('p', { class: 'status__hint' }, ...tx(t('host.error.busy.lan')), ' ', howto),
    );
  } else {
    body.push(
      h('h2', { class: 'status__title' }, ...tx(t('host.error.closed.title'))),
      h('p', { class: 'status__body' }, ...sentences(t('host.error.closed.body'))),
      h('div', { class: 'dialog__actions' }, button(t('host.error.closed.new'), { nav: 'closed:new', action: 'new', kind: 'primary', onPress: () => on.fresh() })),
    );
  }
  return h('main', { class: `screen status status--${kind}` }, h('div', { class: 'status__card' }, h('div', { class: 'status__brand' }, logoMark(), h('span', { class: 'brand__name' }, 'irori')), ...body));
}

/** 起動中の画面。ゲームの枠の上に重ね、ready で消す。応答がない・始められないときは、次の行動を出す。 */
export function launchOverlay(
  g: GameEntry,
  issue: Issue,
  on: { wait(): void; home(): void; retry(): void; hints?: { menu: string; sound: string | null } },
): HTMLElement {
  const body: Child[] = [thumb(g, 'launch__thumb'), h('h2', { class: 'launch__title' }, ...tx(g.title))];
  if (issue === 'none') {
    body.push(h('p', { class: 'launch__msg', attrs: { role: 'status' } }, t('host.launch.loading')), h('div', { class: 'ember-bar', attrs: { 'aria-hidden': 'true' } }));
    // ゲームが始まったら画面に何も重ねないので、メニューの開き方と音の案内は、始まる前のこの覆いに出す。
    const hints = on.hints;
    if (hints) {
      body.push(
        h(
          'div',
          { class: 'launch__hints' },
          h('p', { class: 'launch__hint', data: { hint: 'menu' } }, ...tx(hints.menu)),
          hints.sound ? h('p', { class: 'launch__hint', data: { hint: 'sound' } }, icon('soundOn'), h('span', {}, ...tx(hints.sound))) : null,
        ),
      );
    }
  } else if (issue === 'slow') {
    body.push(
      h('p', { class: 'launch__msg', attrs: { role: 'alert' } }, t('host.launch.slow')),
      h('p', { class: 'status__body' }, ...sentences(t('host.launch.slowBody'))),
      h(
        'div',
        { class: 'dialog__actions' },
        button(t('host.launch.wait'), { nav: 'launch:wait', action: 'wait', kind: 'primary', onPress: () => on.wait() }),
        button(t('host.home'), { nav: 'launch:home', action: 'home', onPress: () => on.home() }),
      ),
    );
  } else {
    body.push(
      h('p', { class: 'launch__msg', attrs: { role: 'alert' } }, t('host.launch.failed')),
      h('p', { class: 'status__body' }, ...tx(t('host.launch.failedBody'))),
      h(
        'div',
        { class: 'dialog__actions' },
        button(t('host.home'), { nav: 'launch:home', action: 'home', kind: 'primary', onPress: () => on.home() }),
        button(t('host.launch.retry'), { nav: 'launch:retry', action: 'retry', onPress: () => on.retry() }),
      ),
    );
  }
  return h('div', { class: `launch launch--${issue}`, data: { issue } }, h('div', { class: 'launch__card' }, ...body));
}

export function resultsScreen(g: GameEntry | null, rows: readonly ResultRow[], on: { again(): void; home(): void; share(): void }): HTMLElement {
  const list = h('ol', { class: 'results__list' });
  for (const r of rows) {
    list.append(
      h(
        'li',
        { class: `result${r.rank === 1 ? ' result--top' : ''}`, data: { seat: String(r.p), rank: String(r.rank) } },
        h('span', { class: 'result__rank' }, t('host.results.rank', { n: r.rank })),
        seatMark(r.p, 36),
        h('span', { class: 'result__who' }, nameEl(r.name, 'result__name'), r.gone ? h('span', { class: 'result__gone' }, t('host.results.left')) : null),
        // ラベルはゲームが付ける記録（「3.2秒」など）。何の値かが分かるよう、見出しを添える。
        r.label !== undefined ? h('span', { class: 'result__label' }, h('span', { class: 'result__caption' }, t('host.results.record')), nameEl(r.label, 'result__value')) : h('span', { class: 'result__label' }),
        h('span', { class: 'result__score' }, t('host.results.points', { n: r.score.toLocaleString() })),
      ),
    );
  }
  // 5人以上は、行を詰めて見出しを小さくし、1280×720 でもボタンまで画面に収める（host.css の .results--dense）。
  return h(
    'main',
    { class: `screen results${rows.length >= 5 ? ' results--dense' : ''}` },
    h(
      'div',
      { class: 'results__card' },
      h('header', { class: 'results__head' }, h('h1', { class: 'results__title' }, t('host.results.title')), g ? h('p', { class: 'results__game' }, g.title) : null),
      rows.length > 0 ? list : h('p', { class: 'results__none' }, t('host.results.none')),
      h(
        'div',
        { class: 'dialog__actions results__actions' },
        button(t('host.results.again'), { nav: 'results:again', action: 'again', kind: 'primary', onPress: () => on.again() }),
        button(t('host.home'), { nav: 'results:home', action: 'home', onPress: () => on.home() }),
        button(t('host.results.share'), { nav: 'results:share', action: 'share', iconName: 'share', onPress: () => on.share() }),
      ),
    ),
  );
}
