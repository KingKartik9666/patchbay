import assert from 'node:assert/strict';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkPackage } from './check-package.mjs';
import { generateNotices } from './licenses.mjs';
import { packageWindows } from './package.mjs';
import { nodeScript, tauri } from './process.mjs';
import { releaseSettings, sha256, sourceRecords } from './release.mjs';

export async function distribute() {
  assert.ok(
    process.platform === 'win32' && process.arch === 'x64',
    'Build this Windows x64 distribution on Windows x64.',
  );
  assert.ok(
    !process.env.CARGO_BUILD_TARGET,
    'Unset CARGO_BUILD_TARGET for the native Windows x64 release.',
  );
  const settings = await releaseSettings(),
    sourceBefore = await sourceRecords();
  const resources = {
    ...settings.config.bundle.resources,
    '../LICENSE': 'PATCHBAY-LICENSE.txt',
    '../.cache/distribution/THIRD-PARTY-NOTICES.txt': 'THIRD-PARTY-NOTICES.txt',
  };
  await generateNotices();
  const started = Date.now();
  await tauri([
    'build',
    '--bundles',
    'nsis',
    '--ci',
    '--config',
    JSON.stringify({ bundle: { resources } }),
    '--',
    '--locked',
  ]);
  assert.deepEqual(
    await sourceRecords(),
    sourceBefore,
    'Sources changed during the release build; rerun packaging.',
  );
  await nodeScript('check-bundle.mjs');
  await access(settings.binary);
  const installerDirectory = join(settings.nativeOutput, 'bundle/nsis');
  const candidates = [];
  for (const name of await readdir(installerDirectory)) {
    if (!name.endsWith('-setup.exe')) continue;
    const path = join(installerDirectory, name),
      info = await stat(path);
    if (info.isFile() && info.mtimeMs >= started - 2000) candidates.push(path);
  }
  assert.equal(candidates.length, 1, 'Expected exactly one freshly built NSIS installer.');
  const buildHash = sha256(await readFile(settings.binary));
  await packageWindows(settings, candidates[0], resources);
  assert.equal(
    sha256(await readFile(settings.binary)),
    buildHash,
    'The release executable changed while packaging.',
  );
  return checkPackage({ currentSource: true });
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.includes('--help'))
    console.log(
      'Usage: npm run dist:windows\nBuild the locked Tauri release and NSIS installer, then create and verify release/<version>.\nClose running copies of target/release/Patchbay.exe before building. The installer requires preinstalled WebView2 and never downloads it.',
    );
  else {
    assert.equal(process.argv.length, 2, 'Unexpected distribute argument.');
    await distribute();
  }
}
