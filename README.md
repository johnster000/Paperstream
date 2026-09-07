# Paperstream

Back up a file to paper. Print it as pages of dense tiles, get it back by
sweeping your phone over the pages. One HTML file, fully offline.

Status: prototype encoder and decoder in one file. Open `paperstream.html`
in a browser.

- Encode tab: pick a file (or use the built-in sample), Encode, Print.
  "Verify roundtrip" samples the rendered pages on a grid and rebuilds the
  file; "Verify with scanner" runs the camera pipeline over them instead.
- Decode tab: Start camera and sweep over the printed pages in any order,
  or choose photos / a video of the pages. Green outlines are tiles that
  decoded, red ones failed their checksum (move closer or hold steadier).
  Each tile carries Reed-Solomon parity, so smudges, scuffs and soft focus
  are repaired rather than fatal; the readout shows how many bytes were fixed.
  The bar fills as blocks are recovered; when it completes you can save the file.

The scanner has so far only been tested against synthetic renders and
rasterized pages, not real prints. See `CLAUDE.md` for the format, the
pipeline and the roadmap.

Tests:

    node test/codec-stress.test.mjs
    node test/vision-synthetic.test.mjs
    NODE_PATH=$(npm root -g) node test/browser.test.mjs   # needs playwright + chromium
