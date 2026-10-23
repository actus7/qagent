import { describe, expect, it } from 'vitest';
import {
  MAX_READ_LIMIT,
  RingBuffer,
  filterConsoleEntries,
  filterNetworkEntries,
  formatConsoleEntries,
  formatNetworkEntries,
  redactUrl,
  toConsoleLevel,
  truncateText,
  type ConsoleEntry,
  type NetworkEntry,
} from '../page-telemetry';

function consoleEntry(level: ConsoleEntry['level'], text: string, timestamp = 0): ConsoleEntry {
  return { level, text, timestamp };
}

function networkEntry(url: string, overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    method: 'GET',
    url,
    resourceType: 'fetch',
    status: 200,
    mimeType: 'application/json',
    failure: null,
    durationMs: 5,
    startedAt: 0,
    ...overrides,
  };
}

describe('RingBuffer', () => {
  it('keeps only the most recent items once full', () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach(n => buffer.push(n));
    expect(buffer.toArray()).toEqual([3, 4, 5]);
  });

  it('returns a copy and clears on demand', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.toArray().push(99);
    expect(buffer.toArray()).toEqual([1]);
    buffer.clear();
    expect(buffer.toArray()).toEqual([]);
  });
});

describe('redactUrl', () => {
  it('strips userinfo and the fragment', () => {
    expect(redactUrl('https://alice:hunter2@example.com/path#frag')).toBe('https://example.com/path');
  });

  it('redacts query values whose names look sensitive and keeps the rest', () => {
    const redacted = redactUrl('https://api.test/items?page=2&access_token=abc&apiKey=xyz&sig=111&design=blue');
    const params = new URL(redacted).searchParams;
    expect(params.get('page')).toBe('2');
    expect(params.get('access_token')).toBe('REDACTED');
    expect(params.get('apiKey')).toBe('REDACTED');
    expect(params.get('sig')).toBe('REDACTED');
    expect(params.get('design')).toBe('blue');
  });

  it('redacts password, session and secret parameters', () => {
    const redacted = redactUrl('https://x.test/?password=p&session=s&client_secret=c');
    expect(redacted).not.toContain('=p');
    expect(redacted).not.toContain('=s&');
    expect(redacted).not.toContain('=c');
  });

  it('omits data URLs and reports unparseable input', () => {
    expect(redactUrl('data:text/plain;base64,AAAA')).toBe('data:[omitted]');
    expect(redactUrl('not a url')).toBe('[unparseable url]');
  });
});

describe('console helpers', () => {
  it('maps puppeteer console types to the levels the model can filter on', () => {
    expect(toConsoleLevel('warn')).toBe('warning');
    expect(toConsoleLevel('assert')).toBe('error');
    expect(toConsoleLevel('verbose')).toBe('debug');
    expect(toConsoleLevel('table')).toBe('log');
  });

  it('filters by level and case-insensitive pattern, returning the latest matches', () => {
    const entries = [
      consoleEntry('error', 'Boom one'),
      consoleEntry('log', 'boom two'),
      consoleEntry('error', 'other'),
      consoleEntry('error', 'BOOM three'),
    ];
    expect(filterConsoleEntries(entries, { level: 'error', pattern: 'boom' }).map(e => e.text)).toEqual([
      'Boom one',
      'BOOM three',
    ]);
    expect(filterConsoleEntries(entries, { limit: 2 }).map(e => e.text)).toEqual(['other', 'BOOM three']);
  });

  it('caps the requested limit', () => {
    const many = Array.from({ length: 300 }, (_, i) => consoleEntry('log', `m${i}`));
    expect(filterConsoleEntries(many, { limit: 10_000 })).toHaveLength(MAX_READ_LIMIT);
  });

  it('truncates long text', () => {
    expect(truncateText('abcdef', 3)).toBe('abc...');
    expect(truncateText('abc', 3)).toBe('abc');
  });

  it('formats entries with level and clock time', () => {
    const line = formatConsoleEntries([consoleEntry('error', 'boom', Date.UTC(2026, 0, 1, 10, 20, 30))]);
    expect(line).toBe('10:20:30 [error] boom');
  });
});

describe('network helpers', () => {
  const entries = [
    networkEntry('https://a.test/ok'),
    networkEntry('https://a.test/missing', { status: 404 }),
    networkEntry('https://b.test/down', { status: null, failure: 'net::ERR_CONNECTION_REFUSED' }),
    networkEntry('https://b.test/pending', { status: null }),
  ];

  it('keeps only failed requests when onlyFailed is set', () => {
    expect(filterNetworkEntries(entries, { onlyFailed: true }).map(e => e.url)).toEqual([
      'https://a.test/missing',
      'https://b.test/down',
    ]);
  });

  it('filters by URL pattern', () => {
    expect(filterNetworkEntries(entries, { urlPattern: 'B.TEST' })).toHaveLength(2);
  });

  it('formats failures and statuses', () => {
    const text = formatNetworkEntries(entries.slice(1, 3));
    expect(text).toContain('GET https://a.test/missing -> 404');
    expect(text).toContain('FAILED (net::ERR_CONNECTION_REFUSED)');
  });
});
