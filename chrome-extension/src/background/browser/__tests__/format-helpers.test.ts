import { describe, expect, it } from 'vitest';
import { ariaStateFlags, formatAriaState } from '../dom/aria-state';
import { formatPageInfo, type PageFacts } from '../page-info';
import { formatProgressReport, parsePercentText, ariaRangePercent, rankProgressSignals } from '../progress';

describe('ariaStateFlags', () => {
  it('reads native and ARIA disabled the same way', () => {
    expect(ariaStateFlags({ disabled: '' }, 'button')).toEqual(['disabled']);
    expect(ariaStateFlags({ 'aria-disabled': 'true' }, 'div')).toEqual(['disabled']);
  });

  it('maps expanded and collapsed, and ignores explicit false for other flags', () => {
    expect(ariaStateFlags({ 'aria-expanded': 'true' }, 'button')).toEqual(['expanded']);
    expect(ariaStateFlags({ 'aria-expanded': 'false' }, 'button')).toEqual(['collapsed']);
    expect(ariaStateFlags({ 'aria-pressed': 'false' }, 'button')).toEqual([]);
  });

  it('reads a native checked input and a mixed ARIA checkbox', () => {
    expect(ariaStateFlags({ checked: '' }, 'input')).toEqual(['checked']);
    expect(ariaStateFlags({ 'aria-checked': 'mixed' }, 'div')).toEqual(['mixed']);
  });

  it('returns nothing for an element without state attributes', () => {
    expect(ariaStateFlags({ href: '/x' }, 'a')).toEqual([]);
  });
});

describe('formatAriaState', () => {
  it('renders one compact token, or nothing', () => {
    expect(formatAriaState(['disabled', 'expanded'])).toBe('state=disabled,expanded');
    expect(formatAriaState([])).toBe('');
  });
});

describe('progress helpers', () => {
  it('parses a percent out of text and clamps it', () => {
    expect(parsePercentText('Uploading 42%')).toBe(42);
    expect(parsePercentText('Done 150 %')).toBe(100);
    expect(parsePercentText('no number')).toBeUndefined();
  });

  it('converts an ARIA range and rejects an empty range', () => {
    expect(ariaRangePercent(25, 0, 100)).toBe(25);
    expect(ariaRangePercent(5, 10, 10)).toBeUndefined();
  });

  it('ranks percent signals above bare spinners and drops duplicates', () => {
    const ranked = rankProgressSignals(
      [
        { kind: 'spinner', label: 'div.spinner' },
        { kind: 'progressbar', label: 'div#bar', percent: 40 },
        { kind: 'progressbar', label: 'div#bar', percent: 40 },
      ],
      10,
    );
    expect(ranked.map(signal => signal.kind)).toEqual(['progressbar', 'spinner']);
  });

  it('says so when nothing measurable is on the page', () => {
    expect(formatProgressReport({ signals: [] })).toMatch(/No progress signal found/);
  });

  it('formats a percent signal with its label', () => {
    const text = formatProgressReport({ signals: [{ kind: 'progressbar', label: 'div#bar', percent: 39.6 }] });
    expect(text).toBe('- progressbar div#bar 40%');
  });
});

describe('formatPageInfo', () => {
  const facts: PageFacts = {
    url: 'https://example.com/',
    title: 'Example',
    description: '',
    landmarks: [
      { role: 'navigation', label: 'Primary', depth: 0 },
      { role: 'main', label: '', depth: 0 },
    ],
    headings: {
      total: 3,
      items: [
        { level: 1, text: 'Welcome' },
        { level: 2, text: 'News' },
      ],
    },
    inventory: {
      links: {
        total: 40,
        items: [
          {
            label: 'Home',
            role: 'link',
            tag: 'a',
            region: 'navigation "Primary"',
            attributes: { 'aria-expanded': 'true' },
          },
        ],
      },
      buttons: { total: 0, items: [] },
      fields: { total: 0, items: [] },
      forms: { total: 0, items: [] },
    },
  };

  it('keeps the true total while listing only maxPerKind items', () => {
    const text = formatPageInfo(facts, { maxPerKind: 1, geometry: false });
    expect(text).toContain('Links (40):');
    expect(text).toContain('- link "Home" region=navigation "Primary" state=expanded');
    expect(text).toContain('...39 more');
  });

  it('draws the landmark tree with indentation by depth', () => {
    const nested: PageFacts = {
      ...facts,
      landmarks: [
        { role: 'main', label: '', depth: 0 },
        { role: 'region', label: 'News', depth: 1 },
      ],
    };
    expect(formatPageInfo(nested, { maxPerKind: 5, geometry: false })).toContain(
      'Landmarks:\n  main\n    region "News"',
    );
  });
});
