import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..'),
  output = await mkdtemp(resolve(tmpdir(), 'patchbay-react-editor-'));
if (!output.startsWith(resolve(tmpdir(), 'patchbay-react-editor-')))
  throw new Error('Unexpected test output path');
await build({
  root,
  configFile: false,
  logLevel: 'error',
  base: '/',
  build: {
    outDir: output,
    emptyOutDir: false,
    rollupOptions: { input: resolve(root, 'tests/frontend/graph-editor-harness.html') },
  },
});
const server = createServer(async (request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(
    output,
    `.${requested === '/' ? '/tests/frontend/graph-editor-harness.html' : requested}`,
  );
  if (!file.startsWith(output + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    response.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ||
        'application/octet-stream',
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 850 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.graphDraws = 0;
  window.graphObservers = { resize: 0, mutation: 0 };
  for (const [name, key] of [
    ['ResizeObserver', 'resize'],
    ['MutationObserver', 'mutation'],
  ]) {
    const Original = window[name];
    window[name] = class extends Original {
      active = true;
      external = false;
      constructor(callback) {
        super(callback);
        window.graphObservers[key]++;
      }
      observe(target, options) {
        // Playwright retains its own document-level removal observer. The
        // editor observes element ancestors, so count only its owned resources.
        if (
          name === 'MutationObserver' &&
          target.nodeType === Node.DOCUMENT_NODE &&
          !this.external
        ) {
          this.external = true;
          window.graphObservers[key]--;
        }
        super.observe(target, options);
      }
      disconnect() {
        if (this.active) {
          this.active = false;
          if (!this.external) window.graphObservers[key]--;
        }
        super.disconnect();
      }
    };
  }
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.id === 'graph-ink') window.graphDraws++;
    return clear.apply(this, args);
  };
});
const snapshot = () => page.evaluate(() => window.graphHarness.snapshot());
const state = (id) => page.locator(`.graph-node[data-state-id="${id}"]`);
const center = async (target) => {
  const box = await target.boundingBox();
  assert.ok(box);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
};
const drag = async (target, dx, dy, cancel) => {
  const start = await center(target);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  if (cancel) await cancel();
  await page.mouse.up();
};
// The stage opens fitted and centred on the machine, and nothing it draws is clipped:
// every state, every "+" handle and the "start" label lie inside the scroller's visible
// client area, and the states' union is centred within 24px (DESIGN.md, Layout: Editor).
const fitReport = (target) =>
  target.evaluate(() => {
    const scroll = document.querySelector('#graph-scroll'),
      box = scroll.getBoundingClientRect();
    const view = {
      left: box.left,
      top: box.top,
      right: box.left + scroll.clientWidth,
      bottom: box.top + scroll.clientHeight,
    };
    const nodes = [...document.querySelectorAll('.graph-node')].map((node) =>
      node.getBoundingClientRect(),
    );
    const union = nodes.reduce(
      (all, rect) => ({
        left: Math.min(all.left, rect.left),
        top: Math.min(all.top, rect.top),
        right: Math.max(all.right, rect.right),
        bottom: Math.max(all.bottom, rect.bottom),
      }),
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const clipped = [
      ...document.querySelectorAll(
        '.graph-node, .graph-connect-handle, .graph-node.is-start .graph-node-start',
      ),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left < view.left - 0.5 ||
          rect.top < view.top - 0.5 ||
          rect.right > view.right + 0.5 ||
          rect.bottom > view.bottom + 0.5
        );
      })
      .map(
        (element) =>
          `${element.className} ${element.dataset.stateId ?? element.parentElement?.dataset.stateId}`,
      );
    return {
      nodes: nodes.length,
      dx: (union.left + union.right) / 2 - (view.left + view.right) / 2,
      dy: (union.top + union.bottom) / 2 - (view.top + view.bottom) / 2,
      clipped,
    };
  });
const assertFitted = async (target, label) => {
  const report = await fitReport(target);
  assert.ok(report.nodes > 0, label + ': the fixture has states');
  assert.ok(
    Math.hypot(report.dx, report.dy) <= 24,
    `${label}: the machine opens centred on the stage (${report.dx.toFixed(1)}, ${report.dy.toFixed(1)})`,
  );
  assert.deepEqual(report.clipped, [], label + ': no state, handle or start label is clipped');
};
// The automatic choice fits its select: text + padding <= clientWidth, and the row never
// overflows its card.
const selectReport = (target) =>
  target.evaluate(() => {
    const select = document.querySelector('#graph-draw-input'),
      style = getComputedStyle(select),
      context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // Inter is set with -0.009em tracking; measure the text exactly as the select draws it.
    context.letterSpacing = style.letterSpacing;
    const text = select.options[select.selectedIndex].text,
      row = document.querySelector('.graph-drawing-defaults');
    return {
      text,
      needed:
        context.measureText(text).width +
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight),
      width: select.clientWidth,
      rowOverflow: row.scrollWidth - row.clientWidth,
    };
  });
const inkHash = async () =>
  createHash('sha256')
    .update(await page.locator('#graph-ink').evaluate((canvas) => canvas.toDataURL()))
    .digest('hex');
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#graph-ink').waitFor();
  await page.waitForTimeout(60);
  await assertFitted(page, '1440x850 on open');
  await page.locator('#graph-fit').click();
  await page.waitForTimeout(120);
  assert.equal(
    (await snapshot()).subscribers,
    1,
    'Strict Mode keeps one canvas clock subscription',
  );
  assert.deepEqual(await page.evaluate(() => window.graphObservers), { resize: 1, mutation: 1 });
  assert.equal(
    await page.locator('.graph-connect-handle').count(),
    2,
    'Every state has a direct drawing handle in the default Select tool',
  );
  const handleSize = await page.locator('.graph-connect-handle').first().boundingBox();
  assert.ok(
    handleSize.width >= 24 && handleSize.height >= 24,
    'Drawing handles remain usable hit targets',
  );
  assert.equal(
    await page.locator('button button').count(),
    0,
    'State controls are sibling buttons',
  );
  const zoom = await state('s0').evaluate((node) => parseFloat(node.style.width) / 68);
  await drag(state('s0'), 10, 0);
  await page.waitForTimeout(60);
  let data = await snapshot();
  assert.equal(data.edits.length, 1);
  assert.equal(data.edits[0].type, 'moveState');
  assert.ok(Math.abs(data.result.draft.states[0].x - 10 / zoom) < 0.0001);
  assert.equal(data.result.draft.states[0].y, 35);
  let committed = structuredClone(data.result.draft);
  const beforeCancel = await inkHash();
  await drag(state('s0'), 35, -25, () =>
    page.locator('#graph-scroll').dispatchEvent('pointercancel'),
  );
  await page.waitForTimeout(60);
  assert.equal((await snapshot()).edits.length, 1);
  assert.deepEqual((await snapshot()).result.draft, committed);
  assert.equal(await inkHash(), beforeCancel, 'Cancelled drag restores the exact canvas geometry');
  await drag(state('s0'), 40, 15, () => page.keyboard.press('Escape'));
  assert.equal((await snapshot()).edits.length, 1, 'Escape creates no history edit');
  const handle = (id) => page.locator(`.graph-connect-handle[data-state-id="${id}"]`);
  const from = await center(handle('s0')),
    to = await center(state('s1'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.graphHarness.snapshot().edits.length === 2);
  assert.deepEqual((await snapshot()).edits.at(-1), {
    type: 'upsertTransition',
    from: 's0',
    to: 's1',
    input: 'a',
    output: '0',
  });
  assert.deepEqual(
    (await snapshot()).result.draft.states,
    committed.states,
    'Drawing from a handle does not move its state',
  );
  assert.equal(await page.locator('#graph-input').count(), 0, 'Drawing needs no form submission');
  await handle('s0').focus();
  await page.keyboard.press('Enter');
  await state('s0').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(
    (await snapshot()).edits.at(-1),
    {
      type: 'upsertTransition',
      from: 's0',
      to: 's0',
      input: 'λ',
      output: '0',
    },
    'Keyboard drawing uses the next unused input and supports self-loops',
  );
  // The "start" label sits under the start arrow's tail, left of the node, clear of the
  // first self-loop (drawn above the node) and of every visible transition label.
  const startLabel = await page.evaluate(() => {
    const node = document.querySelector('.graph-node.is-start'),
      label = node.querySelector('.graph-node-start').getBoundingClientRect(),
      own = node.getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('.graph-edge-label')]
      .filter((edge) => getComputedStyle(edge).visibility === 'visible')
      .map((edge) => edge.getBoundingClientRect())
      .filter(
        (edge) =>
          edge.left < label.right &&
          label.left < edge.right &&
          edge.top < label.bottom &&
          label.top < edge.bottom,
      ).length;
    return {
      overlaps,
      leftOfNode: label.right <= own.left,
      belowCentre: label.top >= own.top + own.height / 2 - 1,
    };
  });
  assert.deepEqual(
    startLabel,
    { overlaps: 0, leftOfNode: true, belowCentre: true },
    'The start label sits under the arrow tail, clear of the self-loop and its label',
  );
  const beforeUsed = (await snapshot()).edits.length;
  await page.locator('#graph-draw-input').selectOption('a');
  await handle('s0').click();
  await state('s0').click();
  assert.equal(
    (await snapshot()).edits.length,
    beforeUsed,
    'A used state/input is never overwritten',
  );
  assert.equal(await page.locator('#graph-to').inputValue(), 's1');
  assert.match(await page.locator('#graph-status').innerText(), /already has/);
  await page.locator('#graph-draw-input').selectOption('');
  await handle('s0').click();
  await state('s1').click();
  assert.equal(await page.locator('#graph-from').inputValue(), 's0');
  assert.equal(await page.locator('#graph-to').inputValue(), 's1');
  assert.equal(
    await page.locator('#graph-input').inputValue(),
    '',
    'A full source asks for a new symbol',
  );
  await page.locator('#graph-input').fill('🙂');
  await page.locator('#graph-output').fill('word');
  await page.locator('#graph-save-transition').click();
  assert.deepEqual((await snapshot()).edits.at(-1), {
    type: 'upsertTransition',
    from: 's0',
    to: 's1',
    input: '🙂',
    output: 'word',
  });
  assert.equal(
    await page.locator('#graph-draw-output').inputValue(),
    'word',
    'Inspector output is remembered for drawing',
  );
  await page.locator('#graph-alphabet').fill('["🙂","coin"]');
  await page.locator('#graph-apply-alphabet').click();
  assert.deepEqual(
    (await snapshot()).edits.at(-1),
    { type: 'setAlphabetText', text: '["🙂","coin"]' },
    'Alphabet text reaches Rust unchanged',
  );
  const beforeDrawCancel = (await snapshot()).edits.length;
  await drag(handle('s1'), 35, -25, () => page.keyboard.press('Escape'));
  assert.equal((await snapshot()).edits.length, beforeDrawCancel, 'Escape cancels handle drawing');
  await drag(handle('s1'), 35, -25, () =>
    page.locator('#graph-scroll').dispatchEvent('pointercancel'),
  );
  assert.equal(
    (await snapshot()).edits.length,
    beforeDrawCancel,
    'Pointer cancellation adds no arrow',
  );
  await page.locator('#graph-connect').click();
  await drag(state('s1'), 7, 3);
  assert.deepEqual(
    (await snapshot()).edits.at(-1),
    {
      type: 'upsertTransition',
      from: 's1',
      to: 's1',
      input: 'a',
      output: 'word',
    },
    'The Connect tool shares direct drawing defaults',
  );
  await page.locator('#graph-connect').click();
  await state('s0').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.is-connect-source').count(), 0);
  await state('s1').click();
  assert.equal(
    await page.locator('#graph-transition-panel').count(),
    0,
    'A cancelled connection starts with a fresh source',
  );
  await page.locator('#graph-select').click();
  committed = structuredClone((await snapshot()).result.draft);
  await state('s0').click();
  await page.locator('#graph-state-name').focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Delete');
  assert.equal((await snapshot()).calls.undo || 0, 0, 'Inputs retain typing undo');
  await state('s0').focus();
  await page.keyboard.press('Control+z');
  assert.equal((await snapshot()).calls.undo, 1);
  await page.evaluate(() => window.graphHarness.hide(true));
  await page.locator('#graph-editor').waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Delete');
  assert.equal((await snapshot()).calls.undo, 1, 'Hidden editor does not consume Bench keys');
  await page.evaluate(() => window.graphHarness.hide(false));
  await page.locator('#graph-editor').waitFor({ state: 'visible' });
  await page.evaluate(() => window.graphHarness.rejectNext());
  const count = (await snapshot()).edits.length;
  await drag(state('s0'), 20, 0);
  await page.waitForTimeout(60);
  assert.equal((await snapshot()).edits.length, count + 1);
  assert.deepEqual(
    (await snapshot()).result.draft,
    committed,
    'Rejected Rust edits restore the parent draft',
  );
  assert.match(await page.locator('#graph-errors').innerText(), /Rust rejected/);
  await page.evaluate(() => window.graphHarness.holdNext());
  await drag(state('s0'), 15, 0);
  assert.equal(
    await page.locator('#graph-save').isDisabled(),
    true,
    'Semantic controls await the parent command',
  );
  assert.deepEqual(
    (await snapshot()).result.draft,
    committed,
    'Drag preview stays local until the parent responds',
  );
  const previewX = await state('s0').evaluate((node) => parseFloat(node.style.left));
  await page.evaluate(() => window.graphHarness.release());
  await page.locator('#graph-save').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#graph-save').disabled);
  assert.ok((await snapshot()).result.draft.states[0].x > committed.states[0].x);
  assert.ok(Number.isFinite(previewX));
  await page.locator('#graph-open').click();
  await page.locator('#graph-save').click();
  await page.locator('#graph-text').click();
  await page.locator('#graph-run').click();
  const callbacks = (await snapshot()).calls;
  for (const action of ['open', 'save', 'text', 'run']) assert.equal(callbacks[action], 1);
  await page.waitForTimeout(180);
  const idleDraws = await page.evaluate(() => window.graphDraws),
    idleHash = await inkHash();
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => window.graphDraws),
    idleDraws,
    'Shared clock does not redraw settled ink',
  );
  assert.equal(await inkHash(), idleHash);
  await page.evaluate(() => window.graphHarness.show(false));
  await page.locator('#graph-editor').waitFor({ state: 'detached' });
  assert.equal((await snapshot()).subscribers, 0, 'Unmount removes the canvas subscriber');
  assert.deepEqual(
    await page.evaluate(() => window.graphObservers),
    { resize: 0, mutation: 0 },
    'Unmount disconnects every editor observer',
  );
  await page.keyboard.press('Control+z');
  assert.equal((await snapshot()).calls.undo, 1, 'Unmount removes graph keyboard listeners');
  await page.evaluate(() => window.graphHarness.show(true));
  await page.locator('#graph-ink').waitFor();
  assert.equal((await snapshot()).subscribers, 1, 'Remount creates exactly one canvas subscriber');
  assert.deepEqual(await page.evaluate(() => window.graphObservers), { resize: 1, mutation: 1 });
  await page.evaluate(() =>
    window.graphHarness.load({
      kind: 'moore',
      states: [
        { id: 's0', name: 'First', output: '0', x: 0, y: 35 },
        { id: 's1', name: 'Next', output: '1', x: 250, y: 180 },
      ],
      transitions: [],
      alphabet: [],
      start: 's0',
      nextId: 2,
    }),
  );
  await page.locator('#graph-fit').click();
  assert.equal(
    await page.locator('#graph-draw-output').isVisible(),
    false,
    'Moore drawing has no edge output field',
  );
  const beforeEmptyDrop = (await snapshot()).edits.length;
  await drag(handle('s0'), 75, 50);
  assert.equal(
    (await snapshot()).edits.length,
    beforeEmptyDrop,
    'Dropping on space does not create partial edits',
  );
  assert.equal(
    await page.locator('.graph-node.is-connect-source').count(),
    1,
    'An unfinished arrow can continue to a target',
  );
  await page.keyboard.press('Escape');
  await handle('s0').click();
  await state('s1').click();
  assert.deepEqual(
    (await snapshot()).edits.at(-1),
    {
      type: 'upsertTransition',
      from: 's0',
      to: 's1',
      input: '0',
      output: '0',
    },
    'An empty alphabet starts with the visible automatic default',
  );
  const mooreDraft = structuredClone((await snapshot()).result.draft);
  await page.evaluate(() => window.graphHarness.rejectNext());
  await handle('s1').click();
  await state('s0').click();
  assert.deepEqual(
    (await snapshot()).result.draft,
    mooreDraft,
    'A rejected direct arrow never changes the parent draft',
  );
  assert.match(await page.locator('#graph-errors').innerText(), /Rust rejected/);
  await page.evaluate(() => window.graphHarness.holdNext());
  await handle('s1').click();
  await state('s0').click();
  const pendingArrowCount = (await snapshot()).edits.length;
  assert.equal(await handle('s0').isDisabled(), true, 'Handles wait for the authoritative command');
  assert.equal(await page.locator('#graph-draw-input').isDisabled(), true);
  await state('s0').dispatchEvent('click');
  assert.equal(
    (await snapshot()).edits.length,
    pendingArrowCount,
    'A pending arrow creates only one command',
  );
  await page.evaluate(() => window.graphHarness.release());
  await page.waitForFunction(() => !document.querySelector('#graph-save').disabled);
  await page.evaluate(() =>
    window.graphHarness.load({
      kind: 'mealy',
      states: Array.from({ length: 256 }, (_, i) => ({
        id: `s${i}`,
        name: `S${i}`,
        output: 'inactive',
        x: 100 + (i % 16) * 150,
        y: 100 + Math.floor(i / 16) * 150,
      })),
      transitions: Array.from({ length: 256 }, (_, i) =>
        ['a', 'λ', '🟢'].map((input, j) => ({
          id: `t${i * 3 + j}`,
          from: `s${i}`,
          to: `s${i}`,
          input,
          output: 'β',
        })),
      ).flat(),
      alphabet: ['a', 'λ', '🟢'],
      start: 's0',
      nextId: 1024,
    }),
  );
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 256);
  assert.equal(
    await page.locator('.graph-edge-label').count(),
    768,
    'All transition buttons remain React-owned',
  );
  for (let i = 0; i < 6; i++) await page.locator('#graph-zoom-in').click();
  await page.locator('#graph-scroll').evaluate((node) => {
    node.scrollLeft = 750;
    node.scrollTop = 550;
  });
  await page.waitForTimeout(50);
  assert.ok(
    await page
      .locator('#graph-scroll')
      .evaluate((node) => node.scrollLeft > 0 && node.scrollTop > 0),
  );
  await page.locator('#graph-fit').click();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const dimensions = await page.locator('#graph-ink').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    viewportWidth: document.querySelector('#graph-scroll').clientWidth,
    viewportHeight: document.querySelector('#graph-scroll').clientHeight,
  }));
  assert.ok(
    dimensions.width <= dimensions.viewportWidth * 2 + 2 &&
      dimensions.height <= dimensions.viewportHeight * 2 + 2,
  );
  assert.deepEqual(errors, []);

  // A fresh editor at the sizes the defects were seen at: fitted on open and nothing clipped,
  // and the drawing-defaults select never truncates its automatic choice.
  const fresh = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const freshErrors = [];
  fresh.on('pageerror', (error) => freshErrors.push(error.message));
  // The harness loads no tokens, so it would measure a fallback face. Serve the app's own
  // Inter Variable and set --display, so the select is measured in the face it ships with.
  const inter = await readFile(resolve(root, 'src/fonts/inter-latin-wght-normal.woff2'));
  await fresh.route('**/__fonts/inter.woff2', (route) =>
    route.fulfill({ body: inter, contentType: 'font/woff2' }),
  );
  const withAppFace = async () => {
    await fresh.addStyleTag({
      content:
        "@font-face{font-family:'Inter Variable';font-weight:100 900;src:url('/__fonts/inter.woff2') format('woff2')}" +
        ":root{--display:'Inter Variable',sans-serif}",
    });
    await fresh.evaluate(() => document.fonts.load("500 15px 'Inter Variable'"));
    assert.ok(
      await fresh.evaluate(() => document.fonts.check("500 15px 'Inter Variable'")),
      'Inter Variable is loaded for the select measurement',
    );
  };
  const selects = {};
  try {
    await fresh.goto(`http://127.0.0.1:${server.address().port}`);
    await fresh.locator('#graph-ink').waitFor();
    await withAppFace();
    await fresh.waitForTimeout(60);
    await assertFitted(fresh, '1440x900 on open');
    for (const [width, height] of [
      [1440, 900],
      [960, 900],
      [390, 844],
      [360, 800],
    ]) {
      await fresh.setViewportSize({ width, height });
      await fresh.waitForTimeout(60);
      const report = await selectReport(fresh);
      selects[width] = report;
      assert.equal(report.text, 'Auto · next unused');
      assert.ok(
        report.needed <= report.width + 1,
        `${width}px: the select shows "${report.text}" in full (${report.needed.toFixed(1)} > ${report.width})`,
      );
      assert.ok(report.rowOverflow <= 0, `${width}px: the New arrows row does not overflow`);
    }
    await fresh.setViewportSize({ width: 390, height: 844 });
    await fresh.reload();
    await fresh.locator('#graph-ink').waitFor();
    await withAppFace();
    await fresh.waitForTimeout(60);
    await assertFitted(fresh, '390x844 on open');
    assert.deepEqual(freshErrors, []);
  } finally {
    await fresh.close();
  }
  console.log(
    JSON.stringify(
      {
        passed:
          'React graph direct drawing/defaults/determinism/cancellation/keyboard/rollback/idle/remount/mobile fixture; fitted on open, unclipped handles and start label, untruncated drawing select',
        edits: (await snapshot()).edits.length,
        dimensions,
        selects,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  // The exact temporary directory above is created and owned by this test.
  await rm(output, { recursive: true, force: true });
}
