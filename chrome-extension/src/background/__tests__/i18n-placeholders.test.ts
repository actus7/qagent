import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageKey } from '@extension/i18n/lib/type';

describe('i18n placeholder replacement', () => {
  afterEach(() => {
    vi.doUnmock('@extension/i18n/lib/getMessageFromLocale');
    vi.resetModules();
  });

  it('replaces every repeated occurrence of $1 for string substitutions', async () => {
    vi.doMock('@extension/i18n/lib/getMessageFromLocale', () => ({
      defaultLocale: 'en',
      getMessageFromLocale: () => ({
        repeated_placeholder_key: {
          message: '$1 + $1 = $1',
        },
      }),
    }));

    const { t } = await import('@extension/i18n/lib/i18n');
    const key = 'repeated_placeholder_key' as unknown as MessageKey;

    expect(t(key, 'x')).toBe('x + x = x');
  });

  it('replaces repeated indexed placeholders for array substitutions', async () => {
    vi.doMock('@extension/i18n/lib/getMessageFromLocale', () => ({
      defaultLocale: 'en',
      getMessageFromLocale: () => ({
        repeated_multi_placeholder_key: {
          message: '$1 -> $2 -> $1',
        },
      }),
    }));

    const { t } = await import('@extension/i18n/lib/i18n');
    const key = 'repeated_multi_placeholder_key' as unknown as MessageKey;

    expect(t(key, ['A', 'B'])).toBe('A -> B -> A');
  });
});
