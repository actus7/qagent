import { describe, expect, it } from 'vitest';
import { isOverlayReceiverMissingError } from '../overlay/overlayMessaging';

const MISSING_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

describe('isOverlayReceiverMissingError', () => {
  it('detects the missing receiver error from an Error instance', () => {
    expect(isOverlayReceiverMissingError(new Error(MISSING_RECEIVER))).toBe(true);
  });

  it('detects the missing receiver error from a plain string or message-like object', () => {
    expect(isOverlayReceiverMissingError(MISSING_RECEIVER)).toBe(true);
    expect(isOverlayReceiverMissingError({ message: MISSING_RECEIVER })).toBe(true);
  });

  it('ignores unrelated errors and empty values', () => {
    expect(isOverlayReceiverMissingError(new Error('Tab was closed'))).toBe(false);
    expect(isOverlayReceiverMissingError({ message: 42 })).toBe(false);
    expect(isOverlayReceiverMissingError(undefined)).toBe(false);
  });
});
