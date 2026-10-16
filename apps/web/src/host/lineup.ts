// ゲームの参加者（始めたときに部屋にいた人）を、席の番号と「その席に入った回（世代）」で覚える（画面に依存しない純粋な関数）。
// 中継は、空いた最小の番号を次の人に渡す。席の番号だけで覚えると、ゲームの途中で抜けた（left）席に入った別の人が、
// そのゲームの参加者になってしまう（入力がゲームに届き、結果にも載る）。docs/sdk.md の「途中参加は次のゲームから」を守るため、
// 抜けた席は参加者から外し、名前の控えを結果のために残す。
import type { PlayerId, PlayerInfo } from '@irori/protocol';

export interface Lineup {
  /** いまも参加者として扱う席。 */
  readonly seats: ReadonlySet<PlayerId>;
  /** 名前の控え（始めたときの名前。抜けた席は、抜けたときの名前）。結果の行に使う。 */
  readonly names: ReadonlyMap<PlayerId, string>;
  /** ゲームの途中で抜けた席（同じ番号に別の人が入っても、こちらは元の参加者のこと）。 */
  readonly gone: ReadonlySet<PlayerId>;
}

export function startLineup(players: readonly PlayerInfo[]): Lineup {
  return { seats: new Set(players.map((p) => p.id)), names: new Map(players.map((p) => [p.id, p.name])), gone: new Set() };
}

/** 席が空いた（left）。その席は、このゲームの参加者ではなくなる。あとで同じ番号に入った人は、別の人として扱う。 */
export function seatLeft(l: Lineup, p: PlayerId, name?: string): Lineup {
  if (!l.seats.has(p)) return l;
  const seats = new Set(l.seats);
  seats.delete(p);
  const names = new Map(l.names);
  if (name !== undefined) names.set(p, name);
  return { seats, names, gone: new Set(l.gone).add(p) };
}

/**
 * ホストが入り直したとき（welcome）。切れているあいだの left は届かないので、いまの名簿と照らす。
 * 名簿にいない席と、名前が控えと違う席は、抜けたものとして扱う（同じ名前の別の人が入っていた場合は見分けられない）。
 */
export function reconcile(l: Lineup, players: readonly PlayerInfo[]): Lineup {
  let next = l;
  for (const p of l.seats) {
    const now = players.find((x) => x.id === p);
    if (!now || now.name !== l.names.get(p)) next = seatLeft(next, p);
  }
  return next;
}

/** 結果の行の名前。参加者のままの席は今の名前、抜けた席は控えの名前で「退出」の印を付ける。 */
export function resultName(l: Lineup, roster: readonly PlayerInfo[], p: PlayerId, fallback: string): { name: string; gone: boolean } {
  if (l.seats.has(p)) return { name: roster.find((x) => x.id === p)?.name ?? l.names.get(p) ?? fallback, gone: false };
  return { name: l.names.get(p) ?? fallback, gone: true };
}
