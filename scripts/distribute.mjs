import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This verified distribution target is Windows x64.');
const environment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
delete environment.CSC_LINK; delete environment.WIN_CSC_LINK; delete environment.CSC_KEY_PASSWORD; delete environment.WIN_CSC_KEY_PASSWORD;
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
for (const key of ['CSC_LINK','WIN_CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_KEY_PASSWORD']) delete process.env[key];
process.env.ELECTRON_BUILDER_CACHE = process.env.ELECTRON_BUILDER_CACHE || join(root, '.cache/electron-builder');
const { build, Platform, Arch } = await import('electron-builder');
function run(script) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, script)], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`${script} exited ${code}`)));
  });
}
await run('scripts/check-bundle.mjs');
await run('scripts/package.mjs');
await run('scripts/check-package.mjs');
await build({ projectDir: root, prepackaged: join(root, 'release/Patchbay-win32-x64'),
  targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64), config: require('../electron-builder.cjs'), publish: 'never' });
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'release/distributables'); await mkdir(output, { recursive: true });
await writeFile(join(output, 'README.txt'), (await readFile(join(root, 'docs/distribution.md'), 'utf8')).replaceAll('@VERSION@', manifest.version));
const files = [];
for (const name of [`Patchbay-${manifest.version}-Setup-x64.exe`, `Patchbay-${manifest.version}-Windows-x64.zip`, 'README.txt']) {
  const data = await readFile(join(output, name)); files.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(join(output, 'SHA256SUMS.txt'), files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
await writeFile(join(output, 'release.json'), JSON.stringify({ version: manifest.version, platform: 'win32', arch: 'x64', signed: false, files }, null, 2));
console.log(JSON.stringify({ output, version: manifest.version, files }, null, 2));
