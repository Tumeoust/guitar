import { analyze } from './transcribe.js';

// Runs the chord analysis off the main thread, so the page stays responsive on a long song.
self.onmessage = (e) => {
  try {
    const result = analyze(e.data.samples, (fraction, text) => self.postMessage({ progress: fraction, text }));
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
