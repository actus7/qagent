import { describe, expect, it } from 'vitest';
import { decideAccess, isOriginAlwaysAllowed, type AccessInput } from '../permissions/permissionPolicy';
import { extractDomainsFromText, registrableDomain, registrableDomainOfUrl } from '../permissions/domainTransition';

const base: AccessInput = {
  mode: 'ask',
  sensitive: false,
  isNavigation: false,
  currentUrl: 'https://shop.example.com/cart',
  targetUrl: null,
  alwaysAllowedOrigins: [],
  plan: null,
};

describe('registrable domain', () => {
  it.each([
    ['shop.example.com', 'example.com'],
    ['example.com', 'example.com'],
    ['www.loja.com.br', 'loja.com.br'],
    ['bbc.co.uk', 'bbc.co.uk'],
    ['localhost', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
  ])('%s -> %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });

  it('returns null for non-web URLs', () => {
    expect(registrableDomainOfUrl('chrome://settings')).toBeNull();
    expect(registrableDomainOfUrl('not a url')).toBeNull();
  });

  it('extracts distinct domains from task text in order', () => {
    expect(
      extractDomainsFromText('Compare https://www.amazon.com/dp/1 with amazon.com and shop.loja.com.br/item'),
    ).toEqual(['amazon.com', 'loja.com.br']);
  });
});

describe('access decision: ask mode', () => {
  it('asks for a plain click on a site that is not always-allowed', () => {
    expect(decideAccess(base)).toEqual({ kind: 'ask', transition: null });
  });

  it('skips the prompt for non-sensitive actions on an always-allowed origin', () => {
    expect(decideAccess({ ...base, alwaysAllowedOrigins: ['https://shop.example.com'] })).toEqual({ kind: 'allow' });
  });

  it('still asks for sensitive actions on an always-allowed origin', () => {
    expect(decideAccess({ ...base, sensitive: true, alwaysAllowedOrigins: ['https://shop.example.com'] }).kind).toBe(
      'ask',
    );
  });

  it('asks when a navigation goes to a site that is not always-allowed, and reports the transition', () => {
    const decision = decideAccess({
      ...base,
      alwaysAllowedOrigins: ['https://shop.example.com'],
      isNavigation: true,
      targetUrl: 'https://pay.provider.net/checkout',
    });
    expect(decision).toEqual({ kind: 'ask', transition: { from: 'example.com', to: 'provider.net' } });
  });

  it('allows a navigation to an always-allowed destination even from another page', () => {
    expect(
      decideAccess({
        ...base,
        isNavigation: true,
        targetUrl: 'https://docs.example.org/',
        alwaysAllowedOrigins: ['https://docs.example.org'],
      }),
    ).toEqual({ kind: 'allow' });
  });

  it('does not report a transition for a navigation within the same registrable domain', () => {
    expect(decideAccess({ ...base, isNavigation: true, targetUrl: 'https://www.example.com/x' })).toEqual({
      kind: 'ask',
      transition: null,
    });
  });
});

describe('access decision: auto mode', () => {
  it('runs non-sensitive actions without asking', () => {
    expect(decideAccess({ ...base, mode: 'auto' })).toEqual({ kind: 'allow' });
  });

  it('still asks for sensitive actions', () => {
    expect(decideAccess({ ...base, mode: 'auto', sensitive: true }).kind).toBe('ask');
  });
});

describe('access decision: plan mode', () => {
  const plan = { approved: true, domains: ['example.com'] };

  it('runs non-sensitive actions on a domain covered by the approved plan', () => {
    expect(decideAccess({ ...base, mode: 'plan', plan })).toEqual({ kind: 'allow' });
  });

  it('falls back to asking for domains outside the plan', () => {
    expect(
      decideAccess({
        ...base,
        mode: 'plan',
        plan,
        isNavigation: true,
        targetUrl: 'https://other.org/page',
      }),
    ).toEqual({ kind: 'ask', transition: { from: 'example.com', to: 'other.org' } });
  });

  it('asks for everything when the plan is not approved', () => {
    expect(decideAccess({ ...base, mode: 'plan', plan: { approved: false, domains: ['example.com'] } }).kind).toBe(
      'ask',
    );
    expect(decideAccess({ ...base, mode: 'plan', plan: null }).kind).toBe('ask');
  });

  it('still asks for sensitive actions on planned domains', () => {
    expect(decideAccess({ ...base, mode: 'plan', plan, sensitive: true }).kind).toBe('ask');
  });
});

describe('origin always-allowed check', () => {
  it('matches on scheme, host and port', () => {
    expect(isOriginAlwaysAllowed('https://a.com/x', ['https://a.com'])).toBe(true);
    expect(isOriginAlwaysAllowed('http://a.com/x', ['https://a.com'])).toBe(false);
    expect(isOriginAlwaysAllowed('https://a.com:8443/', ['https://a.com'])).toBe(false);
    expect(isOriginAlwaysAllowed('chrome://newtab', ['https://a.com'])).toBe(false);
  });
});
