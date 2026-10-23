// Song data. A song has two tracks:
//   left:  what the fretting hand holds  { beat, dur, name, shape: { frets[6], fingers[6] } }
//   right: what the picking hand does    { beat, kind: 'strum'|'pick', dir: 'D'|'U', strings[], frets[6], fingers[6], wait }
// In practice mode (below 100 % speed) the song stops at every event with wait: true until it is played right.
// Beats are in the song's own beat unit (quarter notes, or eighths for 6/8).

export const CHORDS = {
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  E:  { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  G:  { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  C:  { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  D:  { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  F:  { frets: [-1, -1, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1] },
  A:  { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  // The easy four-string Bm: no barre, only the D, G, B and high e strings.
  Bm: { frets: [-1, -1, 4, 4, 3, 2], fingers: [0, 0, 3, 4, 2, 1] },
};

export const CHORD_NAMES = {
  Em: 'E minor', Am: 'A minor', E: 'E major', A: 'A major', D: 'D major',
  C: 'C major', G: 'G major', Dm: 'D minor', F: 'F major', Bm: 'B minor',
};

const STRUMS = {
  whole: [[0, 'D']],
  quarters: [[0, 'D'], [1, 'D'], [2, 'D'], [3, 'D']],
  campfire: [[0, 'D'], [1, 'D'], [1.5, 'U'], [2.5, 'U'], [3, 'D'], [3.5, 'U']],
  waltz: [[0, 'D'], [1, 'D'], [2, 'D']],
  // Change drills in 4/4: strum part of the bar and use the silent beats to move to the next chord.
  ballad: [[0, 'D'], [1, 'D'], [2, 'D'], [2.5, 'U'], [3.5, 'U']],
  two: [[0, 'D'], [1, 'D']],
  three: [[0, 'D'], [1, 'D'], [2, 'D']],
};

function playedStrings(frets) {
  const out = [];
  frets.forEach((f, i) => { if (f != null && f >= 0) out.push(i); });
  return out;
}

function addLeft(left, beat, dur, name, shape) {
  const last = left[left.length - 1];
  if (last && name && last.name === name && last.beat + last.dur === beat) last.dur += dur;
  else left.push({ beat, dur, name, shape });
}

export function strumEvent(shape, beat, dir) {
  let strings = playedStrings(shape.frets);
  // Up strums only catch the treble strings, travelling high -> low.
  if (dir === 'U') strings = strings.slice(-4).reverse();
  return { beat, kind: 'strum', dir, strings, frets: shape.frets, fingers: shape.fingers };
}

// progression: [chordName, strumPattern, bars = 1]
function strumSong(meta, progression) {
  const bpb = meta.beatsPerBar;
  const left = [], right = [];
  let beat = 0;
  for (const [name, pattern, bars = 1] of progression) {
    const shape = CHORDS[name];
    addLeft(left, beat, bars * bpb, name, shape);
    for (let b = 0; b < bars; b++) {
      for (const [off, dir] of STRUMS[pattern]) {
        right.push({ ...strumEvent(shape, beat + b * bpb + off, dir), wait: off === 0 });
      }
    }
    beat += bars * bpb;
  }
  return { ...meta, left, right, length: beat };
}

// notes: [string, fret, finger, beats]
function melodySong(meta, notes) {
  const left = [], right = [];
  let beat = 0;
  for (const [s, fret, finger, dur] of notes) {
    const frets = Array(6).fill(null);
    const fingers = Array(6).fill(0);
    frets[s] = fret;
    fingers[s] = finger;
    left.push({ beat, dur, name: null, shape: { frets, fingers } });
    right.push({ beat, kind: 'pick', dir: 'D', strings: [s], frets, fingers, wait: true });
    beat += dur;
  }
  return { ...meta, left, right, length: beat };
}

// bars: [chordName, bassString]; one bar of 6/8 = bass, G, B, e, B, G in eighths.
function arpeggioSong(meta, bars) {
  const left = [], right = [];
  let beat = 0;
  for (const [name, bass] of bars) {
    const shape = CHORDS[name];
    addLeft(left, beat, 6, name, shape);
    [bass, 3, 4, 5, 4, 3].forEach((s, k) => {
      right.push({ beat: beat + k, kind: 'pick', dir: 'D', strings: [s], frets: shape.frets, fingers: shape.fingers, wait: k === 0 });
    });
    beat += 6;
  }
  return { ...meta, left, right, length: beat };
}

// Chord-change drill: the same changes four times over, with less time to move each round.
// One strum per bar (three free beats to change), then two, then three, then all four.
function drillSong(meta, chords) {
  const rounds = chords.length > 2 ? 1 : 2;
  const progression = [];
  for (const pattern of ['whole', 'two', 'three', 'quarters']) {
    for (let r = 0; r < rounds; r++) for (const c of chords) progression.push([c, pattern]);
  }
  progression.push([chords[0], 'whole']);
  return { ...strumSong({ bpm: 60, beatsPerBar: 4, ...meta }, progression), drill: true };
}

function cinnamonLoop(pattern) {
  return [['C', pattern], ['Em', pattern], ['D', pattern], ['Am', pattern]];
}

// One phrase of the clean intro of One: Bm and G (Gmaj7 on the record), with D (D/A) near the end.
function onePhrase(pattern) {
  return [['Bm', pattern], ['G', pattern], ['Bm', pattern], ['G', pattern], ['Bm', pattern], ['D', pattern], ['G', pattern, 2]];
}

// I See Fire (Ed Sheeran), the version with a capo on the 6th fret: each section's chord changes, one chord
// per bar. G/B is played as a plain G, and the A at the end of the chorus is left out.
function iSeeFire() {
  const bars = (chords, pattern) => chords.map((c) => [c, pattern]);
  const intro = bars(['Em', 'C', 'D', 'Em', 'Em', 'C', 'D', 'Em'], 'whole');
  const verse = bars(['Em', 'G', 'D', 'C', 'C', 'Am', 'G', 'C'], 'ballad');
  const chorus = bars(['Em', 'C', 'D', 'Em', 'Em', 'C', 'D', 'Em'], 'campfire');
  const bridge = bars(['Am', 'Em', 'G', 'D', 'Am', 'Em', 'G', 'D', 'Am', 'G', 'C', 'D'], 'quarters');
  return [...intro, ...verse, ...chorus, ...verse, ...chorus, ...bridge, ...chorus, ['Em', 'whole']];
}

function warmup() {
  const notes = [];
  for (let s = 0; s < 6; s++) for (let f = 1; f <= 4; f++) notes.push([s, f, f, 1]);
  for (let s = 5; s >= 0; s--) for (let f = 4; f >= 1; f--) notes.push([s, f, f, 1]);
  return notes;
}

// Ode to Joy (Beethoven, public domain) in first position on the top two strings.
function odeToJoy() {
  const C = [4, 1, 1], D = [4, 3, 3], E = [5, 0, 0], F = [5, 1, 1], G = [5, 3, 3], lowG = [3, 0, 0];
  const n = (note, dur = 1) => [...note, dur];
  const head = [n(E), n(E), n(F), n(G), n(G), n(F), n(E), n(D), n(C), n(C), n(D), n(E)];
  const a1 = [...head, n(E, 1.5), n(D, 0.5), n(D, 2)];
  const a2 = [...head, n(D, 1.5), n(C, 0.5), n(C, 2)];
  const b = [
    n(D), n(D), n(E), n(C),
    n(D), n(E, 0.5), n(F, 0.5), n(E), n(C),
    n(D), n(E, 0.5), n(F, 0.5), n(E), n(D),
    n(C), n(D), n(lowG, 2),
  ];
  return [...a1, ...a2, ...b, ...a2];
}

export const SONGS = [
  // Amazing Grace (traditional, public domain) with the G, C and D chords from the lessons.
  strumSong(
    { id: 'amazing-grace', title: 'Amazing Grace', subtitle: 'Traditional — G, C and D, three down-strums per bar', bpm: 84, beatsPerBar: 3 },
    [['G', 'waltz', 2], ['C', 'waltz'], ['G', 'waltz', 3], ['D', 'waltz', 2],
     ['G', 'waltz', 2], ['C', 'waltz'], ['G', 'waltz', 2], ['D', 'waltz'], ['G', 'waltz', 2]],
  ),
  melodySong(
    { id: 'warmup', title: 'Finger Warm-up', subtitle: 'One finger per fret, frets 1–4 on every string', bpm: 70, beatsPerBar: 4 },
    warmup(),
  ),
  strumSong(
    { id: 'two-chord', title: 'Two-Chord Strum', subtitle: 'Em and Am, steady downstrokes', bpm: 72, beatsPerBar: 4 },
    [['Em', 'quarters', 2], ['Am', 'quarters', 2], ['Em', 'quarters', 2], ['Am', 'quarters', 2],
     ['Em', 'quarters', 2], ['Am', 'quarters', 2], ['Em', 'whole']],
  ),
  strumSong(
    { id: 'campfire', title: 'Campfire Strum', subtitle: 'G – Em – C – D with a D DU UDU pattern', bpm: 76, beatsPerBar: 4 },
    [['G', 'campfire'], ['Em', 'campfire'], ['C', 'campfire'], ['D', 'campfire'],
     ['G', 'campfire'], ['Em', 'campfire'], ['C', 'campfire'], ['D', 'campfire'],
     ['G', 'campfire'], ['Em', 'campfire'], ['C', 'campfire'], ['D', 'campfire'],
     ['G', 'whole']],
  ),
  melodySong(
    { id: 'ode', title: 'Ode to Joy', subtitle: 'Beethoven — single-note melody on the B and high e strings', bpm: 90, beatsPerBar: 4 },
    odeToJoy(),
  ),
  arpeggioSong(
    { id: 'rising-sun', title: 'House of the Rising Sun', subtitle: 'Traditional — fingerpicked arpeggios in 6/8', bpm: 160, beatsPerBar: 6, clickEvery: 3 },
    [['Am', 1], ['C', 1], ['D', 2], ['F', 2], ['Am', 1], ['C', 1], ['E', 0], ['E', 0],
     ['Am', 1], ['C', 1], ['D', 2], ['F', 2], ['Am', 1], ['E', 0], ['Am', 1], ['Am', 1]],
  ),
  // Cinnamon Girl (Lana Del Rey): only the chord loop and a strum pattern, no melody or lyrics.
  strumSong(
    { id: 'cinnamon-girl', title: 'Cinnamon Girl', subtitle: 'Lana Del Rey — capo on the 2nd fret, C – Em – D – Am', bpm: 69, beatsPerBar: 4, capo: 2 },
    [...cinnamonLoop('whole'), ...cinnamonLoop('ballad'), ...cinnamonLoop('ballad'), ...cinnamonLoop('ballad'),
     ...cinnamonLoop('ballad'), ...cinnamonLoop('ballad'), ...cinnamonLoop('ballad'), ...cinnamonLoop('ballad'), ['C', 'whole']],
  ),
  // One (Metallica): only the chords of the clean intro, simplified to Bm, G and D, with a strum pattern. No melody or lyrics.
  strumSong(
    { id: 'one', title: 'One', subtitle: 'Metallica — the clean intro simplified to Bm – G – D, no barre chords', bpm: 72, beatsPerBar: 4 },
    [...onePhrase('whole'), ...onePhrase('ballad'), ...onePhrase('ballad'), ...onePhrase('ballad'), ['Bm', 'whole']],
  ),
  // I See Fire (Ed Sheeran): only the chords and a strum pattern for each section, no melody or lyrics.
  strumSong(
    { id: 'i-see-fire', title: 'I See Fire', subtitle: 'Ed Sheeran — capo on the 6th fret, Em – C – D – G – Am', bpm: 76, beatsPerBar: 4, capo: 6 },
    iSeeFire(),
  ),
  drillSong({ id: 'drill-em-am', title: 'Change drill: Em ↔ Am', subtitle: 'One strum per bar, then two, three and four — the silent beats are for moving' }, ['Em', 'Am']),
  drillSong({ id: 'drill-g-c', title: 'Change drill: G ↔ C', subtitle: 'One strum per bar, then two, three and four — the silent beats are for moving' }, ['G', 'C']),
  drillSong({ id: 'drill-g-d', title: 'Change drill: G ↔ D', subtitle: 'One strum per bar, then two, three and four — the silent beats are for moving' }, ['G', 'D']),
  drillSong({ id: 'drill-g-c-d', title: 'Change drill: G – C – G – D', subtitle: 'The changes in Amazing Grace, with fewer free beats each round' }, ['G', 'C', 'G', 'D']),
  drillSong({ id: 'drill-campfire', title: 'Change drill: G – Em – C – D', subtitle: 'The changes in Campfire Strum, with fewer free beats each round' }, ['G', 'Em', 'C', 'D']),
  drillSong({ id: 'drill-cinnamon', title: 'Change drill: C – Em – D – Am', subtitle: 'The changes in Cinnamon Girl, with fewer free beats each round' }, ['C', 'Em', 'D', 'Am']),
  drillSong({ id: 'drill-i-see-fire', title: 'Change drill: Em – C – D', subtitle: 'The chorus changes in I See Fire, with fewer free beats each round' }, ['Em', 'C', 'D']),
  drillSong({ id: 'drill-bm-g', title: 'Change drill: Bm ↔ G', subtitle: 'The main change in One, with fewer free beats each round' }, ['Bm', 'G']),
  drillSong({ id: 'drill-am-e', title: 'Change drill: Am ↔ E', subtitle: 'One strum per bar, then two, three and four — the silent beats are for moving' }, ['Am', 'E']),
];
