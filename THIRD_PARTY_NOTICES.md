# 第三者の素材と依存

配布物（ビルドして配る画面とSDK）に入るものと、入れていないものを書く。ライセンスの表示は [`REUSE.toml`](REUSE.toml)、方針は [docs/legal/license-policy.md](docs/legal/license-policy.md) にある。

| 区分 | 名前 | 提供元 | ライセンス | 使い方 |
|---|---|---|---|---|
| 配布物に入る依存 | qrcode-generator 2.0.4 | Kazuhiko Arase | MIT（下に全文） | 部屋のQRコードの生成。ホストの画面のビルドに同梱する |
| 配布物に入る第三者のコードの写し | BudouX の日本語モデル（budoux 0.9.3 の `ja`） | Google LLC | Apache-2.0（全文は、配る `licenses.txt` に添える。リポジトリでは `LICENSES/Apache-2.0.txt`） | 日本語の文を文節で折り返すための重み。`apps/web/src/shared/phrase-model-ja.ts` に、値をそのまま写した。分け方の処理は自前で書いた |
| 配色の出典 | Okabe-Ito の配色（2008年に提案された、色覚の多様性に配慮した8色） | Masataka Okabe、Kei Ito | 色の値そのもの。第三者の素材は含まない | プレイヤーの7色と、地に沈まない薄灰を作るときの参考にした |
| 開発用の依存 | TypeScript、Vite、Vitest、Playwright、wrangler、Ajv、happy-dom、jsQR など | 各提供元 | MIT、Apache-2.0、ISC など（`package-lock.json`） | ビルドと試験だけ。配布物には入らない |
| 開発用の依存（MPL-2.0） | axe-core 4.13.0、@axe-core/playwright 4.13.0 | Deque Systems | MPL-2.0（ファイル単位のコピーレフト） | 試験でアクセシビリティを検査するだけ。改変せず、配布物には入らない |
| 開発用の依存（MPL-2.0） | lightningcss 1.33.0（vite 経由） | Parcel | MPL-2.0 | ビルドのときに CSS を縮めるだけ。出力に残るのは、生成した変数名だけ。配布物に、そのコードは入らない |
| 開発用の依存（LGPL-3.0-or-later・任意） | sharp 0.35.5 と、その libvips（wrangler の miniflare 経由。入る環境と入らない環境がある） | Lovell Fuller ほか | LGPL-3.0-or-later（libvips）、Apache-2.0（sharp） | 開発用サーバーの内部の、画像の処理。配布物には入らない |
| 画像・音・書体 | なし | — | — | 画像はコードで描くか、画面から撮る。音は合成。書体はOSのもの。OGP画像とサムネイル（`apps/web/public/og.png`・`registry/thumbs/`）の文字は、Noto Sans JP と Noto Sans Mono（SIL OFL 1.1、Copyright 2014-2021 Adobe ほか）で描いた画像で、書体ファイルは含まない |

QRコードは、株式会社デンソーウェーブの登録商標です。

## qrcode-generator

```
MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```
