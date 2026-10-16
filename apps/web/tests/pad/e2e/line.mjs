// 回線の模型：ブラウザと実 Worker のあいだに置く TCP の中継。WebSocket の接続だけを、試験から黙らせたり切ったりする。
//   freeze    … 両方向のデータを捨てる。閉じない（画面ロックのあとの「死んだ接続」。どちらも気づかない）
//   cutServer … サーバー側だけを切り、ブラウザには何も知らせない（サーバーから切れたが、スマホは気づかない）
//   drop      … 両側を切る（ブラウザは 1006 で閉じたと知る）
//   blockNew  … 新しい WebSocket も通さない（つなぎかけのまま止まる）。unblock() で戻す
// それ以外の新しい接続は、いつも素通しする（入り直しは通る）。型は line.d.mts。
import { connect, createServer } from 'node:net';

export class Line {
  #pairs = new Set();
  #server;
  /** これまでに通した WebSocket の数。入り直した回数を数えるのに使う。 */
  wsOpened = 0;
  blockNew = false;

  constructor(server, port) {
    this.#server = server;
    this.port = port;
  }

  static start(targetPort, port) {
    let line;
    const server = createServer((down) => line.#accept(down, targetPort));
    line = new Line(server, port);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(line));
    });
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** いま生きている（黙らせていない）WebSocket の数。 */
  get liveSockets() {
    let n = 0;
    for (const p of this.#pairs) if (p.ws && !p.frozen) n++;
    return n;
  }

  #accept(down, targetPort) {
    const up = connect({ port: targetPort, host: '127.0.0.1' });
    const pair = { down, up, ws: false, frozen: false };
    this.#pairs.add(pair);
    let head = '';
    down.on('data', (d) => {
      if (!pair.ws && head.length < 16_384) {
        head += d.toString('latin1');
        if (/\r\nupgrade:\s*websocket/i.test(head)) {
          pair.ws = true;
          this.wsOpened++;
          if (this.blockNew) pair.frozen = true;
        }
      }
      if (!pair.frozen && !up.destroyed) up.write(d);
    });
    up.on('data', (d) => {
      if (!pair.frozen && !down.destroyed) down.write(d);
    });
    down.on('close', () => {
      this.#pairs.delete(pair);
      if (!up.destroyed) up.destroy();
    });
    up.on('close', () => {
      if (pair.frozen) return; // 黙らせた接続は、ブラウザ側を開けたままにする
      this.#pairs.delete(pair);
      if (!down.destroyed) down.destroy();
    });
    down.on('error', () => undefined);
    up.on('error', () => undefined);
  }

  #sockets() {
    return [...this.#pairs].filter((p) => p.ws && !p.frozen);
  }

  freeze() {
    const list = this.#sockets();
    for (const p of list) p.frozen = true;
    return list.length;
  }

  cutServer() {
    const list = this.#sockets();
    for (const p of list) {
      p.frozen = true;
      p.up.destroy();
    }
    return list.length;
  }

  drop() {
    const list = this.#sockets();
    for (const p of list) {
      p.down.destroy();
      p.up.destroy();
    }
    return list.length;
  }

  unblock() {
    this.blockNew = false;
    for (const p of [...this.#pairs]) {
      if (p.ws && p.frozen) {
        p.down.destroy();
        p.up.destroy();
      }
    }
  }

  async close() {
    for (const p of this.#pairs) {
      p.down.destroy();
      p.up.destroy();
    }
    this.#pairs.clear();
    await new Promise((r) => this.#server.close(() => r()));
  }
}
