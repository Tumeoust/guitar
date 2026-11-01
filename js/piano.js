// Piano partner: a second player reads the same song as piano notes on a scrolling grand staff,
// with a mini keyboard showing the keys to hold. Chord songs become a bass root (left hand) plus a
// close-position triad (right hand); melody songs become the melody an octave above the guitar.
import { OPEN_MIDI } from './music.js';

// Letters C D E F G A B as diatonic steps 0..6, and their pitch classes.
const LETTERS = 'CDEFGAB';
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACC_TEXT = { '-1': '♭', 0: '', 1: '♯' };
// Sounding chord names: flats for Bb, Eb, Ab (and Db), sharps for F#, C#m, G#m.
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
// Melody notes outside a chord: sharps, as [letter, accidental].
const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];

const TREBLE_LO = 55, TREBLE_HI = 72, TREBLE_CENTER = 64;
const BASS_LO = 40; // bass roots sit in E2..Eb3

const mod12 = (n) => ((n % 12) + 12) % 12;

function parseChord(name) {
  // Sevenths, add9 and barre shapes are played as their plain triad; sus chords keep the 2nd or 4th.
  const m = /^([A-G])([#b]?)(m(?!aj))?(?:.*sus([24]))?/.exec(name);
  if (!m) return null;
  const letter = LETTERS.indexOf(m[1]);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { pc: mod12(LETTER_PC[letter] + acc), minor: m[3] === 'm', sus: m[4] ? Number(m[4]) : 0 };
}

// A spelled note: diatonic step (middle C = 28), accidental and a short label.
function spell(midi, letter, acc) {
  const nat = midi - acc;
  const octave = Math.floor(nat / 12) - 1;
  return { step: octave * 7 + letter, acc, label: LETTERS[letter] + ACC_TEXT[acc] };
}

function letterOf(name) {
  return LETTERS.indexOf(name[0]);
}

// Accidental that turns `letter` into pitch class `pc`, in -2..2.
function accFor(letter, pc) {
  let a = mod12(pc - LETTER_PC[letter]);
  if (a > 6) a -= 12;
  return a;
}

// Close-position triads within the right-hand range, every inversion and octave.
function triadVoicings(pcs) {
  const out = [];
  for (let inv = 0; inv < 3; inv++) {
    const order = [pcs[inv], pcs[(inv + 1) % 3], pcs[(inv + 2) % 3]];
    for (let base = TREBLE_LO - 12; base <= TREBLE_HI; base++) {
      if (mod12(base) !== order[0]) continue;
      const v = [base];
      for (let k = 1; k < 3; k++) {
        let n = v[k - 1] + 1;
        while (mod12(n) !== order[k]) n++;
        v.push(n);
      }
      if (v[0] >= TREBLE_LO && v[2] <= TREBLE_HI) out.push(v);
    }
  }
  return out;
}

// Nearest voicing to the previous one (voice leading); the first one sits around E4.
function pickVoicing(cands, prev) {
  let best = cands[0], bestCost = Infinity;
  for (const v of cands) {
    const mean = (v[0] + v[1] + v[2]) / 3;
    let cost = Math.abs(mean - TREBLE_CENTER) * (prev ? 0.1 : 1);
    if (prev) for (let k = 0; k < 3; k++) cost += Math.abs(v[k] - prev[k]);
    if (cost < bestCost) { bestCost = cost; best = v; }
  }
  return best;
}

// Full arrangement, with spelling for the staff.
function arrange(song, capo) {
  const notes = [], chords = [];
  if (!song) return { notes, chords };
  capo = capo || 0;
  const bpb = song.beatsPerBar || 4;
  let prev = null;
  for (const seg of song.left) {
    if (seg.name) {
      const c = parseChord(seg.name);
      if (!c) continue;
      const pc = mod12(c.pc + capo);
      const name = (c.minor ? MINOR_NAMES : MAJOR_NAMES)[pc];
      chords.push({ beat: seg.beat, name: name + (c.minor ? 'm' : '') + (c.sus ? `sus${c.sus}` : '') });
      // Spell the triad by letters: root, root + 2 letters (1 or 3 for sus2 / sus4), root + 4 letters.
      const rootL = letterOf(name);
      const third = c.sus === 2 ? 2 : c.sus === 4 ? 5 : c.minor ? 3 : 4;
      const pcs = [pc, mod12(pc + third), mod12(pc + 7)];
      const letters = [rootL, (rootL + (c.sus ? c.sus - 1 : 2)) % 7, (rootL + 4) % 7];
      const voicing = pickVoicing(triadVoicings(pcs), prev);
      prev = voicing;
      const bass = BASS_LO + mod12(pc - BASS_LO);
      // One strike per bar, so the reader gets a steady pulse.
      const end = seg.beat + seg.dur;
      for (let t = seg.beat; t < end - 1e-6;) {
        const next = Math.min(end, (Math.floor(t / bpb + 1e-6) + 1) * bpb);
        const dur = next - t;
        notes.push({ beat: t, dur, midi: bass, hand: 'L', ...spell(bass, rootL, accFor(rootL, pc)) });
        for (const midi of voicing) {
          const k = pcs.indexOf(mod12(midi));
          notes.push({ beat: t, dur, midi, hand: 'R', ...spell(midi, letters[k], accFor(letters[k], pcs[k])) });
        }
        t = next;
      }
    } else {
      const s = seg.shape.frets.findIndex((f) => f != null && f >= 0);
      if (s < 0) continue;
      const midi = OPEN_MIDI[s] + capo + seg.shape.frets[s] + 12;
      const [l, a] = SHARP_SPELL[mod12(midi)];
      notes.push({ beat: seg.beat, dur: seg.dur, midi, hand: midi < 60 ? 'L' : 'R', ...spell(midi, l, a) });
    }
  }
  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return { notes, chords };
}

export function pianoArrangement(song, capo) {
  const { notes, chords } = arrange(song, capo);
  return { notes: notes.map(({ beat, dur, midi, hand }) => ({ beat, dur, midi, hand })), chords };
}

const COLORS = {
  bg: '#0b0d12',
  text: '#e8ebf2',
  muted: '#8e97aa',
  line: 'rgba(232, 235, 242, 0.55)',
  past: 'rgba(142, 151, 170, 0.35)',
  R: '#4cc9f0',
  L: '#ffb627',
  playhead: '#4cc9f0',
};
const MUSIC_FONT = '"Noto Music", Bravura, "FreeSerif", "Segoe UI Symbol", "Apple Symbols", "DejaVu Serif", serif';
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const KEY_LO = 36, KEY_HI = 84;
const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

// Treble staff lines E4..F5 (steps 30..38), bass G2..A3 (steps 18..26).
const STAFF = {
  R: { bottom: 30, mid: 34, top: 38 },
  L: { bottom: 18, mid: 22, top: 26 },
};

export class PianoPart {
  constructor(container) {
    this.container = container;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.style.overflow = 'hidden';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.lit = new Int8Array(128);
    this.litLabel = new Array(128).fill('');
    this.lastBeat = NaN;
    this.lastLook = NaN;
    this.clefs = undefined;
    this.setSong(null, 0);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }
    this.resize();
  }

  setSong(song, capo) {
    this.song = song;
    const { notes, chords } = arrange(song, capo);
    this.notes = notes;
    this.chords = chords;
    this.bpb = song?.beatsPerBar || 4;
    this.length = song?.length || 0;
    // 6/8 songs count eighths; note values are drawn in quarters.
    this.quarter = this.bpb === 6 ? 0.5 : 1;
    this.maxDur = notes.reduce((m, n) => Math.max(m, n.dur), 0);
    this.groups = buildGroups(notes);
    // Closest onsets set how much room a note gets on screen.
    this.minGap = this.bpb;
    for (let i = 1; i < this.groups.length; i++) {
      const d = this.groups[i].beat - this.groups[i - 1].beat;
      if (d > 1e-6) this.minGap = Math.min(this.minGap, d);
    }
    this.L = null;
    this.lastBeat = NaN;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.lastBeat = NaN;
    this.lastLook = NaN;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this.clefs === undefined) this.clefs = measureClefs(this.ctx);
    if (this.pending != null) this.update(this.pending, this.pendingLook);
  }

  layout(lookBeats) {
    const { w, h, bpb } = this;
    const L = { w, h };
    L.headH = Math.max(24, Math.min(34, h * 0.06));
    const whiteW = w / 29;
    L.kbH = Math.max(40, Math.min(h * 0.22, whiteW * 5.5, 120));
    L.kbY = h - L.kbH - 4;
    const avail = L.kbY - L.headH - 6;
    let s = Math.max(4, Math.min(avail / 20, 16));
    L.ahead = Math.max(bpb, Math.min(lookBeats > 0 ? lookBeats : 2 * bpb, 3 * bpb));
    for (let i = 0; i < 2; i++) {
      L.x0 = 8 + 1.4 * s;
      L.noteX0 = L.x0 + 4 * s;
      L.playX = Math.max(L.noteX0 + 2 * s, w * 0.22);
      L.ppb = (w - 1.5 * s - L.playX) / L.ahead;
      // Neighbouring notes need room for a notehead and an accidental.
      s = Math.max(4, Math.min(s, (L.ppb * this.minGap) / 3.2));
    }
    L.s = s;
    // Bar lines sit just before the downbeat's notes and accidentals.
    L.barOff = Math.min(2.4 * s, L.ppb * this.minGap * 0.45);
    L.behind = (L.playX - L.noteX0 + s) / L.ppb;
    const sysH = 20 * s;
    const top = L.headH + 4 + Math.max(0, (avail - sysH) / 2);
    L.labelY = top + 1.6 * s;
    L.trebleTop = top + 4 * s;
    L.trebleBottom = L.trebleTop + 4 * s;
    L.bassTop = L.trebleBottom + 5.5 * s;
    L.bassBottom = L.bassTop + 4 * s;
    L.fonts = {
      head: `700 ${Math.round(L.headH * 0.5)}px ${UI_FONT}`,
      chordHead: `800 ${Math.round(L.headH * 0.72)}px ${UI_FONT}`,
      label: `700 ${Math.round(Math.max(11, Math.min(1.35 * s, 18)))}px ${UI_FONT}`,
      acc: `${Math.round(2.4 * s)}px ${MUSIC_FONT}`,
      key: `700 ${Math.round(Math.max(8, Math.min(whiteW * 0.42, 13)))}px ${UI_FONT}`,
    };
    return L;
  }

  // y of a diatonic step on the staff of `hand`.
  yOf(hand, step) {
    const L = this.L;
    const st = STAFF[hand];
    return (hand === 'R' ? L.trebleBottom : L.bassBottom) - (step - st.bottom) * L.s * 0.5;
  }

  update(beat, lookBeats) {
    this.pending = beat;
    this.pendingLook = lookBeats;
    if (typeof window !== 'undefined' && window.devicePixelRatio !== this.dpr) this.resize();
    if (!this.w || !this.h) return;
    if (beat === this.lastBeat && lookBeats === this.lastLook) return;
    if (lookBeats !== this.lastLook || !this.L || this.L.w !== this.w || this.L.h !== this.h) this.L = this.layout(lookBeats);
    this.lastBeat = beat;
    this.lastLook = lookBeats;
    this.draw(beat);
  }

  draw(beat) {
    const { ctx, L, w, h, dpr } = this;
    const s = L.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // After the end the final bar stays in view; during a long count-in the first bar waits at the right.
    const ended = this.length > 0 && beat >= this.length;
    const lastBar = Math.max(0, Math.floor((this.length - 1e-6) / this.bpb) * this.bpb);
    const view = ended ? lastBar : Math.max(beat, -L.ahead * 0.8);
    const xOf = (b) => L.playX + (b - view) * L.ppb;
    const fromBeat = view - L.behind - 0.5, toBeat = view + (w - L.playX) / L.ppb;

    this.drawHeader(beat);

    // Staff lines, brace and clefs.
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    for (const top of [L.trebleTop, L.bassTop]) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(top + i * s) + 0.5;
        ctx.moveTo(L.x0, y);
        ctx.lineTo(w - 4, y);
      }
    }
    ctx.moveTo(L.x0, L.trebleTop);
    ctx.lineTo(L.x0, L.bassBottom);
    ctx.stroke();
    drawBrace(ctx, L.x0 - 0.5 * s, L.trebleTop, L.bassBottom, s);
    drawClefs(ctx, this.clefs, L);

    // Notes scroll under the clefs' edge: clip there.
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.noteX0 - s, 0, w, h);
    ctx.clip();

    // Bar lines, with a double bar at the end.
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    const first = Math.max(0, Math.ceil(fromBeat / this.bpb)) * this.bpb;
    for (let b = first; b <= toBeat && b <= this.length; b += this.bpb) {
      const x = Math.round(xOf(b) - L.barOff) + 0.5;
      ctx.moveTo(x, L.trebleTop);
      ctx.lineTo(x, L.bassBottom);
    }
    ctx.stroke();
    if (this.length && this.length <= toBeat) {
      const x = xOf(this.length) - L.barOff;
      ctx.fillStyle = COLORS.line;
      ctx.fillRect(x + 0.35 * s, L.trebleTop, 0.45 * s, L.bassBottom - L.trebleTop);
    }

    // Chord labels above the treble staff.
    ctx.font = L.fonts.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const chords = this.chords;
    for (let i = lowerBound(chords, fromBeat - 4 * this.bpb); i < chords.length; i++) {
      const c = chords[i];
      if (c.beat > toBeat) break;
      const end = i + 1 < chords.length ? chords[i + 1].beat : this.length;
      ctx.fillStyle = beat >= end ? COLORS.past : beat >= c.beat ? COLORS.R : COLORS.text;
      ctx.fillText(c.name, Math.min(xOf(c.beat) - 0.6 * s, w - 6 - ctx.measureText(c.name).width), L.labelY);
    }

    // Notes.
    const groups = this.groups;
    for (let i = lowerBound(groups, fromBeat); i < groups.length; i++) {
      const g = groups[i];
      if (g.beat > toBeat) break;
      const state = beat >= g.beat + g.dur ? 0 : beat >= g.beat ? 2 : 1;
      this.drawGroup(g, xOf(g.beat), state);
    }

    // Fade the notes out into the clefs.
    ctx.restore();
    const fade = ctx.createLinearGradient(L.noteX0 - s, 0, L.noteX0 + 1.5 * s, 0);
    fade.addColorStop(0, 'rgba(11, 13, 18, 1)');
    fade.addColorStop(1, 'rgba(11, 13, 18, 0)');
    ctx.fillStyle = fade;
    const fadeTop = Math.max(L.headH, L.labelY - 2 * s);
    ctx.fillRect(L.noteX0 - s, fadeTop, 2.5 * s, L.bassBottom + 3 * s - fadeTop);

    // Playhead.
    ctx.fillStyle = 'rgba(76, 201, 240, 0.16)';
    ctx.fillRect(L.playX - 0.6 * s, L.trebleTop - 1.5 * s, 1.2 * s, L.bassBottom - L.trebleTop + 3 * s);
    ctx.fillStyle = COLORS.playhead;
    ctx.fillRect(L.playX - 1, L.trebleTop - 1.5 * s, 2, L.bassBottom - L.trebleTop + 3 * s);

    this.drawKeyboard(beat);
  }

  drawHeader(beat) {
    const { ctx, L, w } = this;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(0, 0, w, L.headH);
    ctx.fillStyle = COLORS.text;
    ctx.font = L.fonts.head;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('🎹 Piano', 10, L.headH / 2);
    const chords = this.chords;
    if (!chords.length) return;
    // The chord sounding now; during the count-in, the first one (dimmed).
    let i = upperBound(chords, beat) - 1;
    const upcoming = i < 0;
    if (upcoming) i = 0;
    ctx.font = L.fonts.chordHead;
    ctx.textAlign = 'right';
    ctx.fillStyle = upcoming || beat >= this.length ? COLORS.muted : COLORS.R;
    ctx.fillText(chords[i].name, w - 10, L.headH / 2);
  }

  drawGroup(g, x, state) {
    const { ctx, L } = this;
    const s = L.s;
    const color = state === 2 ? COLORS[g.hand] : state === 1 ? COLORS.text : COLORS.past;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    const q = g.dur * this.quarter;
    const whole = q >= 4 - 1e-6, hollow = q >= 2 - 1e-6;
    const dotted = isDotted(q);
    const st = STAFF[g.hand];

    // Ledger lines.
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    const lx = x + (g.shiftMin - 0.95) * s, rx = x + (g.shiftMax + 0.95) * s;
    for (let k = st.bottom - 2; k >= g.minStep; k -= 2) {
      const y = Math.round(this.yOf(g.hand, k)) + 0.5;
      ctx.moveTo(lx, y);
      ctx.lineTo(rx, y);
    }
    for (let k = st.top + 2; k <= g.maxStep; k += 2) {
      const y = Math.round(this.yOf(g.hand, k)) + 0.5;
      ctx.moveTo(lx, y);
      ctx.lineTo(rx, y);
    }
    ctx.stroke();

    // Noteheads, accidentals and dots.
    for (const n of g.notes) {
      const nx = x + n.shift * s;
      const y = this.yOf(g.hand, n.step);
      ctx.beginPath();
      if (whole) {
        ctx.ellipse(nx, y, 0.72 * s, 0.46 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(nx, y, 0.34 * s, 0.26 * s, Math.PI / 3, 0, Math.PI * 2);
        ctx.fill('evenodd');
      } else if (hollow) {
        ctx.ellipse(nx, y, 0.62 * s, 0.42 * s, -0.35, 0, Math.PI * 2);
        ctx.ellipse(nx, y, 0.48 * s, 0.2 * s, -0.35, 0, Math.PI * 2);
        ctx.fill('evenodd');
      } else {
        ctx.ellipse(nx, y, 0.62 * s, 0.42 * s, -0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      if (n.acc) {
        ctx.font = L.fonts.acc;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(ACC_TEXT[n.acc], x + (g.shiftMin - 0.85 - 0.9 * n.accCol) * s, y + (n.acc < 0 ? -0.35 * s : 0.1 * s));
      }
      if (dotted) {
        ctx.beginPath();
        const dy = n.step % 2 === 0 ? -0.5 * s : 0;
        ctx.arc(x + (g.shiftMax + 1.2) * s, y + dy, 0.17 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (whole) return;
    // One stem for the whole chord, plus a flag for eighths.
    const yLo = this.yOf(g.hand, g.minStep), yHi = this.yOf(g.hand, g.maxStep);
    const sx = g.up ? x + 0.56 * s : x - 0.56 * s;
    const yEnd = g.up ? yHi - 3.3 * s : yLo + 3.3 * s;
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(sx, g.up ? yLo : yHi);
    ctx.lineTo(sx, yEnd);
    if (q < 1 - 1e-6) {
      const d = g.up ? 1 : -1;
      ctx.moveTo(sx, yEnd);
      ctx.bezierCurveTo(sx + 0.2 * s, yEnd + d * 1.2 * s, sx + 1.3 * s, yEnd + d * 1.4 * s, sx + 0.9 * s, yEnd + d * 2.6 * s);
    }
    ctx.stroke();
  }

  drawKeyboard(beat) {
    const { ctx, L, w } = this;
    const lit = this.lit, labels = this.litLabel;
    lit.fill(0);
    const notes = this.notes;
    if (beat < this.length || !this.length) {
      for (let i = lowerBound(notes, beat - this.maxDur); i < notes.length; i++) {
        const n = notes[i];
        if (n.beat > beat) break;
        if (beat < n.beat + n.dur) {
          lit[n.midi] = n.hand === 'R' ? 1 : 2;
          labels[n.midi] = n.label;
        }
      }
    }

    const y = L.kbY, kh = L.kbH;
    const x0 = 6, ww = (w - 12) / 29;
    const bh = kh * 0.62, bw = ww * 0.62;
    ctx.font = L.fonts.key;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // White keys.
    let wi = 0;
    for (let m = KEY_LO; m <= KEY_HI; m++) {
      if (IS_BLACK[m % 12]) continue;
      const kx = x0 + wi * ww;
      const on = lit[m];
      ctx.fillStyle = on ? (on === 1 ? COLORS.R : COLORS.L) : '#d9dde6';
      ctx.fillRect(kx + 0.5, y, ww - 1, kh);
      if (m === 60) {
        // Middle C: a small marker near the bottom.
        ctx.fillStyle = on ? '#0b0d12' : '#4cc9f0';
        ctx.beginPath();
        ctx.arc(kx + ww / 2, y + kh - Math.min(ww * 0.3, 6), Math.max(2, Math.min(ww * 0.15, 3.5)), 0, Math.PI * 2);
        ctx.fill();
      }
      if (on) {
        ctx.fillStyle = '#06121a';
        ctx.fillText(labels[m], kx + ww / 2, y + kh - Math.min(ww * 0.75, 16));
      }
      wi++;
    }
    // Black keys over them.
    wi = 0;
    for (let m = KEY_LO; m <= KEY_HI; m++) {
      if (!IS_BLACK[m % 12]) { wi++; continue; }
      const kx = x0 + wi * ww - bw / 2;
      const on = lit[m];
      ctx.fillStyle = on ? (on === 1 ? COLORS.R : COLORS.L) : '#1a1e28';
      ctx.fillRect(kx, y, bw, bh);
      if (on) {
        ctx.fillStyle = '#06121a';
        ctx.fillText(labels[m], kx + bw / 2, y + bh - 4);
      }
    }
  }
}

function isDotted(q) {
  return Math.abs(q - 3) < 1e-6 || Math.abs(q - 1.5) < 1e-6 || Math.abs(q - 0.75) < 1e-6;
}

// Notes at the same beat in the same hand share a stem; lay out seconds and accidentals once.
function buildGroups(notes) {
  const groups = [];
  const byKey = new Map();
  for (const n of notes) {
    const key = n.beat + n.hand;
    let g = byKey.get(key);
    if (!g) {
      g = { beat: n.beat, dur: 0, hand: n.hand, notes: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.notes.push(n);
    g.dur = Math.max(g.dur, n.dur);
  }
  for (const g of groups) {
    g.notes.sort((a, b) => a.step - b.step);
    g.minStep = g.notes[0].step;
    g.maxStep = g.notes[g.notes.length - 1].step;
    g.up = (g.minStep + g.maxStep) / 2 < STAFF[g.hand].mid;
    // A second can't share a column: the upper note moves right of the stem (stem up) or the lower left.
    for (let k = 0; k < g.notes.length; k++) {
      const n = g.notes[k];
      const clash = k > 0 && n.step - g.notes[k - 1].step === 1 && g.notes[k - 1].shift === 0;
      n.shift = clash ? (g.up ? 1.15 : 0) : 0;
      if (clash && !g.up) g.notes[k - 1].shift = -1.15;
    }
    g.shiftMin = Math.min(0, ...g.notes.map((n) => n.shift));
    g.shiftMax = Math.max(0, ...g.notes.map((n) => n.shift));
    // Accidentals closer than a sixth step into columns, from the top down.
    let col = -1, lastStep = Infinity;
    for (let k = g.notes.length - 1; k >= 0; k--) {
      const n = g.notes[k];
      if (!n.acc) continue;
      col = lastStep - n.step < 6 ? col + 1 : 0;
      n.accCol = col;
      lastStep = n.step;
    }
  }
  groups.sort((a, b) => a.beat - b.beat);
  return groups;
}

// First index with item.beat >= b.
function lowerBound(arr, b) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].beat < b) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// First index with item.beat > b.
function upperBound(arr, b) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].beat <= b) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Clef glyphs from a font when it has them (a real clef is taller than a letter), else drawn paths.
function measureClefs(ctx) {
  ctx.font = `100px ${MUSIC_FONT}`;
  const m = (ch) => {
    const t = ctx.measureText(ch);
    return { asc: t.actualBoundingBoxAscent, h: t.actualBoundingBoxAscent + t.actualBoundingBoxDescent, left: t.actualBoundingBoxLeft };
  };
  const g = m('𝄞'), f = m('𝄢');
  const ok = g.h > 95 && f.h > 30 && f.h < g.h * 0.75;
  return ok ? { g, f } : null;
}

function drawClefs(ctx, clefs, L) {
  const s = L.s;
  const x = L.x0 + 0.5 * s;
  ctx.fillStyle = '#e8ebf2';
  ctx.strokeStyle = '#e8ebf2';
  if (clefs) {
    // Scale each glyph to its box on the staff.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const put = (c, top, height) => {
      const size = (100 * height) / c.h;
      ctx.font = `${size}px ${MUSIC_FONT}`;
      ctx.fillText(c === clefs.g ? '𝄞' : '𝄢', x + (c.left * size) / 100, top + (c.asc * size) / 100);
    };
    put(clefs.g, L.trebleTop - 1.5 * s, 7.2 * s);
    put(clefs.f, L.bassTop - 0.05 * s, 3.3 * s);
    return;
  }
  // Treble: a loop round the G line, a line up to a curl and down to a hook.
  const gY = L.trebleTop + 3 * s, cx = x + 1.3 * s;
  ctx.lineWidth = Math.max(1.2, 0.22 * s);
  ctx.beginPath();
  ctx.moveTo(cx + 0.1 * s, gY + 0.3 * s);
  ctx.bezierCurveTo(cx - 0.6 * s, gY + 0.3 * s, cx - 0.5 * s, gY - 0.9 * s, cx + 0.2 * s, gY - 0.9 * s);
  ctx.bezierCurveTo(cx + 1.4 * s, gY - 0.9 * s, cx + 1.3 * s, gY + 1.1 * s, cx, gY + 1.1 * s);
  ctx.bezierCurveTo(cx - 1.6 * s, gY + 1.1 * s, cx - 1.4 * s, gY - 1.5 * s, cx + 0.4 * s, gY - 3 * s);
  ctx.bezierCurveTo(cx + 1.2 * s, gY - 3.8 * s, cx + 0.9 * s, gY - 5 * s, cx + 0.4 * s, gY - 4.4 * s);
  ctx.bezierCurveTo(cx - 0.1 * s, gY - 3.8 * s, cx + 0.3 * s, gY + 2 * s, cx + 0.3 * s, gY + 2.4 * s);
  ctx.bezierCurveTo(cx + 0.3 * s, gY + 3.2 * s, cx - 0.6 * s, gY + 3.2 * s, cx - 0.6 * s, gY + 2.6 * s);
  ctx.stroke();
  // Bass: a curl from the F line with two dots either side of it.
  const fY = L.bassTop + s, bx = x + 0.6 * s;
  ctx.beginPath();
  ctx.arc(bx + 0.35 * s, fY, 0.3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bx + 0.35 * s, fY);
  ctx.bezierCurveTo(bx + 0.2 * s, fY - 1.3 * s, bx + 2.4 * s, fY - 1.3 * s, bx + 2.2 * s, fY + 0.4 * s);
  ctx.bezierCurveTo(bx + 2.1 * s, fY + 1.6 * s, bx + 1.2 * s, fY + 2.4 * s, bx, fY + 2.9 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + 2.9 * s, fY - 0.5 * s, 0.17 * s, 0, Math.PI * 2);
  ctx.arc(bx + 2.9 * s, fY + 0.5 * s, 0.17 * s, 0, Math.PI * 2);
  ctx.fill();
}

// A curly brace joining the two staves.
function drawBrace(ctx, x, top, bottom, s) {
  const mid = (top + bottom) / 2, w = 0.9 * s;
  ctx.fillStyle = '#e8ebf2';
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.bezierCurveTo(x - w * 1.1, top + 1.5 * s, x + w * 0.2, mid - 1.5 * s, x - w, mid);
  ctx.bezierCurveTo(x + w * 0.2, mid + 1.5 * s, x - w * 1.1, bottom - 1.5 * s, x, bottom);
  ctx.bezierCurveTo(x - w * 0.7, bottom - 1.5 * s, x + w * 0.6, mid + 1.5 * s, x - w, mid);
  ctx.bezierCurveTo(x + w * 0.6, mid - 1.5 * s, x - w * 0.7, top + 1.5 * s, x, top);
  ctx.fill();
}
