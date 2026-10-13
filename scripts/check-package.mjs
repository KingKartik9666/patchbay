import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, listPackage, statFile } from '@electron/asar';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const bundle = resolve(root, process.argv[2] || `release/Patchbay-${process.platform}-${process.arch}`);
const application = process.platform === 'darwin' ? join(bundle, 'Patchbay.app/Contents') : bundle;
const archive = join(application, process.platform === 'darwin' ? 'Resources/app.asar' : 'resources/app.asar');
async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(file, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unexpected non-file in renderer: ${file}`);
  }
  return files.sort();
}
const distFiles = await filesIn(join(root, 'dist'), 'dist');
const payload = ['LICENSE', 'electron/main.cjs', 'electron/preload.cjs', ...distFiles];
const hash = data => createHash('sha256').update(data).digest('hex');

const archivePaths = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\/+/, ''));
assert.ok(!archivePaths.some(name => name.split('/').includes('node_modules')), 'Development dependencies must not be packaged.');
const packagedDistFiles = archivePaths.filter(name => name.startsWith('dist/') && !statFile(archive, normalize(name)).files).sort();
assert.deepEqual(packagedDistFiles, distFiles, 'Packaged renderer must contain exactly the current recursive dist file set.');
assert.ok(distFiles.includes('dist/licenses/Nunito-OFL.txt'), 'The renderer must distribute the Nunito OFL license.');
assert.ok((await readFile(join(root, 'dist/licenses/Nunito-OFL.txt'))).equals(await readFile(join(root, 'public/licenses/Nunito-OFL.txt'))), 'Built Nunito license differs from its public source.');
for (const file of payload) {
  assert.equal(hash(extractFile(archive, normalize(file))), hash(await readFile(join(root, file))), `Stale packaged file: ${file}`);
}
const sourceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const packagedManifest = JSON.parse(extractFile(archive, 'package.json').toString());
for (const field of ['name', 'productName', 'version', 'main', 'license']) {
  assert.equal(packagedManifest[field], sourceManifest[field], `Stale packaged metadata: ${field}`);
}

async function folderSize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) total += await folderSize(file);
    else if (entry.isFile()) total += (await stat(file)).size;
  }
  return total;
}

const report = {
  version: packagedManifest.version,
  executable: relative(root, join(application, process.platform === 'win32' ? 'Patchbay.exe' : process.platform === 'darwin' ? 'MacOS/Patchbay' : 'Patchbay')),
  portableBytes: await folderSize(bundle),
  appArchiveBytes: (await stat(archive)).size,
  sourceMatchesPackage: true,
  rendererFileSetMatches: true,
  fontLicenseMatches: true,
  locales: process.platform === 'win32' ? await readdir(join(bundle, 'locales')) : [],
  payloadFiles: payload.length,
};
await mkdir(join(root, 'artifacts'), { recursive: true });
await writeFile(join(root, 'artifacts/package-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
