// Song data. A song has two tracks:
//   left:  what the fretting hand holds  { beat, dur, name, shape: { frets[6], fingers[6] } }
//   right: what the picking hand does    { beat, kind: 'strum'|'pick', dir: 'D'|'U', strings[], frets[6], fingers[6] }
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
};

export const CHORD_NAMES = {
  Em: 'E minor', Am: 'A minor', E: 'E major', A: 'A major', D: 'D major',
  C: 'C major', G: 'G major', Dm: 'D minor', F: 'F major',
};

const STRUMS = {
  whole: [[0, 'D']],
  quarters: [[0, 'D'], [1, 'D'], [2, 'D'], [3, 'D']],
  campfire: [[0, 'D'], [1, 'D'], [1.5, 'U'], [2.5, 'U'], [3, 'D'], [3.5, 'U']],
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
      for (const [off, dir] of STRUMS[pattern]) right.push(strumEvent(shape, beat + b * bpb + off, dir));
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
    right.push({ beat, kind: 'pick', dir: 'D', strings: [s], frets, fingers });
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
      right.push({ beat: beat + k, kind: 'pick', dir: 'D', strings: [s], frets: shape.frets, fingers: shape.fingers });
    });
    beat += 6;
  }
  return { ...meta, left, right, length: beat };
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
];
