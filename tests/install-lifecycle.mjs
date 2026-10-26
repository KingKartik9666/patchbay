import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { launchNative, root, artifacts, domain } from './helpers/native.mjs';

const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const installer = resolve(root, `release/${version}/Patchbay-${version}-Setup-x64.exe`);
const payload = resolve(root, `release/${version}/Patchbay-${version}-Windows-x64/Patchbay.exe`);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const portableBytes = await readFile(payload),
  installedBytes = Buffer.from(portableBytes),
  marker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
const markerOffset = installedBytes.indexOf(marker);
assert.ok(markerOffset >= 0, 'Expected the unbundled Tauri marker in the portable executable.');
assert.equal(
  installedBytes.indexOf(marker, markerOffset + 1),
  -1,
  'Ambiguous Tauri bundle marker.',
);
// Tauri patches UNK to NSS while building NSIS, then restores the standalone EXE.
// Require that exact three-byte change and verify every other byte unchanged.
installedBytes.write('NSS', markerOffset + marker.length - 3, 'ascii');
const expected = hash(installedBytes),
  checks = [];
async function step(action, directory) {
  return new Promise((done, fail) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve(root, 'tests/helpers/install.ps1'),
        '-Action',
        action,
        '-Installer',
        installer,
        '-Directory',
        directory,
      ],
      { windowsHide: true },
    );
    let out = '',
      error = '';
    child.stdout.on('data', (data) => (out += data));
    child.stderr.on('data', (data) => (error += data));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0
        ? done(JSON.parse(out))
        : fail(Error(error || `Installer action exited with ${code}`)),
    );
  });
}
async function smoke(directory) {
  assert.equal(hash(await readFile(join(directory, 'Patchbay.exe'))), expected);
  const run = await launchNative({ executable: join(directory, 'Patchbay.exe') });
  try {
    const startup = await run.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('startup'));
    const result = await domain(run.page, {
      type: 'parse',
      source: 'type mealy\nstart Ω\nΩ λ Ω yes',
      input: 'λλ',
      mooreInitial: true,
    });
    assert.equal(result.value.trace.output, 'yes yes');
    assert.equal(await run.page.locator('.depth-scene').count(), 0);
    const diagnostics = JSON.parse(await run.page.locator('#debug').innerText());
    assert.equal(diagnostics.rendererErrors, 0);
    return { version: startup.version, sourceRestored: !!startup.session, url: run.page.url() };
  } finally {
    await run.close();
  }
}
async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    bytes += entry.isDirectory() ? await directoryBytes(path) : (await readFile(path)).length;
  }
  return bytes;
}
const temporary = resolve(root, '.cache/install-verification/Patchbay');
await step('Install', temporary);
const first = await smoke(temporary);
checks.push('NSIS installs and launches a real React → Tauri → Rust flow');
await step('Uninstall', temporary);
checks.push('Silent uninstall removes the installed executable');
await step('Install', temporary);
const second = await smoke(temporary);
checks.push('Reinstall launches the same verified Windows payload');
await step('Uninstall', temporary);
const production = resolve(process.env.LOCALAPPDATA, 'Programs/Patchbay');
const upgraded = await step('Install', production);
const final = await smoke(production);
const shortcut = await step('Shortcut', production);
checks.push('Previous installed version upgraded and desktop shortcut verified');
const report = {
  checks,
  first,
  second,
  final,
  production,
  shortcut: shortcut.shortcut,
  legacyBackup: upgraded.legacyBackup ?? null,
  installedBytes: await directoryBytes(production),
  nativeBytes: (await readFile(payload)).length,
  portableSha256: hash(portableBytes),
  installedSha256: expected,
  bundleMarker: 'Portable UNK, NSIS NSS; every other byte must match',
};
await writeFile(resolve(artifacts, 'installation-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
