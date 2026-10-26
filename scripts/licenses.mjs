import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cargo, root } from './process.mjs';
import { contained, json, sha256 } from './release.mjs';

export const noticesPath = join(root, '.cache/distribution/THIRD-PARTY-NOTICES.txt');
export async function generateNotices() {
  const metadata = JSON.parse(
    await cargo(
      [
        'metadata',
        '--format-version',
        '1',
        '--locked',
        '--offline',
        '--filter-platform',
        'x86_64-pc-windows-msvc',
      ],
      { capture: true },
    ),
  );
  const lock = await json(join(root, 'package-lock.json'));
  const fallbackDirectory = join(root, 'scripts/licenses');
  const fallbacks = await json(join(fallbackDirectory, 'provenance.json'));
  const packages = metadata.packages
    .filter((pkg) => !metadata.workspace_members.includes(pkg.id))
    .map((pkg) => ({
      name: `${pkg.name} ${pkg.version} (Rust)`,
      key: `${pkg.name}@${pkg.version}`,
      license: pkg.license,
      licenseFile: pkg.license_file,
      directory: dirname(pkg.manifest_path),
      source: pkg.repository ?? `https://crates.io/crates/${pkg.name}/${pkg.version}`,
      sourceCode: `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`,
    }));
  for (const [path, record] of Object.entries(lock.packages)) {
    if (!path || record.dev || record.devOptional) continue;
    const directory = join(root, path),
      manifest = await json(join(directory, 'package.json'));
    packages.push({
      name: `${manifest.name} ${manifest.version} (JavaScript)`,
      license: manifest.license,
      directory,
      source:
        manifest.homepage ?? `https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`,
    });
  }
  const sections = [
    'PATCHBAY THIRD-PARTY NOTICES\n\nThis conservative inventory includes JavaScript runtime packages and the locked Windows Rust dependency graph, including build tools. An entry does not imply that a component is separately shipped at runtime. License texts retain their upstream wording.\n',
  ];
  const missing = [];
  for (const pkg of packages.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const names = (await readdir(pkg.directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() && /^(licen[cs]e|copying|notice|copyright)(?:[._-]|$)/i.test(entry.name),
      )
      .map((entry) => entry.name);
    if (pkg.licenseFile && !names.includes(pkg.licenseFile)) names.push(pkg.licenseFile);
    sections.push(
      `\n${'='.repeat(72)}\n${pkg.name}\nLicense: ${pkg.license ?? 'see license text'}\nSource: ${pkg.source}\n`,
    );
    if (pkg.sourceCode) sections.push(`Source code for this version: ${pkg.sourceCode}\n`);
    for (const name of names.sort())
      sections.push(
        `\n--- ${name} ---\n${(await readFile(resolve(pkg.directory, name), 'utf8')).trim()}\n`,
      );
    if (!names.length) {
      const fallback = fallbacks[pkg.key];
      if (!fallback) {
        missing.push(pkg.name);
        continue;
      }
      // These published archives omit license files. Keep authentic upstream or
      // license-steward text locally, tied to the archive's exact VCS revision.
      const vcs = await json(join(pkg.directory, '.cargo_vcs_info.json'));
      assert.equal(
        vcs.git.sha1,
        fallback.revision,
        'License fallback revision differs: ' + pkg.name,
      );
      const text = await readFile(contained(fallbackDirectory, fallback.file));
      assert.equal(
        sha256(text),
        fallback.sha256,
        'Vendored license text changed: ' + fallback.file,
      );
      sections.push(
        `Selected license: ${fallback.license}\nLicense text source: ${fallback.url}\nSource revision: ${fallback.revision}\n\n--- ${fallback.file} ---\n${text.toString().trim()}\n`,
      );
    }
  }
  assert.deepEqual(
    missing,
    [],
    'Dependency license text is missing; inspect these packages before distributing.',
  );
  await mkdir(dirname(noticesPath), { recursive: true });
  await writeFile(noticesPath, sections.join(''));
  return noticesPath;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.includes('--help'))
    console.log(
      'Usage: node scripts/licenses.mjs\nGenerate local dependency notices from installed npm packages and the cached, locked Rust graph.',
    );
  else {
    assert.equal(process.argv.length, 2, 'Unexpected license command argument.');
    console.log(await generateNotices());
  }
}
