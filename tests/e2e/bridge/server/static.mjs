// 試験用の小さな静的サーバー。別オリジンを2つ作るために、同じコードを別ポートで2回立てる。
// 同梱方式の枠はオリジンが空（sandbox に allow-same-origin なし）なので、配信元が CORS を許す（コンソールと別オリジンの取得のため）。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

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
  const root = resolve(opts.rootDir);
  const host = opts.host ?? '127.0.0.1';
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      // 同梱の枠を真似る：/games/ と /sdk/ は、別オリジンからの取得を許す（CORS）。
      if (url.pathname.startsWith('/games/') || url.pathname.startsWith('/sdk/')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filePath = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolvePromise) => {
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
