// パッドのDOMだけを見る。ゲームのモデルや非公開の手札には触れない。
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** opacity で撮影から除いたパッドも、元のレイアウトと有効状態で選ぶ。 */
export function driveDom({ randoms, tick, touch, buttons = true, prefer = [], passChance = 0.12, singleSeat = false }) {
  let ri = 0;
  const random = () => randoms[ri++ % randoms.length];
  const usable = (e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true'
    && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
  const choose = (xs) => xs[Math.floor(random() * xs.length)];
  const click = (e) => { if (e && usable(e)) { e.click(); return 1; } return 0; };
  const pointer = (el, type, x, y, id) => {
    const b = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch',
      clientX: b.left + b.width * x, clientY: b.top + b.height * y,
      buttons: type === 'pointerup' ? 0 : 1 }));
  };
  let actions = 0;
  for (const seat of document.querySelectorAll('.irori-mock__seat')) {
    const pad = seat.querySelector('.irori-pad');
    if (!pad || pad.dataset.kind === 'wait') continue;
    const id = Number(seat.dataset.p) + 20;
    const tiles = [...pad.querySelectorAll('.irori-pad__tile')].filter(usable);
    const ok = pad.querySelector('[data-action="ok"]');
    const pass = pad.querySelector('[data-action="pass"]');
    if (pad.dataset.kind === 'tiles') {
      if (pass && usable(pass) && random() < passChance) actions += click(pass);
      else {
        if (tiles.length) actions += click(choose(tiles));
        actions += click(ok);
      }
      if (singleSeat && actions) break;
      continue;
    }
    const surface = pad.querySelector('.irori-pad__touch, .irori-pad__stick, .irori-pad__dpad');
    if (surface && usable(surface)) {
      if (pad.dataset.kind === 'touch') {
        const from = touch?.from ?? [0.15 + random() * 0.7, 0.15];
        const to = touch?.to ?? [0.15 + random() * 0.7, 0.8];
        pointer(surface, 'pointerdown', ...from, id);
        for (let n = 1; n <= 12; n++) pointer(surface, 'pointermove',
          from[0] + (to[0] - from[0]) * n / 12, from[1] + (to[1] - from[1]) * n / 12, id);
        pointer(surface, 'pointerup', ...to, id);
      } else {
        // 押したまま方向を変える。毎回離すと、移動量が1フレーム未満になる。
        const angle = tick * 0.48 + id * 1.7;
        pointer(surface, 'pointerdown', 0.5, 0.5, id);
        pointer(surface, 'pointermove', 0.5 + Math.cos(angle) * 0.43, 0.5 + Math.sin(angle) * 0.43, id);
      }
      actions++;
    }
    if (!buttons) continue;
    const candidates = [...pad.querySelectorAll('button:not(.irori-pad__arrow)')].filter(usable)
      .filter((e) => !/おわる|終了|退出|やめる/.test(e.textContent));
    const preferred = prefer.flatMap((text) => candidates.filter((e) => e.textContent === text));
    if (candidates.length) actions += click(choose(preferred.length ? preferred : candidates));
    if (singleSeat && actions) break;
  }
  return { actions, phase: document.documentElement.dataset.phase ?? 'play' };
}

export async function step(page, rng, tick, options = {}) {
  return page.evaluate(driveDom, { randoms: Array.from({ length: 64 }, rng), tick, ...options });
}
