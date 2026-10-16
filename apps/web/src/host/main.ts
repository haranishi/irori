// ホストの画面（/）の入口。大画面のブラウザで開き、部屋を作って、棚・QR・参加者を出す。
import '../styles/host.css';
import { h } from '../shared/dom';
import { getLocale, t } from '../shared/i18n';
import { Console } from './console';
import { registerHostMessages } from './messages';

registerHostMessages();

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const root = document.getElementById('app');
if (root) {
  document.documentElement.lang = getLocale();
  if (typeof WebSocket === 'undefined' || typeof MessageChannel === 'undefined') {
    // TVの内蔵ブラウザなど、動かない環境では案内だけを出す（正式に対応するのはPCのブラウザ）。
    root.replaceChildren(h('main', { class: 'screen status' }, h('div', { class: 'status__card' }, h('p', { class: 'status__body' }, t('host.unsupported')))));
  } else {
    new Console({
      root,
      win: window,
      doc: document,
      fetch: (input, init) => window.fetch(input, init),
      session: session(),
      local: local(),
      origin: location.origin,
    }).start();
  }
}
