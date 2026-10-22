import * as THREE from 'three';
import { labelTexture, mutedLabelTexture } from './textures.js';

// World layout (units ≈ cm):
//   x runs along the strings: nut at x = 0, saddle at x = SCALE, headstock at x < 0.
//   y is up out of the fretboard / soundboard.
//   z runs across the strings: the low E (string 0) is at +z, the high e at -z.
// Seen from the player's side (+z, above), this gives the same picture as looking
// down at your own guitar: headstock to the left, low E nearest to you.

export const SCALE = 65;
export const NUM_FRETS = 19;
export const STRING_Y = 0.42;
export const TOP_Y = -0.75;            // soundboard height
export const SOUNDHOLE_X = 48.5;
export const STRIKE_X = 50.5;          // where the picking hand hits the strings
export const HIGHWAY_END = 63;         // right-hand cues start here and travel to STRIKE_X
export const NUT_CUE_X = -1.1;         // where open / muted markers sit

const NUT_SPREAD = 3.5;
const SADDLE_SPREAD = 5.3;
const NUT_WIDTH = 4.4;
const BOARD_END_WIDTH = 5.8;
const BOARD_THICK = 0.75;

export function fretX(n) {
  return SCALE * (1 - Math.pow(2, -n / 12));
}

const BOARD_END = fretX(NUM_FRETS) + 0.7;

export function boardHalfWidth(x) {
  const t = Math.min(Math.max(x / BOARD_END, 0), 1);
  return (NUT_WIDTH + (BOARD_END_WIDTH - NUT_WIDTH) * t) / 2;
}

export function stringZ(i, x = 0) {
  const spread = NUT_SPREAD + (SADDLE_SPREAD - NUT_SPREAD) * (x / SCALE);
  return spread / 2 - (i * spread) / 5;
}

// Where a fingertip goes for a fret: just behind the fret wire.
export function fingerX(fret) {
  if (fret <= 0) return NUT_CUE_X;
  const a = fretX(fret - 1), b = fretX(fret);
  return b - (b - a) * 0.32;
}

// Extrude a shape drawn in (x, z) downwards from y = 0.
function extrudeDown(shape, depth, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 48,
  });
  geo.rotateX(Math.PI / 2);
  return geo;
}

function flat(geo) {
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function rod(a, b, r, mat, segments = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r, r, d.length(), segments, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function taper(x0, w0, x1, w1) {
  return new THREE.Shape([
    new THREE.Vector2(x0, -w0 / 2), new THREE.Vector2(x1, -w1 / 2),
    new THREE.Vector2(x1, w1 / 2), new THREE.Vector2(x0, w0 / 2),
  ]);
}

function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(34.5, 0);
  s.bezierCurveTo(34.5, 9, 38, 14.5, 44, 14.5);
  s.bezierCurveTo(50, 14.5, 52, 11.8, 57, 11.8);
  s.bezierCurveTo(62, 11.8, 64, 19, 72, 19);
  s.bezierCurveTo(80, 19, 85.5, 13, 85.5, 0);
  s.bezierCurveTo(85.5, -13, 80, -19, 72, -19);
  s.bezierCurveTo(64, -19, 62, -11.8, 57, -11.8);
  s.bezierCurveTo(52, -11.8, 50, -14.5, 44, -14.5);
  s.bezierCurveTo(38, -14.5, 34.5, -9, 34.5, 0);
  return s;
}

function headstockShape() {
  const s = new THREE.Shape();
  s.moveTo(0.2, -2.3);
  s.lineTo(-3, -2.9);
  s.lineTo(-16.5, -3.7);
  s.quadraticCurveTo(-19.5, -3.8, -19.5, -1.5);
  s.quadraticCurveTo(-18.4, 0, -19.5, 1.5);
  s.quadraticCurveTo(-19.5, 3.8, -16.5, 3.7);
  s.lineTo(-3, 2.9);
  s.lineTo(0.2, 2.3);
  return s;
}

export function buildGuitar() {
  const root = new THREE.Group();

  const mat = {
    top: new THREE.MeshStandardMaterial({ color: 0xd9a868, roughness: 0.55 }),
    sides: new THREE.MeshStandardMaterial({ color: 0x5a2e17, roughness: 0.45 }),
    neck: new THREE.MeshStandardMaterial({ color: 0x8a4f26, roughness: 0.5 }),
    board: new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.8 }),
    fret: new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.9, roughness: 0.25 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.4 }),
    pearl: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.3, emissive: 0x222018 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x120c09, roughness: 0.6 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x050403 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd5de, metalness: 0.5, roughness: 0.3 }),
  };

  // Body
  const body = new THREE.Mesh(extrudeDown(bodyShape(), 10, 0.4), [mat.top, mat.sides]);
  body.position.y = TOP_Y - 0.4;
  root.add(body);

  const binding = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(bodyShape().getPoints(80).map((p) => new THREE.Vector3(p.x, TOP_Y + 0.01, p.y))),
    new THREE.LineBasicMaterial({ color: 0xf3e6cc }),
  );
  root.add(binding);

  const hole = new THREE.Mesh(flat(new THREE.CircleGeometry(4.3, 64)), mat.hole);
  hole.position.set(SOUNDHOLE_X, TOP_Y + 0.02, 0);
  root.add(hole);
  for (const [r0, r1, c] of [[4.5, 5.4, 0x3a2416], [4.75, 4.95, 0xe8dcc2], [5.15, 5.25, 0xe8dcc2]]) {
    const ring = new THREE.Mesh(flat(new THREE.RingGeometry(r0, r1, 64)), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    ring.position.set(SOUNDHOLE_X, TOP_Y + 0.025, 0);
    root.add(ring);
  }

  // Bridge, saddle and pins
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 15), mat.dark);
  bridge.position.set(66.2, TOP_Y + 0.35, 0);
  root.add(bridge);
  const saddleH = STRING_Y - (TOP_Y + 0.7);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.28, saddleH, 6.2), mat.bone);
  saddle.position.set(SCALE, TOP_Y + 0.7 + saddleH / 2, 0);
  root.add(saddle);

  // Neck, fretboard, nut
  const neck = new THREE.Mesh(extrudeDown(taper(-0.4, NUT_WIDTH - 0.4, 37, BOARD_END_WIDTH - 0.6), 1.6, 0.35), mat.neck);
  neck.position.y = -BOARD_THICK - 0.35;
  root.add(neck);

  const board = new THREE.Mesh(extrudeDown(taper(0, NUT_WIDTH, BOARD_END, BOARD_END_WIDTH), BOARD_THICK), mat.board);
  root.add(board);

  const nut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.46, NUT_WIDTH), mat.bone);
  nut.position.set(-0.25, 0.23, 0);
  root.add(nut);

  for (let n = 1; n <= NUM_FRETS; n++) {
    const x = fretX(n);
    const w = boardHalfWidth(x) * 2;
    const fret = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, w, 8), mat.fret);
    fret.rotation.x = Math.PI / 2;
    fret.position.set(x, 0.03, 0);
    root.add(fret);
  }

  const dotGeo = flat(new THREE.CircleGeometry(0.3, 24));
  const addDot = (x, z) => {
    const d = new THREE.Mesh(dotGeo, mat.pearl);
    d.position.set(x, 0.005, z);
    root.add(d);
  };
  for (const n of [3, 5, 7, 9, 12, 15, 17]) {
    const x = (fretX(n - 1) + fretX(n)) / 2;
    if (n === 12) { addDot(x, 1.2); addDot(x, -1.2); } else addDot(x, 0);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(String(n)), transparent: true, depthWrite: false }));
    label.scale.setScalar(2);
    label.position.set(x, 0.2, boardHalfWidth(x) + 1.0);
    root.add(label);
  }

  // Headstock with tuners, tilted back from the nut
  const head = new THREE.Group();
  head.rotation.z = 0.2;
  root.add(head);
  const headFace = -0.15;
  const headMesh = new THREE.Mesh(extrudeDown(headstockShape(), 1.3, 0.12), [mat.dark, mat.neck]);
  headMesh.position.y = headFace - 0.12;
  head.add(headMesh);

  const POSTS_X = [-5.2, -9.7, -14.2];
  const postFor = [[0, 1], [1, 1], [2, 1], [2, -1], [1, -1], [0, -1]]; // [post index, side]
  const postTops = [];
  for (const side of [1, -1]) {
    for (const px of POSTS_X) {
      const z = side * 2.45;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 12), mat.chrome);
      post.position.set(px, headFace + 0.45, z);
      head.add(post);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), mat.chrome);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.set(px, headFace - 0.6, side * 4.0);
      head.add(shaft);
      const button = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.35, 1.3), mat.chrome);
      button.position.set(px, headFace - 0.6, side * 5.2);
      head.add(button);
    }
  }
  head.updateMatrixWorld(true);
  for (let i = 0; i < 6; i++) {
    const [p, side] = postFor[i];
    postTops.push(head.localToWorld(new THREE.Vector3(POSTS_X[p], headFace + 0.6, side * 2.45)));
  }

  // String names next to the tuning pegs, low E to high e.
  const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];
  const stringLabels = postTops.map((p, i) => {
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(STRING_LABELS[i], '#f2f4f8'), transparent: true, depthTest: false, depthWrite: false,
    }));
    label.renderOrder = 18;
    label.scale.setScalar(1.7);
    label.position.copy(p).add(new THREE.Vector3(0, 1.1, 0));
    root.add(label);
    return label;
  });

  // Strings
  const RADII = [0.07, 0.062, 0.054, 0.046, 0.036, 0.03];
  const strings = [];
  for (let i = 0; i < 6; i++) {
    const wound = i < 4;
    const m = new THREE.MeshStandardMaterial({
      color: wound ? 0xc9a46b : 0xe4e8ef,
      metalness: 0.85,
      roughness: 0.3,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    const a = new THREE.Vector3(-0.05, STRING_Y, stringZ(i, 0));
    const b = new THREE.Vector3(SCALE, STRING_Y, stringZ(i, SCALE));
    const mesh = rod(a, b, RADII[i], m);
    root.add(mesh);
    root.add(rod(a, postTops[i], RADII[i], m));
    const pin = new THREE.Vector3(67.4, TOP_Y + 0.72, stringZ(i, SCALE) * 1.05);
    root.add(rod(b, pin, RADII[i], m));
    const pinHead = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12), mat.bone);
    pinHead.position.copy(pin);
    root.add(pinHead);
    strings.push({ mesh, mat: m, vib: 0, glow: 0, baseZ: mesh.position.z });
  }

  let t = 0;
  return {
    root,
    strings,
    pluck(i, amount = 1) {
      const s = strings[i];
      s.vib = Math.max(s.vib, amount);
    },
    // Steady glow for strings that matter right now (0..1).
    setGlow(i, amount) {
      strings[i].glow = amount;
    },
    // Show at the tuning pegs which strings to play: muted strings (-1) get a red ✕, strings the
    // shape doesn't use (null) are dimmed.
    markStrings(frets) {
      stringLabels.forEach((label, i) => {
        const f = frets ? frets[i] : 0;
        const tex = f === -1 ? mutedLabelTexture(STRING_LABELS[i]) : labelTexture(STRING_LABELS[i], '#f2f4f8');
        if (label.material.map !== tex) {
          label.material.map = tex;
          label.material.needsUpdate = true;
        }
        label.material.opacity = f == null ? 0.35 : 1;
      });
    },
    update(dt) {
      t += dt;
      for (const s of strings) {
        s.vib *= Math.exp(-dt * 4);
        const wobble = Math.sin(t * 90) * 0.03 * s.vib;
        s.mesh.position.z = s.baseZ + wobble;
        s.mesh.scale.x = s.mesh.scale.z = 1 + s.vib * 1.2;
        s.mat.emissiveIntensity = Math.min(1, s.glow * 0.3 + s.vib * 0.6);
      }
    },
  };
}
