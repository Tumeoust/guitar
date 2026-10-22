// Shared music constants. Strings are indexed 0..5 from the low E (6th string)
// to the high e (1st string). Frets: null = string not involved, -1 = muted,
// 0 = open, n = fretted.

export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

export function midiOf(string, fret) {
  return OPEN_MIDI[string] + fret;
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiName(midi) {
  const m = Math.round(midi);
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
