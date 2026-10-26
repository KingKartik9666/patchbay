import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchNative, artifacts, root, domain } from './helpers/native.mjs';
const run = await launchNative(),
  { page } = run,
  errors = [],
  external = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (
    !/^(http:\/\/tauri.localhost|https:\/\/tauri.localhost|http:\/\/ipc.localhost|data:|blob:|ipc:)/.test(
      request.url(),
    )
  )
    external.push(request.url());
});
const closeDrawer = async () => {
  await page.locator('#close-drawer').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
};
const trace = async () => {
  await page.locator('#trace-shortcut').click();
  await page.locator('#panel-trace').waitFor();
};
const end = async () => {
  await page.locator('#progress').focus();
  await page.keyboard.press('End');
  await page.locator('#progress').blur();
};
try {
  await page.locator('[data-route=settings]').click();
  await page.locator('#reduced-motion').check();
  await closeDrawer();
  const presets = JSON.parse(await readFile(resolve(root, 'tests/fixtures/presets.json'), 'utf8'));
  for (const preset of presets) {
    await page.locator('[data-route=machines]').click();
    await page.locator(`[data-preset="${preset.id}"]`).click();
    await page.locator('#machine-title').filter({ hasText: preset.name }).waitFor();
    await end();
    await trace();
    assert.equal(await page.locator('#summary-output').innerText(), preset.expected);
    await closeDrawer();
  }
  checks.push('All eleven presets execute through React → Tauri → Rust');
  await page.locator('[data-route=machines]').click();
  await page.locator('[data-preset=mealy-11-detector]').click();
  await page.locator('#mode-moore').click();
  await page.locator('#mode-moore[aria-pressed=true]').waitFor();
  await page.locator('[data-route=settings]').click();
  await page.locator('#moore-initial').uncheck();
  await closeDrawer();
  await end();
  await trace();
  assert.equal(await page.locator('#summary-output').innerText(), '0100');
  await closeDrawer();
  checks.push('Conversion and initial-output setting');
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill('type mealy\nstart Ω\nΩ 🙂 Ω ✨\nΩ λ Ω β');
  await page.locator('#apply').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  await page.locator('#input').fill('🙂λ🙂');
  await page.locator('#input-form').evaluate((form) => form.requestSubmit());
  await page.locator('#progress[max="3"]').waitFor();
  await end();
  await trace();
  assert.equal(await page.locator('#summary-output').innerText(), '✨β✨');
  await closeDrawer();
  checks.push('Unicode text editing and simulation');
  await page.locator('#text-shortcut').click();
  await page.locator('#source').fill('type moore\nstart A\nA 0 A');
  await page.locator('#apply').click();
  await page.locator('#editor-errors').filter({ hasText: 'Line' }).waitFor();
  await closeDrawer();
  assert.equal(await page.locator('#state-count').innerText(), '1');
  checks.push('Invalid text preserves last valid machine');
  await page.locator('#input').fill('🙂?');
  await page.locator('#input-form').evaluate((form) => form.requestSubmit());
  await page.locator('#input-error').waitFor();
  assert.equal(await page.locator('#play').isDisabled(), true);
  checks.push('Invalid input handled without a renderer error');
  await page.locator('[data-route=editor]').click();
  await page.locator('#graph-new').click();
  await page.locator('#graph-empty').waitFor();
  await page.locator('#graph-add-state').click();
  await page.locator('.graph-node').waitFor();
  await page.locator('#graph-state-name').fill('Start');
  await page.locator('#graph-save-state').click();
  await page.locator('.graph-node').filter({ hasText: 'Start' }).waitFor();
  await page.locator('#graph-alphabet').fill('coin push');
  await page.locator('#graph-apply-alphabet').click();
  await page.locator('#graph-draw-input option[value="coin"]').waitFor({ state: 'attached' });
  const connection = page.locator('.graph-connect-handle').first();
  await connection.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.locator('.graph-edge-label').filter({ hasText: 'coin / 0' }).waitFor();
  assert.equal(await page.locator('#graph-select').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#graph-save-transition').count(), 0);
  await page.locator('#graph-undo').click();
  assert.equal(await page.locator('.graph-edge-label').count(), 0);
  checks.push(
    'State connection handles create a Rust-validated arrow directly in Select mode, without a form',
  );
  await page.locator('#graph-fill-missing').click();
  await page.locator('.graph-edge-label').first().waitFor();
  assert.equal(await page.locator('.graph-edge-label').count(), 2);
  await page.locator('#graph-undo').click();
  assert.equal(await page.locator('.graph-edge-label').count(), 0);
  await page.locator('#graph-redo').click();
  assert.equal(await page.locator('.graph-edge-label').count(), 2);
  await page.locator('#graph-run').click();
  await page.locator('#view-bench').waitFor();
  assert.equal(await page.locator('#input').inputValue(), 'coin push');
  await end();
  await trace();
  assert.equal(await page.locator('#summary-output').innerText(), '00');
  await closeDrawer();
  checks.push('Graph editing, Rust validation, undo/redo and run');
  const pure = await domain(page, {
    type: 'parse',
    source: 'type mealy\nstart A\nA 0 A 1',
    input: '',
    mooreInitial: true,
  });
  assert.equal(pure.value.trace.output, '');
  await assert.rejects(
    domain(page, {
      type: 'simulate',
      machine: pure.value.machine,
      input: '0'.repeat(4097),
      mooreInitial: true,
    }),
  );
  checks.push('Empty and oversized native domain inputs');
  await page.locator('#input').focus();
  await page.keyboard.press('Space');
  assert.equal(
    await page
      .locator('#play')
      .innerText()
      .then((text) => text.includes('Play')),
    true,
  );
  await page.locator('#input').blur();
  await page.locator('body').click({ position: { x: 200, y: 250 } });
  await page.keyboard.press('r');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#progress').inputValue(), '1');
  await page.keyboard.press('r');
  assert.equal(await page.locator('#progress').inputValue(), '0');
  await page.keyboard.press('e');
  await page.locator('#view-editor').waitFor();
  await page.locator('[data-route=bench]').click();
  checks.push('Keyboard field priority, stepping, reset and editor');
  assert.equal(
    await page.locator('#sheet').evaluate((element) => getComputedStyle(element).backdropFilter),
    'none',
  );
  checks.push('Solid surfaces without background effects');
  await page.screenshot({ path: resolve(artifacts, 'tauri-light.png') });
  await page.locator('#theme-toggle').click();
  await page.locator('html[data-theme=dark]').waitFor();
  await page.screenshot({ path: resolve(artifacts, 'tauri-dark.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    checks,
    errors,
    external,
    metrics: await page.locator('#debug').innerText(),
    url: page.url(),
  };
  await writeFile(resolve(artifacts, 'native-ui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'native-failure.png') });
  console.error(error, await page.locator('#toast').textContent());
  throw error;
} finally {
  await run.close();
}
