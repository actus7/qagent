import { describe, expect, it } from 'vitest';
import { buildToolScript, checkToolArgs } from '../runner';
import type { PluginTool } from '@extension/storage';

const tool: PluginTool = {
  name: 'collect_prices',
  description: 'Collect prices',
  parameters: {
    limit: { type: 'number', required: false },
    selector: { type: 'string', required: true },
  },
  code: 'return args.limit ?? 10;',
};

describe('checkToolArgs', () => {
  it('accepts arguments that match the declared types and returns only declared keys', () => {
    expect(checkToolArgs(tool, { selector: '.price', limit: 5 })).toEqual({
      ok: true,
      args: { selector: '.price', limit: 5 },
    });
  });

  it('reports a missing required argument', () => {
    expect(checkToolArgs(tool, { limit: 5 })).toEqual({ ok: false, error: 'missing required argument "selector"' });
  });

  it('reports a wrong type, including null', () => {
    expect(checkToolArgs(tool, { selector: null })).toEqual({
      ok: false,
      error: 'argument "selector" must be a string',
    });
    expect(checkToolArgs(tool, { selector: 'x', limit: '5' })).toEqual({
      ok: false,
      error: 'argument "limit" must be a number',
    });
  });

  it('rejects unknown keys and non-object args', () => {
    expect(checkToolArgs(tool, { selector: 'x', extra: 1 })).toEqual({ ok: false, error: 'unknown argument "extra"' });
    expect(checkToolArgs(tool, ['x'])).toEqual({ ok: false, error: 'args must be an object' });
    expect(checkToolArgs(tool, undefined)).toEqual({ ok: false, error: 'args must be an object' });
  });
});

describe('buildToolScript', () => {
  it('wraps the tool body in an async function called with the JSON args', () => {
    const script = buildToolScript(tool, { selector: '.price' });
    expect(script).toBe('(async (args) => {\nreturn args.limit ?? 10;\n})({"selector":".price"})');
  });
});
