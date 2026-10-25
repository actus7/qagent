// Last-known browser action list, kept next to config.json so `qagent mcp` can list page_* tools before the extension connects.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDirFrom } from './config';
import { isActionCatalogEntry, type ActionCatalogEntry } from './tools';

const TOOLS_CACHE_FILE = 'tools-cache.json';

export function toolsCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDirFrom(env), TOOLS_CACHE_FILE);
}

/** Parses cache text. Anything malformed yields null: the file is data from disk and is never trusted. */
export function parseToolsCache(text: string): ActionCatalogEntry[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const actions = (value as { actions?: unknown } | null)?.actions;
  return Array.isArray(actions) && actions.every(isActionCatalogEntry) ? actions : null;
}

/** Reads the cache. A missing or unreadable file means no cache yet, like a malformed one. */
export function readToolsCache(env: NodeJS.ProcessEnv = process.env): ActionCatalogEntry[] | null {
  try {
    return parseToolsCache(readFileSync(toolsCachePath(env), 'utf8'));
  } catch {
    return null;
  }
}

export function writeToolsCache(entries: ActionCatalogEntry[], env: NodeJS.ProcessEnv = process.env): void {
  mkdirSync(stateDirFrom(env), { recursive: true });
  writeFileSync(toolsCachePath(env), `${JSON.stringify({ actions: entries }, null, 2)}\n`);
}
