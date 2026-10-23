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
const MARKER_SIZE = 1.4;

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

// Fingers on neighbouring strings at the same fret (Em, A, D...) would hide each other, so spread
// them out between the fret wires like a real hand does: lower finger numbers further back.
function staggerOf(frets, fingers, i) {
  const f = frets[i];
  // Strings at most two apart count as neighbours: from this angle they still overlap on screen.
  const near = (s) => frets[s] === f && fingers[s] !== fingers[i];
  let lo = i, hi = i;
  for (;;) {
    if (near(lo - 1)) lo -= 1; else if (near(lo - 2)) lo -= 2; else break;
  }
  for (;;) {
    if (near(hi + 1)) hi += 1; else if (near(hi + 2)) hi += 2; else break;
  }
  if (lo === hi) return null;
  const group = [];
  for (let s = lo; s <= hi; s++) if (frets[s] === f) group.push(fingers[s]);
  const rank = [...group].sort((a, b) => a - b).indexOf(fingers[i]);
  return 0.3 + (0.55 * rank) / (group.length - 1);
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
      const geo = new THREE.CylinderGeometry(0.3, 0.3, 1, 16);
      geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }));
      m.renderOrder = 19;
      return m;
    });
    this.lines = new Pool(r, () => {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const l = new THREE.Line(geo, new THREE.LineDashedMaterial({ transparent: true, depthTest: false, dashSize: 0.3, gapSize: 0.2 }));
      l.renderOrder = 18;
      return l;
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

    // Strum lane and its white line; placeLane() moves them along with the hand.
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

    // Where the fretting hand works along the neck (x0..x1) and where the lane runs (from..to, to being
    // the white line). The highway camera frames these.
    this.hand = { x0: -1.6, x1: fretX(4) + 0.3 };
    this.lane = { from: 0, to: 0 };
    this.placeLane();
  }

  placeLane() {
    const from = this.hand.x1 + LANE_GAP, to = from + LANE_LEN;
    this.lane.from = from;
    this.lane.to = to;
    this.laneWidth = (stringZ(0, to) + 0.9) * 2;
    this.laneMesh.position.set((from + to) / 2, LANE_Y, 0);
    this.laneMesh.scale.set(to - from + 0.6, 1, this.laneWidth);
    this.strike.position.set(to, LANE_Y + 0.04, 0);
    this.strike.scale.set(1, 1, this.laneWidth);
    this.targets.forEach((t, i) => t.mesh.position.set(to, STRING_Y - 0.02, stringZ(i, to)));
  }

  // Follow the hand to the frets this shape uses: in first position from the nut (with its open and
  // muted markers), else from the fret behind the lowest finger. Eased, so the view glides along.
  followHand(frets, dt) {
    const held = frets?.filter((f) => f > 0) ?? [];
    const lo = held.length ? Math.min(...held) : 1, hi = held.length ? Math.max(...held) : 3;
    const x0 = lo <= 3 ? -1.6 : fretX(lo - 1) - 0.5;
    const x1 = fretX(Math.max(hi, lo <= 3 ? 4 : lo + 1)) + 0.3;
    const k = 1 - Math.exp(-dt * 4);
    this.hand.x0 += (x0 - this.hand.x0) * k;
    this.hand.x1 += (x1 - this.hand.x1) * k;
    this.placeLane();
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

  // stagger: where between the fret wires the fingertip sits (0 = previous wire, 1 = this one).
  fingerPos(i, fret, stagger = null) {
    const x = stagger == null ? fingerX(fret) : fretX(fret - 1) + (fretX(fret) - fretX(fret - 1)) * stagger;
    return new THREE.Vector3(x, STRING_Y + 0.3, stringZ(i, Math.max(x, 0)));
  }

  // approach: null for the shape being held now, 0..1 (1 = far away) for the next one.
  drawShape(shape, alpha, approach, pulse) {
    const { frets, fingers } = shape;
    const barres = new Map();
    // The shape being held now draws on top of the faded preview of the next one.
    const order = approach == null ? 22 : 20;
    for (let i = 0; i < 6; i++) {
      const f = frets[i];
      if (f == null) continue;
      if (f === -1) {
        this.marker(crossTexture('#e8ebf2'), NUT_CUE_X, STRING_Y + 0.3, stringZ(i, 0), 0.9, alpha, order);
      } else if (f === 0) {
        this.marker(ringTexture(OPEN_COLOR, 14), NUT_CUE_X, STRING_Y + 0.3, stringZ(i, 0), 0.95, alpha, order);
      } else {
        const finger = fingers[i] || 1;
        const color = FINGER_COLORS[finger];
        const p = this.fingerPos(i, f, staggerOf(frets, fingers, i));
        this.marker(discTexture(color), p.x, p.y, p.z, MARKER_SIZE * (1 + pulse * 0.35), alpha, order);
        if (approach != null) {
          this.marker(ringTexture(color, 8), p.x, p.y, p.z, MARKER_SIZE * (1.05 + approach * 2.6), alpha * (1 - approach * 0.6), 21);
        }
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
      bar.material.opacity = 0.75 * alpha;
      bar.renderOrder = order - 1;
      bar.position.copy(a).add(b).multiplyScalar(0.5);
      bar.position.y -= 0.05;
      bar.scale.set(1, 1, Math.abs(a.z - b.z) + 0.6);
    }
  }

  drawTravel(from, to, alpha) {
    // Dashed line from where each finger is now to where it goes next.
    for (let i = 0; i < 6; i++) {
      const finger = from.fingers[i];
      if (!finger || !(from.frets[i] > 0)) continue;
      const j = to.fingers.findIndex((g, k) => g === finger && to.frets[k] > 0);
      if (j < 0) continue;
      if (j === i && to.frets[j] === from.frets[i]) continue;
      const a = this.fingerPos(i, from.frets[i]), b = this.fingerPos(j, to.frets[j]);
      const line = this.lines.get();
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      line.computeLineDistances();
      line.material.color.set(FINGER_COLORS[finger]);
      line.material.opacity = alpha;
    }
  }

  // overrun: how many beats right-hand cues keep travelling past the strike line before they
  // disappear (practice mode, so the cue doesn't stall while the microphone is still listening).
  // hold: beat of a cue practice mode is still waiting for; its chord stays on the neck until then.
  update(song, beat, lookBeats, dt, { overrun = 0, hold = null } = {}) {
    this.sprites.begin();
    this.bars.begin();
    this.lines.begin();
    this.gems.begin();
    this.strumBars.begin();
    this.beatLines.begin();

    // ---- Left hand -------------------------------------------------------
    // Show the shape for the next strum still to come: once the current chord's last strum has gone
    // by, the hand can already move to the next chord, so that one replaces it (with its shrinking
    // ring counting down to it).
    let { cur, next } = findSegments(song.left, hold ?? beat);
    let early = false;
    if (hold == null && cur && next) {
      const c = cur;
      const last = song.right.findLast((e) => e.beat >= c.beat && e.beat < c.beat + c.dur);
      if (last && beat > last.beat + LET_GO_BEATS) {
        early = true;
        cur = next;
        next = null;
      }
    }
    if (cur && early) {
      this.drawShape(cur.shape, 1, Math.min(1, Math.max(0, cur.beat - beat) / lookBeats), 0);
    } else if (cur) {
      const pulse = Math.max(0, 1 - (beat - cur.beat) * 3);
      this.drawShape(cur.shape, 1, null, pulse);
    }
    if (next && next.beat - beat <= lookBeats) {
      const u = (next.beat - beat) / lookBeats;
      this.drawShape(next.shape, 0.25 + 0.35 * (1 - u), u, 0);
      if (cur) this.drawTravel(cur.shape, next.shape, 0.25 + 0.5 * (1 - u));
    }
    const held = (cur || next)?.shape.frets.filter((f) => f > 0) ?? [];
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
      const x = held.length ? (fretX(Math.min(...held) - 1) + fretX(Math.max(...held))) / 2 : 1.8;
      const label = this.marker(wideLabelTexture(CHORD_NAMES[named.name] || named.name), x, 1.2, -(boardHalfWidth(x) + 3.6), 1, cur ? 1 : 0.5, 23);
      label.scale.set(6.4, 1.6, 1);
    }

    this.shownShape = cur ? cur.shape : next?.shape ?? null;
    this.followHand(this.shownShape?.frets, dt);

    // ---- Right hand ------------------------------------------------------
    // Cues fall from the top of the lane (`from`) down to the white line (`to`).
    const { from, to } = this.lane;
    const span = to - from;
    for (const ev of song.right) {
      const d = ev.beat - beat;
      if (d > lookBeats) break;
      let x, fade, grow;
      if (overrun > 0) {
        // Keep flowing past the line: dim a little up to `overrun`, then fade out quickly.
        if (d < -overrun * 1.4) continue;
        x = to - (d / lookBeats) * span;
        fade = d >= 0 ? Math.min(1, (lookBeats - d) * 2)
          : d >= -overrun ? 1 + (0.4 * d) / overrun
            : 0.6 * (1.4 + d / overrun) / 0.4;
        grow = 1;
      } else {
        if (d < -0.5) continue;
        x = d > 0 ? to - (d / lookBeats) * span : to;
        fade = d < 0 ? Math.max(0, 1 + d * 2) : Math.min(1, (lookBeats - d) * 2);
        grow = d < 0 ? 1 - d * 2.5 : 1;
      }
      if (ev.kind === 'pick') {
        const s = ev.strings[0];
        const gem = this.gems.get();
        const color = stringColor(ev.frets, ev.fingers, s);
        gem.material.color.set(color);
        gem.material.emissive.set(color);
        gem.material.opacity = fade;
        gem.position.set(x, STRING_Y + 0.1, stringZ(s, x));
        gem.scale.set(1.6 * grow, 0.7 * grow, grow);
      } else {
        const zs = ev.strings.map((s) => stringZ(s, x));
        const z0 = Math.max(...zs), z1 = Math.min(...zs), zc = (z0 + z1) / 2;
        const bar = this.strumBars.get();
        bar.material.color.set(STRUM_COLORS[ev.dir]);
        bar.material.opacity = 0.75 * fade;
        bar.position.set(x, STRING_Y + 0.15, zc);
        bar.scale.set(0.45 * grow, 1, z0 - z1 + 0.7);
        this.marker(strumTexture(ev.dir, STRUM_COLORS[ev.dir]), x, STRING_Y + 0.4, zc, 1.3 * grow, fade, 17);
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
      t.mesh.scale.setScalar(1 + t.flash * 0.8);
      t.mesh.material.opacity = 0.6 + t.flash * 0.4;
    }
    this.strikeFlash *= Math.exp(-dt * 4);
    this.strikeMat.color.setRGB(1, 1, 1).lerp(this.strikeColor, this.strikeFlash);

    this.sprites.end();
    this.bars.end();
    this.lines.end();
    this.gems.end();
    this.strumBars.end();
    this.beatLines.end();
  }
}
