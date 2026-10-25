import { describe, expect, it } from 'vitest';
import { resolveBrowserEngine } from '../engineSelection';

describe('resolveBrowserEngine', () => {
  it('keeps chrome.debugger on Chromium by default', () => {
    expect(resolveBrowserEngine({ requested: undefined, hasDebugger: true })).toBe('chrome-debugger');
  });

  it('falls back to the content-script engine when chrome.debugger is missing (Firefox)', () => {
    expect(resolveBrowserEngine({ requested: undefined, hasDebugger: false })).toBe('content-script');
  });

  it('honours the explicit agent-browser opt-in on any browser', () => {
    expect(resolveBrowserEngine({ requested: 'agent-browser', hasDebugger: true })).toBe('agent-browser');
    expect(resolveBrowserEngine({ requested: 'agent-browser', hasDebugger: false })).toBe('agent-browser');
  });

  it('ignores unknown requested values', () => {
    expect(resolveBrowserEngine({ requested: 'chrome-debugger', hasDebugger: false })).toBe('content-script');
  });
});
