import { CHORDS, strumEvent } from './songs.js';
import { LESSON } from './mic.js';

// Lessons build up from single chords to playing changes in time, in four kinds:
//   chord: strum each chord in `chords` at your own pace; the lesson waits until it hears it right.
//   race:  keep changing between `chords`. A change counts when the new chord is right and it came
//          less than `targets[level]` seconds after the previous one; `per` fast changes per level.
//   song:  a change drill from js/songs.js (`song` is its id), played in time with the metronome.
const SLOW = 'Fast changes come from moving all fingers at once, not one after the other. ';
const GCD_TIP = 'G → C: middle finger moves from the low E to the D string, ring from the high e to the A string, index from the A string to the B string. ';
export const LESSONS = [
  { group: 'Single chords', title: 'Em — E minor', chords: ['Em'], reps: 3,
    tip: 'Middle finger on the A string and ring finger on the D string, both at the 2nd fret. Strum all six strings.' },
  { group: 'Single chords', title: 'Am — A minor', chords: ['Am'], reps: 3,
    tip: 'Index on the B string at the 1st fret, middle and ring on the D and G strings at the 2nd fret. Start the strum on the A string.' },
  { group: 'Single chords', title: 'E — E major', chords: ['E'], reps: 3,
    tip: 'Like Em, plus your index finger on the G string at the 1st fret. Strum all six strings.' },
  { group: 'Single chords', title: 'A — A major', chords: ['A'], reps: 3,
    tip: 'Index, middle and ring squeezed side by side on the 2nd fret of the D, G and B strings. Start the strum on the A string.' },
  { group: 'Single chords', title: 'D — D major', chords: ['D'], reps: 3,
    tip: 'A small triangle: index on the G string, ring on the B string, middle on the high e. Strum only the four thinnest strings.' },
  { group: 'Single chords', title: 'C — C major', chords: ['C'], reps: 3,
    tip: 'A diagonal line: ring on the A string at the 3rd fret, middle on the D string at the 2nd, index on the B string at the 1st. Start the strum on the A string.' },
  { group: 'Single chords', title: 'G — G major', chords: ['G'], reps: 3,
    tip: 'Middle on the low E at the 3rd fret, index on the A string at the 2nd, ring on the high e at the 3rd. Strum all six strings.' },
  { group: 'Single chords', title: 'Dm — D minor', chords: ['Dm'], reps: 3,
    tip: 'Index on the high e at the 1st fret, middle on the G string at the 2nd, ring on the B string at the 3rd. Strum the four thinnest strings.' },

  { group: 'Em and Am (Two-Chord Strum)', title: 'Changing Em ↔ Am', chords: ['Em', 'Am', 'Em', 'Am', 'Em', 'Am'], reps: 1,
    tip: 'Same shape for middle and ring finger — just move it one string over, and add your index for Am.' },
  { group: 'Em and Am (Two-Chord Strum)', title: 'Quick changes Em ↔ Am', kind: 'race', chords: ['Em', 'Am'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Middle and ring move together, one string towards the floor; the index drops onto the B string at the same time.` },
  { group: 'Em and Am (Two-Chord Strum)', title: 'In time: Em ↔ Am', kind: 'song', song: 'drill-em-am',
    tip: 'One strum per bar first, so you have three beats to move. Each round leaves one beat less.' },

  { group: 'G, C and D (Amazing Grace)', title: 'Changing G ↔ C', chords: ['G', 'C', 'G', 'C', 'G', 'C'], reps: 1,
    tip: GCD_TIP + 'The ring finger travels furthest: start moving it first.' },
  { group: 'G, C and D (Amazing Grace)', title: 'Changing G ↔ D', chords: ['G', 'D', 'G', 'D', 'G', 'D'], reps: 1,
    tip: 'From G to D, put the index on the G string first: it leads, and the other two fingers drop around it.' },
  { group: 'G, C and D (Amazing Grace)', title: 'Quick changes G ↔ C', kind: 'race', chords: ['G', 'C'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}${GCD_TIP}` },
  { group: 'G, C and D (Amazing Grace)', title: 'Quick changes G ↔ D', kind: 'race', chords: ['G', 'D'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Lift the whole hand a little, aim the index at the G string and land all three fingers together.` },
  { group: 'G, C and D (Amazing Grace)', title: 'Campfire changes G → C → D', chords: ['G', 'C', 'D', 'G', 'C', 'D', 'G'], reps: 1,
    tip: 'Move the fingers that travel furthest first; the others follow.' },
  { group: 'G, C and D (Amazing Grace)', title: 'In time: G ↔ C', kind: 'song', song: 'drill-g-c',
    tip: 'One strum per bar first, so you have three beats to move. Each round leaves one beat less.' },
  { group: 'G, C and D (Amazing Grace)', title: 'In time: G ↔ D', kind: 'song', song: 'drill-g-d',
    tip: 'One strum per bar first, so you have three beats to move. Each round leaves one beat less.' },
  { group: 'G, C and D (Amazing Grace)', title: 'In time: G – C – G – D', kind: 'song', song: 'drill-g-c-d',
    tip: 'The changes of Amazing Grace in order. After this, try the song itself.' },

  { group: 'G, Em, C and D (Campfire Strum)', title: 'Changing G → Em → C → D', chords: ['G', 'Em', 'C', 'D', 'G', 'Em', 'C', 'D', 'G'], reps: 1,
    tip: 'G → Em: middle onto the A string and ring onto the D string, both at the 2nd fret. Em → C: ring to the A string at the 3rd fret, middle to the D string, index onto the B string at the 1st.' },
  { group: 'G, Em, C and D (Campfire Strum)', title: 'Quick changes G → Em → C → D', kind: 'race', chords: ['G', 'Em', 'C', 'D'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Look one chord ahead: while one rings, think of where each finger goes next.` },
  { group: 'G, Em, C and D (Campfire Strum)', title: 'In time: G – Em – C – D', kind: 'song', song: 'drill-campfire',
    tip: 'The changes of Campfire Strum in order. After this, try the song itself.' },

  { group: 'Am, E, A and D', title: 'Changing Am ↔ E', chords: ['Am', 'E', 'Am', 'E', 'Am', 'E'], reps: 1,
    tip: 'Am and E are the same shape, one string apart. Move all three fingers together.' },
  { group: 'Am, E, A and D', title: 'Quick changes Am ↔ E', kind: 'race', chords: ['Am', 'E'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Keep the shape in your hand and slide it one string over.` },
  { group: 'Am, E, A and D', title: 'In time: Am ↔ E', kind: 'song', song: 'drill-am-e',
    tip: 'One strum per bar first, so you have three beats to move. Each round leaves one beat less.' },
  { group: 'Am, E, A and D', title: 'Changing A ↔ D', chords: ['A', 'D', 'A', 'D', 'A', 'D'], reps: 1,
    tip: 'Keep your index finger close to the G string — it is in both chords.' },
  { group: 'Am, E, A and D', title: 'Quick changes A ↔ D', kind: 'race', chords: ['A', 'D'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}The ring finger stays on the B string and just slides from the 2nd to the 3rd fret — use it as your guide.` },
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
    this.race = lesson.kind === 'race';
    // A race has no fixed list of steps: it keeps cycling through its chords.
    this.steps = this.race ? null : lesson.chords.flatMap((c) => Array(lesson.reps).fill(c));
    this.index = 0;
    this.level = 0; // race: index into lesson.targets
    this.fast = 0; // race: fast changes so far at this level
    this.lastOk = null; // race: onset time of the last chord played right
    this.best = Infinity;
    this.done = false;
    this.lastOnset = Infinity; // set on the first update
    this.ignoreUntil = 0;
    this.advanceAt = null;
    this.mic.expect(this.shape.frets);
  }

  chordAt(k) { return this.race ? this.lesson.chords[k % this.lesson.chords.length] : this.steps[k]; }
  get chord() { return this.chordAt(this.index); }
  get shape() { return CHORDS[this.chord]; }
  get target() { return this.lesson.targets?.[this.level]; }
  // Progress dots: chords played (chord lessons) or fast changes at this level (races).
  get total() { return this.race ? this.lesson.per : this.steps.length; }
  get doneCount() { return this.done ? this.total : this.race ? this.fast : this.index; }

  // Don't listen for a while, e.g. while the "Hear it" example rings out.
  mute(until) {
    this.ignoreUntil = until;
    this.lastOk = null; // the example would count against the change time
  }

  skip() {
    if (this.race) this.levelUp();
    else this.advance();
  }

  advance() {
    this.advanceAt = null;
    if (!this.race && this.index + 1 >= this.steps.length) {
      this.complete();
      return;
    }
    this.index++;
    this.mic.expect(this.shape.frets);
    this.ui.onStep(this);
  }

  complete() {
    this.done = true;
    this.ui.onComplete(this);
  }

  levelUp() {
    this.fast = 0;
    this.lastOk = null;
    if (++this.level >= this.lesson.targets.length) this.complete();
    else this.advance();
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
      if (this.race && result.ok) this.timeChange(result, f.t);
      this.ui.onResult(this, result);
      if (this.done) return;
      if (result.levelUp) this.levelUp();
      // In a race the next chord shows straight away: the clock is already running.
      else if (result.ok) this.advanceAt = this.race ? t : t + 0.9;
      break;
    }
  }

  // Race: how long the change took, from the previous right chord to this one.
  timeChange(result, onset) {
    if (this.lastOk != null) {
      result.changeTime = onset - this.lastOk;
      result.fast = result.changeTime <= this.target;
      this.best = Math.min(this.best, result.changeTime);
      if (result.fast && ++this.fast >= this.lesson.per) result.levelUp = true;
    }
    this.lastOk = onset;
  }

  feedback(result) {
    return chordFeedback(this.shape, result);
  }

  // Data for the 3D view: only the shape to hold now (a preview of the next one just gets in the
  // way), and a strum cue every 2 seconds. Races do show the next chord, with no strum cues: the
  // change should start as soon as the chord has been strummed.
  view(t) {
    const shape = this.shape;
    const left = [{ beat: t - 0.5, dur: 1, name: this.chord, shape }];
    const right = [];
    if (this.race) {
      const name = this.chordAt(this.index + 1);
      left.push({ beat: t + 1, dur: 1, name, shape: CHORDS[name] });
    } else {
      for (let k = Math.floor(t / 2) * 2; k < t + 4; k += 2) right.push(strumEvent(shape, k + 0.5, 'D'));
    }
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
