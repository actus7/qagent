// Uploads the newest dist-zip/*.zip to the Chrome Web Store and submits it for review.
// Credentials come from ~/.qagent/cws.json (written by scripts/cws-auth.mjs) or, in CI, from the
// environment: CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN. Never from the repo.
// Usage: node scripts/publish-cws.mjs [--upload-only]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ZIP_DIR = join(ROOT, 'dist-zip');
const CONFIG_FILE = join(homedir(), '.qagent', 'cws.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com';
const REQUIRED = ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];

function credentials() {
  if (REQUIRED.every(name => process.env[name])) {
    return Object.fromEntries(REQUIRED.map(name => [name, process.env[name]]));
  }
  if (!existsSync(CONFIG_FILE)) {
    console.error(`No credentials: run "node scripts/cws-auth.mjs" first, or set ${REQUIRED.join(', ')}.`);
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  return {
    CWS_EXTENSION_ID: saved.extensionId,
    CWS_CLIENT_ID: saved.clientId,
    CWS_CLIENT_SECRET: saved.clientSecret,
    CWS_REFRESH_TOKEN: saved.refreshToken,
  };
}
const env = credentials();
const isUploadOnly = process.argv.includes('--upload-only');

function newestZip() {
  const zips = readdirSync(ZIP_DIR)
    .filter(name => name.endsWith('.zip'))
    .map(name => ({ path: join(ZIP_DIR, name), mtime: statSync(join(ZIP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (zips.length === 0) throw new Error(`No zip in ${ZIP_DIR}: run pnpm zip first`);
  return zips[0].path;
}

async function accessToken() {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const body = await response.json();
  // The error body names the OAuth error only; it never carries the secrets sent.
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status}): ${body.error ?? 'unknown'}`);
  return body.access_token;
}

async function call(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(json)}`);
  return json;
}

const zip = newestZip();
console.log(`Uploading ${zip}`);
const token = await accessToken();
const id = encodeURIComponent(env.CWS_EXTENSION_ID);

const upload = await call('PUT', `/upload/chromewebstore/v1.1/items/${id}`, token, readFileSync(zip));
if (upload.uploadState !== 'SUCCESS') {
  console.error('Upload was not accepted:', JSON.stringify(upload.itemError ?? upload));
  process.exit(1);
}
console.log('Upload accepted.');

if (isUploadOnly) {
  console.log('Upload only: submit it for review from the Developer Dashboard.');
} else {
  const published = await call('POST', `/chromewebstore/v1.1/items/${id}/publish`, token);
  console.log(`Submitted for review: ${JSON.stringify(published.status ?? published)}`);
}
