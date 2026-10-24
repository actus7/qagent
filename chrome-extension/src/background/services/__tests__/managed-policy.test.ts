import { describe, expect, it, beforeEach } from 'vitest';
import {
  EMPTY_MANAGED_POLICY,
  evaluateManagedUrl,
  isManagedActionAllowed,
  isManagedProviderAllowed,
  matchUrlPattern,
  parseManagedPolicy,
  type ManagedPolicy,
} from '@extension/shared';
import { isUrlAllowed } from '../../browser/util';
import { setManagedPolicy } from '../../state/managedPolicyState';

const policy = (overrides: Partial<ManagedPolicy>): ManagedPolicy => ({ ...EMPTY_MANAGED_POLICY, ...overrides });

describe('matchUrlPattern', () => {
  it('matches a host and its subdomains', () => {
    expect(matchUrlPattern('https://bank.example.com/login', 'example.com')).toBe(true);
    expect(matchUrlPattern('https://example.com/', 'example.com')).toBe(true);
    expect(matchUrlPattern('https://notexample.com/', 'example.com')).toBe(false);
  });

  it('treats *.domain the same as the domain', () => {
    expect(matchUrlPattern('https://shop.example.com/', '*.example.com')).toBe(true);
    expect(matchUrlPattern('https://example.com/', '*.example.com')).toBe(true);
  });

  it('applies glob wildcards inside host and path', () => {
    expect(matchUrlPattern('https://shop-eu.example.com/', 'shop-*.example.com')).toBe(true);
    expect(matchUrlPattern('https://shop.example.org/', 'shop-*.example.com')).toBe(false);
    expect(matchUrlPattern('https://intranet.acme.com/app/x', 'intranet.acme.com/app/*')).toBe(true);
    expect(matchUrlPattern('https://intranet.acme.com/other', 'intranet.acme.com/app/*')).toBe(false);
  });

  it('covers children of a plain path but not similar prefixes', () => {
    expect(matchUrlPattern('https://acme.com/admin', 'acme.com/admin')).toBe(true);
    expect(matchUrlPattern('https://acme.com/admin/users', 'acme.com/admin')).toBe(true);
    expect(matchUrlPattern('https://acme.com/administrator', 'acme.com/admin')).toBe(false);
  });

  it('honours an explicit scheme and ignores non-web URLs', () => {
    expect(matchUrlPattern('http://acme.com/', 'https://acme.com')).toBe(false);
    expect(matchUrlPattern('https://acme.com/', 'https://*.acme.com')).toBe(true);
    expect(matchUrlPattern('http://shop.acme.com/', 'https://*.acme.com')).toBe(false);
    expect(matchUrlPattern('https://acme.com/', 'https://acme.com')).toBe(true);
    expect(matchUrlPattern('file:///etc/hosts', '*')).toBe(false);
    expect(matchUrlPattern('https://acme.com/', '')).toBe(false);
  });
});

describe('evaluateManagedUrl', () => {
  it('allows everything without managed URL rules', () => {
    expect(evaluateManagedUrl('https://anything.test/', EMPTY_MANAGED_POLICY)).toEqual({ allowed: true });
  });

  it('blocks URLs matching a blocked pattern even when an allow list matches', () => {
    const rules = policy({ blockedUrlPatterns: ['bank.example.com'], allowedUrlPatterns: ['example.com'] });
    expect(evaluateManagedUrl('https://bank.example.com/', rules)).toEqual({
      allowed: false,
      reason: 'blocked_pattern',
    });
    expect(evaluateManagedUrl('https://www.example.com/', rules)).toEqual({ allowed: true });
  });

  it('refuses URLs outside a configured allow list', () => {
    const rules = policy({ allowedUrlPatterns: ['intranet.acme.com'] });
    expect(evaluateManagedUrl('https://news.other.org/', rules)).toEqual({
      allowed: false,
      reason: 'not_in_allowlist',
    });
    expect(evaluateManagedUrl('https://intranet.acme.com/', rules)).toEqual({ allowed: true });
  });
});

describe('enforcement decisions', () => {
  it('removes only the disabled tools from the action list', () => {
    const rules = policy({ disableJavascriptTool: true, disableFileUpload: true });
    expect(isManagedActionAllowed('execute_javascript', rules)).toBe(false);
    expect(isManagedActionAllowed('upload_file', rules)).toBe(false);
    expect(isManagedActionAllowed('click', rules)).toBe(true);
    expect(isManagedActionAllowed('execute_javascript', EMPTY_MANAGED_POLICY)).toBe(true);
  });

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

  it('ignores wrongly typed values instead of trusting them', () => {
    const parsed = parseManagedPolicy({
      blockedUrlPatterns: ['bank.example.com', 42, '  ', 'bank.example.com'],
      disableFileUpload: true,
      allowedProviders: ['OpenAI'],
    });
    expect(parsed.blockedUrlPatterns).toEqual(['bank.example.com']);
    expect(parsed.disableFileUpload).toBe(true);
    expect(parsed.allowedProviders).toEqual(['openai']);
  });
});

describe('isUrlAllowed with managed URL rules', () => {
  beforeEach(() => {
    setManagedPolicy(EMPTY_MANAGED_POLICY);
  });

  it('denies blocked patterns even when the firewall is disabled', () => {
    setManagedPolicy(policy({ blockedUrlPatterns: ['bank.example.com'] }));
    expect(isUrlAllowed('https://bank.example.com/', [], [])).toBe(false);
    expect(isUrlAllowed('https://example.com/', [], [])).toBe(true);
  });

  it('allows only allow-listed patterns when the allow list is set', () => {
    setManagedPolicy(policy({ allowedUrlPatterns: ['intranet.acme.com'] }));
    expect(isUrlAllowed('https://news.other.org/', [], [])).toBe(false);
    expect(isUrlAllowed('https://intranet.acme.com/', [], [])).toBe(true);
    expect(isUrlAllowed('about:blank', [], [])).toBe(true);
  });
});
