import { midiOf, hzToMidi } from './music.js';

// Listens to the microphone and judges right-hand events:
//   - onsets (a string was struck) from spectral flux / level jumps,
//   - single notes by pitch (YIN), compared by pitch class so octave slips don't count as misses,
//   - chords by a 12-bin chroma profile compared to the expected chord.
export class MicJudge {
  constructor(ctx) {
    this.ctx = ctx;
    this.frames = [];
    this.noise = 0.004;
    this.slowRms = 0;
    this.fluxAvg = 0;
    this.lastOnset = -1;
    this.level = 0;
    this.pitch = 0;
    this.latency = 0.06;
    this.checkPitch = true;
    this.active = false;
  }

  // input: optional AudioNode to listen to instead of the microphone (used by ?selftest).
  async start(input) {
    let src = input;
    if (!src) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      src = this.ctx.createMediaStreamSource(this.stream);
    }
    this.fast = this.ctx.createAnalyser();
    this.fast.fftSize = 2048;
    this.fast.smoothingTimeConstant = 0;
    this.slow = this.ctx.createAnalyser();
    this.slow.fftSize = 8192;
    this.slow.smoothingTimeConstant = 0;
    src.connect(this.fast);
    src.connect(this.slow);
    this.src = src;
    this.td = new Float32Array(this.fast.fftSize);
    this.fd = new Float32Array(this.fast.frequencyBinCount);
    this.prevMag = new Float32Array(this.fast.frequencyBinCount).fill(-90);
    this.sfd = new Float32Array(this.slow.frequencyBinCount);
    this.active = true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.src?.disconnect(this.fast);
    this.src?.disconnect(this.slow);
    this.active = false;
    this.frames = [];
  }

  update(t) {
    if (!this.active) return;
    const sr = this.ctx.sampleRate;
    this.fast.getFloatTimeDomainData(this.td);
    let sum = 0;
    for (let i = 0; i < this.td.length; i++) sum += this.td[i] * this.td[i];
    const rms = Math.sqrt(sum / this.td.length);

    this.fast.getFloatFrequencyData(this.fd);
    const top = Math.min(this.fd.length, Math.floor(6000 / (sr / this.fast.fftSize)));
    let flux = 0;
    // Log-magnitude flux, so a quiet treble note over a loud ringing bass still registers.
    for (let k = 2; k < top; k++) {
      const db = Math.max(this.fd[k], -90);
      const d = db - this.prevMag[k];
      if (d > 0) flux += d;
      this.prevMag[k] = db;
    }
    flux /= top;

    if (rms < this.noise) this.noise = rms;
    else this.noise += (rms - this.noise) * 0.002;
    const gate = rms > Math.max(this.noise * 2.5, 0.004);

    let onset = false;
    if (gate && t - this.lastOnset > 0.09) {
      if (flux > this.fluxAvg * 1.8 || rms > this.slowRms * 1.4) {
        onset = true;
        this.lastOnset = t;
      }
    }
    this.fluxAvg += (flux - this.fluxAvg) * 0.1;
    this.slowRms += (rms - this.slowRms) * 0.1;

    const pitch = gate ? yin(this.td, sr) : 0;
    let chroma = null;
    if (gate) {
      this.slow.getFloatFrequencyData(this.sfd);
      chroma = new Float32Array(12);
      const bin = sr / this.slow.fftSize;
      for (let k = Math.ceil(95 / bin); k < Math.min(this.sfd.length, 1500 / bin); k++) {
        const pc = ((Math.round(hzToMidi(k * bin)) % 12) + 12) % 12;
        chroma[pc] += Math.pow(10, this.sfd[k] / 20);
      }
    }

    this.level = rms;
    this.pitch = pitch;
    this.frames.push({ t, rms, flux, onset, pitch, chroma });
    while (this.frames.length && this.frames[0].t < t - 3) this.frames.shift();
  }

  // expected: AudioContext time at which the event should be heard.
  judge(ev, expected) {
    const at = expected + this.latency;
    const candidates = this.frames
      .filter((f) => f.onset && Math.abs(f.t - at) <= 0.16)
      .sort((a, b) => Math.abs(a.t - at) - Math.abs(b.t - at));
    if (!candidates.length) return { grade: 'miss' };
    // A strum can trigger more than one onset: take the closest one that has the right notes.
    const hit = this.checkPitch ? candidates.find((f) => this.pitchMatches(ev, f.t)) : candidates[0];
    if (!hit) return { grade: 'wrong', dt: candidates[0].t - at };
    const dt = hit.t - at;
    return { grade: Math.abs(dt) < 0.07 ? 'perfect' : 'good', dt };
  }

  // Judge once every frame needed for this event has been captured.
  readyAt(expected) {
    return expected + this.latency + 0.34;
  }

  pitchMatches(ev, onsetT) {
    const win = this.frames.filter((f) => f.t >= onsetT + 0.02 && f.t <= onsetT + 0.17 && f.chroma);
    if (!win.length) return false;
    // Other strings may still be ringing, so also look at what got louder at the onset.
    const before = this.frames.filter((f) => f.t >= onsetT - 0.12 && f.t < onsetT && f.chroma);
    const now = new Float32Array(12), rise = new Float32Array(12);
    for (const f of win) for (let k = 0; k < 12; k++) now[k] += f.chroma[k] / win.length;
    for (let k = 0; k < 12; k++) rise[k] = now[k];
    for (const f of before) for (let k = 0; k < 12; k++) rise[k] -= f.chroma[k] / before.length;
    for (let k = 0; k < 12; k++) rise[k] = Math.max(0, rise[k]);

    if (ev.kind === 'pick') {
      const s = ev.strings[0];
      const want = midiOf(s, ev.frets[s]);
      const voiced = win.filter((f) => f.pitch > 0);
      const hits = voiced.filter((f) => {
        let d = (((hzToMidi(f.pitch) - want) % 12) + 12) % 12;
        d = Math.min(d, 12 - d);
        return d < 0.6;
      });
      if (hits.length > 0 && hits.length >= voiced.length * 0.34) return true;
      const peak = Math.max(...rise);
      return peak > 0 && rise[want % 12] >= peak * 0.6;
    }
    const tmpl = new Float32Array(12);
    for (const s of ev.strings) {
      const f = ev.frets[s];
      if (f != null && f >= 0) tmpl[midiOf(s, f) % 12] += 1;
    }
    const sim = Math.max(cosine(now, tmpl), cosine(rise, tmpl));
    return sim >= (ev.dir === 'U' ? 0.5 : 0.6);
  }
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let k = 0; k < a.length; k++) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

// YIN pitch detector; returns Hz or 0.
function yin(buf, sr) {
  const minLag = Math.floor(sr / 1100);
  const maxLag = Math.min(Math.floor(sr / 70), Math.floor(buf.length / 2));
  const w = buf.length - maxLag;
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  let running = 0;
  let tau = -1;
  for (let k = 1; k <= maxLag; k++) {
    running += d[k];
    d[k] = (d[k] * k) / (running || 1);
    if (tau < 0 && k >= minLag && d[k] < 0.15) tau = k;
    if (tau > 0 && k > tau) {
      if (d[k] < d[tau]) tau = k; else break;
    }
  }
  if (tau < 0) return 0;
  const a = d[tau - 1], b = d[tau], c = tau + 1 <= maxLag ? d[tau + 1] : b;
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (tau + (Math.abs(shift) < 1 ? shift : 0));
}
