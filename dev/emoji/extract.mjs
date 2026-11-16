// Photos -> the model's numbers, in headless Chromium, with the vendored model.
//
//   NODE_PATH=$(npm root -g) node dev/emoji/extract.mjs manifest.json out.json
//
// manifest.json: [{ "file": "photos/wink1.jpg", "label": "wink", "source": "https://…", "licence": "CC BY 2.0" }, …]
// (file paths are relative to the manifest). out.json gets the same entries with
// raw (52 blendshapes), roll (degrees), matrix (4x4 pose, column-major) and box.
// The photos stay outside the repo; only the numbers are committed (fixtures.json).
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'http://extract.local';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const [manifestPath, outPath] = process.argv.slice(2);
if (!manifestPath || !outPath) {
  console.error('usage: node dev/emoji/extract.mjs manifest.json out.json');
  process.exit(2);
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const base = path.dirname(path.resolve(manifestPath));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
// The page and the photos are served from disk: no web server needed.
await page.route(`${ORIGIN}/**`, async (route) => {
  const url = new URL(route.request().url());
  const file = url.pathname.startsWith('/__photo/')
    ? path.resolve(base, decodeURIComponent(url.pathname.slice(9)))
    : path.join(REPO, decodeURIComponent(url.pathname));
  try {
    await route.fulfill({ body: await readFile(file), contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  } catch (e) {
    await route.fulfill({ status: 404, body: 'not found' });
  }
});
await page.goto(`${ORIGIN}/dev/emoji/extract.html`);
await page.evaluate(() => window.ready);

const out = [];
let missed = 0;
for (const item of manifest) {
  let r = null;
  try {
    r = await page.evaluate(([u, o]) => window.extract(u, o), [`/__photo/${encodeURIComponent(item.file)}`, item.opts || {}]);
  } catch (e) {
    console.error('failed:', item.file, e.message.split('\n')[0]);
  }
  if (!r) { missed++; continue; }
  out.push({ ...item, ...r });
}
await browser.close();
await writeFile(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.length} faces, ${missed} photos without a face -> ${outPath}`);
