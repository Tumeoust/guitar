import * as THREE from 'three';

const cache = new Map();

function canvasTexture(key, draw, w = 128, h = 128) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function centeredText(g, text, x, y, size, color) {
  g.fillStyle = color;
  g.font = `800 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y + size * 0.06);
}

// Filled disc with a finger number on it, with a white rim like a Guitar Hero gem.
export function discTexture(color, text) {
  return canvasTexture(`disc:${color}:${text}`, (g, s) => {
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(10,12,18,0.85)';
    g.stroke();
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 14, 0, Math.PI * 2);
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
    centeredText(g, text, s / 2, s / 2, 70, '#0b0d12');
  });
}

export function ringTexture(color, width = 10) {
  return canvasTexture(`ring:${color}:${width}`, (g, s) => {
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - width / 2 - 2, 0, Math.PI * 2);
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  });
}

export function crossTexture(color) {
  return canvasTexture(`cross:${color}`, (g, s) => {
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.strokeStyle = color;
    const a = s * 0.25, b = s * 0.75;
    g.beginPath();
    g.moveTo(a, a); g.lineTo(b, b);
    g.moveTo(b, a); g.lineTo(a, b);
    g.stroke();
  });
}

// Wide label for longer text such as chord names; use with a 4:1 sprite scale.
export function wideLabelTexture(text, color = '#ffffff') {
  return canvasTexture(`wide:${text}:${color}`, (g, w, h) => {
    g.shadowColor = 'rgba(0, 0, 0, 0.8)';
    g.shadowBlur = 12;
    centeredText(g, text, w / 2, h / 2, 84, color);
  }, 512, 128);
}

// String name greyed out and crossed out: "don't play this string". Grey, because red is a finger.
export function mutedLabelTexture(text) {
  return canvasTexture(`muted:${text}`, (g, s) => {
    centeredText(g, text, s * 0.4, s / 2, 64, '#6b7385');
    g.lineWidth = 8;
    g.lineCap = 'round';
    g.strokeStyle = '#e8ebf2';
    g.beginPath();
    g.moveTo(s * 0.7, s * 0.32); g.lineTo(s * 0.88, s * 0.5);
    g.moveTo(s * 0.88, s * 0.32); g.lineTo(s * 0.7, s * 0.5);
    g.stroke();
  });
}

export function labelTexture(text, color = '#c3cad8') {
  return canvasTexture(`label:${text}:${color}`, (g, s) => {
    centeredText(g, text, s / 2, s / 2, 64, color);
  });
}
