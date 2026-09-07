# Paperstream

Offline file transfer via paper. A file becomes pages of dense, fountain-coded
tiles (a custom format, not QR). The reader sweeps a phone camera over the
pages in any order and gets the file back. Everything runs in one
self-contained HTML file, in the browser, with nothing sent to any server.

## Non-negotiable design constraints
- Deliverable is a single `paperstream.html` with no external dependencies.
  It must work from `file://` and offline. If code is split into modules,
  a build step must inline them back into one file.
- Phone-scannable. Flatbed scanners are a bonus, not the target.
- Nothing leaves the browser. No analytics, no fetches.
- The format spec must stay simple enough to re-implement from a printed
  description decades from now. Prefer boring, well-known primitives.

## Format v0 (implemented, tested)
- Tile: 80×80 cells. Three 7×7 QR-style finders (TL, TR, BL) and a 5×5
  alignment mark (BR, cells 73..77). All other cells are data, row-major,
  XORed with a fixed xorshift32 mask (seed 0x9E3779B9).
- Data per tile: 778 bytes = 20-byte header + 754-byte block + CRC32.
  Header (big-endian): 'P','S', version u8=0, flags u8 (bit0 = gzip),
  fileId u32, K u16, blockLen u16 (=754), fileLen u32, tileIndex u32.
- Container: [u16 nameLen][utf8 name][gzip data]. Split into K blocks of 754.
- Fountain code: systematic. Tile t < K carries block t. Tile t ≥ K is the
  XOR of a random half of all blocks, chosen by mulberry32 seeded from
  mix32(fileId, t). Decoder: peel, then Gaussian elimination over GF(2).
  Any K + ~8 distinct tiles rebuild the file (failure ≈ 2^-surplus).
- Page: letter or A4, 0.35 in margins, 0.32 in text header, 2-cell gutters.
  Default cell 0.0075 in (133 cells/in) → 12×16 tiles → ~141 KB payload/page.

## Lessons already learned (do not relearn)
- Sparse LT / robust-soliton repair tiles FAIL on coverage when only a few
  repair tiles survive alongside most systematic tiles. Dense repair rows fix it.
- xorshift is linear over GF(2). Dense rows generated from it span ≤ 32
  dimensions and elimination fails. Use a PRNG with multiplication (mulberry32).
- Gaussian elimination must operate on copies of equation data. A failed pass
  that mutates pending equations corrupts later peeling (produced wrong output
  silently once).

## Testing rules
- `node test/codec-stress.test.mjs` runs randomized stress tests (loss,
  shuffle, exact K+3 / K+10 surplus, CRC rejection). Run it after ANY codec
  change. Zero wrong outputs is the bar; rank-failure rate at K+3 should be
  ~12%, at K+10 ~0.1%.
- Headless browser tests with Playwright cover encode → rasterize → decode.
- Camera decoding must be tested against real phone photos/videos in
  `fixtures/`, not synthetic renders.

## Roadmap
1. Camera decoder: finder detection, per-tile homography, adaptive threshold,
   blur gating, live progress bar, works from a video sweep.
2. Reed-Solomon inside tiles so a single bad cell doesn't discard a tile.
3. Density tuning against real prints (0.0075 → 0.005 in).
4. Print the decoder's own source on the last pages (self-decoding backup).
5. Write the format spec as a standalone document.
