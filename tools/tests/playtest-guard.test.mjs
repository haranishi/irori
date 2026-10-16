// 試遊サーバーの守り：ブラウザ経由の要求（Origin つき）と、127.0.0.1 以外の Host を断る。curl（Origin なし・Host が 127.0.0.1）は通す。
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, describe, it } from 'node:test';
import { serve } from '../playtest-server.mjs';

const stub = { state: () => ({ ok: true }) };
const running = await serve(stub);
after(() => new Promise((done) => running.server.close(done)));
const port = new URL(running.url).port;

function get(headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/state', method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('試遊サーバーの守り', () => {
  it('curl のような要求（Origin なし・Host が 127.0.0.1）は通す', async () => {
    assert.equal((await get()).status, 200);
    assert.equal((await get({ Host: `localhost:${port}` })).status, 200);
  });
  it('Host が別の名前（DNS の付け替え）なら断る', async () => {
    assert.equal((await get({ Host: 'evil.example' })).status, 403);
    assert.equal((await get({ Host: `evil.example:${port}` })).status, 403);
  });
  it('ブラウザ経由（Origin つき）なら断る', async () => {
    assert.equal((await get({ Origin: 'https://evil.example' })).status, 403);
  });
});
