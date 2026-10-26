import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
// rustup's standard installation directory is not always inherited by desktop terminals.
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
export const environment = {
  ...process.env,
  [pathKey]: [
    join(homedir(), '.cargo', 'bin'),
    dirname(process.execPath),
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')
      : null,
    process.env[pathKey],
  ]
    .filter(Boolean)
    .join(delimiter),
};

export function run(command, args, { capture = false } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    if (capture)
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        output += chunk;
      });
    const stop = () => child.kill();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('error', fail);
    child.once('close', (code, signal) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (code === 0) done(output);
      else fail(new Error(`${command} exited with ${signal ?? code}.`));
    });
  });
}

export const cargo = (args, options) => run(process.env.CARGO || 'cargo', args, options);
export const tauri = (args) =>
  run(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...args]);
export const nodeScript = (name) => run(process.execPath, [join(root, 'scripts', name)]);
