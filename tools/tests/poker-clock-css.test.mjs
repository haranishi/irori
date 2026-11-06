// 持ち点ポーカーの時計：文字は無地にし、残り時間の輪は文字から分離する。
// ゲームの試験は自分のフォルダの外を読めず、vitest は CSS の読み込みを空にするため、
// 配信する CSS の構造は、ファイルとして読めるここで確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../games/poker/style.css', import.meta.url), 'utf8');
const rule = (name) => css.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`))?.[1] ?? '';

test('時計の文字は無地で、残り時間の輪は文字と重ならない別の部品になっている', () => {
  assert.match(rule('clock-label'), /background:\s*#eee2cb/);
  assert.doesNotMatch(rule('clock-label'), /gradient/);
  assert.match(rule('clock-ring'), /conic-gradient/);
  assert.doesNotMatch(rule('clock-ring'), /position:\s*absolute/);
  assert.match(rule('clock'), /display:\s*flex/);
});
