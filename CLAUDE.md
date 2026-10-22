# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fretview: a browser-based, Guitar Hero–style practice game for a real guitar. It shows a 3D guitar from the
player's view with left-hand finger markers and right-hand strum/pick cues, and listens through the microphone
to check what was played. See `README.md` for user-facing behaviour.

## Running

Static site, plain ES modules, **no build step, no package.json, no tests, no linter**. Three.js
(0.170.0) comes from jsDelivr through the import map in `index.html`. Serve the folder, since modules don't load over `file://`:

```sh
python3 -m http.server 8080    # or: npx http-server -p 8080 .
```

- Microphone access needs `localhost` or HTTPS.
- `index.html?selftest` routes the play-along synth into the mic detector instead of the real microphone,
  and exposes `window.fretview` (`state`, `camera`, `controls`, `CHORDS`, `mic`, `audio`, `lesson`) for
  console/Playwright checks. For example, `fretview.audio.playEvent(...)` strums a chord into the detector.
  Use this to verify detection changes without a guitar.
- Pushes to `main` deploy to GitHub Pages (`.github/workflows/pages.yml` uploads the whole repo root as-is).

## Architecture

`js/main.js` is the hub. It owns the Three.js scene, the game `state`, the clock, the HUD/DOM wiring and the
`frame()` loop. The other modules are mostly leaf libraries it calls:

- `songs.js`: `CHORDS` (shapes) and `SONGS`, built by the generators `strumSong`, `melodySong` and `arpeggioSong`.
- `guitar.js`: procedural guitar mesh and the **world-coordinate helpers** (`fretX`, `stringZ`, `fingerX`,
  `STRIKE_X`, `HIGHWAY_END`, …) that `cues.js` uses to place markers.
- `cues.js`: left-hand finger markers and the right-hand cue highway. It also defines `FINGER_COLORS`,
  the single colour scheme. Colour always means *finger* (open strings are white).
- `audio.js`: Karplus–Strong synth and metronome. Its `AudioContext` is also the game clock.
- `mic.js`: `MicJudge` does onset detection (spectral flux), YIN pitch for single notes, chroma matching for
  chords, and `analyzeChord` for lessons. The thresholds are in the exported `LESSON` constant.
- `lessons.js`: `LESSONS` data, plus `LessonRunner`, which drives a lesson without a timeline, and
  `chordFeedback`, which turns analysis results into "X string isn't ringing" or "sounded more like Y".
- `music.js`: MIDI/Hz helpers. `textures.js`: canvas-generated sprite textures.

### Data conventions (shared across modules)

- Strings are indexed **0 = low E … 5 = high e** everywhere (`OPEN_MIDI = [40,45,50,55,59,64]`).
- A shape is `{ frets[6], fingers[6] }`. Fret `-1` = muted, `0` = open, `null` = not part of this event
  (single notes). Finger `0` = none, `1–4` = index…pinky.
- A song is `{ id, title, subtitle, bpm, beatsPerBar, left, right, length, clickEvery? }`.
  - `left`: fretting-hand segments `{ beat, dur, name, shape }`. Consecutive identical chords merge.
  - `right`: picking events `{ beat, kind: 'strum'|'pick', dir: 'D'|'U', strings[], frets, fingers, wait }`.
    Up-strums hit only the top 4 strings, in reverse order (`strumEvent`).
  - Beats are in the song's own unit (eighths for 6/8 songs).
- World space (in `guitar.js`): x runs along the strings (nut at 0, saddle at `SCALE`), y points up from the
  board, and z runs across the strings with the low E at +z.

### Timing model

All timing is in **beats**, mapped to `AudioContext.currentTime` (falling back to `performance.now()` before
audio starts) through an anchor: `beatAt(t) = anchorBeat + (t - anchorTime) * bpm/60 * speed`. Seeking,
pausing and speed changes re-anchor instead of moving a playhead. Audio is scheduled ahead by `schedule()`.
Mic grading compares onset times with `timeOfBeat(ev.beat)`, adjusted for the mic latency setting.

**Practice mode** (speed < 100 % with the mic on): when the clock reaches a `right` event with `wait: true`,
`frame()` holds the anchor on that beat until the mic accepts the chord or note. Strum songs wait on each bar's
first strum, melody songs on every note, and arpeggios on each bar's bass note.

**Lesson mode** bypasses the song timeline. When `lesson` is set, `frame()` takes an early branch and renders
`lesson.view(t)`, a synthetic one-event song, through the same `cues.update` path.

### Adding content

- New chord: add it to `CHORDS` and `CHORD_NAMES` in `songs.js`. It then automatically becomes a mic
  "candidate" (`CANDIDATES` in `lessons.js`), which changes which chords a strum must beat by
  `LESSON.margin`, so test that existing lessons still pass.
- New song: append a generator call to `SONGS`, using a strum pattern from `STRUMS` or adding a new one.
- New lesson: add an entry to `LESSONS` (`chords`, `reps`, `tip`).
