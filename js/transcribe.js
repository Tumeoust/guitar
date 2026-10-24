import { CHORDS } from './songs.js';

// Works out the chords of a recording, for importing a song from an MP3. No DOM here, so it runs in a
// worker (js/transcribe-worker.js) and in Node.
//   1. An onset envelope (spectral flux) gives the tempo (autocorrelation) and the beats (dynamic
//      programming, after Ellis 2007: beats fall on strong onsets, about one period apart).
//   2. A 12-bin chroma profile is averaged over each beat and compared to the 24 major and minor
//      chords, together with a chroma of the bass alone, which mostly plays the root. A hidden Markov
//      model (Viterbi) smooths the labels so a chord doesn't flicker on a melody's passing note.
// Chords are numbered 0..11 for C..B major and 12..23 for C..B minor; -1 is no chord (silence, noise).
//
// buildChart() then groups the beats into bars, and chooses a capo so that as many bars as possible
// use the open shapes the app knows (CHORDS).

export const SR = 11025; // the audio is resampled to this before analysis
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ONSET_N = 1024, ONSET_HOP = 256;
const CHROMA_N = 4096, CHROMA_HOP = 512;
const CHROMA_LO = 80, CHROMA_HI = 2000; // Hz
const BASS_LO = 50, BASS_HI = 200; // Hz
const LOW_HZ = 200; // kick drum and bass onsets, which mark the strong beats
// Viterbi: emission = BETA * correlation with the chord; a change of chord costs SWITCH; no chord
// scores like a chord with correlation NO_CHORD (so it wins only when nothing fits). The bass counts
// BASS_W as much as the full chroma.
const BETA = 10, SWITCH = 2.5, NO_CHORD = 0.2, BASS_W = 0.5;

export const chordName = (c) => (c < 0 ? '—' : NOTE_NAMES[c % 12] + (c >= 12 ? 'm' : ''));
export const chordRoot = (c) => c % 12;
export const chordMinor = (c) => c >= 12;
export const chordOf = (root, minor) => ((root % 12) + 12) % 12 + (minor ? 12 : 0);

// The app's shapes as chord numbers: 'Em' -> E minor, 'F' -> F major.
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const SHAPES = Object.keys(CHORDS).map((name) => {
  const m = /^([A-G])(#|b)?(m?)$/.exec(name);
  const root = LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { name, chord: chordOf(root, m[3] === 'm') };
});

// ---- Signal processing -----------------------------------------------------
function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// In-place radix-2 FFT of (re, im).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Magnitude spectra of frames centred every `hop` samples; calls each(frameIndex, mag).
function stft(x, n, hop, each) {
  const win = hann(n);
  const re = new Float32Array(n), im = new Float32Array(n);
  const mag = new Float32Array(n / 2 + 1);
  const frames = Math.max(1, Math.floor(x.length / hop));
  for (let f = 0; f < frames; f++) {
    const start = f * hop - n / 2;
    for (let i = 0; i < n; i++) {
      const j = start + i;
      re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    each(f, mag);
  }
  return frames;
}

// Log-magnitude spectral flux, with the local mean taken off, at SR / ONSET_HOP frames a second: of
// the whole spectrum (env) and of the lowest notes only (low).
function onsetEnvelope(x) {
  const bins = ONSET_N / 2 + 1, lowBins = Math.ceil(LOW_HZ / (SR / ONSET_N));
  const prev = new Float32Array(bins);
  const frames = Math.max(1, Math.floor(x.length / ONSET_HOP));
  const all = new Float32Array(frames), low = new Float32Array(frames);
  stft(x, ONSET_N, ONSET_HOP, (f, mag) => {
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      const v = Math.log1p(1000 * mag[k]);
      if (f > 0 && v > prev[k]) flux += v - prev[k];
      prev[k] = v;
      if (k === lowBins) low[f] = flux;
    }
    all[f] = flux;
  });
  return { env: normalizeOnsets(all), low: normalizeOnsets(low) };
}

function normalizeOnsets(out) {
  const half = 8;
  const env = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(out.length - 1, i + half); j++) { s += out[j]; c++; }
    env[i] = Math.max(0, out[i] - s / c);
  }
  let sd = 0;
  for (const v of env) sd += v * v;
  sd = Math.sqrt(sd / env.length) || 1;
  for (let i = 0; i < env.length; i++) env[i] /= sd;
  return env;
}

// Beat period in onset frames: the strongest autocorrelation lag, weighted towards 120 BPM.
export function estimatePeriod(env, fps) {
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 50);
  let best = minLag, bestScore = -Infinity;
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    const score = ac[lag] * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // Parabolic interpolation for a period between whole frames.
  const a = ac[best - 1], b = ac[best], c = ac[best + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return best + (Math.abs(shift) < 1 ? shift : 0);
}

// Ellis' dynamic-programming beat tracker; returns beat frames.
export function trackBeats(env, period, tightness = 100) {
  const n = env.length;
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0, from = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const s = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (from < 0 || s > best) { best = s; from = p; }
    }
    score[t] = env[t] + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }
  // End on the best-scoring frame within the last period.
  let t = n - 1;
  for (let i = Math.max(0, n - Math.ceil(period)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats = [];
  for (; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

// 24 bins a frame: the chroma of everything from CHROMA_LO to CHROMA_HI, then that of the bass.
function chromaFrames(x, tuning) {
  const bins = CHROMA_N / 2 + 1, binHz = SR / CHROMA_N;
  // Each bin's share of its nearest pitch class, fading out towards the quarter tones.
  const pc = new Int8Array(bins).fill(-1), weight = new Float32Array(bins);
  for (let k = 1; k < Math.min(bins, CHROMA_HI / binHz); k++) {
    const m = 69 + 12 * Math.log2((k * binHz) / 440) - tuning;
    const r = Math.round(m);
    pc[k] = ((r % 12) + 12) % 12;
    weight[k] = Math.cos(Math.PI * (m - r)) ** 2;
  }
  const lo = Math.ceil(CHROMA_LO / binHz), bassLo = Math.ceil(BASS_LO / binHz), bassHi = BASS_HI / binHz;
  const out = [];
  stft(x, CHROMA_N, CHROMA_HOP, (f, mag) => {
    const c = new Float32Array(24);
    for (let k = Math.min(lo, bassLo); k < bins; k++) {
      if (pc[k] < 0) continue;
      const v = weight[k] * Math.sqrt(mag[k]);
      if (k >= lo) c[pc[k]] += v;
      if (k >= bassLo && k < bassHi) c[12 + pc[k]] += v;
    }
    out.push(c);
  });
  return out;
}

// How far the recording sits from A = 440 Hz, in semitones (-0.5..0.5): the circular mean of where
// the strongest spectral peaks fall between the semitones.
export function estimateTuning(x) {
  const binHz = SR / CHROMA_N;
  let sx = 0, sy = 0;
  const frames = Math.floor(x.length / (CHROMA_HOP * 4));
  const step = Math.max(1, Math.floor(frames / 200)) * CHROMA_HOP * 4;
  stft(x, CHROMA_N, step, (f, mag) => {
    for (let k = Math.ceil(CHROMA_LO / binHz) + 1; k < CHROMA_HI / binHz; k++) {
      if (!(mag[k] > mag[k - 1] && mag[k] >= mag[k + 1])) continue;
      const a = mag[k - 1], b = mag[k], c = mag[k + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      const m = 69 + 12 * Math.log2(((k + shift) * binHz) / 440);
      const ang = 2 * Math.PI * (m - Math.round(m));
      sx += b * Math.cos(ang);
      sy += b * Math.sin(ang);
    }
  });
  return Math.atan2(sy, sx) / (2 * Math.PI);
}

// ---- Chords ----------------------------------------------------------------
// Chroma template for each of the 24 chords: the three notes and their first overtones.
const TEMPLATES = Array.from({ length: 24 }, (_, c) => {
  const t = new Float32Array(12);
  const root = chordRoot(c);
  for (const iv of [0, chordMinor(c) ? 3 : 4, 7]) {
    for (let h = 1; h <= 4; h++) t[(root + iv + Math.round(12 * Math.log2(h))) % 12] += 1 / h;
  }
  return t;
});

// What the bass plays under each chord: mostly the root, sometimes the fifth.
const BASS_TEMPLATES = Array.from({ length: 24 }, (_, c) => {
  const t = new Float32Array(12);
  t[chordRoot(c)] = 1;
  t[(chordRoot(c) + 7) % 12] = 0.3;
  return t;
});

function correlation(a, b) {
  let ma = 0, mb = 0;
  for (let k = 0; k < 12; k++) { ma += a[k] / 12; mb += b[k] / 12; }
  let dot = 0, na = 0, nb = 0;
  for (let k = 0; k < 12; k++) {
    const x = a[k] - ma, y = b[k] - mb;
    dot += x * y; na += x * x; nb += y * y;
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

// Best chord sequence for beat chromas (24 bins, as chromaFrames); quiet[i] marks beats too quiet to
// hold a chord.
export function labelChords(chromas, quiet = []) {
  const S = 25, NONE = 24; // 24 chords + no chord
  const n = chromas.length;
  if (!n) return [];
  const emit = chromas.map((c, i) => {
    const e = new Float32Array(S);
    const full = c.subarray(0, 12), bass = c.subarray(12, 24);
    for (let s = 0; s < 24; s++) {
      const fit = (correlation(full, TEMPLATES[s]) + BASS_W * correlation(bass, BASS_TEMPLATES[s])) / (1 + BASS_W);
      e[s] = quiet[i] ? -BETA : BETA * fit;
    }
    e[NONE] = quiet[i] ? BETA : BETA * NO_CHORD;
    return e;
  });
  let score = Float32Array.from(emit[0]);
  const back = [];
  for (let i = 1; i < n; i++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (score[s] > score[bestPrev]) bestPrev = s;
    const next = new Float32Array(S), from = new Int8Array(S);
    for (let s = 0; s < S; s++) {
      const stay = score[s], move = score[bestPrev] - SWITCH;
      from[s] = stay >= move ? s : bestPrev;
      next[s] = Math.max(stay, move) + emit[i][s];
    }
    back.push(from);
    score = next;
  }
  let s = 0;
  for (let k = 1; k < S; k++) if (score[k] > score[s]) s = k;
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = s === NONE ? -1 : s;
    if (i > 0) s = back[i - 1][s];
  }
  return out;
}

// samples: mono Float32Array at SR. progress(fraction, text) is called along the way.
export function analyze(samples, progress = () => {}) {
  const fps = SR / ONSET_HOP;
  progress(0.05, 'Finding the beat');
  const { env, low } = onsetEnvelope(samples);
  const period = estimatePeriod(env, fps);
  let beatFrames = trackBeats(env, period);
  progress(0.35, 'Tuning');
  const tuning = estimateTuning(samples);
  progress(0.45, 'Listening for chords');
  const frames = chromaFrames(samples, tuning);
  progress(0.85, 'Smoothing the chords');

  // Beats sit on onset frames; chroma frames are CHROMA_HOP apart. Average the chroma frames whose
  // window stays (nearly) inside the beat: a window reaching into the next beat hears its strum, and
  // the chord would seem to change a beat early. A beat shorter than the window gets its middle frame.
  let beats = beatFrames.map((f) => (f * ONSET_HOP) / SR);
  // Leading and trailing silence has no beat worth keeping.
  const rmsAt = (t0, t1) => {
    const a = Math.max(0, Math.floor(t0 * SR)), b = Math.min(samples.length, Math.ceil(t1 * SR));
    let s = 0;
    for (let i = a; i < b; i++) s += samples[i] * samples[i];
    return b > a ? Math.sqrt(s / (b - a)) : 0;
  };
  const spans = beats.map((t, i) => [t, beats[i + 1] ?? t + period / fps]);
  const energy = spans.map(([a, b]) => rmsAt(a, b));
  const sorted = [...energy].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const quiet = energy.map((e) => e < median * 0.1);
  const reach = (0.4 * CHROMA_N) / SR;
  const chromas = spans.map(([a, b]) => {
    const c = new Float32Array(24);
    let lo = a + reach, hi = b - reach;
    if (lo > hi) lo = hi = (a + b) / 2;
    const f0 = Math.max(0, Math.ceil((lo * SR) / CHROMA_HOP));
    const f1 = Math.min(frames.length - 1, Math.max(f0, Math.floor((hi * SR) / CHROMA_HOP)));
    for (let f = f0; f <= f1; f++) for (let k = 0; k < 24; k++) c[k] += frames[f][k];
    return c;
  });
  const labels = labelChords(chromas, quiet);
  progress(1, 'Done');
  return {
    duration: samples.length / SR,
    tuning: Math.round(tuning * 100), // cents
    beats: beats.map((t) => Math.round(t * 1000) / 1000),
    // How hard the kick and bass hit on each beat (the strongest onset within 30 ms).
    strength: beatFrames.map((f) => Math.round(Math.max(...low.subarray(Math.max(0, f - 1), f + 2)) * 100) / 100),
    labels,
  };
}

// ---- Bars, capo and shapes -------------------------------------------------
// Halve or double the beat rate (a fast song often tracks at twice its pulse, a slow one at half).
function retime(beats, labels, strength, tempo) {
  if (tempo === 2) {
    const b = [], l = [], s = [];
    beats.forEach((t, i) => {
      b.push(t); l.push(labels[i]); s.push(strength[i]);
      if (i + 1 < beats.length) { b.push((t + beats[i + 1]) / 2); l.push(labels[i]); s.push(0); }
    });
    return { beats: b, labels: l, strength: s };
  }
  if (tempo === 0.5) {
    // Keep the every-other beats that hold more of the chord changes.
    const changesOn = (odd) => labels.filter((c, i) => i % 2 === odd && i > 0 && c !== labels[i - 1]).length;
    const odd = changesOn(1) > changesOn(0) ? 1 : 0;
    const keep = beats.map((_, i) => i).filter((i) => i % 2 === odd);
    return { beats: keep.map((i) => beats[i]), labels: keep.map((i) => labels[i]), strength: keep.map((i) => strength[i]) };
  }
  return { beats, labels, strength };
}

// The beat (0..bpb-1) where the first full bar starts: chords tend to change on the first beat of a
// bar, and the kick drum and the bass tend to hit hardest on it.
export function bestPhase(labels, strength, bpb) {
  const mean = strength.reduce((a, b) => a + b, 0) / (strength.length || 1) || 1;
  let best = 0, bestScore = -Infinity;
  for (let p = 0; p < bpb; p++) {
    let s = 0;
    for (let i = p; i < labels.length; i += bpb) {
      if (i > 0 && labels[i] !== labels[i - 1]) s += 1;
      s += 0.5 * ((strength[i] || 0) / mean);
    }
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

// One chord per bar: the one that rings longest in it, with the first beat counting a little more.
// null when most of the bar has no chord.
function barChord(labels) {
  const votes = new Map();
  labels.forEach((c, i) => votes.set(c, (votes.get(c) || 0) + (i === 0 ? 1.5 : 1)));
  let best = -1, most = -1;
  for (const [c, v] of votes) if (c >= 0 && v > most) { most = v; best = c; }
  const none = votes.get(-1) || 0;
  return best < 0 || none > most ? null : best;
}

// settings: { beatsPerBar, tempo: 0.5 | 1 | 2, shift } (shift moves the first beat of the bar).
export function buildBars(analysis, { beatsPerBar = 4, tempo = 1, shift = 0 } = {}) {
  const { beats, labels, strength } = retime(analysis.beats, analysis.labels, analysis.strength, tempo);
  const phase = ((bestPhase(labels, strength, beatsPerBar) + shift) % beatsPerBar + beatsPerBar) % beatsPerBar;
  let bars = [];
  for (let i = phase; i + beatsPerBar <= labels.length; i += beatsPerBar) {
    bars.push({ chord: barChord(labels.slice(i, i + beatsPerBar)), time: beats[i] });
  }
  // Drop the silence before the first chord and after the last.
  const first = bars.findIndex((b) => b.chord != null);
  const last = bars.findLastIndex((b) => b.chord != null);
  bars = first < 0 ? [] : bars.slice(first, last + 1);
  // The typical beat length, measured over 8 beats at a time: single beats are only as exact as the
  // onset frames (23 ms), and a stretch with a missed beat shouldn't count.
  const span = Math.min(8, beats.length - 1), gaps = [];
  for (let i = span; i < beats.length; i++) gaps.push((beats[i] - beats[i - span]) / span);
  gaps.sort((a, b) => a - b);
  const ibi = gaps[Math.floor(gaps.length / 2)] || 0.5;
  return { bars, bpm: Math.round(60 / ibi) };
}

// The shape that plays chord c with a capo on fret `capo`: an exact match, or else the shape that
// shares the most notes with it (same root first, then same quality).
export function shapeFor(c, capo) {
  const exact = SHAPES.find((s) => soundingChord(s.name, capo) === c);
  if (exact) return { name: exact.name, exact: true };
  const notes = (x) => [0, chordMinor(x) ? 3 : 4, 7].map((iv) => (chordRoot(x) + iv) % 12);
  const want = notes(c);
  let best = null, bestScore = -1;
  for (const s of SHAPES) {
    const sounding = soundingChord(s.name, capo);
    const shared = notes(sounding).filter((n) => want.includes(n)).length;
    const score = shared * 4 + (chordRoot(sounding) === chordRoot(c) ? 2 : 0) + (chordMinor(sounding) === chordMinor(c) ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return { name: best.name, exact: false };
}

// The sounding chord of a shape played with a capo.
export function soundingChord(shapeName, capo) {
  const s = SHAPES.find((x) => x.name === shapeName);
  return chordOf(chordRoot(s.chord) + capo, chordMinor(s.chord));
}

// The capo (0..maxCapo) that lets the most bars use an exact shape; the lowest one on a tie.
export function bestCapo(chords, maxCapo = 7) {
  let best = 0, most = -1;
  for (let capo = 0; capo <= maxCapo; capo++) {
    const n = chords.filter((c) => c != null && shapeFor(c, capo).exact).length;
    if (n > most) { most = n; best = capo; }
  }
  return best;
}
