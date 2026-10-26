import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchNative, root, artifacts, domain } from './helpers/native.mjs';

let run = await launchNative();
const dataDirectory = run.dataDirectory,
  checks = [];
const closeDrawer = async () => {
  await run.page.locator('#close-drawer').click();
  await run.page.locator('#drawer').waitFor({ state: 'hidden' });
};
const saved = async () =>
  JSON.parse(await readFile(resolve(dataDirectory, 'session.json'), 'utf8')).session;
async function dialog(title, path, cancel = false) {
  await new Promise((done, fail) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve(root, 'tests/helpers/file-dialog.ps1'),
        '-AppProcessId',
        String(run.app.pid),
        '-Title',
        title,
        ...(cancel ? ['-Cancel'] : ['-FilePath', path]),
      ],
      { windowsHide: true },
    );
    let error = '';
    child.stderr.on('data', (data) => (error += data));
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? done() : fail(new Error(error))));
  });
}
try {
  const fixtures = JSON.parse(
    await readFile(resolve(root, 'tests/fixtures/graph-compatibility.json'), 'utf8'),
  );
  let page = run.page;
  await page.locator('[data-route=settings]').click();
  await page.locator('#reduced-motion').check();
  await closeDrawer();
  const seed = await page
    .evaluate(() => window.__TAURI_INTERNALS__.invoke('startup'))
    .then((result) => result.session);
  // Autosave has run by now; use the actual session schema returned by Rust.
  const compatibility = {
    ...seed,
    source: fixtures[0].source,
    input: '1101',
    graph: fixtures[0].draft,
    manualDraft: null,
    route: 'editor',
    reducedMotion: true,
  };
  await page.evaluate(
    (session) => window.__TAURI_INTERNALS__.invoke('save_session', { session }),
    compatibility,
  );
  await page.reload();
  await page.locator('#app[data-ready=true]').waitFor();
  await page.locator('#graph-text').click();
  await page.locator('#source').waitFor();
  await closeDrawer();
  await run.close();
  run = null;
  assert.deepEqual((await saved()).graph, fixtures[0].draft);
  checks.push(
    'Opening and closing unchanged generated text preserves graph IDs, ordering, coordinates and inactive outputs',
  );
  run = await launchNative({ dataDirectory });
  page = run.page;
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill('type mealy\nstart Ω\nΩ λ Ω 1');
  // Close while the debounce is pending; the native close path must await it.
  await run.close();
  run = null;
  assert.match((await saved()).source, /start Ω/);
  checks.push('Immediate native close flushes the latest valid text');
  run = await launchNative({ dataDirectory });
  page = run.page;
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill('unfinished invalid text Ω');
  await run.close();
  run = null;
  const pending = await saved();
  assert.equal(pending.manualDraft, 'unfinished invalid text Ω');
  assert.match(pending.source, /start Ω/);
  run = await launchNative({ dataDirectory });
  page = run.page;
  await page.locator('#text-shortcut').click();
  assert.equal(await page.locator('#source').inputValue(), 'unfinished invalid text Ω');
  await page.locator('#editor-errors p').first().waitFor();
  await closeDrawer();
  checks.push('Invalid manual draft and last valid machine survive close and restart');
  await page.locator('#speed').selectOption('4');
  await page.locator('#input').fill('λλ');
  await page.locator('#input-form').evaluate((form) => form.requestSubmit());
  await page.locator('#progress[max="2"]').waitFor();
  assert.equal(await page.locator('#speed').inputValue(), '4');
  checks.push('Playback speed survives a new Rust trace');
  const textPath = resolve(dataDirectory, 'roundtrip.txt'),
    graphPath = resolve(dataDirectory, 'roundtrip.patchbay'),
    pngPath = resolve(dataDirectory, 'screenshot.png');
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill('type mealy\nstart A\nA coin A yes\nA push A no');
  await page.locator('#apply').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  await page.locator('#text-shortcut').click();
  await page.locator('#save-file').click();
  await dialog('Save Patchbay project', textPath);
  await page.locator('#toast').filter({ hasText: 'Text definition saved' }).waitFor();
  assert.match(await readFile(textPath, 'utf8'), /A coin A yes/);
  await page.locator('#open-file').click();
  await dialog('Open Patchbay project', textPath);
  await page.locator('#toast').filter({ hasText: 'Text definition opened.' }).waitFor();
  await page.locator('#source').filter({ visible: true }).waitFor();
  assert.match(await page.locator('#source').inputValue(), /A coin A yes/);
  await closeDrawer();
  await page.locator('[data-route=editor]').click();
  await page.locator('#graph-save').click();
  await dialog('Save Patchbay project', graphPath);
  await page.locator('#toast').filter({ hasText: 'Drawing saved' }).waitFor();
  const graphFile = await readFile(graphPath, 'utf8');
  assert.equal(JSON.parse(graphFile).version, 1);
  await domain(page, { type: 'openProject', source: graphFile });
  await page.locator('#graph-open').click();
  await dialog('Open Patchbay project', graphPath);
  await page.locator('#toast').filter({ hasText: 'Project opened' }).waitFor();
  checks.push('Native text and version-1 graph save/open dialogs round trip real files');
  await page.locator('[data-route=settings]').click();
  await page.locator('#screenshot').click();
  await dialog('Save Patchbay screenshot', pngPath);
  await page.locator('#toast').filter({ hasText: 'Screenshot saved' }).waitFor();
  assert.equal((await readFile(pngPath)).subarray(1, 4).toString(), 'PNG');
  await closeDrawer();
  checks.push('Native own-window screenshot saves a real PNG');
  await page.locator('[data-route=bench]').click();
  await page.locator('#text-shortcut').click();
  await page.locator('#open-file').click();
  await dialog('Open Patchbay project', '', true);
  assert.ok(await page.locator('#source').isVisible());
  await closeDrawer();
  checks.push('Cancelling a native file dialog preserves the current machine');
  const large = JSON.parse(
    await readFile(resolve(root, 'tests/fixtures/benchmark-input.json'), 'utf8'),
  );
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill(large.source);
  await page.locator('#apply').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  await page.locator('#input').fill(large.input);
  await page.locator('#input-form').evaluate((form) => form.requestSubmit());
  await page.locator('#progress[max="4096"]').waitFor();
  assert.equal(await page.locator('.diagram-node').count(), 256);
  await page.locator('#progress').focus();
  await page.keyboard.press('End');
  await page.locator('#progress').blur();
  await page.locator('#trace-shortcut').click();
  await page.locator('#panel-trace').waitFor();
  assert.equal(await page.locator('#summary-output').innerText(), large.input);
  assert.ok((await page.locator('#trace-body tr').count()) <= 200);
  await closeDrawer();
  checks.push(
    '256 states, 512 transitions and 4096 input symbols run through the native UI with a bounded trace table',
  );
  await page.evaluate(() => {
    // Tauri freezes invoke; delay its actual HTTP IPC transport instead.
    const fetch = window.fetch;
    window.fetch = (url, ...args) => {
      if (!String(url).includes('/save_session')) return fetch.call(window, url, ...args);
      window.delayedSessionSave = true;
      return new Promise((resolve) => setTimeout(resolve, 800)).then(() =>
        fetch.call(window, url, ...args),
      );
    };
  });
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill('type mealy\nstart Final\nFinal x Final y');
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
  );
  await page.waitForFunction(() => window.delayedSessionSave === true);
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
  );
  await page.waitForTimeout(150);
  assert.equal(
    run.app.exitCode,
    null,
    'A repeated close must wait for the in-flight session write',
  );
  await run.close();
  run = null;
  assert.match((await saved()).source, /start Final/);
  checks.push('Repeated native close requests wait for the final in-flight save');
  await writeFile(
    resolve(artifacts, 'session-report.json'),
    JSON.stringify({ checks, dataDirectory }, null, 2),
  );
  console.log(JSON.stringify({ checks }, null, 2));
} catch (error) {
  console.error('Native session check failed:', error);
  if (run)
    await run.page.screenshot({ path: resolve(artifacts, 'session-failure.png') }).catch(() => {});
  throw error;
} finally {
  if (run) await run.close();
}
