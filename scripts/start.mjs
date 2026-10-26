import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { cargo, run } from './process.mjs';

if (process.argv.includes('--help')) {
  console.log(
    'Usage: npm start [-- --debug]\nLaunch the existing target/release/Patchbay.exe (or debug build with --debug). Build first with npm run desktop:build or npm run desktop:debug.',
  );
} else {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (args.length === 1 && args[0] === '--debug'),
    'Only --debug is supported.',
  );
  const metadata = JSON.parse(
    await cargo(['metadata', '--no-deps', '--format-version', '1', '--locked', '--offline'], {
      capture: true,
    }),
  );
  const executable = join(
    metadata.target_directory,
    args.includes('--debug') ? 'debug' : 'release',
    process.platform === 'win32' ? 'Patchbay.exe' : 'Patchbay',
  );
  try {
    await access(executable);
  } catch {
    throw new Error(
      `Build Patchbay first: npm run desktop:${args.includes('--debug') ? 'debug' : 'build'}`,
    );
  }
  await run(executable, []);
}
