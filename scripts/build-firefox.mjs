// Builds the Firefox extension into dist-firefox/ so it can sit next to the Chrome build in dist/.
// The workspace build always writes dist/, so the Chrome build is parked aside and restored afterwards.
// Usage: node scripts/build-firefox.mjs [--zip]
import { existsSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DIST = 'dist';
const FIREFOX_DIST = 'dist-firefox';
const PARKED_CHROME = '.dist-chrome-parked';
const zip = process.argv.includes('--zip');

function run(command) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, __FIREFOX__: 'true' } });
  if (result.status !== 0) throw new Error(`"${command}" failed with exit code ${result.status}`);
}

rmSync(PARKED_CHROME, { recursive: true, force: true });
const hadChrome = existsSync(DIST);
if (hadChrome) renameSync(DIST, PARKED_CHROME);
try {
  run('pnpm build');
  if (zip) run('pnpm -F zipper zip');
  rmSync(FIREFOX_DIST, { recursive: true, force: true });
  renameSync(DIST, FIREFOX_DIST);
  console.log(`Firefox build ready in ${FIREFOX_DIST}/ (load ${FIREFOX_DIST}/manifest.json in about:debugging).`);
} finally {
  // Never lose the Chrome build, even when the Firefox build fails.
  if (hadChrome) {
    rmSync(DIST, { recursive: true, force: true });
    renameSync(PARKED_CHROME, DIST);
  }
}
