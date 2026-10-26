import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { cargo, root } from './process.mjs';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const slash = (path) => path.replaceAll('\\', '/');
export const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
export const releaseBase = join(root, 'release');

export function contained(directory, path) {
  const resolved = resolve(directory, path),
    suffix = relative(resolve(directory), resolved);
  assert.ok(
    suffix &&
      !suffix.startsWith('..' + sep) &&
      suffix !== '..' &&
      !suffix.includes(':') &&
      !suffix.startsWith(sep),
    'Path must remain inside ' + directory + ': ' + path,
  );
  return resolved;
}

export async function filesIn(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesIn(path)));
    else if (entry.isFile()) paths.push(path);
    else throw new Error('Unexpected link or special file: ' + path);
  }
  return paths.sort();
}

export async function releaseSettings() {
  const [manifest, lock, config] = await Promise.all([
    json(join(root, 'package.json')),
    json(join(root, 'package-lock.json')),
    json(join(root, 'src-tauri/tauri.conf.json')),
  ]);
  assert.match(
    manifest.version,
    /^\d+\.\d+\.\d+$/,
    'Windows release needs a numeric semver version.',
  );
  assert.equal(lock.version, manifest.version, 'Refresh package-lock.json.');
  assert.equal(lock.packages[''].version, manifest.version, 'Refresh package-lock.json.');
  for (const section of ['dependencies', 'devDependencies']) {
    assert.deepEqual(
      lock.packages[''][section],
      manifest[section],
      'Dependency lock differs from package.json.',
    );
  }
  assert.equal(config.version, manifest.version, 'Tauri and npm versions must match.');
  const metadata = JSON.parse(
    await cargo(['metadata', '--no-deps', '--format-version', '1', '--locked', '--offline'], {
      capture: true,
    }),
  );
  for (const name of ['patchbay-core', 'patchbay-desktop']) {
    assert.equal(
      metadata.packages.find((item) => item.name === name)?.version,
      manifest.version,
      name + ' version differs.',
    );
  }
  assert.equal(
    config.bundle.windows.webviewInstallMode.type,
    'skip',
    'This distribution requires preinstalled WebView2.',
  );
  assert.equal(
    config.bundle.windows.nsis.installMode,
    'currentUser',
    'This distribution is per user.',
  );
  const output = contained(releaseBase, manifest.version);
  return {
    manifest,
    config,
    output,
    binary: join(metadata.target_directory, 'release/Patchbay.exe'),
    nativeOutput: join(metadata.target_directory, 'release'),
    portable: `Patchbay-${manifest.version}-Windows-x64`,
    installer: `Patchbay-${manifest.version}-Setup-x64.exe`,
  };
}

export async function sourceRecords() {
  const directories = [
    'src',
    'public',
    'crates/patchbay-core',
    'src-tauri/src',
    'src-tauri/permissions',
    'src-tauri/capabilities',
    'scripts',
  ];
  const paths = [
    'package.json',
    'package-lock.json',
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'LICENSE',
    'docs/distribution.md',
    'src-tauri/Cargo.toml',
    'src-tauri/build.rs',
    'src-tauri/tauri.conf.json',
    'src-tauri/installer-hooks.nsh',
  ].map((path) => join(root, path));
  for (const directory of directories) paths.push(...(await filesIn(join(root, directory))));
  return Promise.all(
    [...new Set(paths)].sort().map(async (path) => ({
      path: slash(relative(root, path)),
      sha256: sha256(await readFile(path)),
    })),
  );
}
