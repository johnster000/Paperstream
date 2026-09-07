// Shared helpers for the node tests: load PS/PSV out of paperstream.html and
// render tiles through a perspective warp with blur, shading and noise.
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
export const html = fs.readFileSync(path.join(here, '..', 'paperstream.html'), 'utf8');
const between = (a, b) => html.split(a)[1].split(b)[0];
export const { PS, PSV } = new Function(between('// ==== CODEC BEGIN ====', '// ==== CODEC END ====') + between('// ==== VISION BEGIN ====', '// ==== VISION END ====') + '; return { PS, PSV };')();

export const GUTTER = 2, PITCH = PS.TILE + GUTTER;

let seed = process.env.SEED ? Number(process.env.SEED) : 12345;
export const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
export const reseed = s => { seed = s >>> 0; };
Math.random = rnd; // makeEncoder draws its fileId from Math.random; keep test runs reproducible
const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rnd(); return (s - 2) * Math.sqrt(3); };

// Page rectangle for a cols x rows grid, in cells, with a gutter margin.
export const pageSize = (cols, rows) => [cols * PITCH + 2 * GUTTER, rows * PITCH + 2 * GUTTER];

// Image quad for a pw x ph cell page at s px/cell, rotated by rot, with
// keystone key (top edge narrower than bottom when key > 0), centred in w x h.
export function pose(pw, ph, w, h, s, rot, key, extra = {}) {
  const cx = w / 2, cy = h / 2, hw = pw * s / 2, hh = ph * s / 2, c = Math.cos(rot), si = Math.sin(rot);
  const quad = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => { x *= 1 + key * (y / hh); return [cx + x * c - y * si, cy + x * si + y * c]; });
  return { quad, pw, ph, ...extra };
}
// Where the finders and mark of grid tile (c, r) land in the image.
export function truthPoints(p, c, r) {
  const H = PSV.homography([[0, 0], [p.pw, 0], [p.pw, p.ph], [0, p.ph]], p.quad);
  const ox = GUTTER + c * PITCH, oy = GUTTER + r * PITCH;
  return [[3.5, 3.5], [76.5, 3.5], [3.5, 76.5], [75.5, 75.5]].map(([x, y]) => PSV.project(H, ox + x, oy + y));
}

// Render a cols x rows grid of tiles (tile index = first + r*cols + c) into a
// w x h gray image under pose p. Returns Uint8Array.
export function render(enc, first, cols, rows, w, h, p) {
  const { pw, ph } = p;
  const mats = []; for (let i = 0; i < cols * rows; i++) mats.push(enc.tile(first + i));
  const Hinv = PSV.homography(p.quad, [[0, 0], [pw, 0], [pw, ph], [0, ph]]); // image -> page cells
  const ink = p.ink === undefined ? 25 : p.ink, paper = p.paper === undefined ? 225 : p.paper;
  const SS = 2, img = new Float32Array(w * h);
  const blots = p.blots || []; // [{x, y, r, v}] in page cells: ink drops (v = 1) or white scuffs (v = 0)
  const cellAt = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= pw || cy >= ph) return p.background === undefined ? 0.5 : p.background; // desk
    for (const b of blots) { const dx = cx - b.x, dy = cy - b.y; if (dx * dx + dy * dy < b.r * b.r) return b.v; }
    const gx = cx - GUTTER, gy = cy - GUTTER; if (gx < 0 || gy < 0) return 0;
    const c = Math.floor(gx / PITCH), r = Math.floor(gy / PITCH); if (c >= cols || r >= rows) return 0;
    const x = Math.floor(gx - c * PITCH), y = Math.floor(gy - r * PITCH); if (x >= PS.TILE || y >= PS.TILE) return 0;
    return mats[r * cols + c][y * PS.TILE + x];
  };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let acc = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const [cx, cy] = PSV.project(Hinv, px + (sx + 0.5) / SS, py + (sy + 0.5) / SS); acc += cellAt(cx, cy); }
    img[py * w + px] = acc / (SS * SS);
  }
  for (let pass = 0; pass < (p.blur || 0); pass++) {
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) tmp[y * w + x] = (img[y * w + x - 1] + img[y * w + x] + img[y * w + x + 1]) / 3;
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) img[y * w + x] = (tmp[(y - 1) * w + x] + tmp[y * w + x] + tmp[(y + 1) * w + x]) / 3;
  }
  const out = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const light = 1 - (p.shade || 0) * (px / w) - (p.shade || 0) * 0.5 * (py / h);
    const v = (paper - (paper - ink) * img[py * w + px]) * light + (p.noise || 0) * gauss();
    out[py * w + px] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}
// Write a PGM for eyeballing a render.
export function savePgm(file, g, w, h) { fs.writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), Buffer.from(g)])); }
