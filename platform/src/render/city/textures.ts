import * as THREE from 'three';
import { makeRng, rand, type RngState } from '../../core/rng';

/* Procedural textures drawn once on canvases. No external image assets, so the build is
   self-contained and licensing is simple. Physical tile sizes are documented next to each
   texture so geometry can map UVs in metres. */

export interface FacadeTex {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture; // lit windows for the night look
  tileW: number; // metres covered horizontally by one texture repeat
  tileH: number; // metres covered vertically
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb = true, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, r: RngState, amount: number, base: [number, number, number]) {
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rand(r) - 0.5) * amount;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** Asphalt: fine aggregate noise with faint wear patches. One repeat = 8 m. */
export function asphaltTexture(): THREE.CanvasTexture {
  const n = 512;
  const [c, g] = canvas(n, n);
  const r = makeRng(11, 'tex-asphalt');
  noise(g, n, n, r, 26, [92, 94, 98]);
  g.globalAlpha = 0.06;
  for (let i = 0; i < 26; i++) {
    const x = rand(r) * n;
    const y = rand(r) * n;
    const rad = 20 + rand(r) * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = rand(r) > 0.5;
    grd.addColorStop(0, dark ? '#202226' : '#9a9a9a');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalAlpha = 1;
  return finish(c);
}

/** Paving slabs for sidewalks: 0.6 m tiles with grout. One repeat = 4.8 m. */
export function pavingTexture(): THREE.CanvasTexture {
  const n = 512;
  const [c, g] = canvas(n, n);
  const r = makeRng(12, 'tex-paving');
  noise(g, n, n, r, 14, [214, 204, 186]);
  const tiles = 8;
  const s = n / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const v = (rand(r) - 0.5) * 16;
      g.fillStyle = `rgba(${200 + v},${189 + v},${170 + v},0.35)`;
      g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
    }
  }
  g.strokeStyle = 'rgba(120,108,92,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    g.beginPath();
    g.moveTo(i * s, 0);
    g.lineTo(i * s, n);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * s);
    g.lineTo(n, i * s);
    g.stroke();
  }
  return finish(c);
}

/** Plot surface: compacted sand and concrete. One repeat = 24 m. */
export function plotTexture(): THREE.CanvasTexture {
  const n = 256;
  const [c, g] = canvas(n, n);
  const r = makeRng(13, 'tex-plot');
  noise(g, n, n, r, 18, [206, 190, 160]);
  return finish(c);
}

/** Irrigated planting: grass with soil gaps. One repeat = 6 m. */
export function grassTexture(): THREE.CanvasTexture {
  const n = 256;
  const [c, g] = canvas(n, n);
  const r = makeRng(14, 'tex-grass');
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const k = rand(r);
    const soil = k > 0.93;
    img.data[i * 4] = soil ? 120 + k * 20 : 70 + k * 40;
    img.data[i * 4 + 1] = soil ? 100 + k * 20 : 110 + k * 50;
    img.data[i * 4 + 2] = soil ? 70 : 40 + k * 20;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/** Glass curtain wall: 8 bays x 8 floors with mullions and spandrels. One repeat = 12.8 m x 30.4 m. */
export function glassFacade(seed: number, tint: [number, number, number]): FacadeTex {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  const r = makeRng(seed, 'tex-glass');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const cols = 8;
  const rows = 8;
  const cw = W / cols;
  const rh = H / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = (rand(r) - 0.5) * 18;
      g.fillStyle = `rgb(${tint[0] + v},${tint[1] + v},${tint[2] + v})`;
      g.fillRect(x * cw, y * rh, cw, rh);
      // vertical gradient inside each pane suggests reflection depth
      const grd = g.createLinearGradient(0, y * rh, 0, (y + 1) * rh);
      grd.addColorStop(0, 'rgba(255,255,255,0.07)');
      grd.addColorStop(1, 'rgba(0,0,0,0.10)');
      g.fillStyle = grd;
      g.fillRect(x * cw, y * rh, cw, rh);
      // lit office windows at night: warm, clustered by floor
      if (rand(r) > 0.52) {
        const warm = 180 + rand(r) * 60;
        ge.fillStyle = `rgb(${warm},${warm * 0.82},${warm * 0.55})`;
        ge.fillRect(x * cw + 3, y * rh + rh * 0.22, cw - 6, rh * 0.72);
      }
    }
    // spandrel band (floor slab)
    g.fillStyle = 'rgba(18,24,32,0.85)';
    g.fillRect(0, y * rh, W, rh * 0.16);
  }
  g.fillStyle = 'rgba(176,188,198,0.9)';
  for (let x = 0; x <= cols; x++) g.fillRect(x * cw - 1.5, 0, 3, H);
  return { map: finish(c), emissive: finish(e), tileW: 12.8, tileH: 30.4 };
}

/** Stone or render facade with punched windows and balconies. One repeat = 13.2 m x 14.4 m (4 x 4 floors). */
export function stoneFacade(seed: number, base: [number, number, number], balconies: boolean): FacadeTex {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  const r = makeRng(seed, 'tex-stone');
  noise(g, W, H, r, 12, base);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const cols = 4;
  const rows = 4;
  const cw = W / cols;
  const rh = H / rows;
  for (let y = 0; y < rows; y++) {
    // slab line
    g.fillStyle = `rgba(${base[0] - 40},${base[1] - 40},${base[2] - 40},0.55)`;
    g.fillRect(0, y * rh + rh - 6, W, 6);
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + cw * 0.2;
      const wy = y * rh + rh * 0.18;
      const ww = cw * 0.6;
      const wh = rh * 0.58;
      // recess shadow then glass
      g.fillStyle = 'rgba(40,36,30,0.55)';
      g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const v = rand(r) * 24;
      g.fillStyle = `rgb(${46 + v},${62 + v},${78 + v})`;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(wx, wy, ww, wh * 0.35);
      g.fillStyle = 'rgba(220,214,200,0.9)';
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh); // mullion
      if (balconies) {
        g.fillStyle = `rgba(${base[0] + 18},${base[1] + 18},${base[2] + 18},1)`;
        g.fillRect(wx - 10, wy + wh + 4, ww + 20, 10);
        g.fillStyle = 'rgba(60,70,80,0.6)';
        g.fillRect(wx - 10, wy + wh - 14, ww + 20, 3);
      }
      if (rand(r) > 0.58) {
        const warm = 170 + rand(r) * 70;
        ge.fillStyle = `rgb(${warm},${warm * 0.78},${warm * 0.5})`;
        ge.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
  }
  return { map: finish(c), emissive: finish(e), tileW: 13.2, tileH: 14.4 };
}

/** Retail podium: shopfront glazing with a canopy band. One repeat = 16 m x 5.5 m (one storey). */
export function podiumFacade(seed: number): FacadeTex {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  const r = makeRng(seed, 'tex-podium');
  noise(g, W, H, r, 10, [226, 220, 206]);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let x = 0; x < 4; x++) {
    const bx = x * 128 + 8;
    g.fillStyle = 'rgb(38,52,64)';
    g.fillRect(bx, 70, 112, 170);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(bx, 70, 112, 50);
    g.fillStyle = 'rgba(210,200,180,0.9)';
    g.fillRect(bx + 54, 70, 4, 170);
    const warm = 200 + rand(r) * 50;
    ge.fillStyle = `rgb(${warm},${warm * 0.85},${warm * 0.62})`;
    ge.fillRect(bx + 4, 90, 104, 146);
  }
  g.fillStyle = 'rgb(70,62,52)';
  g.fillRect(0, 44, W, 18); // canopy band
  return { map: finish(c), emissive: finish(e), tileW: 16, tileH: 5.5 };
}

/** Helipad, hospital sign and similar flat decals. */
export function decalTexture(kind: 'helipad' | 'hospital'): THREE.CanvasTexture {
  const n = 256;
  const [c, g] = canvas(n, n);
  if (kind === 'helipad') {
    g.fillStyle = '#3c4148';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(n / 2, n / 2, n * 0.4, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f2f2f2';
    g.font = 'bold 130px Inter, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', n / 2, n / 2 + 6);
  } else {
    g.fillStyle = '#1f5fa8';
    g.fillRect(0, 0, n, n);
    g.fillStyle = '#ffffff';
    g.font = 'bold 170px Inter, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', n / 2, n / 2 + 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Text label sprite texture (junction ids, gateway names). */
export function labelTexture(text: string, sub?: string, accent = '#45d4e8'): THREE.CanvasTexture {
  const W = 512;
  const H = sub ? 176 : 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(10,15,23,0.88)';
  const rr = 22;
  g.beginPath();
  g.moveTo(rr, 0);
  g.lineTo(W - rr, 0);
  g.quadraticCurveTo(W, 0, W, rr);
  g.lineTo(W, H - rr);
  g.quadraticCurveTo(W, H, W - rr, H);
  g.lineTo(rr, H);
  g.quadraticCurveTo(0, H, 0, H - rr);
  g.lineTo(0, rr);
  g.quadraticCurveTo(0, 0, rr, 0);
  g.fill();
  g.fillStyle = accent;
  g.fillRect(0, 0, 10, H);
  g.fillStyle = '#f3f6f9';
  g.font = '700 64px Inter, Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 36, sub ? 58 : H / 2 + 2);
  if (sub) {
    g.fillStyle = '#9fb0c2';
    g.font = '500 38px Inter, Arial, sans-serif';
    g.fillText(sub, 36, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
