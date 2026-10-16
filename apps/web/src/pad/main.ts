// スマホの画面（/pad）の入口。見た目は tokens.css（色の正本）→ pad-ui の部品 → この画面の順に重ねる。
import '../styles/tokens.css';
import '@irori/pad-ui/pad.css';
import '../styles/pad.css';
import { PadApp, browserDeps } from './app';
import { registerPadMessages } from './messages';

registerPadMessages();
const root = document.getElementById('app');
if (root) new PadApp(root, browserDeps()).start();
