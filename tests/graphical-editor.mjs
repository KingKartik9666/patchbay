import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Run after a fresh build: node tests/graphical-editor.mjs
// The fixture uses compiled, offline assets and never reaches a remote service.
const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const artifacts = resolve(root, 'artifacts');
const FILE_LIMIT_BYTES = 1024 * 1024;
const BETWEEN_LIMITS_BYTES = 1_020_000;
await mkdir(artifacts, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(dist, `.${requested === '/' ? '/index.html' : requested}`);
    if (!file.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream'));
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
const errors = [], external = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
await page.addInitScript(() => {
  window.graphDraws = 0;
  const clearRect = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.id === 'graph-ink') window.graphDraws++;
    return clearRect.apply(this, args);
  };
});

const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('patchbay:graph:v1')).draft);
const node = name => page.locator('.graph-node').filter({ has: page.locator('.graph-node-name', { hasText: new RegExp(`^${name}$`) }) });
const center = async locator => {
  const rect = await locator.boundingBox();
  assert.ok(rect, 'Target has a visible rectangle');
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};
const inkHash = async () => createHash('sha256').update(await page.locator('#graph-ink').evaluate(canvas => canvas.toDataURL())).digest('hex');
async function settle() { await page.waitForTimeout(100); }
async function enterEditor() { await page.locator('[data-route=editor]').click(); await settle(); }
async function importDraft(value, name = 'drawing.patchbay') {
  await page.locator('#graph-import').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await settle();
}
async function rename(name) {
  await page.locator('#graph-state-name').fill(name);
  await page.locator('#graph-save-state').click();
}

try {
  await page.goto(base);
  await page.locator('#app[data-ready=true]').waitFor();
  await enterEditor();
  await page.locator('#graph-new').click();
  assert.equal(await page.locator('.graph-node').count(), 0);
  await page.locator('#graph-add-state').click();
  await rename('A');
  await page.locator('#graph-add-state').click();
  await rename('B');
  assert.equal(await page.locator('.graph-node').count(), 2);
  const a = await center(node('A')), b = await center(node('B'));
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 60, 'Toolbar additions do not cover each other');
  checks.push('New machine, accessible state controls, two distinct center additions');

  await page.locator('#graph-fit').click();
  await settle();
  const beforeMove = await draft(), beforeInk = await inkHash();
  const moveStart = await center(node('A'));
  await page.mouse.move(moveStart.x, moveStart.y);
  await page.mouse.down();
  await page.mouse.move(moveStart.x + 95, moveStart.y + 75, { steps: 12 });
  await page.mouse.up();
  await settle();
  const moved = await draft();
  assert.ok(moved.states[0].x > beforeMove.states[0].x + 30);
  assert.notEqual(await inkHash(), beforeInk, 'Canvas ink follows a dragged start state');
  await page.locator('#graph-undo').click();
  await settle();
  assert.deepEqual((await draft()).states, beforeMove.states, 'One undo restores an entire drag');
  assert.equal(await inkHash(), beforeInk, 'Undo restores canvas geometry');
  await page.locator('#graph-redo').click();
  assert.deepEqual((await draft()).states, moved.states);

  const cancelStart = await center(node('A'));
  await page.mouse.move(cancelStart.x, cancelStart.y);
  await page.mouse.down();
  await page.mouse.move(cancelStart.x + 35, cancelStart.y - 25, { steps: 5 });
  await page.locator('#graph-scroll').dispatchEvent('pointercancel');
  await page.mouse.up();
  await settle();
  assert.deepEqual(await draft(), moved, 'Canceled pointer movement cannot persist half a drag');
  checks.push('Real dragging, one history snapshot, pixel geometry undo/redo, pointer cancellation');

  await page.locator('#graph-connect').click();
  await node('A').click();
  await node('B').click();
  assert.equal(await page.locator('#graph-transition-panel').isVisible(), true);
  assert.equal(await page.locator('#graph-from').inputValue(), moved.states[0].id);
  assert.equal(await page.locator('#graph-to').inputValue(), moved.states[1].id);
  await page.locator('#graph-input').fill('a');
  await page.locator('#graph-output').fill('λ');
  await page.locator('#graph-save-transition').click();
  assert.equal((await draft()).transitions.length, 1);
  assert.deepEqual((await draft()).alphabet, ['a']);
  checks.push('Click source → target connection, new input joins alphabet, nonbinary Unicode output');

  await page.locator('#graph-add-transition').click();
  await page.locator('#graph-from').selectOption(moved.states[0].id);
  await page.locator('#graph-input').fill('a');
  await page.locator('#graph-output').fill('β');
  await page.locator('#graph-save-transition').click();
  assert.match(await page.locator('#graph-errors').innerText(), /already has a transition/);
  assert.equal((await draft()).transitions.length, 1, 'Duplicate state/input pair is rejected');
  await page.locator('.graph-edge-label').first().click();
  await page.locator('#graph-output').fill('🟢');
  await page.locator('#graph-save-transition').click();
  assert.equal((await draft()).transitions[0].output, '🟢');
  checks.push('Explicit Add transition fallback, duplicate rejection, arrow label editing, emoji output');

  await page.locator('#graph-connect').click();
  const loopStart = await center(node('B'));
  await page.mouse.move(loopStart.x, loopStart.y);
  await page.mouse.down();
  await page.mouse.move(loopStart.x + 7, loopStart.y + 3, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.locator('#graph-from').inputValue(), moved.states[1].id);
  assert.equal(await page.locator('#graph-to').inputValue(), moved.states[1].id);
  await page.locator('#graph-input').fill('λ');
  await page.locator('#graph-output').fill('1');
  await page.locator('#graph-save-transition').click();
  assert.equal((await draft()).transitions.length, 2);
  await page.locator('#graph-connect').click();
  await node('A').click();
  await node('A').click();
  assert.equal(await page.locator('#graph-from').inputValue(), await page.locator('#graph-to').inputValue());
  checks.push('Real drag self-loop and click source twice self-loop');

  await page.locator('#graph-connect').click();
  await node('A').click();
  const cancelConnection = await center(node('A'));
  await page.mouse.move(cancelConnection.x, cancelConnection.y);
  await page.mouse.down();
  await page.mouse.move(cancelConnection.x + 80, cancelConnection.y + 40, { steps: 5 });
  await page.locator('#graph-scroll').dispatchEvent('pointercancel');
  await page.mouse.up();
  assert.equal(await page.locator('.graph-node.is-connect-source').count(), 0, 'Canceled connection removes its source highlight');
  await node('B').click();
  assert.equal(await page.locator('#graph-transition-panel').isVisible(), false, 'Next click chooses a fresh source after cancellation');
  await node('B').click();
  assert.equal(await page.locator('#graph-from').inputValue(), moved.states[1].id);
  assert.equal(await page.locator('#graph-to').inputValue(), moved.states[1].id);
  checks.push('Canceled connection clears source/preview; the next click starts a fresh connection');

  await page.locator('#graph-run').click();
  assert.equal(await page.locator('#view-editor').isVisible(), true);
  assert.match(await page.locator('#graph-errors').innerText(), /missing|transition/i);
  await page.locator('#graph-fill-missing').click();
  assert.equal((await draft()).transitions.length, 4);
  await page.locator('#graph-run').click();
  assert.equal(await page.locator('#view-bench').isVisible(), true);
  const valid = await draft();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Delete');
  assert.deepEqual(await draft(), valid, 'Editor keyboard actions stop when Editor is hidden');
  await enterEditor();
  checks.push('Incomplete Run validation, explicit Fill missing self-loops, valid Run and hidden keyboard guard');

  await page.locator('#graph-alphabet').fill('a');
  await page.locator('#graph-apply-alphabet').click();
  assert.equal((await draft()).transitions.length, 2);
  await page.locator('#graph-undo').click();
  assert.equal((await draft()).transitions.length, 4, 'Alphabet undo also restores removed transitions');
  await page.locator('#graph-select').click();
  await node('B').click();
  await page.locator('#graph-set-start').click();
  assert.equal((await draft()).start, moved.states[1].id);
  await node('B').focus();
  await page.keyboard.press('Delete');
  assert.equal((await draft()).states.length, 1);
  await page.keyboard.press('Control+z');
  assert.equal((await draft()).states.length, 2);
  assert.equal((await draft()).transitions.length, 4);
  checks.push('Alphabet deletion undo, start state, state and incident transition deletion undo');

  await page.locator('#graph-kind').selectOption('moore');
  await node('A').click();
  await page.locator('#graph-state-output').fill('β');
  await page.locator('#graph-save-state').click();
  assert.equal((await draft()).states[0].output, 'β');
  const stateSaved = await draft();
  await page.locator('#graph-state-name').focus();
  await page.keyboard.press('Control+z');
  assert.deepEqual(await draft(), stateSaved, 'Typing undo does not change graph command history');
  await page.locator('#graph-text').click();
  assert.equal(await page.locator('#source').isVisible(), true);
  assert.match(await page.locator('#source').inputValue(), /type moore/);
  await page.locator('#close-drawer').click();
  await enterEditor();
  checks.push('Mealy/Moore switch, Unicode Moore output, text-input keyboard guard and text drawer access');

  const downloadPending = page.waitForEvent('download');
  await page.locator('#graph-save').click();
  const download = await downloadPending;
  assert.equal(download.suggestedFilename(), 'machine.patchbay');
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(saved.format, 'patchbay-graph');
  assert.deepEqual(saved.draft, stateSaved, 'Draft export preserves positions and state outputs');
  await page.reload();
  await page.locator('#app[data-ready=true]').waitFor();
  await enterEditor();
  assert.deepEqual(await draft(), stateSaved, 'Startup preset cannot overwrite recovered graph');
  checks.push('Browser .patchbay export and draft recovery across reload');

  await page.locator('#graph-zoom-in').click();
  await page.locator('#graph-zoom-out').click();
  await page.locator('#graph-fit').click();
  await page.waitForTimeout(250);
  const idleBefore = await page.evaluate(() => window.graphDraws), idleHash = await inkHash();
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.graphDraws), idleBefore, 'Settled graph does not redraw on every tick');
  assert.equal(await inkHash(), idleHash, 'Settled pixels remain unchanged');
  await page.screenshot({ path: resolve(artifacts, 'graphical-editor-desktop.png') });
  await page.setViewportSize({ width: 360, height: 800 });
  await settle();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No 360px horizontal overflow');
  await page.screenshot({ path: resolve(artifacts, 'graphical-editor-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  checks.push('Zoom in/out/Fit, no idle canvas draws, stable pixels, responsive inspector and 360px layout');

  const viewport = await page.locator('#graph-scroll').boundingBox();
  await page.mouse.dblclick(viewport.x + viewport.width - 55, viewport.y + 65);
  assert.equal((await draft()).states.length, 3, 'Double-click empty canvas adds a state');
  await page.locator('#graph-undo').click();
  assert.equal((await draft()).states.length, 2);
  checks.push('Empty-canvas double-click creation is undoable');

  const beforeLargeImport = await draft();
  const validBrowserSource = JSON.stringify({ format: 'patchbay-graph', version: 1, draft: beforeLargeImport });
  const paddedBrowserSource = validBrowserSource + ' '.repeat(BETWEEN_LIMITS_BYTES - Buffer.byteLength(validBrowserSource, 'utf8'));
  assert.ok(Buffer.byteLength(paddedBrowserSource, 'utf8') > 1_000_000 && Buffer.byteLength(paddedBrowserSource, 'utf8') <= FILE_LIMIT_BYTES);
  await page.locator('#graph-import').setInputFiles({ name: 'near-limit.patchbay', mimeType: 'application/json', buffer: Buffer.from(paddedBrowserSource) });
  await settle();
  assert.deepEqual(await draft(), beforeLargeImport, 'Valid browser graph between one million bytes and 1 MiB is accepted');
  await page.evaluate(() => {
    window.oversizedFileReads = 0;
    const read = File.prototype.text;
    File.prototype.text = function () { if (this.name === 'oversized.patchbay') window.oversizedFileReads++; return read.call(this); };
  });
  await page.locator('#graph-import').setInputFiles({ name: 'oversized.patchbay', mimeType: 'application/json', buffer: Buffer.alloc(FILE_LIMIT_BYTES + 1, 32) });
  assert.match(await page.locator('#graph-errors').innerText(), /1 MiB/);
  assert.equal(await page.evaluate(() => window.oversizedFileReads), 0, 'Oversized import is rejected before file.text');
  assert.deepEqual(await draft(), beforeLargeImport);
  await page.locator('#graph-import').setInputFiles({ name: 'broken.patchbay', mimeType: 'application/json', buffer: Buffer.from('{"format":"patchbay-graph"}') });
  await settle();
  assert.deepEqual(await draft(), beforeLargeImport, 'Malformed imports leave the previous drawing intact');
  checks.push('Valid 1,020,000-byte browser graph accepted; >1 MiB rejected before reading; malformed import rollback');

  await page.evaluate(() => localStorage.setItem('patchbay:graph:v1', '{broken'));
  await page.reload();
  await page.locator('#app[data-ready=true]').waitFor();
  await enterEditor();
  assert.ok((await draft()).states.length > 0, 'Corrupt recovery falls back to the last runnable machine');
  checks.push('Corrupt local recovery does not crash startup');

  const incomplete = { format: 'patchbay-graph', version: 1, draft: { kind: 'moore', states: [{ id: 's0', name: 'EmptyOutput', output: '', x: 245, y: 215 }], transitions: [], alphabet: ['🟢'], start: '', nextId: 1 } };
  await importDraft(incomplete);
  assert.deepEqual(await draft(), incomplete.draft, 'Incomplete imported draft is accepted without inventing behavior');
  await page.locator('#graph-run').click();
  assert.equal(await page.locator('#view-editor').isVisible(), true);
  assert.match(await page.locator('#graph-errors').innerText(), /start|output|transition/i);
  const incompleteDownloadPending = page.waitForEvent('download');
  await page.locator('#graph-save').click();
  const incompleteDownload = await incompleteDownloadPending;
  assert.deepEqual(JSON.parse(await readFile(await incompleteDownload.path(), 'utf8')).draft, incomplete.draft);
  checks.push('Incomplete import/export retains positions, missing start/output and transitions; Run explains them');

  await page.evaluate(value => {
    window.nativeGraphSaved = null;
    window.patchbay = {
      openMachine: async () => ({ name: 'native.patchbay', source: JSON.stringify(value) }),
      saveMachine: async (source, format) => { window.nativeGraphSaved = { source, format }; return true; },
    };
  }, incomplete);
  await page.locator('#graph-open').click();
  await settle();
  assert.deepEqual(await draft(), incomplete.draft);
  await page.locator('#graph-save').click();
  await settle();
  const nativeSave = await page.evaluate(() => window.nativeGraphSaved);
  assert.equal(nativeSave.format, 'graph');
  assert.deepEqual(JSON.parse(nativeSave.source).draft, incomplete.draft);
  const validNativeSource = JSON.stringify(incomplete);
  const paddedNativeSource = validNativeSource + ' '.repeat(BETWEEN_LIMITS_BYTES - Buffer.byteLength(validNativeSource, 'utf8'));
  await page.evaluate(source => { window.patchbay.openMachine = async () => ({ name: 'near-limit-native.patchbay', source }); }, paddedNativeSource);
  await page.locator('#graph-open').click();
  await settle();
  assert.deepEqual(await draft(), incomplete.draft, 'Valid native graph between one million bytes and 1 MiB is accepted');
  await page.evaluate(() => { window.patchbay.openMachine = async () => ({ name: 'native.txt', source: 'type mealy\nstart Native\nalphabet a\nstate Native\nNative a Native λ' }); });
  await page.locator('#graph-open').click();
  await settle();
  assert.equal((await draft()).states[0].name, 'Native');
  assert.equal((await draft()).transitions[0].output, 'λ');
  const beforeNativeOversize = await draft();
  await page.evaluate(limit => { window.patchbay.openMachine = async () => ({ name: 'native.patchbay', source: ' '.repeat(limit + 1) }); }, FILE_LIMIT_BYTES);
  await page.locator('#graph-open').click();
  await settle();
  assert.match(await page.locator('#graph-errors').innerText(), /1 MiB/);
  assert.deepEqual(await draft(), beforeNativeOversize);
  await page.evaluate(() => { window.patchbay = undefined; });
  checks.push('Native bridge contract: JSON/text Open, 1,020,000-byte graph accepted, graph-format Save, >1 MiB rollback (IPC itself tested separately)');

  // A compact file can fit the import bound while its indented export exceeds it.
  // This also exercises the exact inclusive import boundary without thousands of DOM nodes.
  const exportBoundDraft = { format: 'patchbay-graph', version: 1, draft: { kind: 'mealy', states: [{ id: 's0', name: '', output: '0', x: 180, y: 160 }], transitions: [], alphabet: [], start: 's0', nextId: 1 } };
  const overhead = Buffer.byteLength(JSON.stringify(exportBoundDraft), 'utf8');
  exportBoundDraft.draft.states[0].name = 'N'.repeat(FILE_LIMIT_BYTES - overhead);
  const exactBoundSource = JSON.stringify(exportBoundDraft);
  const oversizedExportBytes = Buffer.byteLength(`${JSON.stringify(exportBoundDraft, null, 2)}\n`, 'utf8');
  assert.equal(Buffer.byteLength(exactBoundSource, 'utf8'), FILE_LIMIT_BYTES);
  assert.ok(oversizedExportBytes > FILE_LIMIT_BYTES, 'Fixture becomes oversized when exported with indentation');
  await page.locator('#graph-import').setInputFiles({ name: 'exact-limit.patchbay', mimeType: 'application/json', buffer: Buffer.from(exactBoundSource) });
  await settle();
  assert.equal((await draft()).states[0].name.length, exportBoundDraft.draft.states[0].name.length, 'Valid graph at exactly 1 MiB is accepted');
  await page.evaluate(() => {
    window.oversizedExportBlobs = 0;
    window.oversizedExportUrls = 0;
    window.oversizedNativeSaveCalls = 0;
    const OriginalBlob = window.Blob, createObjectURL = URL.createObjectURL;
    window.Blob = class extends OriginalBlob { constructor(...args) { super(...args); window.oversizedExportBlobs++; } };
    URL.createObjectURL = function (...args) { window.oversizedExportUrls++; return createObjectURL.apply(this, args); };
    window.restoreGraphExportProbes = () => { window.Blob = OriginalBlob; URL.createObjectURL = createObjectURL; };
  });
  let oversizedDownloads = 0;
  const onOversizedDownload = () => { oversizedDownloads++; };
  page.on('download', onOversizedDownload);
  await page.locator('#graph-save').click();
  await settle();
  assert.match(await page.locator('#graph-errors').innerText(), /draft exceeds the 1 MiB/);
  assert.deepEqual(await page.evaluate(() => ({ blobs: window.oversizedExportBlobs, urls: window.oversizedExportUrls })), { blobs: 0, urls: 0 }, 'Oversized draft is rejected before browser Blob or object URL creation');
  assert.equal(oversizedDownloads, 0, 'Oversized draft cannot produce a successful browser download');
  await page.evaluate(() => { window.patchbay = { saveMachine: async () => { window.oversizedNativeSaveCalls++; return true; } }; });
  await page.locator('#graph-save').click();
  await settle();
  assert.equal(await page.evaluate(() => window.oversizedNativeSaveCalls), 0, 'Oversized draft cannot reach native Save or its dialog');
  assert.match(await page.locator('#graph-errors').innerText(), /draft exceeds the 1 MiB/);
  page.off('download', onOversizedDownload);
  await page.evaluate(() => { window.restoreGraphExportProbes(); window.patchbay = undefined; });
  checks.push('Exact 1 MiB import accepted; oversized serialized draft rejected before native Save/dialog and browser Blob/download');

  const edgePositionDraft = { format: 'patchbay-graph', version: 1, draft: { kind: 'mealy', states: [{ id: 's0', name: 'EdgePosition', output: '0', x: 0, y: 35 }], transitions: [], alphabet: ['a'], start: 's0', nextId: 1 } };
  await page.setViewportSize({ width: 1440, height: 744 });
  await importDraft(edgePositionDraft, 'edge-position.patchbay');
  await page.locator('#graph-fit').click();
  await settle();
  const edgeZoom = await node('EdgePosition').evaluate(element => parseFloat(element.style.width) / 68);
  const edgeCenter = await center(node('EdgePosition'));
  const pointerX = Math.round(edgeCenter.x), pointerY = Math.round(edgeCenter.y);
  await page.mouse.move(pointerX, pointerY);
  await page.mouse.down();
  await page.mouse.move(pointerX + 10, pointerY, { steps: 5 });
  await page.mouse.up();
  await settle();
  const edgeMoved = (await draft()).states[0];
  assert.ok(Math.abs(edgeMoved.x - 10 / edgeZoom) < 0.0001, 'Imported x=0 moves by client delta divided by actual zoom');
  assert.equal(edgeMoved.y, 35, 'Horizontal dragging preserves the imported y=35 coordinate');
  await page.locator('#graph-undo').click();
  assert.deepEqual(await draft(), edgePositionDraft.draft, 'One undo restores imported edge coordinates');
  await page.setViewportSize({ width: 1440, height: 1050 });
  checks.push('Imported (0,35) state: real 10px horizontal drag respects zoom, preserves y35 and undoes exactly');

  const symbols = ['a', 'λ', '🟢'];
  const large = { format: 'patchbay-graph', version: 1, draft: {
    kind: 'mealy',
    states: Array.from({ length: 256 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, output: '0', x: 100 + (i % 16) * 150, y: 100 + Math.floor(i / 16) * 150 })),
    transitions: Array.from({ length: 256 }, (_, i) => symbols.map((input, j) => ({ id: `t${i * symbols.length + j}`, from: `s${i}`, to: `s${i}`, input, output: 'β' }))).flat(),
    alphabet: symbols, start: 's0', nextId: 1024,
  } };
  await importDraft(large, 'large.patchbay');
  assert.equal(await page.locator('.graph-node').count(), 256);
  assert.equal(await page.locator('.graph-edge-label').count(), 768);
  const dimensions = await page.locator('#graph-ink').evaluate(canvas => ({ width: canvas.width, height: canvas.height, viewportWidth: document.querySelector('#graph-scroll').clientWidth, viewportHeight: document.querySelector('#graph-scroll').clientHeight, dpr: devicePixelRatio }));
  assert.ok(dimensions.width <= dimensions.viewportWidth * Math.min(2, dimensions.dpr) + 2);
  assert.ok(dimensions.height <= dimensions.viewportHeight * Math.min(2, dimensions.dpr) + 2);
  for (let i = 0; i < 6; i++) await page.locator('#graph-zoom-in').click();
  await page.locator('#graph-scroll').evaluate(element => { element.scrollLeft = 750; element.scrollTop = 550; });
  await settle();
  const view = await page.locator('#graph-scroll').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, width: element.clientWidth, height: element.clientHeight }));
  assert.ok(view.left > 0 && view.top > 0, 'Large drawing scrolls in both axes after zoom');
  await page.screenshot({ path: resolve(artifacts, 'graphical-editor-large.png') });
  await page.locator('#graph-fit').click();
  await page.locator('#graph-run').click();
  assert.equal(await page.locator('#view-bench').isVisible(), true);
  await enterEditor();
  assert.equal(await page.locator('.graph-node').count(), 256, 'Running a large draft cannot replace editor geometry');
  checks.push('256 states and 768 multialphabet transitions, viewport-only canvas, zoom/scroll, large valid Run');

  assert.deepEqual(errors, [], 'No uncaught renderer exceptions');
  assert.deepEqual(external, [], 'No remote runtime requests');
  const report = { passed: checks, dimensions, view, edgeDrag: { zoom: edgeZoom, clientDeltaX: 10, savedX: edgeMoved.x, savedY: edgeMoved.y }, fileBoundary: { limitBytes: FILE_LIMIT_BYTES, acceptedBrowserBytes: Buffer.byteLength(paddedBrowserSource, 'utf8'), acceptedNativeBytes: Buffer.byteLength(paddedNativeSource, 'utf8'), acceptedExactBytes: Buffer.byteLength(exactBoundSource, 'utf8'), rejectedSerializedBytes: oversizedExportBytes }, idleDraws: idleBefore, errors, external, screenshots: ['graphical-editor-desktop.png', 'graphical-editor-mobile.png', 'graphical-editor-large.png'], builtAssets: await (await import('node:fs/promises')).readdir(resolve(dist, 'assets')) };
  await writeFile(resolve(artifacts, 'graphical-editor-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'graphical-editor-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
