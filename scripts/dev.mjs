// Dev mode: starts the BrowserManager companion (unless one is already listening) and the watch build
// with extension auto-reload. Plain Node so it runs the same from PowerShell, cmd or any shell.
// Usage: node scripts/dev.mjs
import { createWriteStream, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

// Run from the repo root wherever it was started, as the shell script did; the log path and pnpm scripts depend on it.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const COMPANION_PORT = Number(process.env.AGENT_BROWSER_WS_PORT ?? 9223);
const LOG_DIR = '.logs';
const COMPANION_LOG = `${LOG_DIR}/companion.log`;

function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// shell: true wraps the command in cmd.exe on Windows, so kill the whole tree, not just the shell.
function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

let companion;
if (await isPortOpen(COMPANION_PORT)) {
  console.log(`[dev] BrowserManager companion already running on ws://127.0.0.1:${COMPANION_PORT}`);
} else {
  console.log(`[dev] Starting BrowserManager companion on ws://127.0.0.1:${COMPANION_PORT}`);
  console.log(`[dev] Companion logs: ${COMPANION_LOG}`);
  mkdirSync(LOG_DIR, { recursive: true });
  const log = createWriteStream(COMPANION_LOG);
  companion = spawn('pnpm companion:agent-browser', { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  companion.stdout.pipe(log);
  companion.stderr.pipe(log);
}

const watch = spawn('pnpm dev:watch', { shell: true, stdio: 'inherit' });
const stop = () => {
  if (companion) killTree(companion);
  killTree(watch);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
watch.on('exit', code => {
  if (companion) killTree(companion);
  process.exit(code ?? 0);
});
