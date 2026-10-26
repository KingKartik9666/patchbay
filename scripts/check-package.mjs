import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { root } from './process.mjs';
import { createZip } from './archive.mjs';
import {
  contained,
  filesIn,
  json,
  releaseSettings,
  sha256,
  slash,
  sourceRecords,
} from './release.mjs';

export async function checkPackage({ currentSource = false } = {}) {
  const settings = await releaseSettings(),
    { output, manifest, portable, installer, binary } = settings;
  const report = await json(join(output, 'release-manifest.json'));
  assert.equal(report.format, 'patchbay-release');
  assert.equal(report.formatVersion, 1);
  assert.equal(report.version, manifest.version);
  assert.equal(report.platform, 'windows-x64');
  assert.equal(report.portable, portable);
  assert.equal(report.installer, installer);
  if (currentSource)
    assert.deepEqual(
      report.sources,
      await sourceRecords(),
      'Sources changed since packaging; rebuild the release.',
    );
  const actual = (await filesIn(output)).map((path) => slash(relative(output, path))).sort();
  const expected = [
    ...report.files.map((file) => file.path),
    'release-manifest.json',
    'SHA256SUMS.txt',
  ].sort();
  assert.deepEqual(actual, expected, 'The release contains missing, extra or duplicate files.');
  const buffers = new Map();
  for (const record of report.files) {
    const data = await readFile(contained(output, record.path));
    assert.equal(data.length, record.bytes, 'Changed file length: ' + record.path);
    assert.equal(sha256(data), record.sha256, 'Changed file hash: ' + record.path);
    buffers.set(record.path, data);
  }
  const exe = buffers.get(`${portable}/Patchbay.exe`);
  assert.ok(
    exe && exe.length > 64 && exe.subarray(0, 2).toString() === 'MZ',
    'Missing Windows executable.',
  );
  const pe = exe.readUInt32LE(0x3c);
  assert.equal(exe.readUInt32LE(pe), 0x4550, 'Missing PE header.');
  assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'Portable executable is not Windows x64.');
  if (currentSource)
    assert.equal(
      sha256(exe),
      sha256(await readFile(binary)),
      'Packaged executable differs from the current release build.',
    );
  for (const name of [
    'PATCHBAY-LICENSE.txt',
    'THIRD-PARTY-NOTICES.txt',
    'licenses/Nunito-OFL.txt',
    'README-WINDOWS.md',
  ]) {
    assert.ok(buffers.get(`${portable}/${name}`)?.length, 'Missing portable resource: ' + name);
  }
  assert.ok(buffers.get(installer)?.subarray(0, 2).toString() === 'MZ', 'Missing NSIS installer.');
  const zip = buffers.get(`${portable}.zip`);
  assert.ok(
    zip?.equals(createZip([...buffers].filter(([name]) => name.startsWith(portable + '/')))),
    'ZIP contents differ from the portable folder.',
  );
  buffers.set('release-manifest.json', await readFile(join(output, 'release-manifest.json')));
  const sums =
    [...buffers]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, data]) => `${sha256(data)}  ${name}`)
      .join('\n') + '\n';
  assert.equal(
    await readFile(join(output, 'SHA256SUMS.txt'), 'utf8'),
    sums,
    'SHA256SUMS.txt differs from release contents.',
  );
  const result = {
    passed: true,
    version: manifest.version,
    directory: output,
    files: report.files.length,
    nativeBytes: exe.length,
    installerBytes: buffers.get(installer).length,
    portableZipBytes: zip.length,
    checks: [
      'matching npm/Tauri/Rust versions and lockfile',
      'complete file inventory and SHA-256 hashes',
      'Windows x64 portable executable',
      'portable resources and deterministic ZIP contents',
      ...(currentSource
        ? ['current source hashes', 'portable executable equals current release build']
        : []),
    ],
    currentSource,
    runtimeVerification: 'Not performed by this static package check.',
  };
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(
    join(root, 'artifacts/package-report.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.includes('--help'))
    console.log(
      'Usage: npm run check:package [-- --current-source]\nVerify release/<version>, its portable ZIP and all SHA-256 hashes. Add --current-source to require an unchanged source snapshot and matching current release executable. Does not launch an application or installer.',
    );
  else {
    const args = process.argv.slice(2);
    assert.ok(
      args.length === 0 || (args.length === 1 && args[0] === '--current-source'),
      'Only --current-source is supported.',
    );
    await checkPackage({ currentSource: args.includes('--current-source') });
  }
}
