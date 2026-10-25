import { describe, expect, it } from 'vitest';
import { EMPTY_MANAGED_POLICY, isManagedProviderAllowed, parseManagedPolicy, type ManagedPolicy } from '@extension/shared';

const policy = (overrides: Partial<ManagedPolicy>): ManagedPolicy => ({ ...EMPTY_MANAGED_POLICY, ...overrides });

describe('enforcement decisions', () => {
  it('matches providers by id or type and refuses others when a list is set', () => {
    const rules = policy({ allowedProviders: ['anthropic', 'ollama'] });
    expect(isManagedProviderAllowed({ id: 'my-claude', type: 'Anthropic' }, rules)).toBe(true);
    expect(isManagedProviderAllowed({ id: 'ollama', type: 'custom_openai' }, rules)).toBe(true);
    expect(isManagedProviderAllowed({ id: 'openai', type: 'openai' }, rules)).toBe(false);
    expect(isManagedProviderAllowed({ id: 'openai' }, EMPTY_MANAGED_POLICY)).toBe(true);
  });
});

describe('parseManagedPolicy', () => {
  it('treats unmanaged or malformed storage as no restrictions', () => {
    expect(parseManagedPolicy(undefined)).toEqual(EMPTY_MANAGED_POLICY);
    expect(parseManagedPolicy('oops')).toEqual(EMPTY_MANAGED_POLICY);
  });

  it('ignores wrongly typed values and the removed URL/action keys', () => {
    const parsed = parseManagedPolicy({
      blockedUrlPatterns: ['bank.example.com'],
      disableFileUpload: true,
      allowedProviders: ['OpenAI', 42, '  '],
    });
    expect(parsed).toEqual({ allowedProviders: ['openai'] });
  });
});
