import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { root } from './process.mjs';
import { createZip } from './archive.mjs';
import { contained, filesIn, sha256, slash, sourceRecords } from './release.mjs';

export async function packageWindows(settings, installerSource, resources) {
  const { output, portable, installer, binary, manifest } = settings;
  const payload = new Map([
    ['Patchbay.exe', await readFile(binary)],
    [
      'README-WINDOWS.md',
      Buffer.from(
        (await readFile(join(root, 'docs/distribution.md'), 'utf8')).replaceAll(
          '@VERSION@',
          manifest.version,
        ),
      ),
    ],
  ]);
  for (const [source, destination] of Object.entries(resources)) {
    contained(output, destination);
    assert.ok(!payload.has(destination), 'Duplicate resource destination: ' + destination);
    payload.set(destination, await readFile(resolve(root, 'src-tauri', source)));
  }
  // Some toolchain configurations emit the loader separately; include it if present.
  try {
    payload.set('WebView2Loader.dll', await readFile(join(dirname(binary), 'WebView2Loader.dll')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const files = new Map([...payload].map(([name, data]) => [`${portable}/${name}`, data]));
  files.set(
    `${portable}.zip`,
    createZip([...payload].map(([name, data]) => [`${portable}/${name}`, data])),
  );
  files.set(installer, await readFile(installerSource));
  files.set('README-WINDOWS.md', payload.get('README-WINDOWS.md'));
  // Only overwrite our known artifacts. Never recursively delete a release folder.
  try {
    const existing = await filesIn(output);
    const allowed = new Set([...files.keys(), 'release-manifest.json', 'SHA256SUMS.txt']);
    for (const path of existing)
      assert.ok(
        allowed.has(slash(relative(output, path))),
        'Unexpected file in release directory: ' + path,
      );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const records = [...files]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) }));
  const report = {
    format: 'patchbay-release',
    formatVersion: 1,
    version: manifest.version,
    platform: 'windows-x64',
    runtime: 'Tauri / preinstalled Microsoft Edge WebView2 Evergreen Runtime',
    portable,
    installer,
    sources: await sourceRecords(),
    files: records,
  };
  files.set('release-manifest.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  files.set(
    'SHA256SUMS.txt',
    Buffer.from(
      [...files]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, data]) => `${sha256(data)}  ${name}`)
        .join('\n') + '\n',
    ),
  );
  for (const [path, data] of files) {
    const destination = contained(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await copyFile(
    join(output, 'release-manifest.json'),
    join(root, 'artifacts/package-manifest.json'),
  );
  console.log(`Packaged ${files.size} files in ${output}`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.includes('--help'))
    console.log(
      'Usage: npm run package\nBuild the Windows x64 NSIS installer, portable ZIP, notices and hashes, then check the release. Alias of npm run dist:windows.',
    );
  else {
    assert.equal(process.argv.length, 2, 'Unexpected package command argument.');
    await import('./distribute.mjs').then((module) => module.distribute());
  }
}
