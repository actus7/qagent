import { describe, expect, it } from 'vitest';
import { auditContrastSamples, contrastRatio, isLargeText, parseCssColor, type ContrastSample } from '../contrast';

const BLACK = [0, 0, 0, 1] as const;
const WHITE = [255, 255, 255, 1] as const;

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio([...BLACK], [...WHITE])).toBeCloseTo(21, 5);
  });

  it('is 1:1 for identical colors', () => {
    expect(contrastRatio([119, 119, 119, 1], [119, 119, 119, 1])).toBeCloseTo(1, 5);
  });
});

describe('parseCssColor', () => {
  it('reads computed rgb and rgba strings', () => {
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual([10, 20, 30, 1]);
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 0.5]);
  });

  it('returns null for color forms it does not read', () => {
    expect(parseCssColor('oklch(0.5 0.2 240)')).toBeNull();
  });
});

describe('isLargeText', () => {
  it('treats 24px text as large, and bold 18.66px as large', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 400)).toBe(false);
  });
});

describe('auditContrastSamples', () => {
  const sample = (overrides: Partial<ContrastSample>): ContrastSample => ({
    text: 'Sample',
    fg: [...BLACK],
    bg: [...WHITE],
    fontSizePx: 16,
    fontWeight: 400,
    ...overrides,
  });

  it('reports only the text below the AA minimum', () => {
    const grey = sample({ text: 'Faint', fg: [170, 170, 170, 1] });
    const audit = auditContrastSamples([sample({ text: 'Strong' }), grey]);
    expect(audit.checked).toBe(2);
    expect(audit.failures.map(item => item.text)).toEqual(['Faint']);
  });

  it('uses the 3:1 minimum for large text', () => {
    // about 3.7:1: fails normal text (4.5) but passes large text (3)
    const grey = [140, 140, 140, 1] as const;
    const normal = auditContrastSamples([sample({ fg: [...grey] })]);
    const large = auditContrastSamples([sample({ fg: [...grey], fontSizePx: 32 })]);
    expect(normal.failures).toHaveLength(1);
    expect(normal.failures[0].required).toBe(4.5);
    expect(large.failures).toHaveLength(0);
  });

  it('composites a translucent foreground before measuring', () => {
    // 50% black over white is mid grey, which fails normal text
    const audit = auditContrastSamples([sample({ fg: [0, 0, 0, 0.5] })]);
    expect(audit.failures).toHaveLength(1);
  });
});
