import * as THREE from 'three';
import {
  SCALE, fretX, fingerX, stringZ, boardHalfWidth, STRING_Y, TOP_Y, STRIKE_X, HIGHWAY_END, NUT_CUE_X,
} from './guitar.js';
import { discTexture, ringTexture, crossTexture, wideLabelTexture } from './textures.js';
import { CHORD_NAMES } from './songs.js';

export const FINGER_COLORS = { 1: '#4cc9f0', 2: '#80ed99', 3: '#ffd166', 4: '#f472b6' };
// Colour always means "which finger": a string, a picking cue and a fretboard dot share the
// colour of the finger that frets it. Open strings are white.
export const OPEN_COLOR = '#ffffff';
const STRUM_COLORS = { D: '#ffffff', U: '#aab4c8' };
const MARKER_SIZE = 1.4;

export function stringColor(frets, fingers, s) {
  return frets[s] > 0 ? FINGER_COLORS[fingers[s] || 1] : OPEN_COLOR;
}
const LANE_WIDTH = 7.4;

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

function arrowGeometry(len) {
  // Flat arrow lying in the x/z plane, pointing towards -z, centred on the origin.
  const head = Math.min(1.1, len * 0.45);
  const s = new THREE.Shape();
  const h = len / 2, sw = 0.2, hw = 0.6;
  s.moveTo(-sw, h);
  s.lineTo(sw, h);
  s.lineTo(sw, -h + head);
  s.lineTo(hw, -h + head);
  s.lineTo(0, -h);
  s.lineTo(-hw, -h + head);
  s.lineTo(-sw, -h + head);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(Math.PI / 2);
  return geo;
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
    this.arrowGeos = new Map();
    this.arrows = new Pool(r, () => {
      const m = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.renderOrder = 16;
      return m;
    });
    this.beatLines = new Pool(r, () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, LANE_WIDTH).rotateX(-Math.PI / 2),
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

    // Right-hand lane over the soundhole
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(HIGHWAY_END - STRIKE_X + 1.5, LANE_WIDTH).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    lane.position.set((STRIKE_X + HIGHWAY_END) / 2 + 0.25, TOP_Y + 0.05, 0);
    r.add(lane);

    this.strikeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const strike = new THREE.Mesh(new THREE.PlaneGeometry(0.22, LANE_WIDTH).rotateX(-Math.PI / 2), this.strikeMat);
    strike.position.set(STRIKE_X, TOP_Y + 0.07, 0);
    r.add(strike);
    this.strikeFlash = 0;
    this.strikeColor = new THREE.Color(0xffffff);

    // Glow along the part of each string that should ring: from the fretting finger to the saddle.
    this.lit = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      m.renderOrder = 12;
      r.add(m);
      this.lit.push(m);
    }

    this.targets = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.4, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      m.position.set(STRIKE_X, STRING_Y - 0.02, stringZ(i, STRIKE_X));
      m.renderOrder = 14;
      r.add(m);
      this.targets.push({ mesh: m, flash: 0 });
    }
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
    const x = fingerX(fret);
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
        this.marker(crossTexture('#ff5d73'), NUT_CUE_X, STRING_Y + 0.3, stringZ(i, 0), 0.95, alpha, order);
      } else if (f === 0) {
        this.marker(ringTexture(OPEN_COLOR, 14), NUT_CUE_X, STRING_Y + 0.3, stringZ(i, 0), 0.95, alpha, order);
      } else {
        const finger = fingers[i] || 1;
        const color = FINGER_COLORS[finger];
        const p = this.fingerPos(i, f);
        this.marker(discTexture(color, String(finger)), p.x, p.y, p.z, MARKER_SIZE * (1 + pulse * 0.35), alpha, order);
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

  drawLitStrings(shape, alpha) {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 6; i++) {
      const m = this.lit[i];
      const f = shape?.frets[i];
      if (f == null || f < 0) { m.visible = false; continue; }
      const x0 = f > 0 ? fingerX(f) : 0;
      const a = new THREE.Vector3(x0, STRING_Y, stringZ(i, x0));
      const b = new THREE.Vector3(SCALE, STRING_Y, stringZ(i, SCALE));
      const d = b.clone().sub(a);
      const flash = this.targets[i].flash;
      const r = 0.14 + flash * 0.08;
      m.visible = true;
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, d.clone().normalize());
      m.scale.set(r, d.length(), r);
      m.material.color.set(stringColor(shape.frets, shape.fingers, i));
      // Open strings stay quieter so the finger colours stand out.
      m.material.opacity = alpha * Math.min(1, (f > 0 ? 0.85 : 0.4) + flash * 0.4);
    }
  }

  arrowGeo(len) {
    const key = Math.round(len * 10);
    if (!this.arrowGeos.has(key)) this.arrowGeos.set(key, arrowGeometry(key / 10));
    return this.arrowGeos.get(key);
  }

  update(song, beat, lookBeats, dt) {
    this.sprites.begin();
    this.bars.begin();
    this.lines.begin();
    this.gems.begin();
    this.arrows.begin();
    this.beatLines.begin();

    // ---- Left hand -------------------------------------------------------
    const { cur, next } = findSegments(song.left, beat);
    if (cur) {
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

    // Chord name floating just above the finger markers (beyond the high e), so name and shape go together.
    const named = cur || next;
    if (named?.name) {
      const x = held.length ? (fretX(Math.min(...held) - 1) + fretX(Math.max(...held))) / 2 : 1.8;
      const label = this.marker(wideLabelTexture(CHORD_NAMES[named.name] || named.name), x, 1.2, -(boardHalfWidth(x) + 1.7), 1, cur ? 1 : 0.5, 23);
      label.scale.set(6.4, 1.6, 1);
    }

    this.drawLitStrings(cur ? cur.shape : next?.shape, cur ? 1 : 0.3);

    // ---- Right hand ------------------------------------------------------
    const span = HIGHWAY_END - STRIKE_X;
    for (const ev of song.right) {
      const d = ev.beat - beat;
      if (d < -0.5) continue;
      if (d > lookBeats) break;
      const x = d > 0 ? STRIKE_X + (d / lookBeats) * span : STRIKE_X;
      const fade = d < 0 ? Math.max(0, 1 + d * 2) : Math.min(1, (lookBeats - d) * 2);
      const grow = d < 0 ? 1 - d * 2.5 : 1;
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
        const z0 = Math.max(...zs), z1 = Math.min(...zs);
        const arrow = this.arrows.get();
        arrow.geometry = this.arrowGeo(z0 - z1 + 1.0);
        arrow.material.color.set(STRUM_COLORS[ev.dir]);
        arrow.material.opacity = 0.9 * fade;
        arrow.position.set(x, STRING_Y + 0.25, (z0 + z1) / 2);
        arrow.rotation.y = ev.dir === 'U' ? Math.PI : 0;
        arrow.scale.set(grow, 1, 1);
      }
    }

    const bpb = song.beatsPerBar;
    const every = song.clickEvery || 1;
    for (let k = Math.ceil(beat / every) * every; k - beat <= lookBeats; k += every) {
      const line = this.beatLines.get();
      const bar = ((k % bpb) + bpb) % bpb === 0;
      line.position.set(STRIKE_X + ((k - beat) / lookBeats) * span, TOP_Y + 0.06, 0);
      line.scale.set(bar ? 0.16 : 0.07, 1, 1);
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
    this.arrows.end();
    this.beatLines.end();
  }
}
