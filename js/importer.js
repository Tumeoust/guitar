import { SR, analyze, buildBars, bestCapo, shapeFor, soundingChord, chordName, SHAPES } from './transcribe.js';
import { strumSong, STRUM_CHOICES, CHORD_NAMES } from './songs.js';

// Importing a song from an audio file: decode it, work out its beats and chords (js/transcribe.js, in a
// worker), and let the player fix the chart before playing it. Charts are kept in sessionStorage, so
// they last until the browser (or tab) is closed. The audio itself is never stored.
//
// A chart: { id, title, file, bpm, beatsPerBar, tempo, shift, capo, strum, bars, analysis }
//   bars: the chord heard in each bar (see transcribe.js for the numbering), null for a bar without one.
//   tempo, shift: how the beats were grouped into bars (see buildBars); analysis: what the worker found.

const STORE = 'fretview.imports';
const $ = (id) => document.getElementById(id);

export function loadCharts() {
  try { return JSON.parse(sessionStorage.getItem(STORE)) || []; } catch { return []; }
}

// Returns false when the browser won't keep them (storage full or blocked).
export function saveCharts(charts) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(charts));
    return true;
  } catch {
    return false;
  }
}

// The playable song: one chord per bar in its open shape for the chart's capo. A bar without a chord
// holds the one before it without strumming.
export function chartToSong(chart) {
  const shapes = chart.bars.map((c) => (c == null ? null : shapeFor(c, chart.capo).name));
  let held = shapes.find(Boolean) ?? 'G';
  const progression = shapes.map((name) => {
    if (name) held = name;
    return [held, name ? chart.strum : 'rest'];
  });
  progression.push([held, 'whole']); // let the last chord ring
  const used = [...new Set(shapes.filter(Boolean))];
  const list = used.slice(0, 6).join(' – ') + (used.length > 6 ? ' …' : '');
  const meta = {
    id: chart.id,
    title: chart.title,
    subtitle: `Imported${chart.capo ? `, capo on the ${ordinal(chart.capo)} fret` : ''} — ${list}`,
    bpm: chart.bpm,
    beatsPerBar: chart.beatsPerBar,
    capo: chart.capo, // also 0: the shapes were chosen to sound like the recording
  };
  return { ...strumSong(meta, progression), imported: true };
}

const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const titleFromFile = (name) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported song';

// Decodes any audio file the browser can play, as mono at the analysis rate.
async function decode(file, progress) {
  progress(0.02, 'Reading the file');
  const data = await file.arrayBuffer();
  progress(0.06, 'Decoding the audio');
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  progress(0.12, 'Preparing the audio');
  let rate = SR;
  let ctx;
  try {
    ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  } catch {
    // Some browsers don't render at sample rates this low: render at twice the rate and halve it.
    rate = SR * 2;
    ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  }
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  if (rate === SR) return out;
  const half = new Float32Array(Math.floor(out.length / 2));
  for (let i = 0; i < half.length; i++) half[i] = (out[2 * i] + out[2 * i + 1]) / 2;
  return half;
}

// The analysis runs in a worker so the page stays responsive; on the page itself if workers fail.
function analyzeInWorker(samples, progress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(analyze(samples, progress));
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.progress != null) progress(e.data.progress, e.data.text);
      else {
        worker.terminate();
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.result);
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      try { resolve(analyze(samples, progress)); } catch (err) { reject(err); }
    };
    worker.postMessage({ samples }, [samples.buffer]);
  });
}

export class Importer {
  // onSave(chart): the player saved the chart; onDelete(id): the player deleted it.
  constructor({ onSave, onDelete }) {
    this.onSave = onSave;
    this.onDelete = onDelete;
    this.chart = null;
    this.job = 0; // so a file picked while another is still being analysed wins

    for (let c = 0; c <= 7; c++) $('import-capo').add(new Option(c ? `Fret ${c}` : 'No capo', c));
    $('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = ''; // picking the same file again still starts over
      if (file) this.load(file);
    });
    $('import-title').addEventListener('input', (e) => { this.chart.title = e.target.value; });
    $('import-bpm').addEventListener('change', (e) => {
      this.chart.bpm = Math.max(30, Math.min(240, Math.round(Number(e.target.value)) || this.chart.bpm));
      e.target.value = this.chart.bpm;
    });
    $('import-meter').addEventListener('change', (e) => {
      this.chart.beatsPerBar = Number(e.target.value);
      if (!STRUM_CHOICES[this.chart.beatsPerBar].some(([id]) => id === this.chart.strum)) {
        this.chart.strum = defaultStrum(this.chart.beatsPerBar);
      }
      this.chart.shift = 0;
      this.rebar();
    });
    $('import-tempo').addEventListener('change', (e) => {
      this.chart.tempo = Number(e.target.value);
      this.chart.shift = 0;
      this.rebar();
    });
    $('import-earlier').addEventListener('click', () => { this.chart.shift--; this.rebar(false); });
    $('import-later').addEventListener('click', () => { this.chart.shift++; this.rebar(false); });
    $('import-capo').addEventListener('change', (e) => {
      // The chords keep their sound; the shapes move to suit the new capo.
      this.chart.capo = Number(e.target.value);
      this.render();
    });
    $('import-strum').addEventListener('change', (e) => { this.chart.strum = e.target.value; });
    $('import-save').addEventListener('click', () => {
      this.chart.title = this.chart.title.trim() || titleFromFile(this.chart.file);
      this.onSave(this.chart);
    });
    $('import-delete').addEventListener('click', () => this.onDelete(this.chart.id));
  }

  // chart: a saved chart to edit (a copy), or null to start with a new file.
  open(chart) {
    this.job++;
    this.chart = chart;
    this.saved = !!chart;
    $('import-progress').hidden = true;
    $('import-file-label').textContent = chart ? `${chart.file} — choose another file…` : 'Choose an audio file…';
    $('import-editor').hidden = !chart;
    if (chart) this.render();
  }

  async load(file) {
    const job = ++this.job;
    const progress = (fraction, text) => {
      if (job !== this.job) return;
      $('import-status').textContent = `${text}…`;
      $('import-level').style.width = `${Math.round(fraction * 100)}%`;
    };
    $('import-file-label').textContent = file.name;
    $('import-editor').hidden = true;
    $('import-progress').hidden = false;
    $('import-progress').classList.remove('bad');
    try {
      const samples = await decode(file, progress);
      if (samples.length < SR * 5) throw new Error('short');
      const analysis = await analyzeInWorker(samples, (f, text) => progress(0.2 + 0.8 * f, text));
      if (job !== this.job) return;
      this.saved = false;
      this.chart = {
        id: `import-${Date.now()}`,
        title: titleFromFile(file.name),
        file: file.name,
        beatsPerBar: 4,
        tempo: 1,
        shift: 0,
        capo: 0,
        strum: defaultStrum(4),
        analysis,
      };
      this.rebar();
      if (!this.chart.bars.length) throw new Error('nochords');
      $('import-progress').hidden = true;
      $('import-editor').hidden = false;
      $('import-title').focus({ preventScroll: true });
    } catch (err) {
      if (job !== this.job) return;
      $('import-progress').classList.add('bad');
      $('import-level').style.width = '0';
      $('import-status').textContent = err.message === 'short'
        ? 'That recording is too short. Pick a whole song.'
        : err.message === 'nochords'
          ? 'No chords could be heard in this recording.'
          : err.name === 'EncodingError' || err.name === 'NotSupportedError'
            ? 'This file can\'t be read as audio here. Try an MP3, M4A or WAV file.'
            : `Something went wrong while listening to the song (${err.message}).`;
    }
  }

  // Group the beats into bars again (after changing the time, the beat or where bars start). This
  // re-reads the chords, so it undoes changes to single bars. Moving the bars by a beat keeps the capo.
  rebar(chooseCapo = true) {
    const c = this.chart;
    const { bars, bpm } = buildBars(c.analysis, { beatsPerBar: c.beatsPerBar, tempo: c.tempo, shift: c.shift });
    c.bars = bars.map((b) => b.chord);
    c.bpm = Math.max(30, Math.min(240, bpm));
    if (chooseCapo) c.capo = bestCapo(c.bars);
    this.render();
  }

  render() {
    const c = this.chart;
    $('import-title').value = c.title;
    $('import-bpm').value = c.bpm;
    $('import-meter').value = c.beatsPerBar;
    $('import-tempo').value = c.tempo;
    $('import-capo').value = c.capo;
    const strum = $('import-strum');
    strum.replaceChildren(...STRUM_CHOICES[c.beatsPerBar].map(([id, label]) => new Option(label, id)));
    strum.value = c.strum;
    $('import-delete').hidden = !this.saved;
    $('import-save').textContent = this.saved ? '▶ Save changes and play' : '▶ Save and play';

    let approx = 0;
    const cells = c.bars.map((chord, i) => {
      const cell = document.createElement('label');
      cell.className = 'bar';
      const num = document.createElement('span');
      num.className = 'n';
      num.textContent = i + 1;
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Bar ${i + 1}`);
      sel.add(new Option('—', ''));
      for (const s of SHAPES) sel.add(new Option(s.name, s.name));
      const shape = chord == null ? null : shapeFor(chord, c.capo);
      sel.value = shape ? shape.name : '';
      if (shape && !shape.exact) {
        approx++;
        cell.classList.add('approx');
        cell.title = `Heard ${chordName(chord)}. No open shape plays it with this capo, so the closest one is used.`;
      } else {
        cell.title = shape ? `${CHORD_NAMES[shape.name] || shape.name}${c.capo ? ` (sounds like ${chordName(chord)})` : ''}` : 'No chord: hold the last one without strumming';
      }
      sel.addEventListener('change', () => {
        c.bars[i] = sel.value ? soundingChord(sel.value, c.capo) : null;
        this.render();
      });
      cell.append(num, sel);
      return cell;
    });
    $('import-bars').replaceChildren(...cells);

    const secs = Math.round((c.bars.length * c.beatsPerBar * 60) / c.bpm);
    const parts = [`${c.bars.length} bars`, `about ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`];
    if (approx) parts.push(`${approx} bar${approx > 1 ? 's' : ''} marked ≈ use the closest shape to the chord heard`);
    $('import-summary').textContent = `${parts.join(' · ')}. Changing Time, Beat or where bars start reads the chords again.`;
  }
}

const defaultStrum = (bpb) => (bpb === 3 ? 'waltz' : 'quarters');
