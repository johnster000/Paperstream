# Paperstream

Back up a file to paper. Print it as pages of dense tiles, get it back by
sweeping your phone over the pages. One HTML file, fully offline.

Status: prototype encoder + digital round-trip verifier. Open
`paperstream.html` in a browser, pick a file (or use the built-in sample),
Encode, Print. Verify rasterizes the pages and rebuilds the file from pixels.
Camera decoding is next; see `CLAUDE.md` for the format and roadmap.

Tests: `node test/codec-stress.test.mjs`
