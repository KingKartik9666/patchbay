import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'release');
await access(join(root, 'dist', 'index.html')).catch(() => {
  throw new Error('Build Patchbay with npm run build before packaging it.');
});
const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const staging = await mkdtemp(join(tmpdir(), 'patchbay-package-'));

try {
  // Only the compiled renderer and tiny main/preload files belong in the desktop bundle.
  await cp(join(root, 'dist'), join(staging, 'dist'), { recursive: true });
  await cp(join(root, 'electron'), join(staging, 'electron'), { recursive: true });
  await cp(join(root, 'LICENSE'), join(staging, 'LICENSE'));
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name: 'patchbay',
    productName: 'Patchbay',
    version: source.version,
    description: source.description || 'A Mealy and Moore machine workbench',
    author: source.author || 'Patchbay',
    main: 'electron/main.cjs',
    license: source.license || 'UNLICENSED',
  }, null, 2));

  const bundles = await packager({
    dir: staging,
    out: output,
    name: 'Patchbay',
    executableName: 'Patchbay',
    platform: process.platform,
    arch: process.arch,
    electronVersion: require('electron/package.json').version,
    asar: true,
    overwrite: true,
    prune: false,
    appCategoryType: 'public.app-category.education',
    win32metadata: {
      CompanyName: 'Patchbay',
      FileDescription: 'Mealy and Moore machine workbench',
      ProductName: 'Patchbay',
    },
  });
  for (const bundle of bundles) {
    const absoluteBundle = resolve(bundle);
    if (!absoluteBundle.startsWith(resolve(output) + sep)) throw new Error('Unexpected package output path.');
    await cp(join(root, 'LICENSE'), join(absoluteBundle, 'PATCHBAY-LICENSE.txt'));
    await cp(join(root, 'public/licenses'), join(absoluteBundle, 'licenses'), { recursive: true });
    await writeFile(join(absoluteBundle, 'README.txt'), (await readFile(join(root, 'docs/distribution.md'), 'utf8')).replaceAll('@VERSION@', source.version));
    if (process.platform === 'win32') {
      // The interface is English. Keep its Chromium locale and remove only unused
      // locale files from this freshly generated package, preserving the runtime.
      const locales = join(absoluteBundle, 'locales');
      await access(join(locales, 'en-US.pak'));
      for (const entry of await readdir(locales, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.pak') && entry.name !== 'en-US.pak') {
          const target = resolve(locales, entry.name);
          if (!target.startsWith(absoluteBundle + sep)) throw new Error('Unexpected locale path.');
          await rm(target);
        }
      }
    }
    console.log(`Packaged Patchbay: ${absoluteBundle}`);
  }
} finally {
  // The deletion target is the exact temporary child created above, never the project.
  const temporaryRoot = resolve(tmpdir()) + sep;
  const absoluteStaging = resolve(staging);
  if (absoluteStaging.startsWith(temporaryRoot) && absoluteStaging.slice(temporaryRoot.length).startsWith('patchbay-package-')) {
    await rm(absoluteStaging, { recursive: true, force: true });
  }
}
