import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToolsCache, readToolsCache, toolsCachePath, writeToolsCache } from './tools-cache';

const ENTRY = { name: 'click', description: 'Click an element', inputSchema: { type: 'object', properties: {} } };

function tempEnv(): NodeJS.ProcessEnv {
  return { QAGENT_HOME: mkdtempSync(join(tmpdir(), 'qagent-cache-')) };
}

describe('tools cache', () => {
  it('returns the same action list it was written with', () => {
    const env = tempEnv();
    writeToolsCache([ENTRY], env);
    assert.deepEqual(readToolsCache(env), [ENTRY]);
  });

  it('writes next to config.json inside the state directory', () => {
    const env = tempEnv();
    writeToolsCache([ENTRY], env);
    const written = JSON.parse(readFileSync(toolsCachePath(env), 'utf8')) as { actions: unknown[] };
    assert.equal(toolsCachePath(env).endsWith('tools-cache.json'), true);
    assert.equal(written.actions.length, 1);
  });

  it('returns null when no cache file exists yet', () => {
    assert.equal(readToolsCache(tempEnv()), null);
  });

  it('rejects text that is not JSON', () => {
    assert.equal(parseToolsCache('{not json'), null);
  });

  it('rejects a cache without an actions array', () => {
    assert.equal(parseToolsCache(JSON.stringify({ tools: [ENTRY] })), null);
    assert.equal(parseToolsCache('null'), null);
    assert.equal(parseToolsCache('"actions"'), null);
  });

  it('rejects the whole cache when one entry is malformed', () => {
    const text = JSON.stringify({ actions: [ENTRY, { name: 42, description: 'bad', inputSchema: {} }] });
    assert.equal(parseToolsCache(text), null);
  });

  it('ignores a malformed file on disk instead of throwing', () => {
    const env = tempEnv();
    writeFileSync(toolsCachePath(env), '{"actions": [{"name": 1}]}');
    assert.equal(readToolsCache(env), null);
  });
});
