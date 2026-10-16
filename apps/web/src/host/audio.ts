// 効果音は WebAudio の合成だけ（音声ファイルは持たない。docs/identity.md「音」）。
// 6つ（移動・決定・戻る・参加・開始・結果）、どれも250ms以内、既定の音量は0.25。
// 木をたたく音（雑音を帯域で絞る）と、鈴のような音（基音と、少しずれた倍音）を組み合わせる。
// ブラウザは操作の前に音を止めるので、最初のキー・クリックの中で AudioContext を作って鳴らせるようにする。

export type SoundName = 'move' | 'decide' | 'back' | 'join' | 'start' | 'result';

export const SOUND_VOLUME = 0.25;
/** どの音も、この長さで終える（秒）。 */
export const SOUND_MAX_S = 0.25;

type Ctor = new () => AudioContext;

export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly ctor: Ctor | undefined = audioCtor()) {}

  get on(): boolean {
    return this.enabled;
  }

  /** 鳴らせる状態か（最初の操作のあと）。 */
  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** 鳴らせる状態でなく、音がオンのとき、案内を出す。 */
  get needsGesture(): boolean {
    return this.enabled && this.ctor !== undefined && !this.unlocked;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setOn(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.changed();
  }

  /** 利用者の操作（keydown・pointerdown）の中で呼ぶ。 */
  unlock(): void {
    if (!this.ctor) return;
    try {
      if (!this.ctx) {
        this.ctx = new this.ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = SOUND_VOLUME;
        this.master.connect(this.ctx.destination);
        this.ctx.addEventListener('statechange', () => this.changed());
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.changed(), () => undefined);
    } catch {
      // 音の出ない環境でも、画面は動かす。
    }
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!this.enabled || !ctx || !out || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'move':
        this.knock(t, 1900, 0.05, 0.55);
        this.tone(t, 880, 0.045, 0.18);
        break;
      case 'back':
        this.knock(t, 900, 0.09, 0.6);
        this.tone(t, 392, 0.09, 0.22, 294);
        break;
      case 'decide':
        this.bell(t, 659, 0.17, 0.5);
        this.bell(t + 0.06, 988, 0.17, 0.42);
        break;
      case 'join':
        this.bell(t, 523, 0.15, 0.45);
        this.bell(t + 0.08, 784, 0.16, 0.45);
        break;
      case 'start':
        [392, 523, 659, 784].forEach((f, i) => this.bell(t + i * 0.05, f, 0.09, 0.38));
        break;
      case 'result':
        for (const f of [523, 659, 784]) this.bell(t, f, SOUND_MAX_S - 0.01, 0.3, 0.02);
        break;
    }
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** 正弦波の短い音。end を渡すと、高さを滑らせる。 */
  private tone(t: number, freq: number, dur: number, gain: number, end?: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (end !== undefined) o.frequency.exponentialRampToValueAtTime(end, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master as GainNode);
    o.start(t);
    o.stop(t + dur + 0.01);
  }

  /** 鈴：基音に、2.76倍の少しずれた倍音を薄く重ねる。 */
  private bell(t: number, freq: number, dur: number, gain: number, attack = 0.003): void {
    const ctx = this.ctx as AudioContext;
    for (const [mult, share] of [
      [1, 1],
      [2.76, 0.18],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * mult, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * share, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (mult === 1 ? 1 : 0.6));
      o.connect(g).connect(this.master as GainNode);
      o.start(t);
      o.stop(t + dur + 0.01);
    }
  }

  /** 木をたたく音：雑音を狭い帯域に通して、すぐに減衰させる。 */
  private knock(t: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx as AudioContext;
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 0.12);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master as GainNode);
    src.start(t);
    src.stop(t + dur + 0.01);
  }
}

function audioCtor(): Ctor | undefined {
  const w = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
}
