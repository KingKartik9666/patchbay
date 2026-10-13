import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const environment = { ...process.env, PATCHBAY_DEV_URL: 'http://127.0.0.1:5173/' };
delete environment.ELECTRON_RUN_AS_NODE;

const server = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
server.printUrls();

const desktop = spawn(electron, [root], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
let closing = false;

async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (desktop.exitCode === null) desktop.kill();
  await server.close();
  process.exitCode = code;
}

desktop.once('error', async (error) => {
  console.error('Could not launch Electron:', error.message);
  await close(1);
});
desktop.once('exit', (code) => { void close(code ?? 0); });
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
