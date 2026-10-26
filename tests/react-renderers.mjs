import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({
  root,
  cacheDir: 'node_modules/.vite-renderers-test',
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    watch: { ignored: ['**/target/**', '**/src-tauri/**', '**/artifacts/**'] },
  },
});
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  reducedMotion: 'no-preference',
});
page.setDefaultTimeout(15000);
const errors = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
const diagramViewport = () =>
  page.locator('#diagram').evaluate((host) => ({
    width: host.clientWidth,
    height: host.clientHeight,
    world: host.scrollWidth,
    backingWidth: host.querySelector('canvas').width,
    backingHeight: host.querySelector('canvas').height,
  }));
const waitForViewport = () =>
  page.waitForFunction(
    () => {
      const host = document.getElementById('diagram'),
        canvas = host?.querySelector('canvas');
      return canvas && canvas.width === host.clientWidth && canvas.height === host.clientHeight;
    },
    undefined,
    { polling: 20 },
  );
try {
  await page.addInitScript(() => {
    window.__rendererActivity = { raf: 0 };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (callback) {
      window.__rendererActivity.raf++;
      return raf.call(this, callback);
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/tests/rendering/index.html`);
  await page.waitForFunction(() => !!window.rendererFixture, undefined, { polling: 20 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.rendererFixture.tick(80, 0.05));
  assert.equal(await page.locator('#diagram').getAttribute('data-building'), 'false');
  assert.equal(await page.locator('.diagram-node').count(), 2);
  assert.equal(await page.locator('.diagram-edge-label').count(), 4);
  assert.equal(await page.evaluate(() => window.rendererFixture.subscribers()), 1);
  assert.ok(
    await page.locator('.diagram-ink').evaluate((canvas) =>
      canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value > 0),
    ),
  );
  assert.deepEqual(
    await page.evaluate(() => [
      window.rendererFixture.building().includes(true),
      window.rendererFixture.building().at(-1),
    ]),
    [true, false],
  );
  checks.push(
    'StrictMode retains one diagram subscription; real Canvas ink, React nodes, labels and construction callbacks render',
  );

  await page.locator('.diagram-node[data-state=S1]').click();
  assert.deepEqual(await page.evaluate(() => window.rendererFixture.inspections()), ['S1']);
  await page.evaluate(() => window.rendererFixture.setCursor(1));
  assert.equal(await page.locator('.diagram-node.is-active').getAttribute('data-state'), 'S1');
  assert.equal(await page.locator('.diagram-node.is-active').getAttribute('aria-current'), 'true');
  checks.push('The onInspect callback, active cursor state and aria-current remain available');

  const ink = await page.locator('.diagram-ink').evaluate((canvas) => canvas.toDataURL());
  await page.evaluate(() => {
    window.rendererFixture.setCallbackVersion(1);
    window.rendererFixture.setCursor(0);
    window.rendererFixture.replay();
  });
  assert.equal(await page.locator('#diagram').getAttribute('data-building'), 'true');
  assert.deepEqual(await page.evaluate(() => window.rendererFixture.buildingCallbacks().at(-1)), {
    version: 1,
    building: true,
  });
  await page.evaluate(() => window.rendererFixture.tick(61, 0.05));
  assert.equal(await page.locator('#diagram').getAttribute('data-building'), 'false');
  assert.deepEqual(await page.evaluate(() => window.rendererFixture.buildingCallbacks().at(-1)), {
    version: 1,
    building: false,
  });
  assert.equal(await page.locator('.diagram-ink').evaluate((canvas) => canvas.toDataURL()), ink);
  checks.push(
    'Small replay finishes within three seconds with unchanged geometry and the latest construction callback',
  );

  await page.evaluate(() => {
    window.rendererFixture.setMachine(2, 'mealy');
    window.rendererFixture.tick(61, 0.05);
    window.rendererFixture.setTravel(0.2);
  });
  assert.equal(await page.locator('.diagram-node.is-reading').getAttribute('data-state'), 'S0');
  await page.evaluate(() => window.rendererFixture.setTravel(0.6));
  assert.ok(
    await page.locator('.diagram-glyph').evaluate((canvas) =>
      canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 === 3 && value > 0),
    ),
  );
  await page.evaluate(() => window.rendererFixture.setTravel(0.8));
  assert.equal(await page.locator('.diagram-node.is-arriving').getAttribute('data-state'), 'S1');
  await page.evaluate(() => window.rendererFixture.setCursor(1));
  assert.equal(await page.locator('.diagram-node.is-reading').count(), 0);
  checks.push(
    'Switching output kinds retains read/travel/arrival states and the Canvas output glyph',
  );

  await page.evaluate(() => {
    window.rendererFixture.setReduced(true);
    window.rendererFixture.replay();
  });
  assert.equal(await page.locator('#diagram').getAttribute('data-building'), 'false');
  await page.evaluate(() => window.rendererFixture.tick(60));
  const still = await page.locator('.diagram-ink').getAttribute('data-draws');
  await page.evaluate(() => window.rendererFixture.tick(120));
  assert.equal(await page.locator('.diagram-ink').getAttribute('data-draws'), still);
  await page.evaluate(() => window.rendererFixture.setReduced(false));
  checks.push(
    'Reduced motion forms immediately and the settled diagram performs no idle Canvas draws',
  );

  await page.evaluate(() => window.rendererFixture.setMachine(256));
  await waitForViewport();
  assert.equal(await page.locator('#diagram').getAttribute('data-building'), 'false');
  assert.equal(await page.locator('.diagram-node').count(), 256);
  const viewport = await diagramViewport();
  assert.ok(viewport.world > viewport.width * 10);
  assert.equal(viewport.backingWidth, viewport.width);
  assert.equal(viewport.backingHeight, viewport.height);
  await page.locator('#diagram').evaluate((host) => {
    host.scrollLeft = host.scrollWidth;
  });
  await page.locator('.diagram-node').last().click();
  assert.equal((await page.evaluate(() => window.rendererFixture.inspections())).at(-1), 'S255');
  checks.push(
    '256 React state buttons remain inspectable while scrolling; Canvas storage stays viewport-sized',
  );

  await page.evaluate(() => {
    window.rendererFixture.setMachine(2);
    window.rendererFixture.tick(61, 0.05);
  });
  const lightInk = await page.locator('.diagram-ink').evaluate((canvas) => canvas.toDataURL());
  await page.evaluate(() => window.rendererFixture.setTheme('dark'));
  const darkInk = await page.locator('.diagram-ink').evaluate((canvas) => canvas.toDataURL());
  assert.notEqual(darkInk, lightInk, 'Theme changes repaint the existing Canvas ink');
  await page.evaluate(() => window.rendererFixture.setTheme('light'));
  assert.equal(
    await page.locator('.diagram-ink').evaluate((canvas) => canvas.toDataURL()),
    lightInk,
  );
  assert.equal(await page.evaluate(() => window.rendererFixture.subscribers()), 1);
  await page.evaluate(() => window.rendererFixture.setQuality('high'));
  assert.equal(
    await page.locator('.diagram-ink').evaluate((canvas) => canvas.width),
    Math.round((await diagramViewport()).width * 1.5),
  );
  await page.evaluate(() => window.rendererFixture.setQuality('medium'));
  await waitForViewport();
  checks.push(
    'Light/dark themes repaint reversibly without remounting; quality changes bound Canvas resolution',
  );

  await page.setViewportSize({ width: 3440, height: 1440 });
  await waitForViewport();
  await page.evaluate(() => {
    window.rendererFixture.setTheme('dark');
    window.rendererFixture.tick();
  });
  const ultrawide = await diagramViewport();
  assert.equal(ultrawide.backingWidth, ultrawide.width);
  assert.equal(ultrawide.backingHeight, ultrawide.height);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'artifacts/react-renderers.png') });
  await page.setViewportSize({ width: 360, height: 844 });
  await waitForViewport();
  await page.evaluate(() => window.rendererFixture.tick());
  const mobile = await diagramViewport();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(mobile.backingWidth, mobile.width);
  assert.equal(mobile.backingHeight, mobile.height);
  checks.push('Ultrawide and mobile resize preserve viewport Canvas bounds without page overflow');

  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      window.__rendererCanvases = [...document.querySelectorAll('.diagram-ink,.diagram-glyph')];
      window.rendererFixture.unmount();
    });
    assert.equal(await page.evaluate(() => window.rendererFixture.subscribers()), 0);
    assert.equal(await page.locator('#diagram,.diagram-glyph').count(), 0);
    assert.deepEqual(
      await page.evaluate(() =>
        window.__rendererCanvases.map((canvas) => [canvas.width, canvas.height]),
      ),
      [
        [1, 1],
        [1, 1],
      ],
    );
    const callbacks = await page.evaluate(() => window.rendererFixture.buildingCallbacks().length);
    await page.evaluate(() => {
      window.rendererFixture.tick(120);
      window.dispatchEvent(new Event('resize'));
    });
    assert.equal(
      await page.evaluate(() => window.rendererFixture.buildingCallbacks().length),
      callbacks,
    );
    await page.evaluate(() => window.rendererFixture.mount());
    assert.equal(await page.evaluate(() => window.rendererFixture.subscribers()), 1);
  }
  await page.evaluate(() => window.rendererFixture.unmount());
  assert.equal(await page.evaluate(() => window.__rendererActivity.raf), 0);
  assert.deepEqual(errors, []);
  checks.push(
    'Ten StrictMode remounts release Canvas storage, portals and subscriptions; disposed renderers stay inert and request no private animation frame',
  );
  const report = { checks, errors, viewport, ultrawide, mobile };
  await writeFile(
    resolve(root, 'artifacts/react-renderers-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      await page.evaluate(() => ({
        activity: window.__rendererActivity,
        fonts: document.fonts.status,
        subscribers: window.rendererFixture?.subscribers(),
        building: window.rendererFixture?.building(),
        diagram: document.getElementById('diagram') && {
          width: document.getElementById('diagram').clientWidth,
          height: document.getElementById('diagram').clientHeight,
          dataset: { ...document.getElementById('diagram').dataset },
          classes: [...document.querySelectorAll('.diagram-node')].map((node) => node.className),
        },
      })),
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
