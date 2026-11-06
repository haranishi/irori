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

test('小さい画面でも役と席の補足は15px、早見と便りは14px以上を保つ', () => {
  assert.match(css, /\.seat-meta,\.role\s*\{\s*font-size:\s*clamp\(15px/);
  assert.match(css, /\.role,\.seat-meta\s*\{\s*font-size:\s*15px/);
  assert.match(rule('events'), /font-size:\s*clamp\(14px/);
  assert.match(rule('role-guide'), /font-size:\s*14px/);
  assert.match(css, /\.hand \.number\[data-digits='2'\]\s*\{\s*width:\s*30px/);
});

test('早見の帯は卓の外で高さを確保し、縮まらず通常の配置に従う', () => {
  assert.match(rule('role-guide'), /flex:\s*none/);
  assert.match(rule('role-guide'), /position:\s*relative/);
  assert.doesNotMatch(rule('role-guide'), /(?:top|bottom|transform):/);
  assert.match(rule('table'), /min-height:\s*0/);
});
