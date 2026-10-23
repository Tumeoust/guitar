import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildGuitar, fretX } from './guitar.js';
import { Cues, FINGER_COLORS } from './cues.js';
import { SONGS, CHORDS, CHORD_NAMES, strumEvent } from './songs.js';
import { GuitarAudio } from './audio.js';
import { MicJudge, LESSON } from './mic.js';
import { midiName, setCapo } from './music.js';
import { LESSONS, LessonRunner, CANDIDATES, chordFeedback, stringName } from './lessons.js';
import { Tuner, TUNER_STRINGS, chime } from './tuner.js';

const $ = (id) => document.getElementById(id);

// ---- Scene -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a1c14, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(30, 60, 40);
scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
rim.position.set(-40, 20, -30);
scene.add(rim);

const guitar = buildGuitar();
scene.add(guitar.root);
const cues = new Cues();
scene.add(cues.root);

const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 400;
controls.minDistance = 10;

// "Player" looks down over the low-E side of the neck, like you do when holding a guitar.
const VIEWS = {
  player: { pos: [52, 60, 62], target: [28, -4, 0] },
  top: { pos: [30, 100, 3], target: [30, 0, 0] },
  // Lessons are about the fretting hand: closer in on the first frets.
  lesson: { pos: [30, 36, 38], target: [11, -3, 0] },
};
let currentView = 'player';
function setView(name) {
  currentView = name;
  const v = VIEWS[name];
  // The views are framed for a 16:9-ish window; back off on narrower ones so the whole guitar fits.
  const back = Math.max(1, 1.6 / camera.aspect);
  controls.target.set(...v.target);
  camera.position.set(...v.pos).sub(controls.target).multiplyScalar(back).add(controls.target);
  controls.update();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = 30;
  camera.updateProjectionMatrix();
  setView(currentView);
}
window.addEventListener('resize', resize);
resize();

// ---- Game state ------------------------------------------------------------
const state = {
  song: SONGS[0],
  playing: false,
  countdownEnd: null, // performance.now() ms at which the 3-2-1 before playing ends
  anchorTime: 0,
  anchorBeat: 0,
  speed: 1,
  lookSec: 2.4,
  guide: false,
  metro: false,
  loop: false,
  scheduledBeat: 0,
  visBeat: 0,
  judgeIndex: 0,
  stats: null,
  // Practice mode (below 100 % speed): the clock stops at each wait point until it is played right.
  waiting: null,
  waitOnset: 0,
  waitTries: 0,
  waitCap: 0,
  lastWaitBeat: -Infinity,
  practice: null,
  lessonSong: null, // index in LESSONS while a change drill from the lessons is playing
};
let audio = null;
let mic = null;
let lesson = null; // a LessonRunner while in lesson mode
let tuner = null;
let autoNext = null; // timer that starts the next lesson
let sensitivity = 5;
try { sensitivity = Number(localStorage.getItem('fretview.sensitivity')) || 5; } catch { /* storage unavailable */ }
// ?selftest feeds the play-along synth into the detector instead of the microphone.
const selfTest = new URLSearchParams(location.search).has('selftest');

const clockNow = () => (audio ? audio.ctx.currentTime : performance.now() / 1000);
const beatsPerSec = () => (state.song.bpm / 60) * state.speed;
const beatAt = (t) => (state.playing ? state.anchorBeat + (t - state.anchorTime) * beatsPerSec() : state.anchorBeat);
const timeOfBeat = (b) => state.anchorTime + (b - state.anchorBeat) / beatsPerSec();
const practiceMode = () => state.speed < 0.999 && !!mic?.active;
// Practice mode stops at the first chord anyway, so a long count-in at 25 % speed would only be in the way.
const countInBeats = () => (state.speed < 0.999 ? 1 : state.song.beatsPerBar);
const COUNTDOWN_SEC = 3;
const counting = () => state.countdownEnd != null;
const running = () => state.playing || counting();
// The microphone needs a moment to judge a note, so in practice mode the cues keep flowing past the
// line for this long (from the cue's beat) before the clock stops and waits.
const graceSec = (ev) => (ev.kind === 'pick' ? 0.25 : LESSON.wait) + 0.5;
const OVERRUN_SEC = LESSON.wait + 0.5;

function ensureAudio() {
  if (!audio) audio = new GuitarAudio();
  audio.resume();
}

function resetStats() {
  state.stats = { perfect: 0, good: 0, wrong: 0, miss: 0, streak: 0, best: 0 };
  state.practice = { total: 0, firstTry: 0 };
  renderStats();
}

function anchor(beat) {
  state.anchorBeat = beat;
  state.anchorTime = clockNow();
  state.scheduledBeat = beat;
  state.visBeat = beat;
  state.judgeIndex = state.song.right.findIndex((ev) => ev.beat >= beat);
  if (state.judgeIndex < 0) state.judgeIndex = state.song.right.length;
  state.waiting = null;
  state.lastWaitBeat = beat - 1e-6;
}

// Starts the 3-2-1 countdown; frame() calls startPlaying() when it runs out.
function play() {
  if (running()) return;
  ensureAudio();
  if (state.speed < 0.999 && !mic?.active) {
    enableMic().then((err) => err && setPracticeStatus(`${err}. The song won't wait for you.`, 'bad'));
  }
  hideMenu();
  if (state.anchorBeat >= state.song.length) {
    state.anchorBeat = -countInBeats();
    resetStats();
  }
  state.countdownEnd = performance.now() + COUNTDOWN_SEC * 1000;
  updatePlayButton();
}

function startPlaying() {
  state.countdownEnd = null;
  $('countdown').hidden = true;
  anchor(state.anchorBeat);
  state.playing = true;
  updatePlayButton();
}

function showCountdown(n) {
  const el = $('countdown-num');
  $('countdown').hidden = false;
  if (el.textContent === String(n)) return;
  el.textContent = n;
  el.classList.remove('tick');
  void el.offsetWidth; // restart the animation
  el.classList.add('tick');
}

function pause() {
  if (counting()) {
    state.countdownEnd = null;
    $('countdown').hidden = true;
    $('countdown-num').textContent = '';
    updatePlayButton();
    return;
  }
  if (!state.playing) return;
  // Resume an unfinished wait point from its cue rather than skipping it.
  state.anchorBeat = state.waiting ? state.waiting.beat : beatAt(clockNow());
  state.playing = false;
  state.waiting = null;
  audio?.stopAll();
  updatePlayButton();
}

function seek(beat) {
  audio?.stopAll();
  if (state.playing) anchor(beat);
  else state.anchorBeat = beat;
}

function restart() {
  resetStats();
  seek(-countInBeats());
  if (!state.playing) play();
}

function loadSong(song) {
  pause();
  state.song = song;
  state.anchorBeat = -countInBeats();
  setCapo(song.capo);
  $('capo').hidden = !song.capo;
  $('capo').textContent = song.capo ? `Capo ${song.capo}` : '';
  $('countdown-capo').textContent = song.capo ? `Capo on fret ${song.capo}` : '';
  $('song-title').textContent = song.title;
  $('song-sub').textContent = song.subtitle;
  resetStats();
}

function setSpeed(pct) {
  const b = beatAt(clockNow());
  state.speed = pct / 100;
  state.waiting = null;
  document.querySelectorAll('.speeds button').forEach((el) => el.classList.toggle('on', Number(el.dataset.speed) === pct));
  if (state.speed < 0.999 && state.playing && !mic?.active) enableMic();
  if (state.playing) {
    state.anchorBeat = b;
    state.anchorTime = clockNow();
    state.scheduledBeat = Math.max(state.scheduledBeat, b);
  }
}

function updatePlayButton() {
  const on = running();
  $('play').textContent = on ? '❚❚ Pause' : '▶ Play';
  // Hide the settings while playing so the whole guitar is visible; they come back on pause.
  document.body.classList.toggle('playing', on);
  $('panel').classList.toggle('open', !on);
}

// ---- Audio scheduling ------------------------------------------------------
function schedule(from, to) {
  const bpb = state.song.beatsPerBar;
  const every = state.song.clickEvery || 1;
  for (let k = Math.ceil(from / every) * every; k < to; k += every) {
    if (k < 0 || state.metro) audio.click(timeOfBeat(k), ((k % bpb) + bpb) % bpb === 0);
  }
  if (!state.guide) return;
  for (const ev of state.song.right) {
    if (ev.beat >= to) break;
    if (ev.beat >= from) audio.playEvent(ev, timeOfBeat(ev.beat));
  }
}

// ---- Microphone judging ----------------------------------------------------
const GRADES = {
  perfect: { label: 'Perfect', color: '#3ddc84' },
  good: { label: 'Good', color: '#8be9fd' },
  wrong: { label: 'Wrong notes', color: '#ffb627' },
  miss: { label: 'Miss', color: '#ff5d73' },
};

function judgeEvents(now) {
  const evs = state.song.right;
  while (state.judgeIndex < evs.length) {
    const ev = evs[state.judgeIndex];
    const expected = timeOfBeat(ev.beat);
    if (mic.readyAt(expected) > now) break;
    state.judgeIndex++;
    if (ev.beat < 0) continue;
    const { grade } = mic.judge(ev, expected);
    const st = state.stats;
    st[grade]++;
    st.streak = grade === 'perfect' || grade === 'good' ? st.streak + 1 : 0;
    st.best = Math.max(st.best, st.streak);
    showPop(grade);
    cues.flashJudgement(GRADES[grade].color);
    renderStats();
  }
}

function showPop(grade) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = GRADES[grade].label;
  el.style.color = GRADES[grade].color;
  const box = $('feedback');
  box.replaceChildren(el);
}

function accuracy() {
  const s = state.stats;
  const total = s.perfect + s.good + s.wrong + s.miss;
  return total ? Math.round(((s.perfect + s.good * 0.7) / total) * 100) : null;
}

function renderStats() {
  const s = state.stats;
  const acc = accuracy();
  $('stats').innerHTML = `
    <span>Perfect</span><b>${s.perfect}</b>
    <span>Good</span><b>${s.good}</b>
    <span>Wrong notes</span><b>${s.wrong}</b>
    <span>Missed</span><b>${s.miss}</b>
    <span>Streak (best)</span><b>${s.streak} (${s.best})</b>
    <span>Accuracy</span><b>${acc == null ? '—' : acc + '%'}</b>`;
}

// Returns an error message, or null once the microphone is listening.
async function enableMic() {
  if (mic?.active) return null;
  ensureAudio();
  mic = mic || new MicJudge(audio.ctx);
  try {
    await mic.start(selfTest ? audio.guide : undefined);
  } catch (err) {
    return `Could not open the microphone: ${err.message}`;
  }
  mic.setSensitivity(sensitivity);
  mic.latency = Number($('latency').value) / 1000;
  mic.checkPitch = $('check-pitch').checked;
  $('mic-section').hidden = false;
  $('mic-toggle').textContent = '🎤 Disable microphone';
  // Only judge what comes after the mic was switched on.
  const beat = beatAt(clockNow());
  const idx = state.song.right.findIndex((ev) => ev.beat >= beat);
  state.judgeIndex = idx < 0 ? state.song.right.length : idx;
  return null;
}

async function toggleMic() {
  if (mic?.active) {
    exitLesson();
    mic.stop();
    $('mic-section').hidden = true;
    $('mic-toggle').textContent = '🎤 Enable microphone';
    return;
  }
  const err = await enableMic();
  if (err) alert(err);
}

// ---- Lessons ---------------------------------------------------------------
const lessonUi = {
  onStep: renderLesson,
  onResult(runner, result) {
    const status = $('lesson-status');
    if (result.ok) {
      status.textContent = runner.race ? raceMessage(runner, result) : `✓ That's ${runner.chord}!`;
      status.className = runner.race && result.changeTime != null && !result.fast ? 'slow' : 'ok';
      const played = runner.shape.frets.map((f, i) => (f >= 0 ? i : -1)).filter((i) => i >= 0);
      played.forEach((i) => guitar.pluck(i, 0.8));
      cues.flashStrings(played);
      cues.flashJudgement(status.className === 'slow' ? '#ffb627' : '#3ddc84');
      renderLessonDots();
    } else {
      status.textContent = runner.feedback(result);
      status.className = 'bad';
      cues.flashJudgement('#ffb627');
    }
  },
  onComplete() {
    const next = lessonIndex() + 1;
    const last = next >= LESSONS.length;
    $('lesson-status').textContent = last
      ? '🎉 All lessons complete!'
      : `🎉 Lesson complete! Next up: ${LESSONS[next].title}`;
    $('lesson-status').className = 'ok';
    $('lesson-skip').hidden = true;
    $('lesson-next').hidden = last;
    markLessonDone(lessonIndex());
    renderLessonDots();
    if (!last) autoNext = setTimeout(() => startLesson(next), 1000);
  },
};

const lessonIndex = () => (state.lessonSong ?? LESSONS.indexOf(lesson?.lesson));

function raceMessage(runner, result) {
  const next = runner.chordAt(runner.index + 1);
  if (result.changeTime == null) return `✓ ${runner.chord} — now change to ${next} as fast as you can`;
  const secs = `${result.changeTime.toFixed(1)} s`;
  if (result.levelUp) {
    const target = runner.lesson.targets[runner.level + 1];
    return target ? `✓ ${secs} — level done! Now under ${target} s. Go on with ${next}` : `✓ ${secs} — fast enough!`;
  }
  if (result.fast) return `✓ ${runner.chord} in ${secs} — next ${next}`;
  return `${runner.chord} was right but took ${secs} — aim for under ${runner.target} s. Now ${next}`;
}

function setSensitivity(value) {
  sensitivity = value;
  document.querySelectorAll('.sensitivity').forEach((el) => { el.value = value; });
  document.querySelectorAll('.sens-val').forEach((el) => { el.textContent = value; });
  mic?.setSensitivity(value);
  try { localStorage.setItem('fretview.sensitivity', value); } catch { /* storage unavailable */ }
}

async function startLesson(i) {
  clearTimeout(autoNext);
  if (LESSONS[i].kind === 'song') {
    startDrill(i);
    return;
  }
  state.lessonSong = null;
  pause();
  hideMenu();
  $('panel').classList.remove('open');
  const err = await enableMic();
  document.body.classList.add('lesson-mode');
  $('lesson').hidden = false;
  if (err) {
    lesson = null;
    $('lesson-status').textContent = `${err}. Lessons need the microphone to hear your guitar.`;
    $('lesson-status').className = 'bad';
    return;
  }
  setCapo(0);
  $('capo').hidden = true;
  lesson = new LessonRunner(LESSONS[i], mic, lessonUi);
  setView('lesson');
  $('song-title').textContent = lesson.lesson.title;
  $('song-sub').textContent = `Lesson ${i + 1} of ${LESSONS.length}`;
  $('lesson-skip').hidden = false;
  $('lesson-next').hidden = true;
  renderLesson(lesson);
}

// "In time" lessons are change drills played as songs, with the metronome and at full speed.
async function startDrill(i) {
  exitLesson();
  const idx = SONGS.findIndex((song) => song.id === LESSONS[i].song);
  select.value = idx;
  loadSong(SONGS[idx]);
  state.lessonSong = i;
  $('song-sub').textContent = `Lesson ${i + 1} of ${LESSONS.length} — ${LESSONS[i].tip}`;
  setSpeed(100);
  $('metro').checked = state.metro = true;
  await enableMic(); // for grading; the drill plays without it too
  play();
}

function exitLesson() {
  clearTimeout(autoNext);
  if (!document.body.classList.contains('lesson-mode')) return;
  lesson = null;
  mic?.expect(null);
  document.body.classList.remove('lesson-mode', 'race');
  $('lesson').hidden = true;
  setView('player');
  loadSong(state.song);
  lastHud = '';
}

function lessonStepText(runner) {
  if (runner.race) {
    const { targets } = runner.lesson;
    return `Changes under ${runner.target ?? targets[targets.length - 1]} s: ${runner.doneCount} of ${runner.total} · level ${Math.min(runner.level + 1, targets.length)} of ${targets.length}`;
  }
  return `Chord ${Math.min(runner.index + 1, runner.total)} of ${runner.total}`;
}

function renderLesson(runner) {
  if (runner.race) {
    $('lesson-tip').textContent = `${runner.lesson.tip} Keep changing ${runner.lesson.chords.join(' → ')} and strum each one; the clock runs from one right chord to the next.`;
    // Keep the verdict on the last change visible; it already names the next chord.
    if (runner.index === 0) {
      $('lesson-status').textContent = `Strum ${runner.chord} to start the clock`;
      $('lesson-status').className = '';
    }
  } else {
    $('lesson-tip').textContent = runner.lesson.chords.length > 1
      ? `${runner.lesson.tip} Now: ${runner.chord}.` : runner.lesson.tip;
    $('lesson-status').textContent = runner.index === 0
      ? `Hold ${runner.chord} and strum when you're ready`
      : `Now ${runner.chord} — strum when you're ready`;
    $('lesson-status').className = '';
  }
  renderLessonDots();
}

function renderLessonDots() {
  $('lesson-step').textContent = lessonStepText(lesson);
  $('lesson-dots').replaceChildren(...Array.from({ length: lesson.total }, (_, k) => {
    const dot = document.createElement('span');
    if (k < lesson.doneCount) dot.className = 'done';
    else if (k === lesson.doneCount) dot.className = 'now';
    return dot;
  }));
}

function updateLessonHud() {
  const hud = `lesson|${lesson.chord}|${lesson.index}|${lesson.doneCount}|${lesson.level}|${lesson.done}`;
  if (hud === lastHud) return;
  lastHud = hud;
  $('chord-now').textContent = lesson.chord;
  $('chord-next').textContent = lesson.race ? lesson.chordAt(lesson.index + 1) : '—';
  $('countin').textContent = '';
  $('barbeat').textContent = lesson.race ? `Best change ${Number.isFinite(lesson.best) ? lesson.best.toFixed(1) + ' s' : '—'}` : lessonStepText(lesson);
  $('progress-fill').style.width = `${(lesson.doneCount / lesson.total) * 100}%`;
  document.body.classList.toggle('race', lesson.race);
}

// Play the chord once so you know what it should sound like; the lesson ignores it.
function hearChord() {
  if (!lesson) return;
  ensureAudio();
  const t = audio.ctx.currentTime + 0.05;
  audio.playEvent(strumEvent(lesson.shape, 0, 'D'), t);
  lesson.mute(t + 2.5);
  const played = lesson.shape.frets.map((f, i) => (f >= 0 ? i : -1)).filter((i) => i >= 0);
  played.forEach((i) => guitar.pluck(i, 0.8));
}

// ---- HUD -------------------------------------------------------------------
let lastHud = '';
function updateHud(beat) {
  const song = state.song;
  const bpb = song.beatsPerBar;
  let now = null, next = null;
  for (const seg of song.left) {
    if (seg.beat <= beat && beat < seg.beat + seg.dur) now = seg;
    else if (seg.beat > beat) { next = seg; break; }
  }
  const nowName = now ? now.name || describe(now.shape) : '';
  const nextName = next ? next.name || describe(next.shape) : '';
  const count = state.playing && beat < 0 ? String(bpb + Math.floor(beat) + 1) : '';
  const shown = Math.max(0, Math.min(beat, song.length - 0.001));
  const bar = `Bar ${Math.floor(shown / bpb) + 1} · Beat ${Math.floor(shown % bpb) + 1}`;
  const hud = `${nowName}|${nextName}|${count}|${bar}`;
  if (hud !== lastHud) {
    lastHud = hud;
    $('chord-now').textContent = nowName || '—';
    $('chord-next').textContent = nextName || '—';
    $('countin').textContent = count;
    $('barbeat').textContent = bar;
  }
  $('progress-fill').style.width = `${Math.max(0, Math.min(1, beat / song.length)) * 100}%`;
}

// Single notes have no chord name: say where they are instead.
function describe(shape) {
  const s = shape.frets.findIndex((f) => f != null);
  if (s < 0) return '';
  const f = shape.frets[s];
  return `String ${6 - s} · ${f === 0 ? 'open' : 'fret ' + f}`;
}

// ---- Practice mode (waits for each chord) ----------------------------------
function setPracticeStatus(text, kind = '') {
  $('practice-status').textContent = text;
  $('practice-status').className = kind;
}

function waitPrompt(ev) {
  if (ev.kind === 'pick') {
    const s = ev.strings[0], f = ev.frets[s];
    return `Pick the ${stringName(s)} string${f > 0 ? `, fret ${f}` : ' (open)'}`;
  }
  const seg = state.song.left.find((l) => l.beat <= ev.beat && ev.beat < l.beat + l.dur);
  const name = seg?.name ? CHORD_NAMES[seg.name] || seg.name : 'the chord';
  return `Strum ${name} to continue`;
}

function startWait(ev, t) {
  state.waiting = ev;
  state.waitOnset = t - 0.5; // a strum just before the cue arrives still counts
  state.waitTries = 0;
  // Let the clock run on for a little while, but never past the next wait point.
  const next = state.song.right.find((e) => e.wait && e.beat > ev.beat);
  state.waitCap = Math.min(ev.beat + graceSec(ev) * beatsPerSec(), next ? next.beat : Infinity);
  mic.expect(ev.kind === 'strum' ? ev.frets : null);
  setPracticeStatus(waitPrompt(ev));
}

function checkWait(t) {
  const ev = state.waiting;
  const ready = ev.kind === 'pick' ? 0.25 : LESSON.wait;
  for (const f of mic.frames) {
    if (!f.onset || f.t <= state.waitOnset) continue;
    if (t - f.t < ready) return; // still listening to this strum
    state.waitOnset = f.t;
    let ok, why;
    if (ev.kind === 'pick') {
      ok = mic.pitchMatches(ev, f.t);
      why = 'Not that note — check the string and the fret, then pick again.';
    } else {
      const r = mic.analyzeChord(f.t, ev.frets, CANDIDATES);
      if (!r || !r.musical) continue; // bumps and noises
      ok = r.ok;
      why = !ok && chordFeedback({ frets: ev.frets, fingers: ev.fingers }, r);
    }
    state.waitTries++;
    if (!ok) {
      setPracticeStatus(why, 'bad');
      cues.flashJudgement('#ffb627');
      return;
    }
    state.practice.total++;
    if (state.waitTries === 1) state.practice.firstTry++;
    // The clock either never stopped or is held at waitCap from this frame; both just carry on.
    state.waiting = null;
    state.lastWaitBeat = ev.beat;
    cues.flashStrings(ev.strings);
    cues.flashJudgement('#3ddc84');
    setPracticeStatus('✓ Nice', 'ok');
    return;
  }
}

function showResults() {
  const acc = accuracy();
  const p = state.practice;
  $('results').innerHTML = p.total
    ? `<h2>Song complete</h2><p class="muted">${p.firstTry} of ${p.total} right on the first try</p>`
    : mic?.active && acc != null
      ? `<h2>${acc}% accuracy</h2><p class="muted">Best streak ${state.stats.best}</p>`
      : '<h2>Song complete</h2>';
  const drill = state.lessonSong;
  if (drill != null) markLessonDone(drill);
  const next = drill == null ? -1 : drill + 1;
  const hasNext = next >= 0 && next < LESSONS.length;
  $('results-next').hidden = !hasNext;
  if (hasNext) $('results-next').textContent = `Next lesson: ${LESSONS[next].title} →`;
  $('results-again').classList.toggle('primary', !hasNext);
  $('results-back').textContent = drill == null ? '← Choose another song' : '← All lessons';
  showScreen('results');
}

// ---- Menu ------------------------------------------------------------------
// The overlay holds the start screen, the song and lesson pickers, and the results. Nothing plays until
// the player has picked something and pressed a button for it.
let screen = 'home';
const inMenu = () => !$('overlay').hidden;

function showScreen(name) {
  pause();
  if (document.body.classList.contains('lesson-mode')) exitLesson();
  if (name !== 'tuner') tuner?.stop();
  screen = name;
  for (const n of ['home', 'songs', 'lessons', 'tuner', 'results']) $(`screen-${n}`).hidden = n !== name;
  $('overlay').hidden = false;
  document.body.classList.add('menu');
  if (name === 'songs') renderSongList();
  if (name === 'lessons') renderLessonList();
  if (name === 'tuner') openTuner();
  const focus = { songs: 'song-go', lessons: 'lesson-continue', results: $('results-next').hidden ? 'results-again' : 'results-next' }[name];
  if (focus) $(focus).focus({ preventScroll: true });
}

function hideMenu() {
  tuner?.stop();
  $('overlay').hidden = true;
  document.body.classList.remove('menu');
}

// Esc and the ← Back buttons go one level up.
function menuBack() {
  if (screen === 'results') showScreen(state.lessonSong == null ? 'songs' : 'lessons');
  else if (screen !== 'home') showScreen('home');
}

// Groups list items under headings; groupOf(item) names the group, make(item, i) builds its element.
function fillList(el, items, groupOf, make) {
  let group = null;
  const children = [];
  items.forEach((item, i) => {
    if (groupOf(item) !== group) {
      group = groupOf(item);
      const h = document.createElement('div');
      h.className = 'pick-group';
      h.textContent = group;
      children.push(h);
    }
    children.push(make(item, i));
  });
  el.replaceChildren(...children);
}

function pickItem(html, className = '') {
  const el = document.createElement('button');
  el.className = `pick-item ${className}`;
  el.innerHTML = html;
  return el;
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const songGroup = (song) => (song.drill ? 'Chord-change drills' : 'Songs');

function renderSongList() {
  fillList($('song-list'), SONGS, songGroup, (song, i) => {
    const capo = song.capo ? ` <span class="badge">Capo ${song.capo}</span>` : '';
    const el = pickItem(`<b>${escapeHtml(song.title)}${capo}</b><span class="muted small">${escapeHtml(song.subtitle)}</span>`,
      song === state.song ? 'on' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', song === state.song);
    el.addEventListener('click', () => chooseSong(i));
    el.addEventListener('dblclick', startSong);
    return el;
  });
  $('song-go').textContent = `▶ Play ${state.song.title}`;
  $('song-list').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

function chooseSong(i) {
  state.lessonSong = null;
  select.value = i;
  if (SONGS[i] !== state.song) loadSong(SONGS[i]);
  try { localStorage.setItem('fretview.song', SONGS[i].id); } catch { /* storage unavailable */ }
  if (screen === 'songs' && inMenu()) renderSongList();
}

function startSong() {
  if (state.anchorBeat >= state.song.length) restart();
  else play();
}

// Finished lessons are remembered by title, so the list can show them and "Continue" picks the next one.
let lessonsDone = new Set();
try { lessonsDone = new Set(JSON.parse(localStorage.getItem('fretview.lessonsDone')) || []); } catch { /* storage unavailable */ }

function markLessonDone(i) {
  if (!LESSONS[i]) return;
  lessonsDone.add(LESSONS[i].title);
  try { localStorage.setItem('fretview.lessonsDone', JSON.stringify([...lessonsDone])); } catch { /* storage unavailable */ }
}

const nextLesson = () => Math.max(0, LESSONS.findIndex((l) => !lessonsDone.has(l.title)));
const LESSON_KINDS = { race: 'Against the clock', song: 'In time, with the metronome' };

function renderLessonList() {
  const next = nextLesson();
  fillList($('lesson-list'), LESSONS, (l) => l.group, (l, i) => {
    const done = lessonsDone.has(l.title);
    const kind = LESSON_KINDS[l.kind] || (l.chords.length > 1 ? 'At your own pace' : 'One chord');
    const el = pickItem(
      `<span class="num">${done ? '✓' : i + 1}</span><b>${escapeHtml(l.title)}</b><span class="muted small">${kind}</span>`,
      `${done ? 'done' : ''} ${i === next ? 'on' : ''}`,
    );
    el.addEventListener('click', () => startLesson(i));
    return el;
  });
  const allDone = LESSONS.every((l) => lessonsDone.has(l.title));
  $('lesson-continue').textContent = allDone
    ? '🎉 All done — start again from lesson 1'
    : `${lessonsDone.size ? 'Continue' : 'Start'} with ${next + 1}. ${LESSONS[next].title} →`;
  $('lesson-list').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

// ---- Magnifier -------------------------------------------------------------
// A close-up of the fretting hand's part of the neck, seen from above so the strings are well apart,
// drawn into the #zoom-view box on top of the full guitar.
const zoomCam = new THREE.PerspectiveCamera(30, 2.4, 0.5, 400);
const zoomFocus = { x: 6, w: 20, set: false };
const ZOOM_TILT = 0.35; // radians from straight down, towards the player
let magnify = false;
try { magnify = localStorage.getItem('fretview.magnify') === '1'; } catch { /* storage unavailable */ }

function setMagnify(on) {
  magnify = on;
  document.body.classList.toggle('magnify', on);
  $('magnify').checked = on;
  try { localStorage.setItem('fretview.magnify', on ? '1' : '0'); } catch { /* storage unavailable */ }
}

function renderZoom(dt) {
  const r = $('zoom-view').getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return;
  // Frame the frets the shape uses; in first position also the nut, where the open / muted
  // markers and the string names are.
  const held = cues.shownShape?.frets.filter((f) => f > 0) ?? [];
  const lo = held.length ? Math.min(...held) : 1, hi = held.length ? Math.max(...held) : 4;
  const x0 = lo <= 3 ? -3.8 : fretX(lo - 1) - 1.5;
  const x1 = fretX(Math.max(hi, lo <= 3 ? 4 : lo + 2)) + 1.2;
  const k = zoomFocus.set ? 1 - Math.exp(-dt * 5) : 1;
  zoomFocus.x += ((x0 + x1) / 2 - zoomFocus.x) * k;
  zoomFocus.w += (x1 - x0 - zoomFocus.w) * k;
  zoomFocus.set = true;

  const aspect = r.width / r.height;
  const tan = Math.tan(THREE.MathUtils.degToRad(zoomCam.fov / 2));
  // Across the strings: the chord name above the high e down to the fret numbers below the low E.
  const d = Math.max(10.5 / (2 * tan), zoomFocus.w / (2 * tan * aspect));
  zoomCam.aspect = aspect;
  zoomCam.updateProjectionMatrix();
  zoomCam.position.set(zoomFocus.x, d * Math.cos(ZOOM_TILT), -0.4 + d * Math.sin(ZOOM_TILT));
  zoomCam.lookAt(zoomFocus.x, 0, -0.4);

  const h = window.innerHeight;
  renderer.setScissorTest(true);
  renderer.setScissor(r.left, h - r.bottom, r.width, r.height);
  renderer.setViewport(r.left, h - r.bottom, r.width, r.height);
  renderer.render(scene, zoomCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, h);
}

// Under the close-up, the shape in words: which finger goes on which string and fret.
let lastFingers = null;
function renderFingers(shape) {
  const key = shape ? `${shape.frets}|${shape.fingers}` : '';
  if (key === lastFingers) return;
  lastFingers = key;
  if (!shape) {
    $('zoom-fingers').replaceChildren();
    return;
  }
  const byFinger = new Map(), open = [], muted = [];
  shape.frets.forEach((f, s) => {
    if (f > 0) {
      const finger = shape.fingers[s] || 1;
      const k = `${finger}:${f}`;
      if (!byFinger.has(k)) byFinger.set(k, { finger, fret: f, strings: [] });
      byFinger.get(k).strings.push(stringName(s));
    } else if (f === 0) open.push(stringName(s));
    else if (f === -1) muted.push(stringName(s));
  });
  const names = (list) => list.join(list.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');
  const item = (html) => {
    const el = document.createElement('span');
    el.innerHTML = html;
    return el;
  };
  const items = [...byFinger.values()].sort((a, b) => a.finger - b.finger).map(({ finger, fret, strings }) => item(
    `<i class="dot" style="--c:${FINGER_COLORS[finger]}">${finger}</i> <b>${names(strings)}</b> string${strings.length > 1 ? 's' : ''}, fret ${fret}`,
  ));
  if (open.length) items.push(item(`<i class="sym ring">○</i> open: ${names(open)}`));
  if (muted.length) items.push(item(`<i class="sym x">✕</i> don't play: ${names(muted)}`));
  $('zoom-fingers').replaceChildren(...items);
}

// ---- Tuner -----------------------------------------------------------------
// Needle angle at ±50 cents; the scale ends there.
const GAUGE = { cx: 150, cy: 160, r: 130, deg: 60 };
const gaugePoint = (cents, r) => {
  const a = ((Math.max(-50, Math.min(50, cents)) / 50) * GAUGE.deg * Math.PI) / 180;
  return [GAUGE.cx + r * Math.sin(a), GAUGE.cy - r * Math.cos(a)];
};
const gaugeArc = (from, to, r) => {
  const [x0, y0] = gaugePoint(from, r), [x1, y1] = gaugePoint(to, r);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};

function buildTuner() {
  const svg = $('tuner-gauge').querySelector('svg');
  svg.querySelector('.gauge-arc').setAttribute('d', gaugeArc(-50, 50, GAUGE.r));
  svg.querySelector('.gauge-zone').setAttribute('d', gaugeArc(-5, 5, GAUGE.r));
  const ns = 'http://www.w3.org/2000/svg';
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const [x0, y0] = gaugePoint(c, GAUGE.r - (major ? 16 : c % 10 === 0 ? 10 : 6));
    const [x1, y1] = gaugePoint(c, GAUGE.r - 2);
    const line = document.createElementNS(ns, 'line');
    Object.entries({ x1: x0, y1: y0, x2: x1, y2: y1 }).forEach(([k, v]) => line.setAttribute(k, v.toFixed(1)));
    if (major) line.classList.add('major');
    $('tuner-ticks').append(line);
    if (major) {
      const [tx, ty] = gaugePoint(c, GAUGE.r + 18);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', tx.toFixed(1));
      text.setAttribute('y', (ty + 4).toFixed(1));
      text.textContent = c > 0 ? `+${c}` : c;
      $('tuner-ticks').append(text);
    }
  }
  $('tuner-strings').replaceChildren(...TUNER_STRINGS.map((st, s) => {
    const b = document.createElement('button');
    b.dataset.string = s;
    b.title = `${stringName(s)} string (${st.name}). Tap to tune only this string, tap again for automatic.`;
    b.innerHTML = `<b>${st.label}</b><span>${st.name}</span>`;
    b.addEventListener('click', () => {
      tuner?.setLock(tuner.lock === s ? null : s);
      renderTunerStrings();
    });
    return b;
  }));
}

async function openTuner() {
  $('tuner-hint').textContent = 'Play a string';
  $('tuner-hint').className = '';
  const err = await enableMic();
  if (screen !== 'tuner') return; // left again while the browser asked for the microphone
  if (err) {
    $('tuner-hint').textContent = `${err}. The tuner needs the microphone to hear your guitar.`;
    $('tuner-hint').className = 'bad';
    return;
  }
  tuner = tuner || new Tuner(audio.ctx, {
    onTuned(s, all) {
      chime(audio.ctx, all);
      const check = $('tuner-check');
      check.classList.remove('pop');
      void check.offsetWidth; // restart the animation
      check.classList.add('pop');
      renderTunerStrings();
    },
  });
  if (!tuner.active) tuner.start(mic.src);
  renderTunerStrings();
}

function renderTunerStrings() {
  const now = tuner?.reading?.string ?? tuner?.lock;
  $('tuner-strings').querySelectorAll('button').forEach((b) => {
    const s = Number(b.dataset.string);
    b.classList.toggle('now', s === now);
    b.classList.toggle('locked', s === tuner?.lock);
    b.classList.toggle('tuned', !!tuner?.tuned.has(s));
  });
}

let tunerShown = null;
function updateTuner(t) {
  tuner.update(t);
  const r = tuner.reading;
  $('tuner-level').style.width = `${Math.min(100, tuner.level * 400)}%`;
  const [x, y] = gaugePoint(tuner.shown, GAUGE.r - 6);
  const needle = $('tuner-needle').querySelector('line');
  needle.setAttribute('x2', x.toFixed(1));
  needle.setAttribute('y2', y.toFixed(1));
  const gauge = $('tuner-gauge');
  gauge.classList.toggle('idle', !r);
  gauge.classList.toggle('near', !!r && Math.abs(r.cents) <= 15);
  gauge.classList.toggle('in', !!r && r.inTune);
  gauge.classList.toggle('done', !!r?.done);

  const key = r ? `${r.string}|${Math.round(r.cents)}|${r.note}|${r.done}` : tuner.lock ?? '';
  if (key === tunerShown) return;
  tunerShown = key;
  renderTunerStrings();
  if (!r) {
    const st = TUNER_STRINGS[tuner.lock];
    $('tuner-note').textContent = st ? st.label : '—';
    $('tuner-cents').textContent = st ? `${stringName(tuner.lock)} string · ${st.name}` : '';
    const all = tuner.tuned.size === TUNER_STRINGS.length;
    $('tuner-hint').textContent = all ? '🎉 All six strings are in tune' : st ? `Play the ${stringName(tuner.lock)} string` : 'Play a string';
    $('tuner-hint').className = all ? 'ok' : '';
    return;
  }
  const st = TUNER_STRINGS[r.string];
  const c = Math.round(r.cents);
  $('tuner-note').textContent = st.label;
  $('tuner-cents').textContent = `${stringName(r.string)} string · heard ${r.note}, ${r.hz.toFixed(1)} Hz · ${c > 0 ? '+' : ''}${c} cents`;
  let hint, cls;
  if (r.done || r.inTune) [hint, cls] = [r.done ? '✓ In tune' : 'Hold it…', 'ok'];
  else if (r.cents < 0) [hint, cls] = [`Too low — tighten the string ↑${Math.abs(c) > 50 ? ' (a lot)' : ''}`, 'bad'];
  else [hint, cls] = [`Too high — loosen the string ↓${c > 50 ? ' (a lot)' : ''}`, 'bad'];
  $('tuner-hint').textContent = hint;
  $('tuner-hint').className = cls;
}

// ---- Main loop -------------------------------------------------------------
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;

  if (counting()) {
    const left = (state.countdownEnd - nowMs) / 1000;
    if (left <= 0) startPlaying();
    else showCountdown(Math.ceil(left));
  }

  const t = clockNow();
  let beat = beatAt(t);
  const song = state.song;

  if (tuner?.active && screen === 'tuner' && inMenu()) updateTuner(t);

  if (lesson) {
    mic.update(t);
    lesson.update(t);
    $('lesson-level').style.width = `${Math.min(100, mic.level * 400)}%`;
    const view = lesson.view(t);
    cues.update(view.song, view.beat, view.lookBeats, dt);
    guitar.markStrings(cues.shownShape?.frets);
    guitar.update(dt);
    updateLessonHud();
    render(dt);
    return;
  }

  if (state.playing && practiceMode() && !state.waiting) {
    const ev = song.right.find((e) => e.wait && e.beat > state.lastWaitBeat && e.beat <= beat);
    if (ev) startWait(ev, t);
  }
  if (state.waiting) {
    // Past the grace period, hold the clock until the wait point is played right.
    if (beat >= state.waitCap) {
      state.anchorBeat = state.waitCap;
      state.anchorTime = t;
    }
    mic.update(t);
    checkWait(t);
    beat = beatAt(t);
  }

  if (state.playing) {
    const horizon = beatAt(t + 0.12);
    if (horizon > state.scheduledBeat) {
      schedule(state.scheduledBeat, horizon);
      state.scheduledBeat = horizon;
    }
    for (const ev of song.right) {
      if (ev.beat > beat) break;
      if (ev.beat > state.visBeat) {
        for (const s of ev.strings) guitar.pluck(s, ev.kind === 'pick' ? 1 : 0.7);
        cues.flashStrings(ev.strings);
      }
    }
    state.visBeat = beat;

    if (beat >= song.length + 1) {
      if (state.loop) {
        seek(0);
        beat = 0;
      } else {
        state.anchorBeat = song.length;
        state.playing = false;
        updatePlayButton();
        showResults();
      }
    }
  }

  const practising = state.playing && practiceMode();
  $('practice').hidden = !practising;
  if (mic?.active) {
    if (!state.waiting) mic.update(t);
    if (state.playing && !practising) judgeEvents(t);
    if (practising) $('practice-level').style.width = `${Math.min(100, mic.level * 400)}%`;
    $('mic-level').style.width = `${Math.min(100, mic.level * 400)}%`;
    $('tuner').textContent = mic.pitch ? midiNameWithCents(mic.pitch) : '—';
  }

  const lookBeats = state.lookSec * beatsPerSec();
  cues.update(song, beat, lookBeats, dt, {
    overrun: practising ? OVERRUN_SEC * beatsPerSec() : 0,
    hold: state.waiting?.beat ?? null,
  });
  guitar.markStrings(cues.shownShape?.frets);
  guitar.update(dt);
  updateHud(beat);
  render(dt);
}

function render(dt) {
  controls.update();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
  renderFingers(cues.shownShape);
  if (magnify) renderZoom(dt);
}

function midiNameWithCents(hz) {
  const m = 69 + 12 * Math.log2(hz / 440);
  const cents = Math.round((m - Math.round(m)) * 100);
  return `${midiName(m)} ${cents >= 0 ? '+' : ''}${cents}¢`;
}

// ---- UI wiring -------------------------------------------------------------
// Fills a <select> with options grouped under <optgroup>s; groupOf(item) names the group.
function fillGrouped(el, items, groupOf, label) {
  const groups = new Map();
  items.forEach((item, i) => {
    const name = groupOf(item);
    if (!groups.has(name)) {
      const g = document.createElement('optgroup');
      g.label = name;
      el.append(g);
      groups.set(name, g);
    }
    groups.get(name).append(new Option(label(item, i), i));
  });
}

const select = $('song-select');
fillGrouped(select, SONGS, songGroup, (song) => song.title);
select.addEventListener('change', () => {
  exitLesson();
  chooseSong(Number(select.value));
  select.blur();
});

$('start').addEventListener('click', () => showScreen('songs'));
$('start-lessons').addEventListener('click', () => showScreen('lessons'));
$('start-tuner').addEventListener('click', () => showScreen('tuner'));
$('tuner-open').addEventListener('click', () => showScreen('tuner'));
buildTuner();
$('menu-open').addEventListener('click', () => showScreen('home'));
document.querySelectorAll('#overlay .back').forEach((el) => el.addEventListener('click', menuBack));
$('song-go').addEventListener('click', startSong);
$('lesson-continue').addEventListener('click', () => startLesson(nextLesson()));
$('results-next').addEventListener('click', () => startLesson(state.lessonSong + 1));
$('results-again').addEventListener('click', restart);
$('results-back').addEventListener('click', menuBack);
$('lesson-hear').addEventListener('click', hearChord);
document.querySelectorAll('.sensitivity').forEach((el) => {
  el.addEventListener('input', () => setSensitivity(Number(el.value)));
});
setSensitivity(sensitivity);
$('lesson-skip').addEventListener('click', () => lesson?.skip());
$('lesson-next').addEventListener('click', () => startLesson(lessonIndex() + 1));
$('lesson-exit').addEventListener('click', () => showScreen('lessons'));

$('play').addEventListener('click', () => {
  exitLesson();
  if (running()) pause();
  else play();
});
$('pause-fab').addEventListener('click', pause);
$('restart').addEventListener('click', () => {
  exitLesson();
  restart();
});
document.querySelectorAll('.speeds button').forEach((el) => {
  el.addEventListener('click', () => setSpeed(Number(el.dataset.speed)));
});
$('look').addEventListener('input', (e) => {
  state.lookSec = Number(e.target.value);
  $('look-val').textContent = `${state.lookSec.toFixed(1)} s`;
});
// The play-along sound can be switched in the song picker and in the settings.
document.querySelectorAll('.guide').forEach((el) => el.addEventListener('change', () => {
  state.guide = el.checked;
  document.querySelectorAll('.guide').forEach((other) => { other.checked = state.guide; });
  if (!state.guide) audio?.stopAll();
}));
$('metro').addEventListener('change', (e) => { state.metro = e.target.checked; });
$('loop').addEventListener('change', (e) => { state.loop = e.target.checked; });
$('view-player').addEventListener('click', () => setView('player'));
$('view-top').addEventListener('click', () => setView('top'));
$('magnify').addEventListener('change', (e) => setMagnify(e.target.checked));
$('zoom-fab').addEventListener('click', () => setMagnify(!magnify));
$('zoom-close').addEventListener('click', () => setMagnify(false));
setMagnify(magnify);
$('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('open'));
$('mic-toggle').addEventListener('click', toggleMic);
$('check-pitch').addEventListener('change', (e) => { if (mic) mic.checkPitch = e.target.checked; });
$('latency').addEventListener('input', (e) => {
  $('lat-val').textContent = `${e.target.value} ms`;
  if (mic) mic.latency = Number(e.target.value) / 1000;
});
$('progress').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const bpb = state.song.beatsPerBar;
  const target = Math.floor((((e.clientX - r.left) / r.width) * state.song.length) / bpb) * bpb;
  seek(target);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.code !== 'Escape')) return;
  if (e.code === 'KeyM') {
    setMagnify(!magnify);
    return;
  }
  if (inMenu()) {
    if (e.code === 'Escape') menuBack();
    else if (screen === 'songs' && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
      e.preventDefault();
      const i = SONGS.indexOf(state.song) + (e.code === 'ArrowDown' ? 1 : -1);
      if (i >= 0 && i < SONGS.length) chooseSong(i);
    } else if (e.code === 'Space' && (screen === 'songs' || screen === 'results')) {
      e.preventDefault(); // or the focused button would be pressed as well
      if (screen === 'songs') startSong();
      else $('results-again').click();
    }
    return;
  }
  if (lesson || document.body.classList.contains('lesson-mode')) {
    if (e.code === 'Escape') $('lesson-exit').click();
    return;
  }
  const bpb = state.song.beatsPerBar;
  if (e.code === 'Escape') {
    if (running()) pause();
    else showScreen('home');
  } else if (e.code === 'Space') {
    e.preventDefault();
    if (running()) pause();
    else play();
  } else if (e.code === 'KeyR') restart();
  else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    const cur = beatAt(clockNow());
    const dir = e.code === 'ArrowRight' ? 1 : -1;
    const target = (Math.floor(cur / bpb + 0.01) + dir) * bpb;
    seek(Math.max(-bpb, Math.min(state.song.length, target)));
  }
});

let savedSong = null;
try { savedSong = SONGS.find((song) => song.id === localStorage.getItem('fretview.song')); } catch { /* storage unavailable */ }
select.value = SONGS.indexOf(savedSong ?? SONGS[0]);
loadSong(savedSong ?? SONGS[0]);
showScreen('home');
requestAnimationFrame(frame);
if (selfTest) window.fretview = { state, camera, controls, CHORDS, get mic() { return mic; }, get audio() { return audio; }, get lesson() { return lesson; }, get tuner() { return tuner; } };
