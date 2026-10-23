import { describe, expect, it } from 'vitest';
import { isUrlAllowed } from '../util';

describe('isUrlAllowed', () => {
  it('blocks a trailing-dot hostname that would bypass a deny entry', () => {
    expect(isUrlAllowed('https://evil.com./path', [], ['evil.com'])).toBe(false);
    expect(isUrlAllowed('https://sub.evil.com./', [], ['evil.com'])).toBe(false);
  });

  it('normalizes list entries: case, scheme, leading wildcard and www prefixes', () => {
    expect(isUrlAllowed('https://Shop.Example.com/', ['  *.EXAMPLE.com  '], [])).toBe(true);
    expect(isUrlAllowed('https://example.com/', ['https://www.example.com'], [])).toBe(true);
    expect(isUrlAllowed('https://other.org/', ['example.com'], [])).toBe(false);
  });

  it('only allows http, https and about:blank schemes', () => {
    expect(isUrlAllowed('ftp://example.com/', [], [])).toBe(false);
    expect(isUrlAllowed('view-source:https://example.com/', [], [])).toBe(false);
    expect(isUrlAllowed('blob:https://example.com/uuid', [], [])).toBe(false);
    expect(isUrlAllowed('about:blank', ['example.com'], [])).toBe(true);
    expect(isUrlAllowed('https://example.com/', [], [])).toBe(true);
  });

  it('keeps blocking the chrome web store even with the firewall disabled', () => {
    expect(isUrlAllowed('https://chromewebstore.google.com/', [], [])).toBe(false);
  });
});
