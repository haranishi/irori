// スマホの画面（/pad）の文言。キーは pad.* に限る（ホストは host.*）。部品（pad-ui）の文言も pad.ui.* として t() を通す。
import { PAD_STRINGS_EN, PAD_STRINGS_JA, type PadStrings } from '@irori/pad-ui';
import { addMessages, t } from '../shared/i18n';
import { softBreaks } from './phrase';

const JA: Record<string, string> = {
  'pad.title': 'irori コントローラー',
  'pad.brand': 'irori',

  'pad.entry.title': '部屋のコードを入れてください',
  'pad.entry.lead': '大きな画面の右下に出ている4文字です。',
  'pad.entry.group': '部屋のコード（4文字）',
  'pad.entry.box': '{n}文字目',
  'pad.entry.submit': '部屋をさがす',
  'pad.entry.badChar': '使えるのは、2〜9の数字と、母音を除く英字です。',
  'pad.entry.badCode': 'コードの形が違います。4文字を入れ直してください。',
  'pad.entry.noRoom': '部屋「{code}」が見つかりません。コードを確かめてください。',
  'pad.checking': '部屋を確かめています…',

  'pad.join.title': 'ゲームに参加する',
  'pad.join.room': '部屋',
  'pad.join.change': 'コードを変える',
  'pad.join.nameLabel': '名前（なくても入れます）',
  'pad.join.privacy': 'ニックネームで大丈夫です。本名や連絡先は入れないでください。',
  'pad.join.empty': '空のままなら「プレイヤー3」のように呼ばれます。',
  'pad.join.named': '大きな画面には、この名前で出ます。',
  'pad.join.submit': '参加する',

  'pad.connecting.title': 'つないでいます…',
  'pad.connecting.slow': 'つながるまで時間がかかっています。通信の状態を確かめてください。',
  'pad.connecting.retry': 'もう一度試す',
  'pad.connecting.cancel': 'やめる',

  'pad.banner.title': 'つながりが切れました',
  'pad.banner.body': 'つなぎ直しています…',
  'pad.banner.note': 'つながったら、そのまま続けられます。',
  'pad.banner.now': '今すぐつなぎ直す',
  'pad.host.title': '大きな画面を待っています',
  'pad.host.body': '大きな画面がつながると、続きから遊べます。',
  'pad.host.note': '退出は、右上の「…」からできます。',

  'pad.joined.title': '参加しました',
  'pad.joined.body': '大きな画面でゲームが選ばれるのを待っています。',
  'pad.seat.aria': 'あなたは{look}の{name}です。',
  'pad.seat.hint': 'メニューは、右上の「…」から開けます。',
  'pad.wait.you': 'あなたの印',
  'pad.seat.changed': '新しい席で入り直しました。',
  'pad.tilt.locked': 'センサーを許可すると使えます。',

  'pad.menu.title': 'メニュー',
  'pad.menu.you': '{look}の席',
  'pad.menu.pause': '一時停止を頼む',
  'pad.menu.pauseNote': '大きな画面にメニューが出ます。',
  'pad.menu.leave': '退出する',
  'pad.menu.leaveNote': '席を空けて部屋を出ます。取り消せません。',
  'pad.menu.open': 'メニューを開く',
  'pad.menu.close': '閉じる',
  'pad.menu.licenses': 'ライセンスとクレジット',
  'pad.menu.sent': '大きな画面にメニューを出しました。',
  'pad.menu.offline': 'つながってから、もう一度押してください。',

  'pad.orient.landscape': '横向きがおすすめです',
  'pad.orient.portrait': '縦向きがおすすめです',
  'pad.orient.bodyLandscape': 'スマホを横にすると、このゲームは遊びやすくなります。',
  'pad.orient.bodyPortrait': 'スマホを縦にすると、このゲームは遊びやすくなります。',
  'pad.orient.keep': 'このまま使う',

  'pad.kicked.title': '部屋から外されました',
  'pad.kicked.body': '大きな画面の人に声をかけてから、コードを入れ直してください。',
  'pad.closed.title': '部屋が閉じられました',
  'pad.closed.body': '新しい部屋のコードを入れると、また遊べます。',
  'pad.left.title': '退出しました',
  'pad.left.body': '同じ部屋にも、別の部屋にも入れます。',
  'pad.left.rejoin': '同じ部屋にもう一度入る',
  'pad.left.reenter': '別の部屋のコードを入れる',
  'pad.full.title': '満員です',
  'pad.full.body': 'この部屋は{max}人までです。席が空いたら、もう一度試してください。',
  'pad.locked.title': '締め切られています',
  'pad.locked.body': '大きな画面の人が、新しい参加を止めています。入りたいときは、声をかけてください。',
  'pad.network.title': 'つながりません',
  'pad.network.body': '通信の状態を確かめて、もう一度試してください。',
  'pad.rate.title': '少し待ってください',
  'pad.rate.body': '短い間に何度も試したため、少し止めています。',
  'pad.busy.title': '混み合っています',
  'pad.busy.body': 'いま混み合っているため、少し止めています。',
  'pad.version.title': '新しい版があります',
  'pad.version.body': 'ページを読み込み直してください。',
  'pad.replaced.title': 'ほかのスマホやタブで開かれました',
  'pad.replaced.body': 'ここで続けると、向こうは止まります。',

  'pad.act.reenter': 'コードを入れ直す',
  'pad.act.retry': 'もう一度試す',
  'pad.act.retryIn': 'もう一度試す（あと{sec}秒）',
  'pad.act.reload': '読み込み直す',
  'pad.act.continue': 'ここで続ける',
};

const EN: Record<string, string> = {
  'pad.title': 'irori controller',
  'pad.brand': 'irori',

  'pad.entry.title': 'Enter the room code',
  'pad.entry.lead': 'The 4 characters at the bottom right of the big screen.',
  'pad.entry.group': 'Room code (4 characters)',
  'pad.entry.box': 'Character {n}',
  'pad.entry.submit': 'Find the room',
  'pad.entry.badChar': 'Use the digits 2–9 and letters other than vowels.',
  'pad.entry.badCode': 'That code does not look right. Enter the 4 characters again.',
  'pad.entry.noRoom': 'Room “{code}” was not found. Check the code.',
  'pad.checking': 'Checking the room…',

  'pad.join.title': 'Join the game',
  'pad.join.room': 'Room',
  'pad.join.change': 'Change code',
  'pad.join.nameLabel': 'Name (optional)',
  'pad.join.privacy': "A nickname is fine. Please don't enter your real name or contact details.",
  'pad.join.empty': 'If left empty, you will be called something like “Player 3”.',
  'pad.join.named': 'This name is shown on the big screen.',
  'pad.join.submit': 'Join',

  'pad.connecting.title': 'Connecting…',
  'pad.connecting.slow': 'This is taking a while. Please check your connection.',
  'pad.connecting.retry': 'Try again',
  'pad.connecting.cancel': 'Cancel',

  'pad.banner.title': 'Connection lost',
  'pad.banner.body': 'Reconnecting…',
  'pad.banner.note': 'You can keep playing once it reconnects.',
  'pad.banner.now': 'Reconnect now',
  'pad.host.title': 'Waiting for the big screen',
  'pad.host.body': 'When the big screen is back, you can keep playing.',
  'pad.host.note': 'To leave, use “…” at the top right.',

  'pad.joined.title': "You're in",
  'pad.joined.body': 'Waiting for a game to be picked on the big screen.',
  'pad.seat.aria': 'You are the {look}, {name}.',
  'pad.seat.hint': 'Open the menu from “…” at the top right.',
  'pad.wait.you': 'Your mark',
  'pad.seat.changed': 'You rejoined with a new seat.',
  'pad.tilt.locked': 'Available after you allow the sensor.',

  'pad.menu.title': 'Menu',
  'pad.menu.you': '{look} seat',
  'pad.menu.pause': 'Ask to pause',
  'pad.menu.pauseNote': 'Shows the menu on the big screen.',
  'pad.menu.leave': 'Leave',
  'pad.menu.leaveNote': 'Free your seat and leave. This cannot be undone.',
  'pad.menu.open': 'Open menu',
  'pad.menu.close': 'Close',
  'pad.menu.licenses': 'Licenses and credits',
  'pad.menu.sent': 'The menu is open on the big screen.',
  'pad.menu.offline': 'Try again once you are connected.',

  'pad.orient.landscape': 'Landscape works best',
  'pad.orient.portrait': 'Portrait works best',
  'pad.orient.bodyLandscape': 'This game is easier to play in landscape.',
  'pad.orient.bodyPortrait': 'This game is easier to play in portrait.',
  'pad.orient.keep': 'Keep it this way',

  'pad.kicked.title': 'You were removed from the room',
  'pad.kicked.body': 'Talk to the person at the big screen, then enter the code again.',
  'pad.closed.title': 'The room was closed',
  'pad.closed.body': 'Enter a new room code to play again.',
  'pad.left.title': 'You left the room',
  'pad.left.body': 'You can join the same room or a different one.',
  'pad.left.rejoin': 'Rejoin the same room',
  'pad.left.reenter': 'Enter a different room code',
  'pad.full.title': 'The room is full',
  'pad.full.body': 'This room holds up to {max} players. Try again when a seat opens.',
  'pad.locked.title': 'The room is locked',
  'pad.locked.body': 'New players are paused at the big screen. Ask them to let you in.',
  'pad.network.title': 'Cannot connect',
  'pad.network.body': 'Check your connection and try again.',
  'pad.rate.title': 'Please wait a moment',
  'pad.rate.body': 'Too many tries in a short time, so joining is paused for a moment.',
  'pad.busy.title': 'The service is busy',
  'pad.busy.body': 'It is busy right now, so joining is paused for a moment.',
  'pad.version.title': 'A new version is available',
  'pad.version.body': 'Please reload the page.',
  'pad.replaced.title': 'Opened on another phone or tab',
  'pad.replaced.body': 'If you continue here, the other one stops.',

  'pad.act.reenter': 'Enter another code',
  'pad.act.retry': 'Try again',
  'pad.act.retryIn': 'Try again in {sec}s',
  'pad.act.reload': 'Reload',
  'pad.act.continue': 'Continue here',
};

const UI_KEYS = Object.keys(PAD_STRINGS_JA) as (keyof PadStrings)[];

function prefixed(strings: PadStrings): Record<string, string> {
  return Object.fromEntries(UI_KEYS.map((k) => [`pad.ui.${k}`, strings[k]]));
}

let registered = false;

export function registerPadMessages(): void {
  if (registered) return;
  registered = true;
  addMessages('ja', { ...prefixed(PAD_STRINGS_JA), ...JA });
  addMessages('en', { ...prefixed(PAD_STRINGS_EN), ...EN });
}

/** 部品に渡す文言。いまの言語で t() から組む。部品は HTML を組めないので、語の切れ目に幅のない空白を入れて渡す。 */
export function padUiStrings(): PadStrings {
  return Object.fromEntries(UI_KEYS.map((k) => [k, softBreaks(t(`pad.ui.${k}`))])) as unknown as PadStrings;
}
