import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist');
const server = createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(dist, '.' + (requested === '/' ? '/index.html' : requested));
    if (!file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream'));
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#app[data-ready="true"]').waitFor();
  await page.locator('[data-route="editor"]').click();
  if (await page.locator('#graph-text').isVisible()) await page.locator('#graph-text').click();
  const alphabet = ['a', 'b', 'c', 'λ'], outputs = ['x', 'y', 'z', 'w'];
  const source = ['type mealy', 'start S0', ...Array.from({ length: 256 }, (_, i) =>
    alphabet.map((symbol, index) => `S${i} ${symbol} S${(i + 1) % 256} ${outputs[index]}`).join('\n'))].join('\n');
  await page.locator('#source').fill(source);
  await page.locator('#apply').click();
  assert.equal(await page.locator('#state-count').textContent(), '256');
  await page.locator('[data-route="bench"]').click();
  await page.locator('#diagram[data-building="false"]').waitFor();
  assert.equal(await page.locator('.diagram-node').count(), 256, 'All states must remain visible through diagram scrolling');
  const sizes = await page.locator('#diagram').evaluate(host => {
    const canvas = host.querySelector('canvas');
    return { canvasWidth: canvas.width, canvasHeight: canvas.height, width: host.clientWidth, height: host.clientHeight, world: host.scrollWidth, dpr: Math.min(devicePixelRatio, 1.5) };
  });
  assert.ok(sizes.world > sizes.width * 10, 'Large graph has an independently scrollable world');
  assert.ok(sizes.canvasWidth <= Math.ceil(sizes.width * sizes.dpr) + 2, 'Canvas must remain viewport-sized');
  assert.ok(sizes.canvasHeight <= Math.ceil(sizes.height * sizes.dpr) + 2, 'Canvas height must remain viewport-sized');
  await page.locator('#diagram').evaluate(host => { host.scrollLeft = host.scrollWidth; });
  await page.locator('.diagram-node').last().click();
  assert.match(await page.locator('#toast').textContent(), /State S255/);
  await page.locator('#input').fill('abcλ');
  await page.locator('.load-button').click();
  await page.locator('#progress').evaluate(control => { control.value = control.max; control.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('[data-route="trace"]').click();
  assert.equal(await page.locator('#summary-output').textContent(), 'xyzw');
  assert.deepEqual(errors, []);
  console.log('Scalability passed: 256 states, 1,024 nonbinary transitions, scrollable accessible nodes, viewport canvas and Unicode simulation.');
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
