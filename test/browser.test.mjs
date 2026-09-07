// Headless browser test: encode -> rasterize -> decode, through the real UI.
// Run: NODE_PATH=$(npm root -g) node test/browser.test.mjs   (needs playwright + chromium)
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(here, '..', 'paperstream.html');
const shots = process.env.SHOTS; // directory for screenshots, optional

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  page error:', e.message); failures++; });
await page.goto(url);

// encode the sample
await page.click('details.alt summary');
await page.click('#use-sample');
await page.click('#encode');
await page.waitForSelector('#verify:not([disabled])', { timeout: 60000 });
const stats = await page.$eval('#stats', el => el.textContent);
console.log('encoded:', stats.replace(/\s+/g, ' ').trim().slice(0, 160));
check((await page.$$('#pages svg')).length >= 1, 'pages rendered');
if (shots) await page.screenshot({ path: path.join(shots, 'encode.png') });

// grid verifier
await page.click('#verify');
await page.waitForFunction(() => /identical|differs|Could not/.test(document.getElementById('log').textContent), null, { timeout: 120000 });
let logText = await page.$eval('#log', el => el.textContent);
check(/Byte-for-byte identical/.test(logText), 'grid verify rebuilt the file: ' + logText.split('\n').pop().slice(0, 120));

// scanner verifier (finders, homography, resampling)
await page.click('#verify-scan');
await page.waitForFunction(() => /identical|differs|Could not/.test(document.getElementById('log').textContent), null, { timeout: 300000 });
logText = await page.$eval('#log', el => el.textContent);
console.log('  scanner log:', logText.replace(/\s+/g, ' ').trim().slice(0, 300));
check(/Byte-for-byte identical/.test(logText), 'scanner verify rebuilt the file');

// decode tab: a "photo" of page 1, rotated and slightly blurred, through the file input
const photo = await page.evaluate(async () => {
  const L = state.layout, P = L.page, ppc = 3, ppi = ppc / L.cell;
  const cw = Math.round(P.w * ppi), ch = Math.round(P.h * ppi);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(state.pages[0]); });
  const cv = document.createElement('canvas'); cv.width = 3600; cv.height = 3600;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#777'; ctx.fillRect(0, 0, cv.width, cv.height);          // desk
  ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(0.15); ctx.scale(0.72, 0.72);
  ctx.filter = 'blur(0.6px) contrast(0.85) brightness(0.95)';
  ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  return Array.from(buf);
});
await page.click('#mode-decode');
check(await page.$eval('#scan', el => !el.hidden), 'decode tab shows the scan view');
await page.setInputFiles('#scan-files', { name: 'page1.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
await page.waitForFunction(() => /Done|Not complete|No tiles/.test(document.getElementById('scan-log').textContent), null, { timeout: 300000 });
const scanLog = await page.$eval('#scan-log', el => el.textContent);
const result = await page.$eval('#result', el => el.hidden ? '' : el.textContent);
console.log('  decode log:', scanLog.replace(/\s+/g, ' ').trim().slice(0, 300));
check(/Done/.test(scanLog) && /sample\.txt/.test(result), 'photo of page 1 rebuilt the file through the Decode tab: ' + result.slice(0, 100));
if (shots) await page.screenshot({ path: path.join(shots, 'decode.png') });

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
