# Paperstream

Offline file transfer via paper. A file becomes pages of dense, fountain-coded
tiles (a custom format, not QR). The reader sweeps a phone camera over the
pages in any order and gets the file back. Everything runs in one
self-contained HTML file, in the browser, with nothing sent to any server.

## Non-negotiable design constraints
- Deliverable is a single `paperstream.html` with no external dependencies,
  for BOTH encoding and decoding. It must work from `file://` and offline.
  If code is split into modules, a build step must inline them back into one file.
- Phone-scannable. Flatbed scanners are a bonus, not the target.
- Nothing leaves the browser. No analytics, no fetches.
- The format spec must stay simple enough to re-implement from a printed
  description decades from now. Prefer boring, well-known primitives.

## Code layout inside paperstream.html
- `// ==== CODEC BEGIN/END ====`: `PS`, the tile format and fountain code. Pure, no DOM.
- `// ==== VISION BEGIN/END ====`: `PSV`, the camera pipeline over gray buffers. Pure, no DOM.
- `// ==== PAGE LAYOUT + UI ====`: page rendering, Encode tab, Decode tab (camera, photos, video files).
- Node tests pull `PS` and `PSV` out of the HTML by those markers (`test/synth.mjs`).

## Format v0 (implemented, tested; nothing printed for real yet)
- Tile: 80×80 cells. Three 7×7 QR-style finders (TL, TR, BL) and a 5×5
  alignment mark (BR, cells 73..77, centre 75.5). Each sits inside a reserved
  8×8 corner block, so a one-cell white separator surrounds it. All other
  cells are data, row-major, XORed with a fixed xorshift32 mask (seed 0x9E3779B9).
- Data per tile: 768 bytes = 4 interleaved Reed-Solomon codewords of 192 bytes
  (160 message + 32 parity) over GF(256), field polynomial 0x11D, generator
  roots α^0..α^31, first byte = highest-degree coefficient (the QR conventions).
  Tile byte j belongs to codeword j mod 4: bytes 0..639 are the message,
  640..767 the parity. Each word fixes 16 errors, or 32 erasures, or 2e+s ≤ 32.
- Message (640 bytes) = 20-byte header + 616-byte block + CRC32 over both.
  CRC is checked AFTER RS, so a miscorrection can never yield wrong output.
  Header (big-endian): 'P','S', version u8=0, flags u8 (bit0 = gzip),
  fileId u32, K u16, blockLen u16 (=616), fileLen u32, tileIndex u32.
- Container: [u16 nameLen][utf8 name][gzip data]. Split into K blocks of 616.
- Fountain code: systematic. Tile t < K carries block t. Tile t ≥ K is the
  XOR of a random half of all blocks, chosen by mulberry32 seeded from
  mix32(fileId, t). Decoder: peel, then Gaussian elimination over GF(2).
  Any K + ~8 distinct tiles rebuild the file (failure ≈ 2^-surplus).
- Page: letter or A4, 0.35 in margins, 0.32 in text header, 2-cell gutters.
  Default cell 0.0075 in (133 cells/in) → 12×16 tiles → ~115 KB payload/page.

## Scanner (PSV) in one paragraph
Grayscale → (frames ≥ 1500 px on the short side: probe at half resolution
first; trust it only if ≥ 6 finders with median module ≥ 6 px, else redo at
full) → summed-area table → local-mean threshold (radius min(w,h)/20,
bias 8) → finders by 1:1:3:1:1 run ratios on each row, cross-checked on the
column, the row again and one diagonal, merged over ≥2 rows → triples with
two equal legs (ratio ≤ 1.3) at a right angle (|cos| ≤ 0.3), handedness picks
TR vs BL → affine guess, search ±12 cells for the 5×5 mark on the full-res
gray (coarse then quarter-cell, plateau centroid), homography from 4 points → fixed cells must match ≥ 75% →
sample 6400 cell centres (bilinear gray vs local mean, keeping each cell's
margin) → the data cells with margin under 25% of the tile's mean margin
(≤ 64, least sure first) go to PS.readTile as erasures → RS per codeword
(all erasures, then half, then none) → CRC decides. Works at any rotation.
Needs ≥ ~2.5 px per cell; 3+ is comfortable. RS turns tiles that were
marginal (soft focus, ink drops, scuffs) from rejected into repaired.

## Lessons already learned (do not relearn)
- Sparse LT / robust-soliton repair tiles FAIL on coverage when only a few
  repair tiles survive alongside most systematic tiles. Dense repair rows fix it.
- xorshift is linear over GF(2). Dense rows generated from it span ≤ 32
  dimensions and elimination fails. Use a PRNG with multiplication (mulberry32).
- Gaussian elimination must operate on copies of equation data. A failed pass
  that mutates pending equations corrupts later peeling (produced wrong output
  silently once).
- Finders need a white separator. With data cells touching the outer ring,
  the 1:1:3:1:1 search lost about half the finders (a black data cell merges
  with the ring on the row or on the cross-check column). Hence the 8×8 blocks.
- Row-scan finder candidates from random data are common (~2 per tile) with
  the m/2 ratio tolerance. A diagonal cross-check removes almost all of them.
- Under strong keystone the alignment mark sits up to ~10 cells from the
  affine prediction and the two legs differ by 20%. Search wide; CRC is cheap.
- `hidden` on a section with a `display:flex` class rule does nothing without
  `[hidden] { display: none !important }`.
- RS erasures: capping at 16 per word wasted half the capacity when the
  scanner's unsure list was right; trusting the whole list and falling back
  (all → half → none) is strictly better because a failed attempt is cheap.
- A random spread of N flipped cells is NOT a capacity test: 40 cells over 4
  words sometimes puts 17 in one word. Test capacity per codeword exactly.
- First live phone test (1080p stream): blurry, nothing decoded. At 1080p a
  tile needs the phone ~10 cm from the page, inside the lens's minimum focus
  distance. Ask for the highest camera resolution so the phone can sit 20–30
  cm away. Video frames are also softer than their pixel count suggests.
- Half-resolution detection is only safe for cells ≥ ~4 px, and the 5×5
  alignment mark must be searched on the full-res gray; its one-cell rings
  vanish in a half-res binarization (lost 2 of 9 tiles at 45° before that fix).

## Testing rules
- `node test/codec-stress.test.mjs`: randomized codec stress (loss, shuffle,
  exact K+3 / K+10 surplus, RS repair exactly at capacity and rejection just
  beyond it, erasures). Run after ANY codec change. Zero wrong outputs is the
  bar; rank-failure at K+3 should be ~10%, at K+10 ~0.1%.
- `node test/vision-synthetic.test.mjs`: renders tiles through perspective,
  rotation, blur, shading, noise, low contrast, cropping, soft focus and ink
  blots, runs PSV, prints bytes repaired per scene, and rebuilds a file from
  a multi-frame sweep. Run after ANY vision change. DEBUG=1 prints why each
  visible tile missed; SEED=n changes the data and poses.
- `NODE_PATH=$(npm root -g) node test/browser.test.mjs`: Playwright + Chromium.
  Encodes the sample, runs both verifiers, then pushes a rotated blurred
  rasterized "photo" through the Decode tab's file input. Set SHOTS=dir for screenshots.
- Camera decoding must ALSO be tested against real phone photos/videos in
  `fixtures/`, not just synthetic renders. None exist yet: the synthetic
  tests cover geometry and thresholding, not printer dot gain, sensor noise,
  rolling shutter, motion blur or autofocus hunting.

## Roadmap
1. Real fixtures: print a page, photograph and film it with a phone, and use
   the Decode tab's "Save this frame" button to capture what the scanner
   actually sees; put the files in `fixtures/` and make them pass. Expect to tune threshold radius,
   bias, the 75% pattern gate and blur handling. Possibly use a higher
   resolution still capture instead of the video stream on phones.
2. Density tuning against real prints (0.0075 → 0.005 in). With RS in place,
   the 'bytes repaired' readout on the Decode tab shows how much margin a
   print has left at a given density.
3. Print the decoder's own source on the last pages (self-decoding backup).
4. Write the format spec as a standalone document.
5. Performance: live frames are processed on the main thread (~60–100 ms at
   1080p). A Worker built from an inline Blob would keep the UI smooth.
