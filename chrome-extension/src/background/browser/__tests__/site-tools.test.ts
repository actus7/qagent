import { describe, expect, it } from 'vitest';
import { formatSiteTools, MAX_SITE_TOOLS, parseSiteToolList } from '../site-tools';

describe('parseSiteToolList', () => {
  it('keeps well-formed tools with their schema as JSON text', () => {
    const tools = parseSiteToolList([
      { name: 'add_item', description: 'Adds an item', inputSchema: { type: 'object' } },
    ]);
    expect(tools).toEqual([{ name: 'add_item', description: 'Adds an item', inputSchema: '{"type":"object"}' }]);
  });

  it('drops entries without a valid tool name', () => {
    const tools = parseSiteToolList([{ name: 'bad name!' }, { description: 'no name' }, null, 'text']);
    expect(tools).toEqual([]);
  });

  it('clips long descriptions and caps the number of tools', () => {
    const long = { name: 'tool', description: 'x'.repeat(1000) };
    expect(parseSiteToolList([long])[0].description).toHaveLength(300);
    const many = Array.from({ length: MAX_SITE_TOOLS + 10 }, (_, i) => ({ name: `tool_${i}` }));
    expect(parseSiteToolList(many)).toHaveLength(MAX_SITE_TOOLS);
  });

  it('returns nothing when the list is not an array', () => {
    expect(parseSiteToolList({ tools: [] })).toEqual([]);
  });
});

describe('formatSiteTools', () => {
  it('lists each tool on its own line with its schema', () => {
    const text = formatSiteTools([{ name: 'add_item', description: 'Adds', inputSchema: '{}' }]);
    expect(text).toBe('- add_item: Adds | input {}');
  });
});
