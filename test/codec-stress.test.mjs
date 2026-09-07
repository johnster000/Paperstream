// Randomized stress tests for the Paperstream codec. Run: node test/codec-stress.test.mjs
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'paperstream.html'), 'utf8');
const codec = html.split('// ==== CODEC BEGIN ====')[1].split('// ==== CODEC END ====')[0];
const PS = new Function(codec + '; return PS;')();

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL:', msg); } };

console.log('constants: BLOCK_LEN', PS.BLOCK_LEN, 'DATA_BYTES', PS.DATA_BYTES);
check(PS.BLOCK_LEN === 754 && PS.DATA_BYTES === 778, 'format constants changed; update CLAUDE.md if intentional');

function trial(size, surplus, shuffle = true) {
  const original = new Uint8Array(size); for (let i = 0; i < size; i++) original[i] = Math.random() * 256 | 0;
  const enc = PS.makeEncoder(PS.packContainer('t.bin', original), 0);
  const total = enc.K + surplus + 20;
  const tiles = []; for (let t = 0; t < total; t++) tiles.push(PS.readTile(enc.tile(t)));
  check(tiles.every(Boolean), 'every rendered tile must read back');
  let order = [...Array(total).keys()]; if (shuffle) order.sort(() => Math.random() - 0.5);
  const keep = new Set(order.slice(0, enc.K + surplus));
  const dec = PS.makeDecoder(); let used = 0;
  for (const t of order) { if (!keep.has(t)) continue; dec.accept(tiles[t]); used++; if (dec.done) break; if (used >= enc.K && dec.eliminate()) break; }
  if (!dec.done) dec.eliminate();
  if (!dec.done) return 'rank';
  const out = PS.unpackContainer(dec.result().container);
  return Buffer.compare(Buffer.from(out.data), Buffer.from(original)) === 0 ? 'ok' : 'wrong';
}

for (const [surplus, n, maxRankFail] of [[3, 200, 0.25], [10, 200, 0.02]]) {
  let ok = 0, rank = 0, wrong = 0;
  for (let i = 0; i < n; i++) { const r = trial(2000 + Math.random() * 60000 | 0, surplus); if (r === 'ok') ok++; else if (r === 'rank') rank++; else wrong++; }
  console.log(`K+${surplus}: ok ${ok}, rank-fail ${rank} (${(100 * rank / n).toFixed(1)}%), wrong ${wrong}`);
  check(wrong === 0, 'decoder produced wrong output');
  check(rank / n <= maxRankFail, `rank failure rate too high at K+${surplus}`);
}

// larger file, timing
{
  const t0 = Date.now(); const r = trial(750_000, 10); console.log(`K~1000: ${r} in ${Date.now() - t0} ms`); check(r === 'ok', 'large file roundtrip');
}
// gzip container end to end
{
  const text = Buffer.from('paper is patient. '.repeat(20000));
  const gz = new Uint8Array(zlib.gzipSync(text));
  const enc = PS.makeEncoder(PS.packContainer('p.txt', gz), PS.FLAG_GZIP);
  const dec = PS.makeDecoder(); for (let t = enc.K; t < 2 * enc.K + 10; t++) dec.accept(PS.readTile(enc.tile(t))); dec.eliminate();
  const out = dec.result(); const c = PS.unpackContainer(out.container);
  check(out.flags === PS.FLAG_GZIP && c.name === 'p.txt' && Buffer.compare(zlib.gunzipSync(Buffer.from(c.data)), text) === 0, 'gzip container roundtrip from repair tiles only');
}
// corruption detection
{
  const enc = PS.makeEncoder(PS.packContainer('x', new Uint8Array(3000)), 0);
  const m = enc.tile(1); m[40 * 80 + 40] ^= 1;
  check(PS.readTile(m) === null, 'single flipped data cell must fail CRC');
  const blank = new Uint8Array(80 * 80); check(PS.readTile(blank) === null, 'blank tile must be rejected');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
