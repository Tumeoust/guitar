import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildGuitar } from './guitar.js';
import { Cues } from './cues.js';
import { SONGS } from './songs.js';
import { GuitarAudio } from './audio.js';
import { MicJudge } from './mic.js';
import { midiName } from './music.js';

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
  anchorTime: 0,
  anchorBeat: 0,
  speed: 1,
  lookSec: 2.4,
  guide: true,
  metro: false,
  loop: false,
  scheduledBeat: 0,
  visBeat: 0,
  judgeIndex: 0,
  stats: null,
};
let audio = null;
let mic = null;
// ?selftest feeds the play-along synth into the detector instead of the microphone.
const selfTest = new URLSearchParams(location.search).has('selftest');

const clockNow = () => (audio ? audio.ctx.currentTime : performance.now() / 1000);
const beatsPerSec = () => (state.song.bpm / 60) * state.speed;
const beatAt = (t) => (state.playing ? state.anchorBeat + (t - state.anchorTime) * beatsPerSec() : state.anchorBeat);
const timeOfBeat = (b) => state.anchorTime + (b - state.anchorBeat) / beatsPerSec();
const countInBeats = () => state.song.beatsPerBar;

function ensureAudio() {
  if (!audio) audio = new GuitarAudio();
  audio.resume();
}

function resetStats() {
  state.stats = { perfect: 0, good: 0, wrong: 0, miss: 0, streak: 0, best: 0 };
  renderStats();
}

function anchor(beat) {
  state.anchorBeat = beat;
  state.anchorTime = clockNow();
  state.scheduledBeat = beat;
  state.visBeat = beat;
  state.judgeIndex = state.song.right.findIndex((ev) => ev.beat >= beat);
  if (state.judgeIndex < 0) state.judgeIndex = state.song.right.length;
}

function play() {
  ensureAudio();
  $('overlay').hidden = true;
  if (state.anchorBeat >= state.song.length) {
    state.anchorBeat = -countInBeats();
    resetStats();
  }
  anchor(state.anchorBeat);
  state.playing = true;
  updatePlayButton();
}

function pause() {
  if (!state.playing) return;
  state.anchorBeat = beatAt(clockNow());
  state.playing = false;
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
  $('song-title').textContent = song.title;
  $('song-sub').textContent = song.subtitle;
  resetStats();
}

function setSpeed(pct) {
  const b = beatAt(clockNow());
  state.speed = pct / 100;
  if (state.playing) {
    state.anchorBeat = b;
    state.anchorTime = clockNow();
    state.scheduledBeat = Math.max(state.scheduledBeat, b);
  }
  $('speed-val').textContent = `${pct}%`;
}

function updatePlayButton() {
  $('play').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  // Fold the settings away while playing so the whole guitar is visible.
  $('panel').classList.toggle('open', !state.playing);
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

async function toggleMic() {
  if (mic?.active) {
    mic.stop();
    $('mic-section').hidden = true;
    $('mic-toggle').textContent = '🎤 Enable microphone';
    return;
  }
  ensureAudio();
  mic = mic || new MicJudge(audio.ctx);
  try {
    await mic.start(selfTest ? audio.guide : undefined);
  } catch (err) {
    alert(`Could not open the microphone: ${err.message}`);
    return;
  }
  mic.latency = Number($('latency').value) / 1000;
  mic.checkPitch = $('check-pitch').checked;
  $('mic-section').hidden = false;
  $('mic-toggle').textContent = '🎤 Disable microphone';
  // Only judge what comes after the mic was switched on.
  const beat = beatAt(clockNow());
  const idx = state.song.right.findIndex((ev) => ev.beat >= beat);
  state.judgeIndex = idx < 0 ? state.song.right.length : idx;
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

function showResults() {
  const acc = accuracy();
  $('results').innerHTML = mic?.active && acc != null
    ? `<h2>${acc}% accuracy</h2><p class="muted">Best streak ${state.stats.best}</p>`
    : '<h2>Song complete</h2>';
  $('start').textContent = 'Play again';
  $('overlay').hidden = false;
}

// ---- Main loop -------------------------------------------------------------
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;

  const t = clockNow();
  let beat = beatAt(t);
  const song = state.song;

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

  if (mic?.active) {
    mic.update(t);
    if (state.playing) judgeEvents(t);
    $('mic-level').style.width = `${Math.min(100, mic.level * 400)}%`;
    $('tuner').textContent = mic.pitch ? midiNameWithCents(mic.pitch) : '—';
  }

  const lookBeats = state.lookSec * beatsPerSec();
  cues.update(song, beat, lookBeats, dt);
  guitar.update(dt);
  updateHud(beat);
  controls.update();
  renderer.render(scene, camera);
}

function midiNameWithCents(hz) {
  const m = 69 + 12 * Math.log2(hz / 440);
  const cents = Math.round((m - Math.round(m)) * 100);
  return `${midiName(m)} ${cents >= 0 ? '+' : ''}${cents}¢`;
}

// ---- UI wiring -------------------------------------------------------------
const select = $('song-select');
SONGS.forEach((s, i) => select.add(new Option(s.title, i)));
select.addEventListener('change', () => { loadSong(SONGS[select.value]); select.blur(); });

$('start').addEventListener('click', () => {
  $('results').innerHTML = '';
  if (state.anchorBeat >= state.song.length) restart();
  else play();
});
$('play').addEventListener('click', () => (state.playing ? pause() : play()));
$('restart').addEventListener('click', restart);
$('speed').addEventListener('input', (e) => setSpeed(Number(e.target.value)));
$('look').addEventListener('input', (e) => {
  state.lookSec = Number(e.target.value);
  $('look-val').textContent = `${state.lookSec.toFixed(1)} s`;
});
$('guide').addEventListener('change', (e) => {
  state.guide = e.target.checked;
  if (!state.guide) audio?.stopAll();
});
$('metro').addEventListener('change', (e) => { state.metro = e.target.checked; });
$('loop').addEventListener('change', (e) => { state.loop = e.target.checked; });
$('view-player').addEventListener('click', () => setView('player'));
$('view-top').addEventListener('click', () => setView('top'));
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
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const bpb = state.song.beatsPerBar;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!$('overlay').hidden) $('start').click();
    else if (state.playing) pause();
    else play();
  } else if (e.code === 'KeyR') restart();
  else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    const cur = beatAt(clockNow());
    const dir = e.code === 'ArrowRight' ? 1 : -1;
    const target = (Math.floor(cur / bpb + 0.01) + dir) * bpb;
    seek(Math.max(-bpb, Math.min(state.song.length, target)));
  }
});

loadSong(SONGS[0]);
requestAnimationFrame(frame);
if (selfTest) window.fretview = { state, camera, controls, get mic() { return mic; } };
