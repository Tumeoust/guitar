# Fretview

A Guitar Hero–style practice game for a **real guitar** that runs in the browser.

You see a 3D acoustic guitar from the player's side, the way you see your own guitar when you look down at it:
headstock on the left, thickest string nearest to you. There is no sheet music and there are no note names.
The game only shows what each hand has to do:

- **Left hand.** Coloured dots on the fretboard show which finger goes where:
  1 = index (blue), 2 = middle (green), 3 = ring (yellow), 4 = pinky (pink).
  ○ at the nut means play the string open, and ✕ means don't play it.
  Colour always means a finger: each string to be played glows in the colour of the finger fretting it,
  from the finger to the bridge. Open strings glow white.
  The next shape fades in early with a shrinking ring. Dashed lines show where each finger travels to.
- **Right hand.** Cues slide along the strings from the bridge towards the white line over the soundhole.
  Strum or pick when they reach it.
  - White arrow: strum down (thick → thin strings). Grey arrow: strum up.
  - A gem on a string: pick that string. It has the colour of the finger fretting it, or white if the string is open.

By default the game gives no feedback; you just play along. An optional **microphone mode** listens to your guitar
and grades each strum or pick as *Perfect*, *Good*, *Wrong notes* or *Miss*:

- An onset detector (spectral flux) catches the strike.
- For single notes, a YIN pitch detector checks the pitch.
- For chords, a 12-bin chroma profile is compared against the expected chord.

## Running it

It is a static site with no build step. Three.js loads from a CDN. Serve the folder with any static web server,
because ES modules don't load over `file://`:

```sh
npx http-server -p 8080 .
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080>. The site can also be hosted as-is on GitHub Pages.

Microphone access needs a secure context: `localhost` or HTTPS.

## Controls

| Key / control      | Action                                 |
| ------------------ | -------------------------------------- |
| Space              | Play / pause                           |
| R                  | Restart (with a one-bar count-in)      |
| ← / →              | Jump back / forward one bar            |
| Drag / scroll      | Move / zoom the camera                 |
| Speed slider       | 40–120 % tempo                         |
| Look-ahead slider  | How early cues appear                  |
| Play-along sound   | Synthesised guitar playing the part    |
| Mic delay          | Compensates for microphone latency     |

The settings panel folds away while a song plays, and comes back when you pause.

## Songs

- Finger Warm-up: one finger per fret, frets 1–4 across all strings.
- Two-Chord Strum: Em / Am, downstrokes.
- Campfire Strum: G – Em – C – D with a D DU UDU pattern.
- Ode to Joy (Beethoven): single-note melody.
- House of the Rising Sun (traditional): fingerpicked arpeggios in 6/8.

To add a song, edit `js/songs.js`. Songs are built from chord progressions with strum patterns, from note lists,
or from arpeggio patterns. The `CHORDS` table defines frets and fingers per string, from low E to high e.

## Code layout

| File             | What it does                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `js/main.js`     | Scene setup, clock, audio scheduling, HUD, UI wiring                  |
| `js/guitar.js`   | Procedural 3D guitar and fretboard geometry (fret / string positions) |
| `js/cues.js`     | Left-hand finger markers and the right-hand cue highway               |
| `js/songs.js`    | Chord shapes and song data                                            |
| `js/audio.js`    | Karplus–Strong string synth and metronome                             |
| `js/mic.js`      | Microphone onset, pitch and chord detection, and grading              |

## Testing microphone mode without a guitar

Open `index.html?selftest`. Microphone mode then listens to the play-along synth instead of the real microphone.
Playing along "perfectly" should score mostly Perfect.

Grading of picked notes during arpeggios is the least reliable part, because other strings are still ringing.
Untick *Check the right notes* to grade timing only.
