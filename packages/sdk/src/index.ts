// irori の SDK（docs/sdk.md）。ビルドすると依存のない1ファイル（dist/irori.js）になり、ゲームのフォルダに写して使う。
// 読み込んだだけでは何もしない（connect を呼んだときに、枠の中か単体かを見て動き方を決める）。
import { connectHost } from './host';
import { createMock } from './mock';
import type { ConnectOptions, Irori } from './types';

export { IroriError } from './errors';
export type { IroriErrorCode } from './errors';
export type { ConnectOptions, GameInput, Irori, IroriEvents, IroriStorage, Target } from './types';
export type { ButtonSpec, ChoiceSpec, ColorName, GameEndOptions, GamePadSpec as PadSpec, GameResult, HostCapability, HostEnvironment, PlayerId, PlayerInfo } from '@irori/protocol';
export type { Look, ShapeName } from '@irori/pad-ui';

const HANDSHAKE_TIMEOUT_MS = 3_000;

let pending: Promise<Irori> | null = null;

/** 枠の中ならコンソールと握手し、単体で開いたなら仮想プレイヤーになる。何度呼んでも同じものを返す。 */
export function connect(options: ConnectOptions = {}): Promise<Irori> {
  if (pending) return pending;
  const inFrame = window.parent !== window;
  const p: Promise<Irori> = inFrame
    ? connectHost(window, options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS)
    : Promise.resolve(createMock(window, { mockPlayers: options.mockPlayers }));
  pending = p;
  // 握手に失敗したら、呼び直せるようにする。
  p.catch(() => {
    if (pending === p) pending = null;
  });
  return p;
}
