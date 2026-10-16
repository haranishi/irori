// ホストの画面の状態遷移（画面に依存しない純粋な関数）。
// boot → connecting → home ⇄ detail → launching → playing ⇄ paused → results → home。異常は offline・busy・closed・replaced。
// offline と replaced は「覆い」で、下の画面（ゲームを含む）は動かしたまま上に重ねる。戻ったら下の画面に戻る。
// busy と closed は部屋がない状態なので、下の画面を持たない。

export type Phase = 'boot' | 'connecting' | 'home' | 'detail' | 'launching' | 'playing' | 'paused' | 'results' | 'busy' | 'closed';
export type Cover = 'offline' | 'replaced';
/** launching の中の小さな状態。slow＝ready が来ない（待つ／ホームへ）、failed＝枠が止まった（ホームへ）。 */
export type Issue = 'none' | 'slow' | 'failed';
export type StateName = Phase | Cover;

export interface Machine {
  readonly phase: Phase;
  readonly issue: Issue;
  readonly cover: Cover | null;
}

export type Signal =
  | 'start'
  | 'welcome'
  | 'lost'
  | 'replaced'
  | 'busy'
  | 'closed'
  | 'retry'
  | 'open'
  | 'back'
  | 'launch'
  | 'slow'
  | 'patience'
  | 'failed'
  | 'ready'
  | 'pause'
  | 'continue'
  | 'end'
  | 'home';

export const INITIAL: Machine = { phase: 'boot', issue: 'none', cover: null };

const ROOMLESS: ReadonlySet<Phase> = new Set(['boot', 'busy', 'closed']);
const IN_GAME: ReadonlySet<Phase> = new Set(['launching', 'playing', 'paused']);

/** 画面の遷移（部屋の接続とは独立）。当てはまらない信号は null（無視）。 */
function step(phase: Phase, issue: Issue, s: Signal): { phase: Phase; issue: Issue } | null {
  switch (s) {
    case 'open':
      return phase === 'home' ? { phase: 'detail', issue: 'none' } : null;
    case 'back':
      return phase === 'detail' ? { phase: 'home', issue: 'none' } : null;
    case 'launch':
      return phase === 'detail' || phase === 'results' || (phase === 'launching' && issue === 'failed') ? { phase: 'launching', issue: 'none' } : null;
    case 'slow':
      return phase === 'launching' && issue === 'none' ? { phase, issue: 'slow' } : null;
    case 'patience':
      return phase === 'launching' && issue === 'slow' ? { phase, issue: 'none' } : null;
    case 'ready':
      return phase === 'launching' && issue !== 'failed' ? { phase: 'playing', issue: 'none' } : null;
    case 'failed':
      return IN_GAME.has(phase) ? { phase: 'launching', issue: 'failed' } : null;
    case 'pause':
      return phase === 'playing' ? { phase: 'paused', issue: 'none' } : null;
    case 'continue':
      return phase === 'paused' ? { phase: 'playing', issue: 'none' } : null;
    case 'end':
      return IN_GAME.has(phase) && issue !== 'failed' ? { phase: 'results', issue: 'none' } : null;
    case 'home':
      return phase === 'detail' || phase === 'launching' || phase === 'paused' || phase === 'results' ? { phase: 'home', issue: 'none' } : null;
    default:
      return null;
  }
}

export function next(m: Machine, s: Signal): Machine {
  switch (s) {
    case 'start':
      return m.phase === 'boot' ? { phase: 'connecting', issue: 'none', cover: null } : m;
    case 'welcome':
      if (m.phase === 'boot' || m.phase === 'connecting' || ROOMLESS.has(m.phase)) return { phase: 'home', issue: 'none', cover: null };
      return m.cover === null ? m : { ...m, cover: null };
    case 'lost':
      // 部屋のない状態では、切断を覆いにしない（つなぐ相手がまだない）。
      return ROOMLESS.has(m.phase) || m.cover === 'offline' ? m : { ...m, cover: 'offline' };
    case 'replaced':
      return ROOMLESS.has(m.phase) ? m : { ...m, cover: 'replaced' };
    case 'busy':
      return m.phase === 'connecting' || m.phase === 'closed' ? { phase: 'busy', issue: 'none', cover: null } : m;
    case 'closed':
      return m.phase === 'boot' ? m : { phase: 'closed', issue: 'none', cover: null };
    case 'retry':
      return m.phase === 'busy' || m.phase === 'closed' ? { phase: 'connecting', issue: 'none', cover: null } : m;
    default: {
      // 覆いの下でも、ゲームの進行（end など）は下の画面に反映する。
      const r = step(m.phase, m.issue, s);
      return r === null ? m : { phase: r.phase, issue: r.issue, cover: m.cover };
    }
  }
}

/** 画面の data-state に出す名前。覆いがあれば覆いの名前。 */
export function stateName(m: Machine): StateName {
  return m.cover ?? m.phase;
}

/** ゲームの枠を持っている状態か（覆いの下を含む）。 */
export function inGame(m: Machine): boolean {
  return IN_GAME.has(m.phase);
}

/**
 * スマホへ出す画面の担い手。console＝コンソール（リーダーにリモコン、ほかは待機）、game＝ゲームの指定、none＝送らない。
 * 始めるのに失敗した・応答がないときは、ホームへ戻る操作が要るので、コンソールがリモコンを出す。
 */
export function padOwner(m: Machine): 'console' | 'game' | 'none' {
  switch (m.phase) {
    case 'home':
    case 'detail':
    case 'results':
    case 'paused':
      return 'console';
    case 'launching':
      return m.issue === 'none' ? 'game' : 'console';
    case 'playing':
      return 'game';
    default:
      return 'none';
  }
}
