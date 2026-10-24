import { midiOf, midiToHz, hzToMidi } from './music.js';

// Chord lessons: minimum similarity, lead over the closest other chord, level below which a
// string counts as silent (its fundamental, relative to the loudest string's), and how long to
// listen after a strum. tonal: share of the energy in the four loudest notes for a sound to count
// as a chord at all (noise spreads evenly, i.e. about 0.33).
export const LESSON = { sim: 0.75, margin: 0.02, missing: 0.05, wait: 0.62, tonal: 0.45 };
// Near twins (D / Dm, E / Em, A / Am) are told apart by the notes they differ in: one chord's notes
// must be this many times louder than the other's to settle it.
const DUEL = 2;
// The notes measured one by one at their exact pitch, as MIDI numbers: from below the low E up to
// past the high e at the 12th fret with a capo on the 7th.
const NOTE_LO = 36, NOTE_HI = 84;

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
    this.minRms = sensitivityToRms(5); // quieter strikes than this are ignored
  }

  // Sensitivity 1 (only loud strums count) .. 10 (very sensitive).
  setSensitivity(value) {
    this.minRms = sensitivityToRms(value);
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
    // Long window, used only by the lessons: fine enough to tell neighbouring low notes apart.
    this.fine = this.ctx.createAnalyser();
    this.fine.fftSize = 16384;
    this.fine.smoothingTimeConstant = 0;
    src.connect(this.fast);
    src.connect(this.slow);
    src.connect(this.fine);
    this.src = src;
    this.td = new Float32Array(this.fast.fftSize);
    this.fd = new Float32Array(this.fast.frequencyBinCount);
    this.prevMag = new Float32Array(this.fast.frequencyBinCount).fill(-90);
    this.sfd = new Float32Array(this.slow.frequencyBinCount);
    this.ffd = new Float32Array(this.fine.frequencyBinCount);
    this.active = true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.src?.disconnect(this.fast);
    this.src?.disconnect(this.slow);
    this.src?.disconnect(this.fine);
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
    if (gate && rms > this.minRms && t - this.lastOnset > 0.09) {
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

    let fine = null, notes = null;
    if (gate) {
      this.fine.getFloatFrequencyData(this.ffd);
      fine = new Float32Array(12);
      const bin = sr / this.fine.fftSize;
      for (let k = Math.ceil(75 / bin); k < Math.min(this.ffd.length, 1400 / bin); k++) {
        const pc = ((Math.round(hzToMidi(k * bin)) % 12) + 12) % 12;
        fine[pc] += Math.pow(10, this.ffd[k] / 20);
      }
      notes = this.noteLevels();
    }

    this.level = rms;
    this.pitch = pitch;
    this.frames.push({ t, rms, flux, onset, pitch, chroma, fine, notes });
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

  // Detailed check of a strummed chord, for the lessons. Needs LESSON.wait seconds of audio after
  // the onset. The chord passes if it matches well AND better than every other known chord
  // (candidates: { name: frets }), which is what tells apart near-twins like Em / E or Am / A.
  analyzeChord(onsetT, frets, candidates) {
    // The fine analyser looks 0.34 s back, so start late enough that the previous chord is out of view.
    const win = this.frames.filter((f) => f.t >= onsetT + 0.36 && f.t <= onsetT + LESSON.wait && f.fine);
    if (win.length < 2) return null;
    const avg = new Float32Array(12);
    for (const f of win) for (let k = 0; k < 12; k++) avg[k] += f.fine[k];
    const sim = cosine(avg, chordTemplate(frets));

    let rival = null, rivalSim = -1;
    for (const [name, other] of Object.entries(candidates)) {
      if (other.join() === frets.join()) continue;
      const c = cosine(avg, chordTemplate(other));
      if (c > rivalSim) { rival = name; rivalSim = c; }
    }

    const missing = this.silentStrings(frets, win);

    // Against a near twin, the notes the two chords differ in decide when they are clear-cut. Otherwise
    // the overall profile must lead by the margin.
    const duel = rival ? this.noteDuel(frets, candidates[rival], win) : null;
    const clear = duel != null && (duel >= DUEL || duel <= 1 / DUEL);
    const beatsRival = clear ? duel >= DUEL : sim - rivalSim >= LESSON.margin;
    const rivalWins = clear ? duel <= 1 / DUEL : rivalSim > sim;

    const ok = sim >= LESSON.sim && beatsRival && missing.length === 0;
    // Was this a chord at all? A strummed chord keeps ringing and puts most of its energy into a few
    // notes; a bump or a tap dies away quickly and spreads over all twelve.
    const ringing = win.reduce((sum, f) => sum + f.rms, 0) / win.length >= this.minRms * 0.4;
    const top4 = [...avg].sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0);
    const total = avg.reduce((a, b) => a + b, 0) || 1;
    const musical = ringing && top4 / total >= LESSON.tonal;
    return { ok: ok && musical, musical, tonality: top4 / total, sim, rival, rivalSim, rivalWins, missing };
  }

  // Amplitude of every note from NOTE_LO to NOTE_HI at its exact pitch in the fine spectrum (this.ffd).
  noteLevels() {
    const bin = this.ctx.sampleRate / this.fine.fftSize;
    const out = new Float32Array(NOTE_HI - NOTE_LO + 1);
    for (let m = NOTE_LO; m <= NOTE_HI; m++) {
      const hz = midiToHz(m);
      let peak = 0;
      for (let k = Math.floor((hz * 0.985) / bin); k <= Math.ceil((hz * 1.015) / bin); k++) {
        peak = Math.max(peak, Math.pow(10, this.ffd[k] / 20));
      }
      out[m - NOTE_LO] = peak;
    }
    return out;
  }

  // Loudness of a string's note over the frames, at its exact pitch.
  noteLevel(win, s, fret) {
    const i = midiOf(s, fret) - NOTE_LO;
    return win.reduce((sum, f) => sum + (f.notes?.[i] ?? 0), 0);
  }

  // Near twins differ in a note or two, often on a thin, quiet string that hardly moves the overall
  // profile (a D with a soft high e reads as Dm). So compare those notes directly: how many times louder
  // the expected chord's notes are than the other chord's. null unless both chords sound the same
  // strings and differ on at most two of them.
  noteDuel(frets, other, win) {
    const differ = [0, 1, 2, 3, 4, 5].filter((s) => frets[s] !== other[s]);
    if (!differ.length || differ.length > 2 || differ.some((s) => !(frets[s] >= 0) || !(other[s] >= 0))) return null;
    let mine = 1e-9, theirs = 1e-9;
    for (const s of differ) {
      mine += this.noteLevel(win, s, frets[s]);
      theirs += this.noteLevel(win, s, other[s]);
    }
    return mine / theirs;
  }

  // Strings whose fundamental is (nearly) absent. A string is only blamed when no other string has
  // an overtone on the same frequency.
  silentStrings(frets, win) {
    const sounding = [0, 1, 2, 3, 4, 5].filter((s) => frets[s] >= 0);
    const amps = Object.fromEntries(sounding.map((s) => [s, this.noteLevel(win, s, frets[s])]));
    const ref = Math.max(...Object.values(amps)) || 1;
    const f0 = Object.fromEntries(sounding.map((s) => [s, midiToHz(midiOf(s, frets[s]))]));
    const masked = (s) => sounding.some((o) => o !== s && [1, 2, 3, 4, 5, 6].some((h) => Math.abs((f0[o] * h) / f0[s] - 1) < 0.02));
    return sounding.filter((s) => amps[s] < LESSON.missing * ref && !masked(s));
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
    const tmpl = chordTemplate(ev.frets, ev.strings);
    const sim = Math.max(cosine(now, tmpl), cosine(rise, tmpl));
    return sim >= (ev.dir === 'U' ? 0.5 : 0.6);
  }
}

// Expected 12-bin chroma for a set of strings, including the first overtones of each note:
// a real string's 3rd harmonic (a fifth up) and 5th (a major third up) are clearly audible.
export function chordTemplate(frets, strings = [0, 1, 2, 3, 4, 5]) {
  const t = new Float32Array(12);
  for (const s of strings) {
    const f = frets[s];
    if (f == null || f < 0) continue;
    const m = midiOf(s, f);
    for (let h = 1; h <= 6; h++) t[Math.round(m + 12 * Math.log2(h)) % 12] += 1 / Math.sqrt(h);
  }
  return t;
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

function sensitivityToRms(value) {
  return 0.004 * Math.pow(2, (10 - value) / 2);
}

// YIN pitch detector; returns Hz or 0.
export function yin(buf, sr) {
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
