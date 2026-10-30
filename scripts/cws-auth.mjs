// One-time setup for publishing to the Chrome Web Store: asks for the extension ID and the
// OAuth client, opens Google's consent page, and saves the refresh token it returns.
// Everything goes to ~/.qagent/cws.json, outside the repository. Run it in your own terminal:
//   node scripts/cws-auth.mjs
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CONFIG_DIR = join(homedir(), '.qagent');
const CWS_CONFIG = join(CONFIG_DIR, 'cws.json');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async question => (await rl.question(question)).trim();

const extensionId = await ask('ID da extensão (Developer Dashboard, 32 letras): ');
const clientId = await ask('OAuth Client ID (termina em .apps.googleusercontent.com): ');
const clientSecret = await ask('OAuth Client secret: ');
rl.close();
if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('O ID da extensão tem 32 letras de a até p.');
if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error('Client ID inválido.');
if (!clientSecret) throw new Error('Client secret vazio.');

// Google sends the consent result to this one-shot local server.
const code = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const received = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!received && !error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(received ? '<h2>Pronto. Pode fechar esta aba e voltar ao terminal.</h2>' : `<h2>Erro: ${error}</h2>`);
    server.close();
    if (received) resolve({ value: received, redirectUri: `http://127.0.0.1:${server.address().port}` });
    else reject(new Error(`Autorização recusada: ${error}`));
  });
  server.listen(0, '127.0.0.1', () => {
    const redirectUri = `http://127.0.0.1:${server.address().port}`;
    const consent = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
    })}`;
    console.log('\nAbrindo o navegador para você autorizar. Se não abrir, copie este link:\n');
    console.log(consent, '\n');
    if (process.platform === 'win32') spawn('explorer.exe', [consent], { detached: true, stdio: 'ignore' }).unref();
  });
});

const response = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code: code.value,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: code.redirectUri,
    grant_type: 'authorization_code',
  }),
});
const body = await response.json();
if (!response.ok || !body.refresh_token) {
  throw new Error(`Não recebi o refresh token (${response.status}): ${body.error ?? 'sem detalhe'}`);
}

mkdirSync(CONFIG_DIR, { recursive: true });
writeFileSync(
  CWS_CONFIG,
  `${JSON.stringify({ extensionId, clientId, clientSecret, refreshToken: body.refresh_token }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(`Credenciais salvas em ${CWS_CONFIG}. Agora rode: node scripts/publish-cws.mjs`);
