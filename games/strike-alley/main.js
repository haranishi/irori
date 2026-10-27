// @ts-check
// SDK との接続と、効果（pad・cue・vibrate・end）の実行、再生の時計。規則は logic.js、描画は view.js。
// 再生の時計は performance.now() 同士で測り、一時停止の間は止める。投げた結果は logic.js が先に決めているので、
// 描くのが遅くても、再生にかかる実時間が同じになるだけで、倒れる本数は変わらない。
import { connect } from './irori.js';
import { createGame, publicView, updateGame } from './logic.js';
import { createView } from './view.js';

/** 字幕を見せる時間（ミリ秒）。大きな出来事ほど長く。 */
const HOLD = { strike: 2100, spare: 1800, gutter: 1600, miss: 1400, pins: 1400 };
/** ストライクの瞬間の静止（実時間）。 */
const HIT_STOP_MS = 90;

const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const view = createView({ stage, status });

/** 一時停止で止まる時計。 */
function createClock() {
  let offset = 0;
  /** @type {number|null} */
  let pausedAt = null;
  return {
    now() {
      return (pausedAt ?? performance.now()) - offset;
    },
    /** @param {boolean} stop */
    hold(stop) {
      if (stop && pausedAt === null) pausedAt = performance.now();
      if (!stop && pausedAt !== null) {
        offset += performance.now() - pausedAt;
        pausedAt = null;
      }
    },
  };
}

/**
 * 再生の位置。打った瞬間の静止は、最後に頼まれた1回だけが、決めた時刻に戻す（重ねて伸びない）。
 * @param {number} start
 */
function createReplay(start) {
  let frozen = 0;
  let stopFrom = 0;
  let stopUntil = 0;
  return {
    /** @param {number} now */
    time(now) {
      if (stopUntil && now >= stopUntil) {
        frozen += stopUntil - stopFrom;
        stopFrom = 0;
        stopUntil = 0;
      }
      return now - start - frozen - (stopUntil ? now - stopFrom : 0);
    },
    /** @param {number} now @param {number} ms */
    stop(now, ms) {
      if (stopUntil) frozen += Math.min(now, stopUntil) - stopFrom;
      stopFrom = now;
      stopUntil = now + ms;
    },
  };
}

async function boot() {
  const irori = await connect();
  if (!irori.capabilities.includes('result-options-v1') || !irori.capabilities.includes('host-environment-v1')) {
    view.showMessage('もう少しで遊べます', 'iroriを新しくして開き直してね');
    document.documentElement.dataset.phase = 'unsupported';
    irori.setPad({ k: 'wait', title: '更新が必要です', body: 'iroriを新しくして開き直してね' });
    irori.ready();
    return;
  }
  /** @type {Map<number, import('./irori.js').Look>} */
  const looks = new Map(irori.players.map((p) => [p.id, irori.look(p.id)]));
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  const first = createGame({ players: irori.players, leader: irori.leader, environment: irori.environment, paused: irori.paused, nonce });
  /** @type {import('./logic.js').GameState|null} */
  let state = first.state;
  let model = publicView(state);
  const clock = createClock();
  /** @type {{id: number, replay: ReturnType<typeof createReplay>, hitAt: number|null, gutterDone: boolean}|null} */
  let rolling = null;
  /** @type {{id: number, at: number}|null} */
  let settled = null;
  let raf = 0;
  let disposed = false;
  /** @type {(() => void)[]} */
  const subscriptions = [];

  /** cue の無い古い SDK や、cue-v1 の無いホストでも、止まらずに無音で続ける。 @param {import('./logic.js').CueName} name @param {number} v */
  function cue(name, v) {
    try {
      irori.cue?.(name, Math.max(0, Math.min(1, v)));
    } catch {
      // 能力の無いホストでは何もしない。
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    for (const off of subscriptions.splice(0)) off();
    removeEventListener('pagehide', dispose);
    state = null;
    view.dispose();
  }

  /** @param {readonly import('./logic.js').GameEffect[]} effects */
  function apply(effects) {
    for (const effect of effects) {
      if (disposed) return;
      try {
        if (effect.t === 'pad') irori.setPad(effect.spec, effect.to);
        else if (effect.t === 'vibrate') irori.vibrate(effect.ms, effect.to);
        else if (effect.t === 'cue') cue(effect.name, effect.v);
        else {
          // 結果画面へ移る前に、最後の字幕と得点表を一度描いておく。
          dispose();
          irori.end(effect.results, effect.options);
        }
      } catch (err) {
        // 1つの効果の失敗で、進行を止めない。
        console.warn('strike-alley: effect failed', effect.t, err);
      }
    }
  }

  /** @param {import('./logic.js').GameEvent} event */
  function dispatch(event) {
    if (!state || disposed) return;
    const next = updateGame(state, event);
    if (next.state === state && next.effects.length === 0) return;
    state = next.state;
    model = publicView(state);
    clock.hold(model.blockers.length > 0);
    view.update(model, looks);
    apply(next.effects);
  }

  /** 再生と字幕の進み。描くたびに見て、時刻が来たら logic.js へ知らせる。 */
  function direct() {
    const now = clock.now();
    let replayMs = 0;
    /** @type {number|null} */
    let sinceHit = null;
    const roll = model.roll;
    if (model.phase === 'rolling' && roll && !model.blockers.length) {
      if (rolling?.id !== roll.id) rolling = { id: roll.id, replay: createReplay(now), hitAt: null, gutterDone: false };
      replayMs = rolling.replay.time(now);
      const result = roll.result;
      if (rolling.hitAt === null && result.hitMs !== null && replayMs >= result.hitMs) {
        rolling.hitAt = now;
        if (roll.knocked > 0) cue('pins', roll.knocked / 10);
        if (roll.kind === 'strike' && !view.reduced()) {
          rolling.replay.stop(now, HIT_STOP_MS);
          replayMs = rolling.replay.time(now);
        }
      }
      if (!rolling.gutterDone && result.gutter && result.gutterMs !== null && replayMs >= result.gutterMs) {
        rolling.gutterDone = true;
        cue('gutter', 0.7);
      }
      if (replayMs >= result.durationMs) dispatch({ t: 'settled', id: roll.id });
    } else if (model.phase === 'rolling' && roll && rolling?.id === roll.id) {
      replayMs = rolling.replay.time(now);
    }
    if (rolling && roll && rolling.id === roll.id && rolling.hitAt !== null) sinceHit = now - rolling.hitAt;
    if (model.phase === 'settled' && roll && !model.blockers.length) {
      if (settled?.id !== roll.id) settled = { id: roll.id, at: now };
      if (now - settled.at >= HOLD[roll.kind]) dispatch({ t: 'next', id: roll.id });
    }
    return { now, replayMs, sinceHit };
  }

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const timing = direct();
    if (!disposed) view.draw(timing);
  }

  subscriptions.push(
    irori.on('input', (p, input) => dispatch({ t: 'input', p, input })),
    irori.on('players', (players, leader) => {
      for (const p of players) if (!looks.has(p.id)) looks.set(p.id, irori.look(p.id));
      dispatch({ t: 'players', players, leader });
    }),
    irori.on('pause', () => dispatch({ t: 'menu', paused: true })),
    irori.on('resume', () => dispatch({ t: 'menu', paused: false })),
    irori.on('environment', (value) => dispatch({ t: 'environment', value })),
  );
  addEventListener('pagehide', dispose, { once: true });
  clock.hold(model.blockers.length > 0);
  view.update(model, looks);
  apply(first.effects);
  irori.ready();
  raf = requestAnimationFrame(frame);
}

void boot().catch(() => {
  view.showMessage('つながりませんでした', 'ゲームを開き直してください');
  document.documentElement.dataset.phase = 'error';
});
