import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  await access(new URL('../dist/index.html', import.meta.url));
} catch {
  console.error('Build Patchbay first with npm run build, then run npm start.');
  process.exit(1);
}

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.PATCHBAY_DEV_URL;
const desktop = spawn(electron, [root], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
desktop.once('error', (error) => {
  console.error('Could not launch Electron:', error.message);
  process.exitCode = 1;
});
desktop.once('exit', (code) => { process.exitCode = code ?? 0; });
process.once('SIGINT', () => desktop.kill());
process.once('SIGTERM', () => desktop.kill());
