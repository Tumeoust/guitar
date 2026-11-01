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
  { group: 'Single chords', title: 'Bm — B minor', chords: ['Bm'], reps: 3,
    tip: 'The easy Bm, no barre: index on the high e at the 2nd fret, middle on the B string at the 3rd, ring on the D string and pinky on the G string at the 4th. Strum the four thinnest strings.' },

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

  { group: 'C, Em, D and Am (Cinnamon Girl)', title: 'Changing C → Em → D → Am', chords: ['C', 'Em', 'D', 'Am', 'C', 'Em', 'D', 'Am', 'C'], reps: 1,
    tip: 'C → Em: ring and middle each move one string towards you, the index lifts off. Em → D: a new shape — aim the index at the G string first. D → Am: index to the B string at the 1st fret, middle and ring onto the D and G strings. Am → C: only the ring finger moves, up to the A string at the 3rd fret.' },
  { group: 'C, Em, D and Am (Cinnamon Girl)', title: 'Quick changes C → Em → D → Am', kind: 'race', chords: ['C', 'Em', 'D', 'Am'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Am → C is the easy one: index and middle stay put, only the ring finger moves.` },
  { group: 'C, Em, D and Am (Cinnamon Girl)', title: 'In time: C – Em – D – Am', kind: 'song', song: 'drill-cinnamon',
    tip: 'The loop of Cinnamon Girl. After this, try the song itself — with a capo on the 2nd fret.' },

  { group: 'Bm, G and D (One)', title: 'Changing Bm ↔ G', chords: ['Bm', 'G', 'Bm', 'G', 'Bm', 'G'], reps: 1,
    tip: 'Bm → G: the whole hand moves down the neck. Lift all four fingers, then land middle on the low E, index on the A string and ring on the high e. Strum all six strings for G, only four for Bm.' },
  { group: 'Bm, G and D (One)', title: 'Changing Bm → D → G', chords: ['Bm', 'D', 'G', 'Bm', 'D', 'G', 'Bm'], reps: 1,
    tip: 'Bm → D: move the hand two frets towards the headstock and make the small D triangle — index to the G string at the 2nd fret, ring to the B string at the 3rd, middle to the high e at the 2nd.' },
  { group: 'Bm, G and D (One)', title: 'Quick changes Bm ↔ G', kind: 'race', chords: ['Bm', 'G'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Keep your thumb behind the neck and move your arm, not just your fingers.` },
  { group: 'Bm, G and D (One)', title: 'In time: Bm ↔ G', kind: 'song', song: 'drill-bm-g',
    tip: 'The main change of One. After this, try the song itself.' },

  { group: 'Em, C, D, G and Am (I See Fire)', title: 'Changing Em → C → D', chords: ['Em', 'C', 'D', 'Em', 'C', 'D', 'Em'], reps: 1,
    tip: 'Em → C: ring finger to the A string at the 3rd fret, middle to the D string at the 2nd, index onto the B string at the 1st. C → D: aim the index at the G string at the 2nd fret first. D → Em: middle and ring onto the A and D strings at the 2nd fret.' },
  { group: 'Em, C, D, G and Am (I See Fire)', title: 'Changing Am → Em → G → D', chords: ['Am', 'Em', 'G', 'D', 'Am', 'Em', 'G', 'D', 'Am'], reps: 1,
    tip: 'The bridge of I See Fire. Am → Em: middle and ring each move one string towards the thick strings, the index lifts off. Em → G: middle to the low E at the 3rd fret, index to the A string at the 2nd, ring to the high e at the 3rd. G → D: lead with the index on the G string. D → Am: index to the B string at the 1st fret, middle and ring onto the D and G strings.' },
  { group: 'Em, C, D, G and Am (I See Fire)', title: 'In time: Em – C – D', kind: 'song', song: 'drill-i-see-fire',
    tip: 'The chorus changes of I See Fire. After this, try the song itself — with a capo on the 6th fret.' },

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

  // The courses after the open chords: new shapes, then barre chords.
  { group: 'F, Dm, C and Am (Aerials)', title: 'F — F major (small F)', chords: ['F'], reps: 3,
    tip: 'The small F: index flat across the B and high e strings at the 1st fret, middle on the G string at the 2nd, ring on the D string at the 3rd. Strum the four thinnest strings. Roll the index slightly onto its side so both strings ring.' },
  { group: 'F, Dm, C and Am (Aerials)', title: 'Changing C ↔ F', chords: ['C', 'F', 'C', 'F', 'C', 'F'], reps: 1,
    tip: 'C → F: the index stays on the B string at the 1st fret and flattens to cover the high e too. Ring moves from the A to the D string, middle from the D to the G string.' },
  { group: 'F, Dm, C and Am (Aerials)', title: 'Quick changes C ↔ F', kind: 'race', chords: ['C', 'F'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Keep the index on the B string as your pivot; ring and middle each hop one string over.` },
  { group: 'F, Dm, C and Am (Aerials)', title: 'In time: C ↔ F', kind: 'song', song: 'drill-c-f',
    tip: 'One strum per bar first, so you have three beats to move. Each round leaves one beat less.' },
  { group: 'F, Dm, C and Am (Aerials)', title: 'Changing Dm → C → F → Am', chords: ['Dm', 'C', 'F', 'Am', 'Dm', 'C', 'F', 'Am', 'Dm'], reps: 1,
    tip: 'Dm → C: a new shape — ring to the A string at the 3rd fret, middle to the D string, index to the B string. C → F: the index flattens over the B and high e. F → Am: the index stays on the B string at the 1st fret; middle and ring drop onto the D and G strings at the 2nd. Am → Dm: index to the high e, middle to the G string, ring to the B string at the 3rd.' },
  { group: 'F, Dm, C and Am (Aerials)', title: 'In time: Dm – C – F – Am', kind: 'song', song: 'drill-aerials',
    tip: 'The changes of Aerials. After this, try the song itself.' },

  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'E7 — E seven', chords: ['E7'], reps: 3,
    tip: 'An E with the ring finger lifted: middle on the A string at the 2nd fret, index on the G string at the 1st. The open D string gives it the bluesy sound. Strum all six strings.' },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'A7 — A seven', chords: ['A7'], reps: 3,
    tip: 'Middle on the D string and ring on the B string, both at the 2nd fret; the G string between them rings open. Start the strum on the A string.' },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'B7 — B seven', chords: ['B7'], reps: 3,
    tip: 'Your first four-finger chord: middle on the A string at the 2nd fret, index on the D string at the 1st, ring on the G string and pinky on the high e at the 2nd. The B string rings open. Start the strum on the A string.' },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'Changing E7 ↔ A7', chords: ['E7', 'A7', 'E7', 'A7', 'E7', 'A7'], reps: 1,
    tip: 'E7 → A7: the middle finger moves one string over, from the A to the D string; the index lifts off the G string and the ring lands on the B string.' },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'Changing E7 ↔ B7', chords: ['E7', 'B7', 'E7', 'B7', 'E7', 'B7'], reps: 1,
    tip: 'The middle finger stays on the A string at the 2nd fret in both chords — keep it down and move the others around it.' },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'Quick changes E7 ↔ B7', kind: 'race', chords: ['E7', 'B7'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}The middle finger is your anchor: it never leaves the A string.` },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'Changing B7 → A7 → E7', chords: ['B7', 'A7', 'E7', 'B7', 'A7', 'E7', 'B7'], reps: 1,
    tip: 'The turnaround at the end of every blues. B7 → A7: lift index and pinky, middle hops to the D string, ring to the B string. A7 → E7: middle back to the A string, index onto the G string.' },
  { group: 'E7, A7 and B7 (12-Bar Blues)', title: 'In time: E7 – A7 – E7 – B7', kind: 'song', song: 'drill-blues',
    tip: 'The changes of the 12-bar blues. After this, try 12-Bar Blues in E.' },

  { group: 'G7, C7 and D7 (When the Saints)', title: 'G7 — G seven', chords: ['G7'], reps: 3,
    tip: 'Like G, but the high e is fretted at the 1st fret: ring on the low E at the 3rd, middle on the A string at the 2nd, index on the high e at the 1st. Strum all six strings.' },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'D7 — D seven', chords: ['D7'], reps: 3,
    tip: 'A D triangle turned upside down: middle on the G string and ring on the high e at the 2nd fret, index on the B string at the 1st. Strum the four thinnest strings.' },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'C7 — C seven', chords: ['C7'], reps: 3,
    tip: 'A C with the pinky added on the G string at the 3rd fret. Make the C first, then reach with the pinky. Start the strum on the A string.' },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'Changing G → G7 → C', chords: ['G', 'G7', 'C', 'G', 'G7', 'C', 'G'], reps: 1,
    tip: 'G7 wants to move to C. G → G7: ring onto the low E at the 3rd fret, middle onto the A string at the 2nd, index onto the high e at the 1st. G7 → C: ring and middle each move one string towards the floor, to the A and D strings; the index moves from the high e to the B string.' },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'Changing D7 ↔ G', chords: ['D7', 'G', 'D7', 'G', 'D7', 'G'], reps: 1,
    tip: 'D7 → G: the whole hand reaches over to the thick strings. Land the middle on the low E first; the others follow.' },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'Changing C → C7 → F', chords: ['C', 'C7', 'F', 'C', 'C7', 'F', 'C'], reps: 1,
    tip: 'C7 wants to move to F. C → C7: just add the pinky on the G string at the 3rd fret. C7 → F: the index stays on the B string and flattens, the ring slides to the D string, the middle to the G string.' },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'Quick changes G7 ↔ C', kind: 'race', chords: ['G7', 'C'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}Ring and middle move together, one string towards the floor, while the index hops from the high e to the B string.` },
  { group: 'G7, C7 and D7 (When the Saints)', title: 'In time: G – G7 – C – D7', kind: 'song', song: 'drill-saints',
    tip: 'The changes of When the Saints Go Marching In. After this, try the song itself.' },

  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'Em7 — E minor seven', chords: ['Em7'], reps: 3,
    tip: 'Index on the A string and middle on the D string at the 2nd fret, ring on the B string and pinky on the high e at the 3rd. Strum all six strings. Ring and pinky are the anchor: they stay put for the next chords.' },
  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'Cadd9 — C add nine', chords: ['Cadd9'], reps: 3,
    tip: 'Ring and pinky on the 3rd fret of the B and high e strings, middle on the A string at the 3rd, index on the D string at the 2nd. Start the strum on the A string.' },
  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'Dsus4 — D sus four', chords: ['Dsus4'], reps: 3,
    tip: 'Ring and pinky on the 3rd fret of the B and high e strings, index on the G string at the 2nd. Strum the four thinnest strings.' },
  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'Changing Em7 → Cadd9 → Dsus4', chords: ['Em7', 'Cadd9', 'Dsus4', 'Em7', 'Cadd9', 'Dsus4', 'Em7'], reps: 1,
    tip: 'Keep ring and pinky pressed the whole time. Em7 → Cadd9: index and middle swap — middle to the A string at the 3rd fret, index to the D string at the 2nd. Cadd9 → Dsus4: lift the middle, index to the G string. Dsus4 → Em7: index and middle back onto the A and D strings.' },
  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'Quick changes Em7 → Cadd9 → Dsus4', kind: 'race', chords: ['Em7', 'Cadd9', 'Dsus4'], targets: [2.5, 1.5, 1], per: 4,
    tip: `${SLOW}With ring and pinky anchored, only one or two fingers move — these can get really fast.` },
  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'Changing G ↔ Cadd9', chords: ['G', 'Cadd9', 'G', 'Cadd9', 'G', 'Cadd9'], reps: 1,
    tip: 'G → Cadd9: ring from the high e down to the B string, pinky onto the high e, middle from the low E to the A string, index from the A to the D string. Cadd9 → G: pinky lifts, ring back to the high e.' },
  { group: 'Em7, Cadd9 and Dsus4 (Anchor fingers)', title: 'In time: Em7 – Cadd9 – Dsus4 – G', kind: 'song', song: 'drill-anchor',
    tip: 'The anchor family in time. After this, try Anchor Strum.' },

  { group: 'Asus2, Dsus2 and Dsus4 (Colour chords)', title: 'Asus2 — A sus two', chords: ['Asus2'], reps: 3,
    tip: 'An A with the B string left open: index on the D string and middle on the G string at the 2nd fret. Start the strum on the A string.' },
  { group: 'Asus2, Dsus2 and Dsus4 (Colour chords)', title: 'Dsus2 — D sus two', chords: ['Dsus2'], reps: 3,
    tip: 'A D with the high e left open: index on the G string at the 2nd fret, ring on the B string at the 3rd. Strum the four thinnest strings.' },
  { group: 'Asus2, Dsus2 and Dsus4 (Colour chords)', title: 'Changing A → Asus2 → A', chords: ['A', 'Asus2', 'A', 'Asus2', 'A', 'Asus2', 'A'], reps: 1,
    tip: 'Play A with index, middle and ring, then just lift the ring finger for Asus2 and put it back. The other two never move.' },
  { group: 'Asus2, Dsus2 and Dsus4 (Colour chords)', title: 'Changing D → Dsus4 → D → Dsus2', chords: ['D', 'Dsus4', 'D', 'Dsus2', 'D', 'Dsus4', 'D', 'Dsus2', 'D'], reps: 1,
    tip: 'Hold the D with index and ring. Dsus4: swap the middle for the pinky on the high e at the 3rd fret. Dsus2: lift the middle off the high e so it rings open. Index and ring stay down the whole time.' },
  { group: 'Asus2, Dsus2 and Dsus4 (Colour chords)', title: 'In time: D – Dsus4 – D – Dsus2', kind: 'song', song: 'drill-sus',
    tip: 'Flicking a finger on and off in time is how players make a plain chord move. Keep the strum going.' },

  { group: 'Am7 and Fmaj7 (Soft Sevenths)', title: 'Am7 — A minor seven', chords: ['Am7'], reps: 3,
    tip: 'An Am with the ring finger lifted: middle on the D string at the 2nd fret, index on the B string at the 1st; the G string rings open. Start the strum on the A string.' },
  { group: 'Am7 and Fmaj7 (Soft Sevenths)', title: 'Fmaj7 — F major seven', chords: ['Fmaj7'], reps: 3,
    tip: 'A small F with the high e left open: ring on the D string at the 3rd fret, middle on the G string at the 2nd, index on the B string at the 1st — just the tip, so the high e rings. Strum the four thinnest strings.' },
  { group: 'Am7 and Fmaj7 (Soft Sevenths)', title: 'Changing C → Am7 → Fmaj7', chords: ['C', 'Am7', 'Fmaj7', 'C', 'Am7', 'Fmaj7', 'C'], reps: 1,
    tip: 'The index stays on the B string at the 1st fret in all three chords. C → Am7: lift the ring. Am7 → Fmaj7: ring onto the D string at the 3rd, middle onto the G string at the 2nd.' },
  { group: 'Am7 and Fmaj7 (Soft Sevenths)', title: 'Quick changes Fmaj7 ↔ G', kind: 'race', chords: ['Fmaj7', 'G'], targets: [3, 2, 1.5], per: 4,
    tip: `${SLOW}The hand moves from the thin strings to the thick ones: lift everything, land the middle on the low E first.` },
  { group: 'Am7 and Fmaj7 (Soft Sevenths)', title: 'In time: C – Am7 – Fmaj7 – G', kind: 'song', song: 'drill-soft',
    tip: 'The changes of Soft Sevenths. After this, try the song itself.' },

  { group: 'F and Bm barre (First Barre)', title: 'F barre — the full F', chords: ['F barre'], reps: 3,
    tip: 'Lay the index flat across all six strings at the 1st fret, close behind the fret wire. Then middle on the G string at the 2nd fret, ring on the A string and pinky on the D string at the 3rd. Thumb low behind the neck, and pull back gently with your arm instead of squeezing. Strum all six strings.' },
  { group: 'F and Bm barre (First Barre)', title: 'Changing F ↔ F barre', chords: ['F', 'F barre', 'F', 'F barre', 'F', 'F barre'], reps: 1,
    tip: 'Go from the small F to the full one: flatten the index over all six strings and add the pinky. If a string buzzes, roll the index slightly onto its bony side.' },
  { group: 'F and Bm barre (First Barre)', title: 'Changing C ↔ F barre', chords: ['C', 'F barre', 'C', 'F barre', 'C', 'F barre'], reps: 1,
    tip: 'C → F barre: put the barre down first, then the other three fingers together. F barre → C: lift everything and land the ring on the A string at the 3rd fret.' },
  { group: 'F and Bm barre (First Barre)', title: 'In time: C ↔ F barre', kind: 'song', song: 'drill-barre-f',
    tip: 'One strum per bar first, so you have three beats to build the barre. Each round leaves one beat less.' },
  { group: 'F and Bm barre (First Barre)', title: 'Bm barre — the full Bm', chords: ['Bm barre'], reps: 3,
    tip: 'The index lies across the A to high e strings at the 2nd fret, ring on the D string and pinky on the G string at the 4th, middle on the B string at the 3rd. The low E stays silent — let the tip of the index touch it. Start the strum on the A string.' },
  { group: 'F and Bm barre (First Barre)', title: 'Changing Bm ↔ Bm barre', chords: ['Bm', 'Bm barre', 'Bm', 'Bm barre', 'Bm', 'Bm barre'], reps: 1,
    tip: 'The easy Bm is the top of the full one. Keep middle, ring and pinky where they are and lay the index down across five strings.' },
  { group: 'F and Bm barre (First Barre)', title: 'Changing Bm barre → G → D → A', chords: ['Bm barre', 'G', 'D', 'A', 'Bm barre', 'G', 'D', 'A', 'Bm barre'], reps: 1,
    tip: 'Bm barre → G: lift the barre and land middle on the low E, index on the A string, ring on the high e. A → Bm barre: slide the hand up a fret and lay the index flat.' },
  { group: 'F and Bm barre (First Barre)', title: 'Quick changes C ↔ F barre', kind: 'race', chords: ['C', 'F barre'], targets: [4, 3, 2], per: 4,
    tip: `${SLOW}Barres are slower to build: the first target gives you 4 seconds.` },
  { group: 'F and Bm barre (First Barre)', title: 'In time: C – G – Am – F barre', kind: 'song', song: 'drill-barre',
    tip: 'The verse of First Barre. After this, try the song itself.' },
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
  if (result.rivalWins) {
    return `That sounded more like ${result.rival}. Check each finger against the dots.`;
  }
  return 'Not quite — check the finger positions and strum again.';
}
