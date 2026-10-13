import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const artifacts = resolve(import.meta.dirname, '../artifacts');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/'); await page.locator('#app[data-ready=true]').waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(artifacts, 'depth-light.png') });
  await page.locator('#theme-toggle').click(); await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(artifacts, 'depth-dark.png') });
  await page.locator('[data-route=editor]').click(); await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(artifacts, 'depth-editor.png') });
  const state = await page.evaluate(() => ({ renderer: document.querySelector('.depth-scene').dataset.renderer, pixels: document.querySelector('#depth-canvas').width * document.querySelector('#depth-canvas').height, glass: getComputedStyle(document.querySelector('#sheet')).backgroundColor, blur: getComputedStyle(document.querySelector('#sheet')).backdropFilter, errors: document.querySelector('#metric-errors').textContent }));
  await writeFile(resolve(artifacts, 'depth-preview.json'), JSON.stringify({ ...state, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ ...state, pageErrors: errors }));
} finally { await browser.close(); }
