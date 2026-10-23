import { describe, expect, it } from 'vitest';
import { normalizeSiteOrigin } from '@extension/storage';

// The persisted store (sitePermissionsStore) is exercised end to end in e2e/extension.test.mjs,
// because the storage package does not pick up a stubbed chrome.storage under Vitest.
describe('site origin normalization', () => {
  it.each([
    ['https://Example.com/path?q=1', 'https://example.com'],
    ['http://example.com:8080/', 'http://example.com:8080'],
    ['example.com', 'https://example.com'],
    ['  https://shop.example.com/cart  ', 'https://shop.example.com'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSiteOrigin(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'chrome://settings',
    'data:text/html,hi',
    'https://',
  ])('rejects %s', input => {
    expect(normalizeSiteOrigin(input)).toBeNull();
  });
});
