// 文字数の上限は書記素で数える（docs/pad.md）。画面は検証を通った指定を受け取るが、念のためここでも切る。
import { truncateGraphemes } from '@irori/protocol';

export function clip(text: unknown, max: number): string {
  return typeof text === 'string' ? truncateGraphemes(text, max) : '';
}
