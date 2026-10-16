// 公開する画像の書体の道具の試験。確認ずみでない書体ファイル（別の書体・ライセンスの違う版）を、うっかり混ぜないこと。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { OFL_FONTS, fontFaceCss, loadOflFonts } from '../lib/ofl-fonts.mjs';

const dir = mkdtempSync(join(tmpdir(), 'irori-ofl-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const body = Buffer.from('これは書体ではなく、試験用の中身');
const sha256 = createHash('sha256').update(body).digest('hex');
const specs = { jp: { env: 'T_JP', url: 'https://example.invalid/jp.ttf', sha256 } };

describe('ofl-fonts', () => {
  it('環境変数が無ければ、取得先つきで落ちる', () => {
    assert.throws(() => loadOflFonts({}, ['jp']), /IRORI_FONT_JP[\s\S]*github\.com\/google\/fonts/);
    assert.throws(() => loadOflFonts({}, ['mono']), /IRORI_FONT_MONO/);
  });

  it('SHA-256 が確認ずみと違うファイルは使わない', () => {
    const wrong = join(dir, 'wrong.ttf');
    writeFileSync(wrong, 'ちがう中身');
    assert.throws(() => loadOflFonts({ T_JP: wrong }, ['jp'], specs), /SHA-256 が一致しません/);
  });

  it('確認ずみのファイルなら読める', () => {
    const ok = join(dir, 'ok.ttf');
    writeFileSync(ok, body);
    const fonts = loadOflFonts({ T_JP: ok }, ['jp'], specs);
    assert.deepEqual(fonts.jp, body);
  });

  it('本物の2つの書体は、確認ずみの SHA-256 と取得先を持つ（取り違えの目印）', () => {
    for (const key of ['jp', 'mono']) {
      assert.match(OFL_FONTS[key].sha256, /^[0-9a-f]{64}$/);
      assert.match(OFL_FONTS[key].url, /^https:\/\/github\.com\/google\/fonts\/raw\/main\/ofl\//);
    }
  });

  it('@font-face は、渡した場所だけを指す', () => {
    const css = fontFaceCss({ jpUrl: '/__font/jp.ttf' });
    assert.match(css, /font-family: 'IroriOfl'/);
    assert.match(css, /url\('\/__font\/jp\.ttf'\)/);
    assert.doesNotMatch(css, /IroriOflMono/);
  });
});

describe('canvas の書体の差し替え', () => {
  it('書体の名前の並びを IroriOfl に替え、太さと大きさは残す', async () => {
    const { rewriteCanvasFont } = await import('../lib/ofl-fonts.mjs');
    assert.equal(rewriteCanvasFont('700 18px ui-rounded, "Hiragino Maru Gothic ProN", sans-serif'), '700 18px IroriOfl');
    assert.equal(rewriteCanvasFont('16px sans-serif'), '16px IroriOfl');
    assert.equal(rewriteCanvasFont('bold 24px/1.2 "Noto Sans JP", system-ui'), 'bold 24px IroriOfl');
    assert.equal(rewriteCanvasFont('italic 800 12.5px Menlo'), 'italic 800 12.5px IroriOfl');
  });
  it('ページの最初に流す文は、代入を差し替え、替える前の値を残す', async () => {
    const { canvasFontPatchScript } = await import('../lib/ofl-fonts.mjs');
    const script = canvasFontPatchScript();
    assert.match(script, /CanvasRenderingContext2D\.prototype/);
    assert.match(script, /__canvasFonts/);
    // 偽の canvas で、文を実際に流して確かめる。
    let stored = '';
    const proto = {};
    Object.defineProperty(proto, 'font', { configurable: true, enumerable: true, get() { return stored; }, set(v) { stored = v; } });
    const window = {};
    new Function('window', 'CanvasRenderingContext2D', script)(window, { prototype: proto });
    const ctx = Object.create(proto);
    ctx.font = '700 18px "Hiragino Maru Gothic ProN", sans-serif';
    assert.equal(ctx.font, '700 18px IroriOfl');
    assert.deepEqual([...window.__canvasFonts], ['700 18px "Hiragino Maru Gothic ProN", sans-serif']);
  });
});
