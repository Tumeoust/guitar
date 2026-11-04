import { OPEN_MIDI, midiToHz, hzToMidi, midiName } from './music.js';
import { yin } from './mic.js';

// Tunings the tuner offers, low (6th string) to high (1st), ignoring any capo. `labels` go on the
// string buttons, `strings` name each string in sentences ("Play the low C string").
export const TUNINGS = [
  { id: 'standard', title: 'Standard (E A D G B E)', midi: OPEN_MIDI,
    labels: ['E', 'A', 'D', 'G', 'B', 'e'], strings: ['low E', 'A', 'D', 'G', 'B', 'high e'] },
  // Drop C: the whole guitar a whole step down from standard, with the 6th string a further whole
  // step down. Aerials by System of a Down is played in it.
  { id: 'dropC', title: 'Drop C (C G C F A D)', midi: [36, 43, 48, 53, 57, 62],
    labels: ['C', 'G', 'c', 'F', 'A', 'd'], strings: ['low C', 'G', 'C', 'F', 'A', 'high D'] },
  // Open C minor: the open strings ring a C minor chord. The notes repeat, so the strings are named
  // by number.
  { id: 'openCm', title: 'Open C minor (C G C G C E♭)', midi: [36, 43, 48, 55, 60, 63],
    labels: ['C', 'G', 'c', 'g', 'c', 'E♭'], names: ['C2', 'G2', 'C3', 'G3', 'C4', 'E♭4'],
    strings: ['6th (low C)', '5th (G)', '4th (C)', '3rd (G)', '2nd (C)', '1st (E♭)'] },
];

export function tunerStrings(id) {
  const t = TUNINGS.find((x) => x.id === id) ?? TUNINGS[0];
  return t.midi.map((midi, s) => ({
    midi,
    hz: midiToHz(midi),
    label: t.labels[s],
    string: t.strings[s],
    name: t.names?.[s] ?? midiName(midi),
  }));
}

// IN: within this many cents counts as in tune; HOLD: for this long before the ✓;
// OUT: further off than this, for LEAVE seconds, re-arms the ✓ for the same string.
const TUNE = { in: 5, hold: 0.45, out: 15, leave: 0.3, silence: 0.35 };
const MIN_HZ = 55, MAX_HZ = 450; // the low C of drop C is 65 Hz

// Guitar tuner: follows the pitch of the microphone in real time, works out which string is being
// played, and calls ui.onTuned(string) once a string has stayed in tune for a moment.
//   ui.onTuned(string, allDone)
export class Tuner {
  constructor(ctx, ui, strings = tunerStrings('standard')) {
    this.ctx = ctx;
    this.ui = ui;
    this.strings = strings;
    this.active = false;
    this.lock = null; // string index the player picked, or null to detect it automatically
    this.tuned = new Set();
    this.reset();
  }

  // Switch to another tuning (from tunerStrings): forgets which strings were in tune.
  setTuning(strings) {
    this.strings = strings;
    this.tuned.clear();
    this.lock = null;
    this.reset();
  }

  reset() {
    this.history = [];
    this.string = null; // string being tuned
    this.votes = new Array(this.strings.length).fill(0); // recent seconds each string was nearest
    this.hz = 0;
    this.cents = 0; // raw (median-filtered) offset from the string's note
    this.shown = 0; // what the needle shows: eased towards `cents`
    this.sounding = false;
    this.quietFor = 0;
    this.inFor = 0;
    this.outFor = 0;
    this.done = false; // the ✓ fired for this note
    this.level = 0;
    this.noise = 0.002;
    this.lastT = null;
  }

  start(src) {
    this.src = src;
    this.an = this.ctx.createAnalyser();
    // 85 ms at 48 kHz: several periods of the low E, so its pitch is steady to about a cent.
    this.an.fftSize = 4096;
    this.an.smoothingTimeConstant = 0;
    src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.active = true;
    this.reset();
  }

  stop() {
    if (!this.active) return;
    try { this.src.disconnect(this.an); } catch { /* already disconnected */ }
    this.active = false;
  }

  setLock(s) {
    this.lock = s;
    this.string = s;
    this.done = false;
    this.inFor = 0;
  }

  update(t) {
    if (!this.active) return;
    const dt = this.lastT == null ? 0 : Math.min(0.1, t - this.lastT);
    this.lastT = t;
    this.an.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = rms;
    if (rms < this.noise) this.noise = rms;
    else this.noise += (rms - this.noise) * 0.001;

    const loud = rms > Math.max(this.noise * 3, 0.002);
    const hz = loud ? yin(this.buf, this.ctx.sampleRate, MIN_HZ) : 0;
    if (hz >= MIN_HZ && hz <= MAX_HZ) {
      this.quietFor = 0;
      this.history.push(hz);
      if (this.history.length > 5) this.history.shift();
      this.hz = median(this.history);
      this.follow(dt);
    } else {
      this.quietFor += dt;
      if (this.quietFor > TUNE.silence) {
        this.sounding = false;
        this.history = [];
        this.votes.fill(0);
        this.done = false;
        this.inFor = this.outFor = 0;
      }
    }
    // Ease the needle so it glides rather than jitters; it falls back to the middle in silence.
    const target = this.sounding ? this.cents : 0;
    this.shown += (target - this.shown) * (1 - Math.exp(-dt * (this.sounding ? 14 : 4)));
  }

  follow(dt) {
    const s = this.lock ?? this.pickString(this.hz, dt);
    if (s !== this.string) {
      this.string = s;
      this.done = false;
      this.inFor = this.outFor = 0;
      this.shown = clamp(this.centsOff(this.hz, s), -60, 60); // jump, don't sweep across from the old string
    }
    this.cents = this.centsOff(this.hz, s);
    this.sounding = true;

    const off = Math.abs(this.cents);
    this.inFor = off <= TUNE.in ? this.inFor + dt : 0;
    this.outFor = off > TUNE.out ? this.outFor + dt : 0;
    if (this.done && this.outFor > TUNE.leave) this.done = false;
    if (!this.done && this.inFor >= TUNE.hold) {
      this.done = true;
      this.tuned.add(s);
      this.ui.onTuned?.(s, this.tuned.size === this.strings.length);
    }
  }

  // Nearest string by pitch. Each frame votes for its nearest string and old votes fade, so a stray
  // overtone, a frame of another string still ringing, or a slide between two notes doesn't make the
  // display flicker; a newly plucked string takes over within about a tenth of a second.
  pickString(hz, dt) {
    let best = 0;
    for (let s = 1; s < this.strings.length; s++) {
      if (Math.abs(this.centsOff(hz, s)) < Math.abs(this.centsOff(hz, best))) best = s;
    }
    const fade = Math.exp(-dt / 0.3);
    this.votes = this.votes.map((v, s) => v * fade + (s === best ? dt : 0));
    if (this.string == null || !this.sounding) return best;
    return this.votes[best] > this.votes[this.string] + 0.08 ? best : this.string;
  }

  centsOff(hz, s) {
    return 1200 * Math.log2(hz / this.strings[s].hz);
  }

  // What to show: null when nothing is ringing.
  get reading() {
    if (!this.sounding || this.string == null) return null;
    return {
      string: this.string,
      hz: this.hz,
      cents: this.cents,
      shown: this.shown,
      note: noteName(Math.round(hzToMidi(this.hz)), this.strings[this.string]),
      inTune: Math.abs(this.cents) <= TUNE.in,
      done: this.done,
    };
  }
}

// A soft two-note bell for a string in tune; a rising arpeggio once all six are.
export function chime(ctx, all) {
  const out = ctx.createGain();
  out.gain.value = 0.22;
  out.connect(ctx.destination);
  const notes = all ? [76, 80, 83, 88] : [83, 88]; // E5 G#5 B5 E6 / B5 E6
  const t0 = ctx.currentTime + 0.02;
  notes.forEach((midi, i) => {
    const at = t0 + i * (all ? 0.11 : 0.09);
    const f = midiToHz(midi);
    // Bell-like partials: the fundamental, an octave and a slightly sharp twelfth.
    for (const [mult, amp, decay] of [[1, 1, 1.4], [2, 0.35, 0.6], [3.01, 0.12, 0.3]]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(amp, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    }
  });
}

// Spell a heard note the way the string being tuned is spelled (E♭4, not D#4) when they match.
const noteName = (midi, st) => (midi === st.midi ? st.name : midiName(midi));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
