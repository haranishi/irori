import { describe, expect, it, vi } from 'vitest';
import { SOUND_MAX_S, SOUND_VOLUME, Sounds, type SoundName } from '../../src/host/audio';
import { WakeKeeper } from '../../src/host/wake';
import { FakeDoc } from './fakes';

// WebAudio の作り物：作られた音源の、鳴り始めと止める時刻、音量の山の終わりを記録する。
class Param {
  value = 0;
  readonly ramps: { v: number; t: number }[] = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.ramps.push({ v, t });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.ramps.push({ v, t });
  }
}
class Node {
  connect<T>(n: T): T {
    return n;
  }
}
class Source extends Node {
  type = '';
  buffer: unknown = null;
  frequency = new Param();
  start = vi.fn();
  stop = vi.fn();
}
class Gain extends Node {
  gain = new Param();
}
class Filter extends Node {
  type = '';
  frequency = new Param();
  Q = new Param();
}
class Ctx extends EventTarget {
  static last: Ctx | null = null;
  state: AudioContextState = 'suspended';
  currentTime = 5;
  sampleRate = 48_000;
  destination = new Node();
  readonly sources: Source[] = [];
  readonly gains: Gain[] = [];
  constructor() {
    super();
    Ctx.last = this;
  }
  createGain() {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createBufferSource() {
    return this.createOscillator();
  }
  createBiquadFilter() {
    return new Filter();
  }
  createBuffer(_ch: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }
  resume() {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
    return Promise.resolve();
  }
}

const NAMES: SoundName[] = ['move', 'decide', 'back', 'join', 'start', 'result'];

describe('合成の音（6つ・250ms以内・音量0.25・最初の操作のあと）', () => {
  it('最初の操作の前は鳴らさず、案内が要る。unlock のあとは鳴らせる', async () => {
    Ctx.last = null;
    const s = new Sounds(Ctx as unknown as new () => AudioContext);
    expect(s.needsGesture).toBe(true);
    s.play('decide');
    expect(Ctx.last).toBeNull();
    s.unlock();
    await Promise.resolve();
    expect(s.unlocked).toBe(true);
    expect(s.needsGesture).toBe(false);
    const made = Ctx.last as Ctx | null;
    expect(made?.gains[0]?.gain.value).toBe(SOUND_VOLUME);
  });

  it('6つの音は、どれも250ms以内に消え、止める', async () => {
    const s = new Sounds(Ctx as unknown as new () => AudioContext);
    s.unlock();
    await Promise.resolve();
    const ctx = Ctx.last as Ctx;
    for (const name of NAMES) {
      const firstSource = ctx.sources.length;
      const firstGain = ctx.gains.length;
      s.play(name);
      const sources = ctx.sources.slice(firstSource);
      expect(sources.length, name).toBeGreaterThan(0);
      for (const src of sources) {
        const stopAt = src.stop.mock.calls[0]?.[0] as number;
        expect(stopAt - ctx.currentTime, name).toBeLessThanOrEqual(SOUND_MAX_S + 0.011);
      }
      // 音量の山が消える（0.0001 まで下がる）時刻は、250ms以内。
      for (const g of ctx.gains.slice(firstGain)) {
        const end = Math.max(...g.gain.ramps.map((r) => r.t));
        expect(end - ctx.currentTime, name).toBeLessThanOrEqual(SOUND_MAX_S + 0.001);
      }
    }
  });

  it('音をオフにすると鳴らさない。オンに戻すと鳴る', async () => {
    const s = new Sounds(Ctx as unknown as new () => AudioContext);
    s.unlock();
    await Promise.resolve();
    const ctx = Ctx.last as Ctx;
    s.setOn(false);
    expect(s.needsGesture).toBe(false);
    const before = ctx.sources.length;
    s.play('move');
    expect(ctx.sources.length).toBe(before);
    s.setOn(true);
    s.play('move');
    expect(ctx.sources.length).toBeGreaterThan(before);
  });

  it('音の出せない環境（AudioContext がない）でも、案内も例外も出さない', () => {
    const s = new Sounds(undefined);
    expect(s.needsGesture).toBe(false);
    s.unlock();
    s.play('start');
  });
});

describe('画面の消灯を防ぐ（Wake Lock）', () => {
  function setup() {
    const released: string[] = [];
    let seq = 0;
    const request = vi.fn(async () => {
      const id = `s${++seq}`;
      const t = new EventTarget() as EventTarget & { released: boolean; release(): Promise<void> };
      t.released = false;
      t.release = async () => {
        t.released = true;
        released.push(id);
        t.dispatchEvent(new Event('release'));
      };
      return t;
    });
    const doc = new FakeDoc();
    const keeper = new WakeKeeper({ wakeLock: { request } } as never, doc as unknown as Document);
    return { keeper, request, released, doc };
  }

  it('部屋があるあいだ取り、画面が裏に回って放されたら、見えたときに取り直す', async () => {
    const { keeper, request, doc } = setup();
    keeper.want(true);
    await vi.waitFor(() => expect(keeper.held).toBe(true));
    expect(request).toHaveBeenCalledWith('screen');
    // ブラウザが裏に回ったときに放す（release の知らせ）。
    const first = await request.mock.results[0]?.value;
    await first.release();
    expect(keeper.held).toBe(false);
    doc.hide();
    doc.show();
    await vi.waitFor(() => expect(keeper.held).toBe(true));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('部屋がなくなったら放す。取れないブラウザでは何もしない', async () => {
    const { keeper, released } = setup();
    keeper.want(true);
    await vi.waitFor(() => expect(keeper.held).toBe(true));
    keeper.want(false);
    await vi.waitFor(() => expect(released).toHaveLength(1));
    const none = new WakeKeeper({} as never, new FakeDoc() as unknown as Document);
    none.want(true);
    await none.acquire();
    expect(none.held).toBe(false);
  });
});
