import { CHORDS, strumEvent } from './songs.js';
import { LESSON } from './mic.js';

// Each lesson is a list of chords to strum, one at a time, at your own pace. The lesson waits
// until the microphone hears the chord played correctly before moving on.
export const LESSONS = [
  { title: 'Em — E minor', chords: ['Em'], reps: 3,
    tip: 'Middle finger on the A string and ring finger on the D string, both at the 2nd fret. Strum all six strings.' },
  { title: 'Am — A minor', chords: ['Am'], reps: 3,
    tip: 'Index on the B string at the 1st fret, middle and ring on the D and G strings at the 2nd fret. Start the strum on the A string.' },
  { title: 'E — E major', chords: ['E'], reps: 3,
    tip: 'Like Em, plus your index finger on the G string at the 1st fret. Strum all six strings.' },
  { title: 'A — A major', chords: ['A'], reps: 3,
    tip: 'Index, middle and ring squeezed side by side on the 2nd fret of the D, G and B strings. Start the strum on the A string.' },
  { title: 'D — D major', chords: ['D'], reps: 3,
    tip: 'A small triangle: index on the G string, ring on the B string, middle on the high e. Strum only the four thinnest strings.' },
  { title: 'C — C major', chords: ['C'], reps: 3,
    tip: 'A diagonal line: ring on the A string at the 3rd fret, middle on the D string at the 2nd, index on the B string at the 1st. Start the strum on the A string.' },
  { title: 'G — G major', chords: ['G'], reps: 3,
    tip: 'Middle on the low E at the 3rd fret, index on the A string at the 2nd, ring on the high e at the 3rd. Strum all six strings.' },
  { title: 'Dm — D minor', chords: ['Dm'], reps: 3,
    tip: 'Index on the high e at the 1st fret, middle on the G string at the 2nd, ring on the B string at the 3rd. Strum the four thinnest strings.' },
  { title: 'Changing Em ↔ Am', chords: ['Em', 'Am', 'Em', 'Am', 'Em', 'Am'], reps: 1,
    tip: 'Same shape for middle and ring finger — just move it one string over, and add your index for Am.' },
  { title: 'Changing Am ↔ E', chords: ['Am', 'E', 'Am', 'E', 'Am', 'E'], reps: 1,
    tip: 'Am and E are the same shape, one string apart. Move all three fingers together.' },
  { title: 'Changing A ↔ D', chords: ['A', 'D', 'A', 'D', 'A', 'D'], reps: 1,
    tip: 'Keep your index finger close to the G string — it is in both chords.' },
  { title: 'Campfire changes G → C → D', chords: ['G', 'C', 'D', 'G', 'C', 'D', 'G'], reps: 1,
    tip: 'Move the fingers that travel furthest first; the others follow.' },
];

const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high e'];
const FINGER_NAMES = { 1: 'index', 2: 'middle', 3: 'ring', 4: 'pinky' };
export const CANDIDATES = Object.fromEntries(Object.entries(CHORDS).map(([name, c]) => [name, c.frets]));
const REFRACTORY = 0.6; // one strum can trigger several onsets

export function stringName(s) {
  return STRING_NAMES[s];
}

export class LessonRunner {
  // ui: { onStep(runner), onResult(runner, result), onComplete(runner) }
  constructor(lesson, mic, ui) {
    this.lesson = lesson;
    this.mic = mic;
    this.ui = ui;
    this.steps = lesson.chords.flatMap((c) => Array(lesson.reps).fill(c));
    this.index = 0;
    this.done = false;
    this.lastOnset = Infinity; // set on the first update
    this.ignoreUntil = 0;
    this.advanceAt = null;
    this.mic.expect(this.shape.frets);
  }

  get chord() { return this.steps[this.index]; }
  get shape() { return CHORDS[this.chord]; }

  // Don't listen for a while, e.g. while the "Hear it" example rings out.
  mute(until) {
    this.ignoreUntil = until;
  }

  skip() {
    this.advance();
  }

  advance() {
    this.advanceAt = null;
    if (this.index + 1 >= this.steps.length) {
      this.done = true;
      this.ui.onComplete(this);
      return;
    }
    this.index++;
    this.mic.expect(this.shape.frets);
    this.ui.onStep(this);
  }

  update(t) {
    if (this.done) return;
    if (this.lastOnset === Infinity) this.lastOnset = t;
    if (this.advanceAt != null) {
      if (t >= this.advanceAt) this.advance();
      return;
    }
    for (const f of this.mic.frames) {
      if (!f.onset || f.t <= this.lastOnset + REFRACTORY) continue;
      if (f.t < this.ignoreUntil) { this.lastOnset = f.t; continue; }
      if (t - f.t < LESSON.wait) break; // still listening to this strum
      this.lastOnset = f.t;
      const result = this.mic.analyzeChord(f.t, this.shape.frets, CANDIDATES);
      // Bumps, taps and talking are ignored without comment.
      if (!result || !result.musical) continue;
      this.ui.onResult(this, result);
      if (result.ok) this.advanceAt = t + 0.9;
      break;
    }
  }

  feedback(result) {
    return chordFeedback(this.shape, result);
  }

  // Data for the 3D view: only the shape to hold now (a preview of the next one just gets in the
  // way), and a strum cue every 2 seconds.
  view(t) {
    const shape = this.shape;
    const left = [{ beat: t - 0.5, dur: 1, name: this.chord, shape }];
    const right = [];
    for (let k = Math.floor(t / 2) * 2; k < t + 4; k += 2) right.push(strumEvent(shape, k + 0.5, 'D'));
    return { song: { beatsPerBar: 2, left, right }, beat: t, lookBeats: 2 };
  }
}

// Explain a failed strum in plain words, most specific problem first.
export function chordFeedback(shape, result) {
  const { frets, fingers } = shape;
  if (result.missing.length) {
    const s = result.missing[0];
    if (frets[s] === 0) {
      return `The open ${STRING_NAMES[s]} string isn't ringing — make sure no finger is touching it.`;
    }
    return `The ${STRING_NAMES[s]} string isn't ringing clearly. Press it firmly with your ${FINGER_NAMES[fingers[s]] || 'finger'}, just behind the fret, using your fingertip.`;
  }
  if (result.rival && result.rivalSim > result.sim) {
    return `That sounded more like ${result.rival}. Check each finger against the dots.`;
  }
  return 'Not quite — check the finger positions and strum again.';
}
