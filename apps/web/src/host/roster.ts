// 参加者の一覧とリーダー（画面に依存しない純粋な関数）。中継から届いた welcome・joined・left・online を当てる。
// リーダーは最初に入った席。離れたら（切れた・抜けた）、接続中の最小の席へ移る（docs/ux.md の4）。
import { LIMITS, type PlayerId, type PlayerInfo, type ToHostFrame } from '@irori/protocol';

export interface Roster {
  readonly players: readonly PlayerInfo[];
  readonly leader: PlayerId | null;
  readonly max: number;
  readonly locked: boolean;
}

export const EMPTY_ROSTER: Roster = { players: [], leader: null, max: LIMITS.MAX_PLAYERS, locked: false };

const byId = (a: PlayerInfo, b: PlayerInfo) => a.id - b.id;

/**
 * 次のリーダー。いまのリーダーがつながっていれば、そのまま。つながっていなければ、接続中の最小の席へ移す。
 * 誰もつながっていないときは、席が残っていればいまのリーダーのまま（戻ってきたら続けられる）。
 */
export function nextLeader(players: readonly PlayerInfo[], current: PlayerId | null): PlayerId | null {
  const keep = current === null ? undefined : players.find((p) => p.id === current);
  if (keep?.online) return keep.id;
  let heir: PlayerInfo | undefined;
  for (const p of players) if (p.online && (!heir || p.id < heir.id)) heir = p;
  if (heir) return heir.id;
  if (keep) return keep.id;
  return [...players].sort(byId)[0]?.id ?? null;
}

export function applyFrame(r: Roster, f: ToHostFrame): Roster {
  switch (f.t) {
    case 'welcome': {
      const players = [...f.players].sort(byId);
      return { players, leader: nextLeader(players, r.leader), max: f.max, locked: f.locked };
    }
    case 'joined': {
      const players = [...r.players.filter((p) => p.id !== f.p.id), f.p].sort(byId);
      return { ...r, players, leader: nextLeader(players, r.leader) };
    }
    case 'left': {
      const players = r.players.filter((p) => p.id !== f.p);
      return { ...r, players, leader: nextLeader(players, r.leader) };
    }
    case 'online': {
      const players = r.players.map((p) => (p.id === f.p ? { ...p, online: f.on } : p));
      return { ...r, players, leader: nextLeader(players, r.leader) };
    }
    default:
      return r;
  }
}

export function withLocked(r: Roster, locked: boolean): Roster {
  return r.locked === locked ? r : { ...r, locked };
}

export function nameOf(r: Roster, id: PlayerId | null): string | null {
  if (id === null) return null;
  return r.players.find((p) => p.id === id)?.name ?? null;
}

/** いまの人数で、そのゲームが遊べるか。遊べないときは理由（あと何人・最大何人）。 */
export type Fit = { ok: true } | { ok: false; why: 'need'; n: number } | { ok: false; why: 'over'; max: number };

export function fit(range: { readonly min: number; readonly max: number }, count: number): Fit {
  if (count < range.min) return { ok: false, why: 'need', n: range.min - count };
  if (count > range.max) return { ok: false, why: 'over', max: range.max };
  return { ok: true };
}
