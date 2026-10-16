// PadApp の進み方を、偽の WebSocket と時計で確かめる（実ブラウザの試験は *.e2e.ts）。
import { HEARTBEAT_PING, type PadSpec } from '@irori/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_CODES, FakeWS, comeBack, joined, lastWS, memoryStorage, pointer, settle, startApp } from './helpers';

beforeEach(() => {
  FakeWS.all = [];
});

describe('入り方', () => {
  it('QRのURLの # からコードを取り、存在を確かめて参加の画面を出す。名前は前回のもの・見本の文字は見出しと同じ・本名を入れない案内', async () => {
    const local = memoryStorage();
    local.setItem('irori:name', 'はなこ');
    const h = startApp({ hash: 'bcdf', local });
    await settle();
    expect(h.lookups).toEqual(['/api/rooms/BCDF']);
    expect(h.screen()).toBe('join');
    const name = h.q<HTMLInputElement>('#pp-name')!;
    expect(name.value).toBe('はなこ');
    // 見本の文字は、キーボードで見出しが隠れたときだけ見せる（CSS）。中身は見出しと同じ。
    expect(name.getAttribute('placeholder')).toBe('名前（なくても入れます）');
    expect(h.q('#pp-privacy')!.textContent).toBe('ニックネームで大丈夫です。本名や連絡先は入れないでください。');
    expect(location.hash).toBe('#BCDF');
  });

  it('コードがなければ入力の画面。形の違うコードは知らせを出す', async () => {
    expect(startApp().screen()).toBe('entry');
    const h = startApp({ hash: 'AEIO' });
    expect(h.screen()).toBe('entry');
    expect(h.q('.pp-msg')!.textContent).toBe('コードの形が違います。4文字を入れ直してください。');
    expect(h.lookups).toEqual([]);
  });

  it('存在しない部屋は入力の画面に戻り、コードを残して知らせる', async () => {
    const h = startApp({ hash: 'BCDF' });
    h.respond({ status: 200, body: { exists: false, locked: false, players: 0, max: 8 } });
    await settle();
    // 最初の照会はすでに既定の応答で済んでいるので、入れ直したことにして照会し直す
    h.click('[data-act="change"]');
    expect(h.screen()).toBe('entry');
    const boxes = [...h.root.querySelectorAll<HTMLInputElement>('.pp-code__box')];
    for (const [i, c] of [...'BCDF'].entries()) {
      boxes[i]!.value = c;
      boxes[i]!.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await settle();
    expect(h.screen()).toBe('entry');
    expect(h.q('.pp-msg')!.textContent).toBe('部屋「BCDF」が見つかりません。コードを確かめてください。');
  });

  it('満員・ロック・回数の上限・通信の失敗は、理由と「もう一度試す」を出す', async () => {
    const cases = [
      [{ status: 200, body: { exists: true, locked: false, players: 8, max: 8 } }, 'full', '8人まで'],
      [{ status: 200, body: { exists: true, locked: true, players: 2, max: 8 } }, 'locked', '締め切られています'],
      [{ status: 429, body: { error: 'rate', retryAfterSec: 20 }, headers: { 'Retry-After': '20' } }, 'rate', 'あと20秒'],
      ['network', 'network', 'つながりません'],
    ] as const;
    for (const [reply, state, text] of cases) {
      const h = startApp();
      h.respond(reply);
      // 入力の画面からコードを入れる
      const boxes = [...h.root.querySelectorAll<HTMLInputElement>('.pp-code__box')];
      for (const [i, c] of [...'BCDF'].entries()) {
        boxes[i]!.value = c;
        boxes[i]!.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await settle();
      expect(h.state(), state).toBe(state);
      expect(h.root.textContent).toContain(text);
      expect(h.q('[data-act="retry"]')).not.toBeNull();
      expect(h.q('[data-act="reenter"]')).not.toBeNull();
    }
  });

  it('参加のボタンを連打しても、つなぐのは1回だけ。参加のタップで画面の消灯を防ぐ', async () => {
    const h = startApp({ hash: 'BCDF' });
    await settle();
    expect(h.wakeRequests()).toBe(0);
    // 同じボタンを、画面が替わる前に5回押す（指の連打と同じ）。
    const button = h.q('[data-act="join"]')!;
    for (let i = 0; i < 5; i++) button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(FakeWS.all.length).toBe(1);
    await settle();
    expect(h.wakeRequests()).toBe(1);
  });
});

describe('つなぐ', () => {
  it('hello に名前を入れ、welcome の札を sessionStorage に置く。名前は12文字・空なら送らない', async () => {
    const h = startApp({ hash: 'BCDF' });
    await settle();
    h.q<HTMLInputElement>('#pp-name')!.value = '  たろう  ';
    h.click('[data-act="join"]');
    const ws = lastWS();
    ws.welcome(3, 'たろう', 'TOKEN-ABC');
    expect(ws.hello).toEqual({ t: 'hello', v: 1, role: 'pad', name: 'たろう' });
    expect(h.session.getItem('irori:resume:BCDF')).toBe('TOKEN-ABC');
    expect(h.local.getItem('irori:name')).toBe('たろう');
    expect(h.screen()).toBe('play');

    const h2 = startApp({ hash: 'BCDF' });
    await settle();
    h2.click('[data-act="join"]');
    lastWS().accept();
    expect(lastWS().hello).toEqual({ t: 'hello', v: 1, role: 'pad' });
  });

  it('名前はバイト数でも切り、hello を512バイトに収める（超えると閉じられて入り直し続けるため）', async () => {
    const h = startApp({ hash: 'BCDF' });
    await settle();
    h.q<HTMLInputElement>('#pp-name')!.value = `e${'́'.repeat(200)}`.repeat(12);
    h.click('[data-act="join"]');
    const ws = lastWS();
    ws.accept();
    const hello = ws.sent.find((s) => s.includes('"hello"'))!;
    expect(new TextEncoder().encode(hello).length).toBeLessThanOrEqual(512);
  });

  it('名前は textContent で描く（HTML として解釈しない）', async () => {
    // 中継は名前を12書記素に切るが、< や > は残す。画面の側で HTML にしないことを確かめる。
    const h = startApp({ hash: 'BCDF' });
    await joined(h, 2, '<b>悪</b><i>');
    expect(h.q('.pp-badge__name')!.textContent).toBe('<b>悪</b><i>');
    expect(h.root.querySelector('.pp-play b, .pp-play i')).toBeNull();
    expect(h.q('.pp-menu__seat')!.textContent).toContain('<b>悪</b>');
  });

  it('席の色と形を縁と左上に出す（色だけに頼らず、形と「空色の四角」のような言葉も）', async () => {
    const h = startApp({ hash: 'BCDF' });
    await joined(h, 2, 'じろう');
    const play = h.q('.pp-play')!;
    expect(play.style.getPropertyValue('--pp-seat')).toBe('#56B4E9');
    expect(h.q('.pp-badge [data-shape]')!.getAttribute('data-shape')).toBe('square');
    expect(h.q('.pp-look')!.textContent).toBe('空色の四角');
  });

  it('札があれば（再読み込み）、参加の画面も存在の確認も飛ばして、同じ札で入り直す', async () => {
    const session = memoryStorage();
    session.setItem('irori:resume:BCDF', 'TOKEN-OLD');
    const h = startApp({ hash: 'BCDF', session });
    await settle();
    expect(h.lookups).toEqual([]);
    expect(h.screen()).toBe('connecting');
    const ws = lastWS();
    ws.accept();
    expect(ws.hello).toMatchObject({ t: 'hello', resume: 'TOKEN-OLD' });
    ws.message({ t: 'welcome', role: 'pad', you: { id: 4, name: 'しろう', online: true }, resume: 'TOKEN-OLD', host: true });
    expect(h.screen()).toBe('play');
    ws.pad({ k: 'buzzer', label: '押す' });
    expect(h.q('.irori-pad__buzzer')).not.toBeNull();
  });

  it('保存が使えない端末でも入れる（札を残せないだけ）', async () => {
    const h = startApp({ hash: 'BCDF', noStorage: true });
    await joined(h);
    expect(h.screen()).toBe('play');
  });
});

describe('画面とつながり', () => {
  it('ホストの画面を出す。同じ指定の再送では作り直さない。つなぎ直したあとは、同じ指定でも当て直す', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    const spec: PadSpec = { k: 'choices', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    ws.pad(spec);
    const first = h.q('.irori-pad__choices')!;
    pointer(h.q('.irori-pad__choice[data-id="a"]')!, 'pointerdown');
    expect(first.hasAttribute('data-picked')).toBe(true);
    ws.pad(spec);
    expect(h.q('.irori-pad__choices')).toBe(first);
    // 切れて入り直し、ホストが同じ画面を送り直した → 選ぶ前の状態に戻る（ホストの画面が正）。
    ws.drop(1006);
    expect(h.q('.pp-banner')!.hidden).toBe(false);
    h.clock.advance(1_000);
    const ws2 = lastWS();
    expect(ws2).not.toBe(ws);
    ws2.welcome(1, 'プレイヤー1');
    expect(h.q('.pp-banner')!.hidden).toBe(true);
    ws2.pad(spec);
    expect(h.q('.irori-pad__choices')).not.toBe(first);
    expect(h.q('.irori-pad__choices')!.hasAttribute('data-picked')).toBe(false);
  });

  it('切れている間は、枠の真ん中に「つなぎ直しています…」のカードを出して操作を止め、「今すぐつなぎ直す」はすぐ押せる', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.pad({ k: 'buzzer', label: '押す' });
    ws.drop(1006);
    expect(h.q('.pp-play')!.dataset.link).toBe('lost');
    expect((h.q('.pp-pad') as HTMLElement & { inert: boolean }).inert).toBe(true);
    const card = h.q('.pp-banner')!;
    expect(card.hidden).toBe(false);
    expect(card.closest('.pp-stage')).not.toBeNull();
    expect(card.textContent).toContain('つながりが切れました');
    expect(card.textContent).toContain('つなぎ直しています…');
    const now = h.q<HTMLButtonElement>('[data-act="reconnect-now"]')!;
    expect(now.hidden).toBe(false);
    expect(now.closest('.pp-banner')).toBe(card);
    // 自動の入り直しを待たずに、押せばすぐつなぎ直す。
    const before = FakeWS.all.length;
    h.click('[data-act="reconnect-now"]');
    expect(FakeWS.all.length).toBe(before + 1);
  });

  it('画面に戻ると、生きているかをすぐ確かめる（probe の ping）', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    const pings = () => ws.sent.filter((s) => s === HEARTBEAT_PING).length;
    expect(pings()).toBe(0);
    comeBack();
    expect(pings()).toBe(1);
    // 3秒返事がなければ、捨てて入り直す
    h.clock.advance(3_000);
    expect(ws.closedWith).not.toBeNull();
    h.clock.advance(1_000);
    expect(FakeWS.all.length).toBe(2);
  });

  it('入り直しの待ち時間の途中で画面に戻ったら、待たずにすぐ入り直す', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.drop(1006);
    expect(FakeWS.all.length).toBe(1);
    comeBack();
    expect(FakeWS.all.length).toBe(2);
  });

  it('ホストがいない間は「ホストを待っています」を重ね、戻ったら外す', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.message({ t: 'host', on: false });
    expect(h.q('[data-cover="host"]')!.hidden).toBe(false);
    ws.message({ t: 'host', on: true });
    expect(h.q('[data-cover="host"]')!.hidden).toBe(true);
  });

  it('fx は振動を頼み、縁を光らせる', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.message({ t: 'fx', ms: [50, 30, 50] });
    expect(h.vibrations).toEqual([[50, 30, 50]]);
    expect(h.q('.pp-frame')!.hasAttribute('data-fx')).toBe(true);
    h.clock.advance(400);
    expect(h.q('.pp-frame')!.hasAttribute('data-fx')).toBe(false);
  });

  it('入り直したら席が変わっていた（猶予の60秒を過ぎた）ときは、新しい席の色にし、前の画面を出さない', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h, 1, 'たろう');
    ws.pad({ k: 'buzzer', label: '押す' });
    ws.drop(1006);
    h.clock.advance(1_000);
    lastWS().welcome(5, 'たろう', 'TOKEN-NEW');
    expect(h.q('.pp-badge [data-shape]')!.getAttribute('data-shape')).toBe('star');
    expect(h.q('.irori-pad__buzzer')).toBeNull();
    expect(h.q('.pp-toast')!.textContent).toBe('新しい席で入り直しました。');
  });
});

describe('自動では入り直さない終わり方', () => {
  it('kicked：外されたと出し、札を捨て、画面に戻っても入り直さない', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.message({ t: 'kicked' });
    ws.drop(CLOSE_CODES.kicked);
    expect(h.state()).toBe('kicked');
    expect(h.session.getItem('irori:resume:BCDF')).toBeNull();
    comeBack();
    h.clock.advance(60_000);
    expect(FakeWS.all.length).toBe(1);
  });

  it('kicked：閉じるコードが届かなくても（回線が先に切れた）、kicked の知らせだけで止まる', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.message({ t: 'kicked' });
    ws.drop(1006);
    h.clock.advance(60_000);
    expect(FakeWS.all.length).toBe(1);
    expect(h.state()).toBe('kicked');
  });

  it('closed・満員・ロック・版の違い・部屋がない、はそれぞれの画面を出し、入り直さない', async () => {
    const cases = [
      [CLOSE_CODES.closed, 'closed'],
      [CLOSE_CODES.full, 'full'],
      [CLOSE_CODES.locked, 'locked'],
      [CLOSE_CODES.version, 'version'],
    ] as const;
    for (const [code, state] of cases) {
      const h = startApp({ hash: 'BCDF' });
      await settle();
      h.click('[data-act="join"]');
      lastWS().accept();
      lastWS().drop(code);
      expect(h.state(), state).toBe(state);
      h.clock.advance(60_000);
      expect(FakeWS.all.length, state).toBe(1);
    }
    const h = startApp({ hash: 'BCDF' });
    await joined(h);
    lastWS().drop(CLOSE_CODES['no-room']);
    expect(h.screen()).toBe('entry');
    expect(h.q('.pp-msg')!.textContent).toContain('見つかりません');
    expect(h.session.getItem('irori:resume:BCDF')).toBeNull();
  });

  it('replaced：案内と「ここで続ける」を出し、自動では入り直さない。押したときだけ入り直す', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.drop(CLOSE_CODES.replaced);
    expect(h.state()).toBe('replaced');
    comeBack();
    h.clock.advance(60_000);
    expect(FakeWS.all.length).toBe(1);
    // 札は残っている（同じ席を取り返すため）
    expect(h.session.getItem('irori:resume:BCDF')).toBe('TOKEN-1');
    h.click('[data-act="continue"]');
    expect(FakeWS.all.length).toBe(2);
    lastWS().accept();
    expect(lastWS().hello).toMatchObject({ resume: 'TOKEN-1' });
  });

  it('退出：bye を送ってから閉じ、札を捨てる。「もう一度入る」で新しく入る', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    h.clock.advance(1_000);
    const badge = h.q('[data-act="seat"]')!;
    pointer(badge, 'pointerdown');
    h.clock.advance(600);
    expect(h.q('.pp-menu')!.hidden).toBe(false);
    h.clock.advance(400); // 開いた直後の指の離しは無視する時間
    h.click('[data-act="leave"]');
    expect(ws.frames.some((f) => f.t === 'bye')).toBe(true);
    expect(ws.closedWith).not.toBeNull();
    expect(h.state()).toBe('left');
    expect(h.session.getItem('irori:resume:BCDF')).toBeNull();
    h.click('[data-act="rejoin"]');
    await settle();
    expect(FakeWS.all.length).toBe(2);
    lastWS().accept();
    expect(lastWS().hello).not.toHaveProperty('resume');
  });
});

describe('採点のあとの直し（入口・食い違い・待ち時間）', () => {
  it('右上の「…」は、ふつうのタップでメニューを開く。札の短いタップは「…」へ案内するだけ', async () => {
    const h = startApp({ hash: 'BCDF' });
    await joined(h);
    h.click('[data-act="seat"]');
    expect(h.q('.pp-menu')!.hidden).toBe(true);
    // 短いタップの案内（指の pointerdown → pointerup）
    const badge = h.q('[data-act="seat"]')!;
    pointer(badge, 'pointerdown');
    pointer(badge, 'pointerup');
    expect(h.q('.pp-toast')!.textContent).toBe('メニューは、右上の「…」から開けます。');
    h.click('[data-act="menu"]');
    expect(h.q('.pp-menu')!.hidden).toBe(false);
    expect(h.q('[data-act="menu"]')!.getAttribute('aria-label')).toBe('メニューを開く');
  });

  it('回数の上限で断られたら、「もう一度試す」は待ち時間のあいだ押せず、残りの秒数を減らす', async () => {
    const h = startApp();
    h.respond({ status: 429, body: { error: 'rate', retryAfterSec: 3 }, headers: { 'Retry-After': '3' } });
    const boxes = [...h.root.querySelectorAll<HTMLInputElement>('.pp-code__box')];
    for (const [i, c] of [...'BCDF'].entries()) {
      boxes[i]!.value = c;
      boxes[i]!.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await settle();
    const retry = h.q<HTMLButtonElement>('[data-act="retry"]')!;
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toBe('もう一度試す（あと3秒）');
    h.clock.advance(1_000);
    expect(retry.textContent).toBe('もう一度試す（あと2秒）');
    h.clock.advance(2_000);
    expect(retry.disabled).toBe(false);
    expect(retry.textContent).toBe('もう一度試す');
  });

  it('外されたときは「コードを入れ直す」だけを出す（すぐ戻れるボタンは置かない）。取って代わられたときも、続けない道がある', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.message({ t: 'kicked' });
    const buttons = [...h.root.querySelectorAll('[data-state="kicked"] button')];
    expect(buttons.map((b) => b.getAttribute('data-act'))).toEqual(['reenter']);
    expect(buttons[0]!.classList.contains('pp-btn--primary')).toBe(true);
    expect(buttons[0]!.textContent).toBe('コードを入れ直す');
    expect(h.q('[data-state="kicked"] .pp-lead')!.textContent).toBe('大きな画面の人に声をかけてから、コードを入れ直してください。');
    h.click('[data-state="kicked"] .pp-btn--primary');
    expect(h.screen()).toBe('entry');

    const h2 = startApp({ hash: 'BCDF' });
    await joined(h2);
    lastWS().drop(CLOSE_CODES.replaced);
    expect(h2.q('[data-state="replaced"] [data-act="reenter"]')).not.toBeNull();
  });

  it('部屋を確かめている間も「やめる」でコードの入力に戻れる', async () => {
    const h = startApp({ hash: 'BCDF' });
    expect(h.screen()).toBe('checking');
    h.click('[data-act="cancel"]');
    expect(h.screen()).toBe('entry');
    await settle();
    // 返事が遅れて届いても、入力の画面のまま
    expect(h.screen()).toBe('entry');
  });

  it('名前の欄のすぐ下の一文は、空なら「空のままなら…」、入れたら「この名前で出ます」に替わる（場所は残る）', async () => {
    const h = startApp({ hash: 'BCDF' });
    await settle();
    const name = h.q<HTMLInputElement>('#pp-name')!;
    const empty = h.q('#pp-name-empty')!;
    expect(name.nextElementSibling).toBe(empty);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('空のままなら「プレイヤー3」のように呼ばれます。');
    name.value = 'た';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('大きな画面には、この名前で出ます。');
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(empty.textContent).toBe('空のままなら「プレイヤー3」のように呼ばれます。');
  });

  it('自分で出たあとは、主に「同じ部屋にもう一度入る」、副に「別の部屋のコードを入れる」を出す', async () => {
    const h = startApp({ hash: 'BCDF' });
    await joined(h);
    h.click('[data-act="menu"]');
    h.clock.advance(400); // 開いた直後の誤タップよけが過ぎてから押す
    h.click('[data-act="leave"]');
    expect(h.state()).toBe('left');
    const buttons = [...h.root.querySelectorAll<HTMLButtonElement>('[data-state="left"] button')];
    expect(buttons.map((b) => [b.getAttribute('data-act'), b.textContent, b.classList.contains('pp-btn--primary')])).toEqual([
      ['rejoin', '同じ部屋にもう一度入る', true],
      ['reenter', '別の部屋のコードを入れる', false],
    ]);
  });
});

describe('ソフトキーボード（見える高さ）', () => {
  it('見える高さ（visualViewport）が変わったら、その高さと位置を --vvh・--vvt で画面へ渡す（iOS はキーボードで画面の高さが変わらない）', () => {
    const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    const had = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    try {
      startApp();
      const root = document.documentElement;
      expect(root.style.getPropertyValue('--vvh')).toBe('844px');
      vv.height = 420;
      vv.offsetTop = 12;
      vv.dispatchEvent(new Event('resize'));
      expect(root.style.getPropertyValue('--vvh')).toBe('420px');
      expect(root.style.getPropertyValue('--vvt')).toBe('12px');
      vv.height = 380;
      vv.dispatchEvent(new Event('scroll'));
      expect(root.style.getPropertyValue('--vvh')).toBe('380px');
    } finally {
      if (had) Object.defineProperty(window, 'visualViewport', had);
      else delete (window as { visualViewport?: unknown }).visualViewport;
      document.documentElement.style.removeProperty('--vvh');
      document.documentElement.style.removeProperty('--vvt');
    }
  });
});

describe('待ちの画面の自分の印', () => {
  it('大きな形には「あなたの印」と添える（見出しの別の人の名前と取り違えない）。読み上げからは外す', async () => {
    const h = startApp({ hash: 'BCDF' });
    const ws = await joined(h);
    ws.pad({ k: 'wait', title: 'たろうが選んでいます', body: '大きな画面を見てね' } as PadSpec);
    const you = h.q('.irori-pad__wait .pp-wait-you')!;
    expect(you.textContent).toBe('あなたの印');
    expect(you.getAttribute('aria-hidden')).toBe('true');
    // 同じ画面を描き直しても、添え書きは1つだけ。
    ws.pad({ k: 'wait', title: 'はなこが選んでいます', body: '大きな画面を見てね' } as PadSpec);
    expect(h.root.querySelectorAll('.pp-wait-you').length).toBe(1);
    expect(h.q('.irori-pad__wait')!.textContent).toContain('はなこが選んでいます');
  });
});
