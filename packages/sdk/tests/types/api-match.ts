// 手書きの irori.d.ts と、実装（src/index.ts）の公開の型が同じであることを、tsc に確かめさせる。
// どちらかだけを直すと、ここが型の誤りになる。
import type * as D from '../../irori.js';
import type * as I from '../../src/index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type ApiMatches = [
  Expect<Equal<D.CueName, I.CueName>>,
  Expect<Equal<D.PlayerId, I.PlayerId>>,
  Expect<Equal<D.PlayerInfo, I.PlayerInfo>>,
  Expect<Equal<D.GameInput, I.GameInput>>,
  Expect<Equal<D.ColorName, I.ColorName>>,
  Expect<Equal<D.ButtonSpec, I.ButtonSpec>>,
  Expect<Equal<D.ChoiceSpec, I.ChoiceSpec>>,
  Expect<Equal<D.TileSpec, I.TileSpec>>,
  Expect<Equal<D.PadSpec, I.PadSpec>>,
  Expect<Equal<D.GameResult, I.GameResult>>,
  Expect<Equal<D.GameEndOptions, I.GameEndOptions>>,
  Expect<Equal<D.HostEnvironment, I.HostEnvironment>>,
  Expect<Equal<D.HostCapability, I.HostCapability>>,
  Expect<Equal<D.ShapeName, I.ShapeName>>,
  Expect<Equal<D.Look, I.Look>>,
  Expect<Equal<D.Target, I.Target>>,
  Expect<Equal<D.IroriEvents, I.IroriEvents>>,
  Expect<Equal<D.IroriStorage, I.IroriStorage>>,
  Expect<Equal<D.Irori, I.Irori>>,
  Expect<Equal<D.ConnectOptions, I.ConnectOptions>>,
  Expect<Equal<D.IroriErrorCode, I.IroriErrorCode>>,
  Expect<Equal<typeof D.connect, typeof I.connect>>,
  Expect<Equal<InstanceType<typeof D.IroriError>, InstanceType<typeof I.IroriError>>>,
  Expect<Equal<ConstructorParameters<typeof D.IroriError>, ConstructorParameters<typeof I.IroriError>>>,
  // 値として書き出すものも同じ（型だけのものは、上の一覧で見る）。
  Expect<Equal<keyof typeof D, keyof typeof I>>,
];
