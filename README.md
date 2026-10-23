# Fretview

A Guitar Hero–style practice game for a **real guitar** that runs in the browser.

The default **Highway** view looks up the neck from the body, like the note highway in Guitar Hero: the nut is at
the top and the strings run E A D G B e from left to right, the way chord charts draw them. The camera follows your
fretting hand up and down the neck. *Player* view (under *Camera* in the settings) shows the whole guitar the way you
see your own when you look down at it: headstock on the left, thickest string nearest to you. The choice is
remembered. There is no sheet music and there are no note names. The game only shows what each hand has to do:

- **Left hand.** Coloured gems on the fretboard show which finger goes where, in the fret-button colours of
  Guitar Hero 3: index green, middle red, ring yellow, pinky blue.
  ○ at the nut means play the string open, and ✕ at the nut means don't play it.
  Each dot sits just behind its fret wire, where the fingertip presses, so fingers on the same fret line up in a
  row. Fret numbers are written along the low E side.
  Colour always means a finger: a picking cue has the colour of the finger fretting its string, or white when the
  string is open.
  Filled dots are the chord to hold; the next chord shows as hollow rings in the same finger colours, and a ring
  round a filled dot means that finger stays put. As soon as the last strum of a chord has gone past the line, the
  next chord fills in, so your fingers can move before its first strum arrives; the *Now* and *Next* chords in the
  info box switch at the same moment. Below 100 % speed, a chord the game is still waiting for stays on the neck
  until it has been played right.
- **Right hand.** Below the hand, strums and picks fall down the strum lane to the white line, like notes in
  Guitar Hero. Strum or pick when they reach it.
  - A bar across the strings: strum those strings. White with ↓: strum down (thick → thin strings).
    Grey with ↑: strum up.
  - A gem on a string: pick that string. It has the colour of the finger fretting it, or white if the string is open.
  - The first strum of each new chord has the chord's name beside the lane, so a change can be seen coming.

**📖 How to read the screen** on the start screen explains all of this, with the keys.

The song title, the chord now and next, and where you are in the song sit in a small box in the bottom-left
corner, with a progress bar you can click to jump. Lesson and practice-speed feedback appear in the bottom-right
corner.

## Getting around

The start screen offers **Chord lessons** and **Play songs**. Neither starts anything on its own:

- **Play songs** opens a song list (↑ / ↓ to move through it). Pick a song, a practice speed and whether to
  hear the play-along guitar, then press Play (or Space). The last song you picked is remembered.
- **Chord lessons** opens the list of lessons. Finished lessons get a ✓ and are remembered, and the big button
  continues with the first one you haven't done yet. Any lesson can also be started straight from the list.

**🎵 Tune your guitar first** (under the two buttons, next to *How to read the screen*, or *Open tuner* next to the small tuner readout in the
settings) opens the tuner. Play one string at a time: it works out which string you're playing, and a needle
shows how many cents sharp or flat it is, moving as the pitch changes, with a hint to tighten or loosen.
Once a string has stayed within ±5 cents for a moment, a ✓ pops up with a chime and the string gets a ✓ in the
row above the dial; when all six are in tune you hear a longer chime. Tap a string in that row to tune only
that string (useful when it's so far off that it sounds like a neighbouring string); tap it again to go back
to automatic. The tuner always uses standard tuning (E A D G B e) and ignores a song's capo.

When a song ends, the results screen offers *Play again*, the next lesson after a drill, or a way back to the
list. *Exit* in a lesson goes back to the lesson list. **⌂ Menu** in the settings, or Esc while paused, returns
to the start screen.

Settings (practice speed, play-along sound, metronome, loop, look-ahead, mic delay) are remembered between
visits. The "In time" drills switch the metronome on and play at 100 %, and your own settings come back when
you leave the drill. Below 100 %, the HUD shows the speed next to the song title.

If the microphone can't be opened, the app says why in plain words (blocked, not found, in use by another app)
instead of failing silently. A lesson then still shows its chord and offers *Try again*.

## Magnifier

**🔍 Magnify the neck** (in the settings, the 🔍 button, or the M key) adds a close-up of the fretting hand's
part of the neck in the top-left corner, seen from above so the strings are well apart. It follows the chord
shape along the neck. Below it, the shape is spelled out: which finger goes on which string and fret, which
strings ring open, and which not to play. The setting is remembered.

## Chord lessons

The lessons teach one chord at a time with no time pressure (Em, Am, E, A, D, C, G, Dm and Bm), then build up the
changes between them in three steps, grouped by the song they lead to:

1. **Changing X ↔ Y**: change at your own pace. The lesson waits until it hears each chord right.
2. **Quick changes X ↔ Y**: against the clock. The clock runs from one right chord to the next, and the next
   chord is already shown faded on the neck. Four changes under 3 s finish level 1, then under 2 s, then under 1.5 s.
3. **In time: X ↔ Y**: a change drill played as a song with the metronome. It starts with one strum per bar,
   so there are three silent beats to move, then two, three and four strums per bar.

The drills are also in the song list under *Chord-change drills*. After a drill, the results screen offers the
next lesson. Lessons you have finished are ticked off in the lesson list.
The chord to hold is shown on the neck. The lesson listens through the device microphone and moves on only
when it hears the chord played correctly. When a strum is wrong, it says what to fix:

- "The G string isn't ringing" when a string's fundamental frequency is missing.
- "That sounded more like E" when another chord matches better.

**Hear it** plays the chord once so you know how it should sound. The microphone ignores that playback.

How the check works (`MicJudge.analyzeChord` in `js/mic.js`):

1. About 0.4–0.6 s after a strum, a long FFT (16384 samples) is folded into a 12-note chroma profile.
2. That profile is compared with an expected profile built from each string's note plus its first overtones.
3. The strum passes if it matches the expected chord well, and better than every other chord the app knows,
   by a margin. The margin is what tells near-twins like Em / E or Am / A apart.

## Songs

The game is silent by default. The play-along guitar sound can be switched on in the settings.
Pressing Play hides the settings and counts down 3, 2, 1 on screen before the song starts. The ❚❚ button
in the corner (or Space) pauses and brings the settings back. Playing on resumes from the start of the bar
you paused in. Switching to another tab or app pauses the song.

**Practice speeds.** Every song can be played at 25 %, 50 %, 75 % or 100 % speed. Below 100 %, the song stops at
the start of each bar and waits until the microphone hears the chord played right; the same feedback as in the
lessons tells you what to fix. In single-note songs it waits for every note. The cues keep sliding a little way
past the line while the microphone listens, so playing on time doesn't stall the song; it only stops if you
haven't played it right by then. At 100 % it plays straight through.

An optional **microphone mode** listens to your guitar and grades each strum or pick as
*Perfect*, *Good*, *Wrong notes* or *Miss*:

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

Then open <http://localhost:8080>.

Every push to `main` publishes the site to GitHub Pages through `.github/workflows/pages.yml`.
In the repository settings, under **Pages**, the source must be set to **GitHub Actions**.

Microphone access needs a secure context: `localhost` or HTTPS.

## Controls

| Key / control      | Action                                 |
| ------------------ | -------------------------------------- |
| Space              | Play / pause                           |
| Esc                | Pause; when paused, back to the menu. In a lesson, exit it |
| R                  | Restart (with a one-bar count-in)      |
| ← / →              | Jump back / forward one bar            |
| Drag / scroll      | Move / zoom the camera (Player and Top view) |
| Camera             | Highway (looking up the neck, strums falling to the line), Player or Top |
| Practice speed     | 25 / 50 / 75 / 100 %; below 100 % the song waits for you |
| Look-ahead slider  | How early cues appear                  |
| Play-along sound   | Synthesised guitar playing the part (off by default) |
| Mic delay          | Compensates for microphone latency     |

The settings panel folds away while a song plays, and comes back when you pause.

## Songs

- Amazing Grace (traditional): G, C and D, three down-strums per bar. A good first song after the lessons.
- Finger Warm-up: one finger per fret, frets 1–4 across all strings.
- Two-Chord Strum: Em / Am, downstrokes.
- Campfire Strum: G – Em – C – D with a D DU UDU pattern.
- Ode to Joy (Beethoven): single-note melody.
- House of the Rising Sun (traditional): fingerpicked arpeggios in 6/8.
- Cinnamon Girl (Lana Del Rey): the C – Em – D – Am loop with a capo on the 2nd fret. Only the chords and a strum
  pattern, no melody or lyrics.
- One (Metallica): the clean intro simplified to Bm – G – D, with an easy four-string Bm (no barre). Only the
  chords and a strum pattern, no melody or lyrics.

A song can set `capo`. The dots and fret numbers then count from the capo, the way chord sheets write it,
and the play-along sound and the microphone check use the pitches the capo gives. The HUD shows a *Capo* badge.

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
| `js/tuner.js`    | Tuner: pitch tracking, string detection, in-tune check and chime      |
| `js/lessons.js`  | Chord lessons and the lesson runner (listens, judges, explains)       |

## Testing microphone mode without a guitar

Open `index.html?selftest`. Microphone mode, lessons and the tuner then listen to the synth instead of the real microphone.
For songs, switch the play-along sound on; playing along "perfectly" should score mostly Perfect.
For lessons, `fretview.audio.playEvent(...)` in the console strums any chord into the detector.

Grading of picked notes during arpeggios is the least reliable part, because other strings are still ringing.
Untick *Check the right notes* to grade timing only.
