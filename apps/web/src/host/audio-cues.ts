// @ts-check
// cue-v1 の合成。振動子・雑音・フィルタ・包絡だけを使う。外部素材は持たない。
import type { CueName } from '@irori/protocol';

export const CUE_MAX_S = 1.5;
type Voice = { at: number; f: number; end?: number; dur: number; gain: number; kind: OscillatorType | 'noise' };

/** 実時間とOfflineAudioContextで同じ音を描く。強さ0は完全な無音。 */
export function synthesizeCue(ctx: BaseAudioContext, out: AudioNode, name: CueName, v: number): void {
  if (!Number.isFinite(v) || v <= 0) return;
  v = Math.min(1, v);
  const voices: Voice[] = [];
  const tone = (f: number, dur: number, at = 0, end?: number, kind: OscillatorType = 'sine', gain = 1) =>
    voices.push({ at, f, dur, gain, kind, ...(end === undefined ? {} : { end }) });
  const noise = (f: number, dur: number, at = 0, gain = 1) => voices.push({ at, f, dur, gain, kind: 'noise' });
  const bell = (f: number, dur: number, at = 0) => { tone(f, dur, at); tone(f * 2.76, dur * 0.6, at, undefined, 'sine', 0.18); };
  switch (name) {
    case 'tick': tone(1800, 0.025); break;
    case 'confirm': tone(660, 0.12); tone(990, 0.16, 0.09); break;
    case 'deny': tone(110, 0.22, 0, 85, 'square'); break;
    case 'turn': bell(520, 0.36); break;
    case 'win': [520, 660, 790].forEach((f, i) => bell(f, 0.27, i * 0.13)); break;
    case 'lose': tone(440, 0.45, 0, 140); break;
    case 'count': tone(600, 0.09); break;
    case 'go': tone(1200, 0.19); break;
    case 'deal': noise(1800, 0.09); break;
    case 'flip': noise(3000, 0.14); break;
    case 'place': noise(900, 0.07); tone(220, 0.07); break;
    case 'sweep': noise(2200, 0.34); break;
    case 'revolution': tone(110, 0.85, 0, 620, 'sawtooth'); break;
    case 'roll': noise(160, 1.1); tone(65, 1.05, 0, 45); break;
    case 'pins': {
      const count = 2 + Math.round(v * 8);
      noise(800, 0.12 + v * 0.16);
      for (let i = 0; i < count; i++) noise(1200 + i * 180, 0.05 + v * 0.09, i * (0.025 + v * 0.04), 0.65);
      break;
    }
    case 'strike': noise(850, 0.2); [660, 880, 1100].forEach((f, i) => bell(f, 0.35, 0.12 + i * 0.12)); break;
    case 'spare': noise(950, 0.16); bell(660, 0.32, 0.12); bell(880, 0.35, 0.25); break;
    case 'gutter': noise(230, 0.14); tone(220, 0.4, 0.04, 60); break;
    case 'night': tone(80, 1.4, 0, 65); break;
    case 'dawn': bell(520, 0.5); bell(780, 0.55, 0.17); break;
    case 'vote': tone(150, 0.17, 0, 55); noise(350, 0.08); break;
    case 'execute': tone(90, 0.6, 0, 30); noise(220, 0.22); break;
    case 'reveal': [1000, 1400, 1800, 2200].forEach((f, i) => bell(f, 0.38, i * 0.09)); break;
  }
  // 全音源の振幅を加算しても余裕を残す。消音・既定音量のmasterはさらにこの下流にある。
  const scale = 0.5 * v / Math.max(1, voices.reduce((sum, voice) => sum + voice.gain, 0));
  const pitch = 0.97 + Math.random() * 0.06;
  const start = ctx.currentTime + 0.005;
  for (const voice of voices) {
    const t = start + voice.at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(scale * voice.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.00001, t + voice.dur - 0.005);
    g.gain.linearRampToValueAtTime(0, t + voice.dur);
    g.connect(out);
    let source: AudioScheduledSourceNode;
    if (voice.kind === 'noise') {
      const src = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * voice.dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = voice.f * pitch;
      filter.Q.value = 0.7;
      src.connect(filter).connect(g);
      source = src;
      source.onended = () => { source.disconnect(); filter.disconnect(); g.disconnect(); };
    } else {
      const osc = ctx.createOscillator();
      osc.type = voice.kind;
      osc.frequency.setValueAtTime(voice.f * pitch, t);
      if (voice.end !== undefined) osc.frequency.exponentialRampToValueAtTime(voice.end * pitch, t + voice.dur);
      osc.connect(g);
      source = osc;
      source.onended = () => { source.disconnect(); g.disconnect(); };
    }
    source.start(t);
    source.stop(t + voice.dur);
  }
}
