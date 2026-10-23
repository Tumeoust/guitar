import * as THREE from 'three';
import {
  fretX, fingerX, stringZ, boardHalfWidth, STRING_Y, NUT_CUE_X,
} from './guitar.js';
import { discTexture, ringTexture, crossTexture, strumTexture, wideLabelTexture } from './textures.js';
import { CHORD_NAMES } from './songs.js';

// The fret-button colours of Guitar Hero 3, in the same order: index = green, middle = red,
// ring = yellow, pinky = blue.
export const FINGER_COLORS = { 1: '#22d34b', 2: '#ff3640', 3: '#ffd31a', 4: '#2a8cff' };
// Colour always means "which finger": a picking cue and a fretboard dot share the colour of the
// finger that frets it. Open strings are white.
export const OPEN_COLOR = '#ffffff';
const STRUM_COLORS = { D: '#ffffff', U: '#aab4c8' };
// Small enough that fingers on neighbouring strings at one fret (A major) fit side by side.
const MARKER_SIZE = 0.8;

export function stringColor(frets, fingers, s) {
  return frets[s] > 0 ? FINGER_COLORS[fingers[s] || 1] : OPEN_COLOR;
}
// The strum lane runs along the neck from just past the fretting hand towards the body, and the
// right-hand cues fall down it to the white line, like notes in Guitar Hero. The lane, white line and
// beat lines lie just under the strings, in the same plane as the cues.
const LANE_GAP = 0.8; // from the end of the hand's frets to the top of the lane
const LANE_LEN = 10; // from the top of the lane to the white line
const LANE_Y = STRING_Y - 0.14;
// How long after a chord's last strum (or pick) has crossed the line the next chord takes its place.
const LET_GO_BEATS = 0.25;

class Pool {
  constructor(parent, create) {
    this.parent = parent;
    this.create = create;
    this.items = [];
    this.n = 0;
  }
  begin() { this.n = 0; }
  get() {
    let it = this.items[this.n];
    if (!it) {
      it = this.create();
      this.parent.add(it);
      this.items.push(it);
    }
    this.n++;
    it.visible = true;
    return it;
  }
  end() {
    for (let i = this.n; i < this.items.length; i++) this.items[i].visible = false;
  }
}

function findSegments(left, beat) {
  let cur = null, next = null;
  for (const seg of left) {
    if (seg.beat <= beat && beat < seg.beat + seg.dur) cur = seg;
    else if (seg.beat > beat) { next = seg; break; }
  }
  return { cur, next };
}

export class Cues {
  constructor() {
    this.root = new THREE.Group();
    const r = this.root;

    this.sprites = new Pool(r, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      s.renderOrder = 20;
      return s;
    });
    this.bars = new Pool(r, () => {
      const geo = new THREE.CylinderGeometry(0.2, 0.2, 1, 16);
      geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }));
      m.renderOrder = 19;
      return m;
    });
    this.gems = new Pool(r, () => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 20, 12),
        new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.3, emissiveIntensity: 0.7 }),
      );
      m.scale.set(1.6, 0.7, 1);
      m.renderOrder = 15;
      return m;
    });
    // A strum: a bar across the strings to hit, with a ↓ or ↑ on it.
    this.strumBars = new Pool(r, () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      m.renderOrder = 16;
      return m;
    });
    this.beatLines = new Pool(r, () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
      );
      return m;
    });

    // Hand-position band on the fretboard
    this.band = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    this.band.position.y = 0.01;
    r.add(this.band);

    // Strum lane and its white line.
    this.laneMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    r.add(this.laneMesh);

    this.strikeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.strike = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1).rotateX(-Math.PI / 2), this.strikeMat);
    r.add(this.strike);
    this.strikeFlash = 0;
    this.strikeColor = new THREE.Color(0xffffff);

    this.targets = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.4, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      m.renderOrder = 14;
      r.add(m);
      this.targets.push({ mesh: m, flash: 0 });
    }

    this.lane = { from: 0, to: 0 };
    this.setCapo(0);
  }

  // With a capo, every shape moves up the neck: its frets count from the capo, and the open / muted
  // markers sit just above the capo instead of at the nut (nutX).
  setCapo(capo) {
    this.capo = capo;
    this.nutX = capo > 0 ? fingerX(capo) - 1 : NUT_CUE_X;
    // The lane runs from just past the 4th fret above the capo towards the body, the white line at its
    // far end. Like the highway camera, it stays put while playing: every shape in the songs and
    // lessons fits in 4 frets.
    const from = fretX(capo + 4) + 0.3 + LANE_GAP, to = from + LANE_LEN;
    this.lane.from = from;
    this.lane.to = to;
    this.laneWidth = (stringZ(0, to) + 0.9) * 2;
    this.laneMesh.position.set((from + to) / 2, LANE_Y, 0);
    this.laneMesh.scale.set(to - from + 0.6, 1, this.laneWidth);
    this.strike.position.set(to, LANE_Y + 0.04, 0);
    this.strike.scale.set(1, 1, this.laneWidth);
    this.targets.forEach((t, i) => t.mesh.position.set(to, STRING_Y - 0.02, stringZ(i, to)));
  }

  flashStrings(strings) {
    for (const s of strings) this.targets[s].flash = 1;
  }

  flashJudgement(color) {
    this.strikeColor.set(color);
    this.strikeFlash = 1;
  }

  marker(tex, x, y, z, scale, opacity, order = 20) {
    const s = this.sprites.get();
    s.renderOrder = order;
    if (s.material.map !== tex) {
      s.material.map = tex;
      s.material.needsUpdate = true;
    }
    s.position.set(x, y, z);
    s.scale.setScalar(scale);
    s.material.opacity = opacity;
    return s;
  }

  fingerPos(i, fret) {
    const x = fingerX(this.capo + fret);
    return new THREE.Vector3(x, STRING_Y + 0.3, stringZ(i, Math.max(x, 0)));
  }

  // The shape to hold now is drawn as filled gems, the next one (ghost) as hollow rings in the same
  // finger colours. A ring round a filled gem means that finger stays where it is.
  drawShape(shape, alpha, ghost) {
    const { frets, fingers } = shape;
    const barres = new Map();
    const order = ghost ? 20 : 22;
    for (let i = 0; i < 6; i++) {
      const f = frets[i];
      if (f == null) continue;
      // Open and muted markers at the nut only for the shape to hold, or they would pile up there.
      if (f === -1) {
        if (!ghost) this.marker(crossTexture('#e8ebf2'), this.nutX, STRING_Y + 0.3, stringZ(i, Math.max(this.nutX, 0)), 0.7, alpha, order);
      } else if (f === 0) {
        if (!ghost) this.marker(ringTexture(OPEN_COLOR, 14), this.nutX, STRING_Y + 0.3, stringZ(i, Math.max(this.nutX, 0)), 0.75, alpha, order);
      } else {
        const finger = fingers[i] || 1;
        const color = FINGER_COLORS[finger];
        const p = this.fingerPos(i, f);
        if (ghost) this.marker(ringTexture(color, 12), p.x, p.y, p.z, MARKER_SIZE * 1.25, alpha, order);
        else this.marker(discTexture(color), p.x, p.y, p.z, MARKER_SIZE, alpha, order);
        const key = `${finger}:${f}`;
        if (!barres.has(key)) barres.set(key, []);
        barres.get(key).push(i);
      }
    }
    for (const [key, list] of barres) {
      if (list.length < 2) continue;
      const [finger, f] = key.split(':').map(Number);
      const a = this.fingerPos(list[0], f), b = this.fingerPos(list[list.length - 1], f);
      const bar = this.bars.get();
      bar.material.color.set(FINGER_COLORS[finger]);
      bar.material.opacity = (ghost ? 0.3 : 0.75) * alpha;
      bar.renderOrder = order - 1;
      bar.position.copy(a).add(b).multiplyScalar(0.5);
      bar.position.y -= 0.05;
      bar.scale.set(1, 1, Math.abs(a.z - b.z) + 0.4);
    }
  }

  // overrun: how many beats right-hand cues keep travelling past the strike line before they
  // disappear (practice mode, so the cue doesn't stall while the microphone is still listening).
  // hold: beat of a cue practice mode is still waiting for; its chord stays on the neck until then.
  update(song, beat, lookBeats, dt, { overrun = 0, hold = null } = {}) {
    this.sprites.begin();
    this.bars.begin();
    this.gems.begin();
    this.strumBars.begin();
    this.beatLines.begin();

    // ---- Left hand -------------------------------------------------------
    // Filled gems: the shape to hold. Hollow rings: the next shape, coming up within the look-ahead.
    // Once the current chord's last strum has gone by, the hand can already move, so the next chord
    // fills in and becomes the shape to hold.
    let { cur, next } = findSegments(song.left, hold ?? beat);
    let early = false;
    if (hold == null && cur && next) {
      const c = cur;
      const last = song.right.findLast((e) => e.beat >= c.beat && e.beat < c.beat + c.dur);
      if (last && beat > last.beat + LET_GO_BEATS) {
        early = true;
        cur = next;
        next = song.left[song.left.indexOf(cur) + 1] ?? null;
      }
    }
    // The HUD names the same chords as the neck shows.
    this.nowSeg = cur;
    this.nextSeg = next;
    if (cur) this.drawShape(cur.shape, 1, false);
    if (next && next.beat - beat <= lookBeats) {
      const u = (next.beat - beat) / lookBeats;
      this.drawShape(next.shape, 0.35 + 0.5 * (1 - u), true);
    }
    const held = (cur || next)?.shape.frets.filter((f) => f > 0).map((f) => f + this.capo) ?? [];
    if (held.length) {
      const x0 = fretX(Math.min(...held) - 1), x1 = fretX(Math.max(...held));
      const hw = boardHalfWidth(x1);
      this.band.visible = true;
      this.band.position.x = (x0 + x1) / 2;
      this.band.scale.set(x1 - x0, 1, hw * 2);
    } else {
      this.band.visible = false;
    }

    // Chord name floating just beyond the high e, next to the finger markers, so name and shape go together.
    const named = cur || next;
    if (named?.name) {
      const x = held.length ? (fretX(Math.min(...held) - 1) + fretX(Math.max(...held))) / 2 : fretX(this.capo + 1) - 1.8;
      const label = this.marker(wideLabelTexture(CHORD_NAMES[named.name] || named.name), x, 1.2, -(boardHalfWidth(x) + 3.6), 1, cur ? 1 : 0.5, 23);
      label.scale.set(6.4, 1.6, 1);
    }

    this.shownShape = cur ? cur.shape : next?.shape ?? null;

    // ---- Right hand ------------------------------------------------------
    // Cues fall from the top of the lane (`from`) down to the white line (`to`). The first strum of
    // each new chord carries the chord's name beside the lane, so a change can be seen coming.
    const { from, to } = this.lane;
    const span = to - from;
    const changes = new Map();
    for (const seg of song.left) if (seg.name) changes.set(seg.beat, seg.name);
    for (const ev of song.right) {
      const d = ev.beat - beat;
      if (d > lookBeats) break;
      let x, fade;
      if (overrun > 0) {
        // Keep flowing past the line: dim a little up to `overrun`, then fade out quickly.
        if (d < -overrun * 1.4) continue;
        x = to - (d / lookBeats) * span;
        fade = d >= 0 ? Math.min(1, (lookBeats - d) * 2)
          : d >= -overrun ? 1 + (0.4 * d) / overrun
            : 0.6 * (1.4 + d / overrun) / 0.4;
      } else {
        // Stop on the line and fade there, without growing: nothing on screen zooms.
        if (d < -0.25) continue;
        x = d > 0 ? to - (d / lookBeats) * span : to;
        fade = d < 0 ? Math.max(0, 1 + d * 4) : Math.min(1, (lookBeats - d) * 2);
      }
      if (ev.kind === 'pick') {
        const s = ev.strings[0];
        const gem = this.gems.get();
        const color = stringColor(ev.frets, ev.fingers, s);
        gem.material.color.set(color);
        gem.material.emissive.set(color);
        gem.material.opacity = fade;
        gem.position.set(x, STRING_Y + 0.1, stringZ(s, x));
        gem.scale.set(1.6, 0.7, 1);
      } else {
        const zs = ev.strings.map((s) => stringZ(s, x));
        const z0 = Math.max(...zs), z1 = Math.min(...zs), zc = (z0 + z1) / 2;
        const bar = this.strumBars.get();
        bar.material.color.set(STRUM_COLORS[ev.dir]);
        bar.material.opacity = 0.75 * fade;
        bar.position.set(x, STRING_Y + 0.15, zc);
        bar.scale.set(0.45, 1, z0 - z1 + 0.7);
        this.marker(strumTexture(ev.dir, STRUM_COLORS[ev.dir]), x, STRING_Y + 0.4, zc, 1.3, fade, 17);
      }
      const name = changes.get(ev.beat);
      if (name) {
        const tag = this.marker(wideLabelTexture(name), x, STRING_Y + 0.4, -(this.laneWidth / 2 + 1.3), 1, fade, 17);
        tag.scale.set(4, 1, 1);
      }
    }

    const bpb = song.beatsPerBar;
    const every = song.clickEvery || 1;
    for (let k = Math.ceil(beat / every) * every; k - beat <= lookBeats; k += every) {
      const line = this.beatLines.get();
      const bar = ((k % bpb) + bpb) % bpb === 0;
      line.position.set(to - ((k - beat) / lookBeats) * span, LANE_Y + 0.02, 0);
      line.scale.set(bar ? 0.16 : 0.07, 1, this.laneWidth);
      line.material.opacity = bar ? 0.45 : 0.18;
    }

    for (const t of this.targets) {
      t.flash *= Math.exp(-dt * 6);
      t.mesh.material.opacity = 0.6 + t.flash * 0.4;
    }
    this.strikeFlash *= Math.exp(-dt * 4);
    this.strikeMat.color.setRGB(1, 1, 1).lerp(this.strikeColor, this.strikeFlash);

    this.sprites.end();
    this.bars.end();
    this.gems.end();
    this.strumBars.end();
    this.beatLines.end();
  }
}
