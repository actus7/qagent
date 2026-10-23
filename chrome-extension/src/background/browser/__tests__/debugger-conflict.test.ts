import { describe, expect, it } from 'vitest';
import { isDebuggerConflictError } from '../debugger-conflict';

describe('isDebuggerConflictError', () => {
  it('recognises Chrome refusing to attach because another debugger owns the tab', () => {
    expect(isDebuggerConflictError(new Error('Another debugger is already attached to the tab with id: 12.'))).toBe(
      true,
    );
    expect(isDebuggerConflictError('Another debugger is already attached')).toBe(true);
  });

  it('does not treat unrelated attach failures as a conflict', () => {
    expect(isDebuggerConflictError(new Error('Cannot access a chrome:// URL'))).toBe(false);
    expect(isDebuggerConflictError(undefined)).toBe(false);
  });
});
