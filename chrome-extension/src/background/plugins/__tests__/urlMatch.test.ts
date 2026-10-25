import { describe, expect, it } from 'vitest';
import { matchesUrlGlob, pluginAppliesToUrl } from '../urlMatch';
import type { BrowserPlugin } from '@extension/storage';

const plugin = (overrides: Partial<BrowserPlugin>): BrowserPlugin => ({
  id: 'p1',
  name: 'P',
  description: '',
  version: '1.0.0',
  enabled: true,
  matches: [],
  instructions: '',
  tools: [],
  createdBy: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('matchesUrlGlob', () => {
  it('matches a host glob against the hostname only', () => {
    expect(matchesUrlGlob('example.com', 'https://example.com/any/path?q=1')).toBe(true);
    expect(matchesUrlGlob('example.com', 'https://other.com/')).toBe(false);
  });

  it('matches wildcard host globs', () => {
    expect(matchesUrlGlob('*.example.com', 'https://api.example.com/x')).toBe(true);
    expect(matchesUrlGlob('*.example.com', 'https://example.org/x')).toBe(false);
  });

  it('matches a full URL glob with a scheme', () => {
    expect(matchesUrlGlob('https://shop.test/cart*', 'https://shop.test/cart/42')).toBe(true);
    expect(matchesUrlGlob('https://shop.test/cart*', 'http://shop.test/cart/42')).toBe(false);
  });

  it('matches host and path without a scheme when the glob contains a slash', () => {
    expect(matchesUrlGlob('shop.test/checkout/*', 'https://shop.test/checkout/step-2')).toBe(true);
    expect(matchesUrlGlob('shop.test/checkout/*', 'https://shop.test/cart')).toBe(false);
  });

  it('treats regex characters in the glob as literals', () => {
    expect(matchesUrlGlob('a.b.com', 'https://axb.com/')).toBe(false);
  });

  it('never matches an empty glob or an unparseable URL', () => {
    expect(matchesUrlGlob('   ', 'https://example.com/')).toBe(false);
    expect(matchesUrlGlob('example.com', 'not a url')).toBe(false);
  });
});

describe('pluginAppliesToUrl', () => {
  it('applies to every site when matches is empty', () => {
    expect(pluginAppliesToUrl(plugin({ matches: [] }), 'https://anything.dev/')).toBe(true);
  });

  it('applies when any glob matches', () => {
    const scoped = plugin({ matches: ['a.com', 'b.com'] });
    expect(pluginAppliesToUrl(scoped, 'https://b.com/x')).toBe(true);
    expect(pluginAppliesToUrl(scoped, 'https://c.com/x')).toBe(false);
  });

  it('never applies when disabled', () => {
    expect(pluginAppliesToUrl(plugin({ enabled: false, matches: [] }), 'https://a.com/')).toBe(false);
  });
});
