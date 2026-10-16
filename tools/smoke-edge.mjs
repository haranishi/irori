// 起動済みの Worker に、部屋の作成・ホスト・スマホ・入力の往復を1回通す。成功なら「OK」、失敗なら終了コード1。
// CI と実機の確認に使う。使い方: node tools/smoke-edge.mjs http://127.0.0.1:8787
// 待つのは「フレームが届いたこと」と「接続が閉じたこと」だけ。決め打ちの時間は待たない（全体の上限だけ置く）。

const TOTAL_TIMEOUT_MS = 30_000;
const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

function fail(message) {
  console.error(`NG: ${message}`);
  process.exit(1);
}

class Peer {
  constructor(url) {
    this.frames = [];
    this.raw = [];
    this.closed = null;
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const text = String(e.data);
      this.raw.push(text);
      try {
        this.frames.push(JSON.parse(text));
      } catch {
        // 読めないものは raw にだけ残す
      }
      this.wake();
    };
    this.ws.onclose = (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake();
    };
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`接続できません: ${url}`));
    });
  }

  wake() {
    for (const fn of this.waiters.splice(0)) fn();
  }

  send(frame) {
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  /** 条件に合うものが届くまで待つ。閉じたら失敗にする。 */
  until(check, what) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const hit = check();
        if (hit !== undefined) return resolve(hit);
        if (this.closed) return reject(new Error(`${what} の前に閉じました（${this.closed.code} ${this.closed.reason}）`));
        this.waiters.push(attempt);
      };
      attempt();
    });
  }

  take(t) {
    return this.until(() => {
      const i = this.frames.findIndex((f) => f.t === t);
      return i < 0 ? undefined : this.frames.splice(i, 1)[0];
    }, `「${t}」`);
  }

  closedCode() {
    return new Promise((resolve) => {
      const attempt = () => (this.closed ? resolve(this.closed.code) : this.waiters.push(attempt));
      attempt();
    });
  }
}

async function smoke(base) {
  const http = new URL(base);
  const ws = `${http.protocol === 'https:' ? 'wss:' : 'ws:'}//${http.host}`;

  const health = await fetch(new URL('/api/health', http));
  if (!health.ok) throw new Error(`/api/health が ${health.status}`);

  const created = await fetch(new URL('/api/rooms', http), { method: 'POST' });
  if (created.status !== 201) throw new Error(`部屋を作れません（${created.status} ${await created.text()}）`);
  const room = await created.json();
  if (!/^[A-Z0-9]{4}$/.test(room.code) || typeof room.key !== 'string') throw new Error(`作成の応答が不正: ${JSON.stringify(room)}`);

  const status = await (await fetch(new URL(`/api/rooms/${room.code}`, http))).json();
  if (status.exists !== true) throw new Error(`作った部屋が見つかりません: ${JSON.stringify(status)}`);

  const host = new Peer(`${ws}/api/rooms/${room.code}/ws`);
  await host.opened;
  host.send({ t: 'hello', v: 1, role: 'host', key: room.key });
  await host.take('welcome');

  const pad = new Peer(`${ws}/api/rooms/${room.code}/ws`);
  await pad.opened;
  pad.send({ t: 'hello', v: 1, role: 'pad', name: 'smoke' });
  const welcome = await pad.take('welcome');
  const seat = welcome.you?.id;
  const joined = await host.take('joined');
  if (joined.p?.id !== seat) throw new Error(`joined の席番号が違います: ${JSON.stringify(joined)}`);

  pad.send({ t: 'in', i: { k: 'btn', id: 'ok', d: 1 } });
  const input = await host.take('in');
  if (input.p !== seat || input.i?.k !== 'btn' || typeof input.T !== 'number') throw new Error(`入力の転送が不正: ${JSON.stringify(input)}`);

  host.send({ t: 'pad', to: seat, spec: { k: 'buzzer', label: 'OK' } });
  const spec = await pad.take('pad');
  if (spec.spec?.k !== 'buzzer') throw new Error(`画面の指定が届きません: ${JSON.stringify(spec)}`);

  pad.send(PING);
  await pad.until(() => (pad.raw.includes(PONG) ? true : undefined), 'pong');

  host.send({ t: 'close' });
  await pad.take('closed');
  const code = await pad.closedCode();
  if (code !== 4010) throw new Error(`部屋を閉じたときのコードが ${code}`);
  host.ws.close();
}

const base = process.argv[2];
if (!base) fail('使い方: node tools/smoke-edge.mjs <Worker の URL>（例: http://127.0.0.1:8787）');
const timer = setTimeout(() => fail(`${TOTAL_TIMEOUT_MS / 1000}秒で終わりませんでした`), TOTAL_TIMEOUT_MS);
smoke(base).then(
  () => {
    clearTimeout(timer);
    console.log('OK');
    process.exit(0);
  },
  (e) => fail(e instanceof Error ? e.message : String(e)),
);
