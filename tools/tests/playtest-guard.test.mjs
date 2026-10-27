// 試遊サーバーの守り：ブラウザ経由の要求（Origin つき）と、127.0.0.1 以外の Host を断る。curl（Origin なし・Host が 127.0.0.1）は通す。
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { request } from 'node:http';
import { after, describe, it } from 'node:test';
import { Playtest, serve } from '../playtest-server.mjs';

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

describe('試遊サーバーのホストの画面の大きさ', () => {
  it('範囲外や整数でない大きさは400、始める前は409（ブラウザを起こさずに確かめる）', async () => {
    const pt = new Playtest();
    after(() => rmSync(pt.shots, { recursive: true, force: true }));
    for (const body of [undefined, {}, { width: 100, height: 700 }, { width: 768, height: 99999 }, { width: 768.5, height: 1024 }, { width: '768', height: 1024 }]) {
      await assert.rejects(() => pt.viewport(body), { status: 400 });
    }
    await assert.rejects(() => pt.viewport({ width: 768, height: 1024 }), { status: 409 });
  });
});
