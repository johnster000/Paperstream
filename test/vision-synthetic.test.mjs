// Synthetic-camera tests for the scanner pipeline. Run: node test/vision-synthetic.test.mjs
// Renders tiles through a perspective warp with blur, uneven light and noise,
// then runs PSV.decodeFrame on the pixels. This is a regression net for the
// geometry and thresholding code; it does not replace real phone fixtures.
import { PS, PSV, render, pose, pageSize, truthPoints, rnd, PITCH, GUTTER } from './synth.mjs';

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL:', msg); } };

const data = new Uint8Array(40000); for (let i = 0; i < data.length; i++) data[i] = rnd() * 256 | 0;
const enc = PS.makeEncoder(PS.packContainer('scene.bin', data), 0);
console.log('K =', enc.K);

// A tile counts as visible when its finders and mark are inside the frame with a margin.
function visibleTiles(p, cols, rows, w, h) {
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (truthPoints(p, c, r).every(([x, y]) => x > 20 && y > 20 && x < w - 20 && y < h - 20)) n++;
  return n;
}

// slack = how many visible tiles the scene may miss
function scene(name, cols, rows, w, h, s, rot, key, extra, slack, opts) {
  const [pw, ph] = pageSize(cols, rows), p = pose(pw, ph, w, h, s, rot, key, extra);
  const first = Math.floor(rnd() * (enc.K + 10));
  const g = render(enc, first, cols, rows, w, h, p);
  const t0 = Date.now(), res = PSV.decodeFrame(g, w, h, opts), ms = Date.now() - t0;
  const ok = res.tiles.filter(t => t.ok), idx = new Set(ok.map(t => t.tile.header.tileIndex));
  const repaired = ok.reduce((a, t) => a + t.tile.corrected, 0);
  const vis = visibleTiles(p, cols, rows, w, h);
  const reasons = {}; for (const t of res.tiles) if (!t.ok) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  console.log(`${name}: finders ${res.finders.length}/${3 * cols * rows}, tiles ${idx.size}/${vis} visible (${cols * rows} drawn), ${repaired} bytes repaired, in ${ms} ms` + (Object.keys(reasons).length ? ', rejected ' + JSON.stringify(reasons) : ''));
  check([...idx].every(i => i >= first && i < first + cols * rows) && idx.size === ok.length, `${name}: decoded a tile index that was not on the page`);
  check(idx.size >= vis - slack, `${name}: expected at least ${vis - slack} tiles, got ${idx.size}`);
  if (process.env.DEBUG) { // per-tile diagnosis of misses: DEBUG=1 SEED=n node test/vision-synthetic.test.mjs
    const I = PSV.integral(g, w, h), r = Math.max(10, Math.round(Math.min(w, h) / 20));
    for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
      const ti = first + rr * cols + c; if (idx.has(ti)) continue;
      const T = truthPoints(p, c, rr); if (!T.every(([x, y]) => x > 20 && y > 20 && x < w - 20 && y < h - 20)) continue;
      const near = pt => res.finders.find(f => Math.hypot(f.x - pt[0], f.y - pt[1]) < 3);
      const [tl, tr, bl] = [near(T[0]), near(T[1]), near(T[2])];
      let why = 'finders ' + [tl, tr, bl].map(f => f ? 'ok' : 'MISSING').join('/');
      if (tl && tr && bl) {
        const al = PSV.findAlign(g, I, w, h, r, 8, tl, tr, bl), d = PSV.decodeTile(g, I, w, h, r, 8, tl, tr, bl);
        const off = al.picks.length ? Math.hypot(al.picks[0].x - T[3][0], al.picks[0].y - T[3][1]).toFixed(1) : 'none';
        why += `, mark score ${al.score} off by ${off} px, decodeTile -> ${d.ok ? 'OK' : d.reason + ' (fixed match ' + (d.match || 0).toFixed(2) + ')'}`;
        why += ', finder err px ' + [tl, tr, bl].map((f, i) => Math.hypot(f.x - T[i][0], f.y - T[i][1]).toFixed(2)).join('/');
      }
      console.log(`    miss tile ${ti} at grid (${c},${rr}): ${why}`);
    }
  }
  return res;
}

scene('flat 5px', 3, 3, 1400, 1400, 5, 0, 0, {}, 0);
scene('4K-ish 5px', 4, 3, 2400, 1700, 5, 0.1, 0.03, { blur: 1, noise: 3 }, 0);       // big frame: detection runs at half resolution
scene('4K-ish 3px', 5, 4, 1800, 1500, 3, 0.1, 0.03, { blur: 1, noise: 3 }, 2);       // half-res detection at the low end
scene('tilt 4px', 3, 3, 1300, 1300, 4, 0.2, 0.05, { blur: 1, shade: 0.25, noise: 4 }, 0);
scene('45deg 4px', 3, 3, 1500, 1500, 4, Math.PI / 4, 0.03, { blur: 1, noise: 3 }, 1);   // finder ratios must survive a diagonal scan
scene('180deg 4px', 2, 2, 900, 900, 4, Math.PI, 0.04, { blur: 1 }, 0);
scene('tilt 3px', 3, 3, 1000, 1000, 3, 0.12, 0.05, { blur: 1, shade: 0.2, noise: 3 }, 2); // about what 1080p video gives at arm's length
scene('dim 4px', 2, 2, 900, 900, 4, 0.1, 0.03, { blur: 1, ink: 90, paper: 160, noise: 3 }, 0);
scene('cropped 4px', 5, 4, 1400, 1000, 4, 0.05, 0.02, { blur: 1 }, 0);                  // edge tiles must be rejected cleanly, not misread
scene('keystone 4px', 3, 3, 1300, 1300, 4, 0.1, 0.18, { blur: 1, noise: 3 }, 1);          // strong perspective
scene('blurry 3px', 2, 2, 700, 700, 3, 0.1, 0.03, { blur: 4, noise: 4 }, 4);              // fails safe: few tiles, none wrong
scene('soft 3px', 3, 3, 1000, 1000, 3, 0.1, 0.03, { blur: 2, noise: 3 }, 2);              // between sharp and hopeless: RS territory
// ink drops and scuffs: a few per tile, each wiping a disc of 2-3 cells radius. Without RS every touched tile is lost.
{
  const [pw, ph] = pageSize(3, 3), blots = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) blots.push({ x: GUTTER + c * PITCH + 10 + rnd() * 60, y: GUTTER + r * PITCH + 10 + rnd() * 60, r: 1.5 + rnd() * 1.5, v: rnd() < 0.5 ? 1 : 0 });
  scene('blots 4px', 3, 3, 1300, 1300, 4, 0.1, 0.03, { blur: 1, noise: 3, blots }, 2);
}

// whole file from several sweeps over different regions
{
  const dec = PS.makeDecoder(); let frames = 0, accepted = 0;
  const perRow = 4, total = enc.K + 12, rows = Math.ceil(total / perRow);
  for (let r = 0; r < rows && !dec.done; r += 2) {
    const nrows = Math.min(2, rows - r), first = r * perRow, [pw, ph] = pageSize(perRow, nrows);
    const g = render(enc, first, perRow, nrows, 1500, 900, pose(pw, ph, 1500, 900, 4, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.1, { blur: 1, noise: 3, shade: 0.2 }));
    const res = PSV.decodeFrame(g, 1500, 900); frames++;
    for (const t of res.tiles) if (t.ok && dec.accept(t.tile).accepted) accepted++;
    if (!dec.done && dec.tilesSeen >= enc.K) dec.eliminate();
  }
  if (!dec.done) dec.eliminate();
  console.log(`sweep: ${frames} frames, ${accepted} tiles accepted, done ${dec.done}`);
  check(dec.done, 'file did not rebuild from the sweep');
  if (dec.done) { const out = PS.unpackContainer(dec.result().container); check(out.name === 'scene.bin' && Buffer.compare(Buffer.from(out.data), Buffer.from(data)) === 0, 'rebuilt file differs'); }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
