import { midiOf, midiToHz } from './music.js';

// Plucked-string synth (Karplus–Strong) used as the "play along" guide, plus a metronome.
export class GuitarAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 190;
    body.Q.value = 1.2;
    body.gain.value = 5;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    const comp = ctx.createDynamicsCompressor();
    body.connect(tone).connect(comp).connect(ctx.destination);

    this.guide = ctx.createGain();
    this.guide.gain.value = 0.9;
    this.guide.connect(body);
    this.clicks = ctx.createGain();
    this.clicks.gain.value = 0.5;
    this.clicks.connect(comp);

    this.buffers = new Map();
    this.voices = new Array(6).fill(null);
    this.live = new Set();
  }

  resume() {
    return this.ctx.resume();
  }

  buffer(midi) {
    if (this.buffers.has(midi)) return this.buffers.get(midi);
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 3);
    const buf = this.ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    // One period is n samples of delay, plus half a sample from the two-point average, plus a
    // fractional delay from a first-order allpass, so the note is in tune to a fraction of a cent.
    const period = sr / midiToHz(midi);
    const n = Math.max(2, Math.floor(period - 0.6));
    const frac = period - 0.5 - n; // 0.1 .. 1.1: where the allpass is flattest
    const c = (1 - frac) / (1 + frac);
    const init = Math.min(len, n + 1);
    let prev = 0, mean = 0;
    for (let i = 0; i < init; i++) {
      prev = prev * 0.45 + (Math.random() * 2 - 1) * 0.55;
      out[i] = prev;
      mean += prev / init;
    }
    let peak = 0;
    for (let i = 0; i < init; i++) {
      out[i] -= mean;
      peak = Math.max(peak, Math.abs(out[i]));
    }
    let apIn = 0, apOut = 0;
    for (let i = init; i < len; i++) {
      const x = 0.996 * 0.5 * (out[i - n] + out[i - n - 1]);
      apOut = c * x + apIn - c * apOut;
      apIn = x;
      out[i] = apOut;
      peak = Math.max(peak, Math.abs(apOut));
    }
    const fade = Math.floor(sr * 0.2);
    for (let i = 0; i < len; i++) {
      out[i] /= peak || 1;
      if (i > len - fade) out[i] *= (len - i) / fade;
    }
    this.buffers.set(midi, buf);
    return buf;
  }

  track(src) {
    this.live.add(src);
    src.onended = () => this.live.delete(src);
  }

  pluck(string, midi, time, velocity) {
    const ctx = this.ctx;
    const at = Math.max(time, ctx.currentTime);
    const prev = this.voices[string];
    if (prev) {
      prev.gain.gain.setTargetAtTime(0, at, 0.015);
      try { prev.src.stop(at + 0.2); } catch { /* already stopped */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(midi);
    const gain = ctx.createGain();
    gain.gain.value = velocity;
    src.connect(gain).connect(this.guide);
    src.start(at);
    this.track(src);
    this.voices[string] = { src, gain };
  }

  playEvent(ev, time) {
    const gap = ev.kind === 'strum' ? 0.014 : 0;
    const vel = ev.kind === 'pick' ? 0.8 : ev.dir === 'U' ? 0.4 : 0.55;
    ev.strings.forEach((s, k) => {
      const f = ev.frets[s];
      if (f == null || f < 0) return;
      this.pluck(s, midiOf(s, f), time + k * gap, vel);
    });
  }

  click(time, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1100;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.5, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(g).connect(this.clicks);
    osc.start(time);
    osc.stop(time + 0.08);
    this.track(osc);
  }

  stopAll() {
    for (const src of this.live) {
      try { src.stop(); } catch { /* not started */ }
    }
    this.live.clear();
    this.voices.fill(null);
  }
}
