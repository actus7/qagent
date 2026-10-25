import { describe, expect, it } from 'vitest';
import { actionErrorForPrompt, wrapUntrustedContent } from '../utils';

describe('actionErrorForPrompt', () => {
  it('keeps only the last line of a plain error', () => {
    expect(actionErrorForPrompt('at frame 1\nat frame 2\nElement not found')).toBe('Element not found');
  });

  it('keeps a wrapped untrusted error whole so the message survives', () => {
    const error = `Action failed: ${wrapUntrustedContent('covered by div#banner')}`;
    const text = actionErrorForPrompt(error);
    expect(text).toContain('covered by div#banner');
    expect(text).toContain('<nano_untrusted_content>');
  });
});
