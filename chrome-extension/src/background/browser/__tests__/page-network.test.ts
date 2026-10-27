import { describe, expect, it } from 'vitest';
import { isIgnoredUrl } from '../page-network';

describe('isIgnoredUrl', () => {
  it('ignores analytics and heartbeat requests', () => {
    expect(isIgnoredUrl('https://www.google-analytics.com/collect')).toBe(true);
    expect(isIgnoredUrl('https://app.example.com/api/ping')).toBe(true);
    expect(isIgnoredUrl('https://connect.facebook.com/plugins/like.php')).toBe(true);
  });

  it('does not ignore URLs that only contain a pattern inside a word', () => {
    expect(isIgnoredUrl('https://shop.example.com/shopping/cart')).toBe(false);
    expect(isIgnoredUrl('https://example.com/mapping/api')).toBe(false);
  });

  it('does not ignore first-party assets served from a CDN', () => {
    expect(isIgnoredUrl('https://d1234.cloudfront.net/app.js')).toBe(false);
  });
});
