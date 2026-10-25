import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MCP_BRIDGE_MIN_TOKEN_LENGTH } from './protocol';

/** Directory holding config.json. QAGENT_HOME overrides ~/.qagent. */
export function stateDirFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.QAGENT_HOME?.trim() || join(homedir(), '.qagent');
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDirFrom(env), 'config.json');
}

function readStored(env: NodeJS.ProcessEnv): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(configFilePath(env), 'utf8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    // A missing or unreadable file means no stored token; pairing creates one.
    return {};
  }
}

function writeStored(env: NodeJS.ProcessEnv, stored: Record<string, unknown>): void {
  mkdirSync(stateDirFrom(env), { recursive: true });
  // Owner-only where the OS honours it. The token authorises local control of the browser.
  writeFileSync(configFilePath(env), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** The shared token: QAGENT_MCP_TOKEN wins, then the stored one. Null when nothing usable is configured. */
export function readToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.QAGENT_MCP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const stored = readStored(env).token;
  return typeof stored === 'string' && stored.length >= MCP_BRIDGE_MIN_TOKEN_LENGTH ? stored : null;
}

/** Returns the configured token, creating and storing one when none exists. */
export function ensureToken(env: NodeJS.ProcessEnv = process.env): { token: string; created: boolean } {
  const existing = readToken(env);
  if (existing) return { token: existing, created: false };
  const token = generateToken();
  writeStored(env, { ...readStored(env), token });
  return { token, created: true };
}

/** Replaces the stored token. Running daemons and paired extensions must be updated to the new value. */
export function rotateToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = generateToken();
  writeStored(env, { ...readStored(env), token });
  return token;
}
