// 試験用の小さな静的サーバー。別オリジンを2つ作るために、同じコードを別ポートで2回立てる。
// 同梱方式の枠はオリジンが空（sandbox に allow-same-origin なし）なので、配信元が CORS を許す（コンソールと別オリジンの取得のため）。
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { assertSafePath } from '../../../../tools/lib/files.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * @param {{ rootDir: string, host?: string }} opts
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startStatic(opts) {
  const root = realpathSync(opts.rootDir);
  const host = opts.host ?? '127.0.0.1';
  const server = createServer(async (req, res) => {
    try {
      let pathname;
      try {
        // Decode before URL normalization, which would erase encoded dot segments.
        pathname = decodeURIComponent((req.url ?? '/').split(/[?#]/, 1)[0]);
      } catch {
        res.writeHead(400).end('bad request');
        return;
      }
      if (pathname.includes('\0')) {
        res.writeHead(400).end('bad request');
        return;
      }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.split('/').some((part) => part === '.' || part === '..')) {
        res.writeHead(403).end('forbidden');
        return;
      }
      // 同梱の枠を真似る：/games/ と /sdk/ は、別オリジンからの取得を許す（CORS）。
      if (pathname.startsWith('/games/') || pathname.startsWith('/sdk/')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      if (pathname.endsWith('/')) pathname += 'index.html';
      const rel = pathname.slice(1);
      let info;
      try {
        // Existing links and special files are rejected; the checkout must stay stable while serving.
        info = assertSafePath(root, rel);
      } catch {
        res.writeHead(403).end('forbidden');
        return;
      }
      const filePath = join(root, rel);
      if (!info?.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (err) {
      const missing = err.code === 'ENOENT' || err.code === 'ENOTDIR';
      res.writeHead(missing ? 404 : 500).end(missing ? 'not found' : 'internal error');
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    // ポート0で空きを選ぶ（固定ポートは並列で重なるため）。
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolvePromise({
        url: `http://${host}:${port}`,
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
