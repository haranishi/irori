// 席ごとに、いまスマホへ出すべき画面を決める（画面に依存しない純粋な関数）。
// ホーム・詳細・結果では、リーダーにリモコン、ほかの席に「{名前}が選んでいます」。一時停止のメニューのあいだは、
// リーダーのリモコンの案内も、ほかの席の待機も「メニューを操作中です」（ゲームを選んでいるのではないため）。
// ゲーム中は、始めたときの参加者にゲームの指定を、途中から来た人に「次のゲームから参加できます」を出す（docs/ux.md の8）。
import { validatePadSpec, type GamePadSpec, type PadSpec, type PlayerId, type PlayerInfo } from '@irori/protocol';

export interface PadTexts {
  remoteHint: string;
  choosing: (name: string) => string;
  choosingBody: string;
  lateTitle: string;
  lateBody: string;
  starting: string;
  waiting: string;
  /** 一時停止のメニューを開いているあいだの文。 */
  menu: string;
}

export interface PadPlanInput {
  owner: 'console' | 'game' | 'none';
  players: readonly PlayerInfo[];
  leader: PlayerId | null;
  /** ゲームを始めたときの席。ゲームの外では null。 */
  participants: ReadonlySet<PlayerId> | null;
  /** ゲームが席ごとに最後に指定した画面。 */
  gameSpecs: ReadonlyMap<PlayerId, GamePadSpec>;
  /** 一時停止のメニューを開いている。 */
  paused?: boolean;
  text: PadTexts;
}

/** 中継と同じ検査を通らないもの（長すぎる名前を入れた文言など）は、文字のない待機にする。 */
function safe(spec: PadSpec): PadSpec {
  return validatePadSpec(spec, true).ok ? spec : { k: 'wait' };
}

export function planPads(input: PadPlanInput): Map<PlayerId, PadSpec> {
  const out = new Map<PlayerId, PadSpec>();
  if (input.owner === 'none') return out;
  const t = input.text;
  if (input.owner === 'console') {
    const leaderName = input.players.find((p) => p.id === input.leader)?.name;
    if (input.paused) {
      for (const p of input.players) {
        out.set(p.id, safe(p.id === input.leader ? { k: 'remote', hint: t.menu } : { k: 'wait', title: t.menu, body: t.choosingBody }));
      }
      return out;
    }
    for (const p of input.players) {
      if (p.id === input.leader) out.set(p.id, safe({ k: 'remote', hint: t.remoteHint }));
      else if (leaderName !== undefined) out.set(p.id, safe({ k: 'wait', title: t.choosing(leaderName), body: t.choosingBody }));
      else out.set(p.id, { k: 'wait', title: t.waiting });
    }
    return out;
  }
  for (const p of input.players) {
    if (input.participants?.has(p.id)) out.set(p.id, input.gameSpecs.get(p.id) ?? { k: 'wait', title: t.starting });
    else out.set(p.id, safe({ k: 'wait', title: t.lateTitle, body: t.lateBody }));
  }
  return out;
}

/** ゲームの宛先（席か '*'）を、参加者の席の一覧に広げる。'*' を中継へそのまま送ると、途中から来た人にも届くため。 */
export function expandTarget(to: PlayerId | '*', participants: ReadonlySet<PlayerId>): PlayerId[] {
  if (to === '*') return [...participants].sort((a, b) => a - b);
  return participants.has(to) ? [to] : [];
}
