import { afterEach, describe, expect, it } from 'vitest';
import { CAPTCHA_VENDORS, inspectCaptchaFrame, matchCaptchaVendor } from '../captcha-vendors';

// A stand-in for the frame's document: querySelector answers from a fixed set of selectors.
function fixtureDocument(elements: Record<string, { checked?: boolean; aria?: string }>): void {
  (globalThis as { document?: unknown }).document = {
    querySelector: (selector: string) => {
      const found = elements[selector];
      if (!found) return null;
      return {
        checked: found.checked ?? false,
        getAttribute: (name: string) => (name === 'aria-checked' ? (found.aria ?? null) : null),
      };
    },
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('matchCaptchaVendor', () => {
  it('matches the reCAPTCHA anchor frame', () => {
    const spec = matchCaptchaVendor('https://www.google.com/recaptcha/api2/anchor?ar=1&k=abc');
    expect(spec?.vendor).toBe('recaptcha');
  });

  it('matches hCaptcha and Turnstile widget frames', () => {
    expect(matchCaptchaVendor('https://newassets.hcaptcha.com/captcha/v1/x/frame.html')?.vendor).toBe('hcaptcha');
    expect(
      matchCaptchaVendor('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/x')?.vendor,
    ).toBe('turnstile');
  });

  it('ignores frames from other sites, including look-alike hosts', () => {
    expect(matchCaptchaVendor('https://example.com/recaptcha/api2/anchor')).toBeNull();
    expect(matchCaptchaVendor('https://www.google.com.evil.test/recaptcha/api2/anchor')).toBeNull();
  });

  it('has a challenge frame only for reCAPTCHA', () => {
    const withChallenge = CAPTCHA_VENDORS.filter(spec => spec.challengeFrameUrl).map(spec => spec.vendor);
    expect(withChallenge).toEqual(['recaptcha']);
  });
});

describe('inspectCaptchaFrame', () => {
  it('reports an unchecked reCAPTCHA checkbox in a fixture document', () => {
    fixtureDocument({ '#recaptcha-anchor': { aria: 'false' } });
    expect(inspectCaptchaFrame('#recaptcha-anchor')).toEqual({ checkbox: true, checked: false });
  });

  it('reports a checked checkbox through aria-checked', () => {
    fixtureDocument({ '#recaptcha-anchor': { aria: 'true' } });
    expect(inspectCaptchaFrame('#recaptcha-anchor')).toEqual({ checkbox: true, checked: true });
  });

  it('reports a missing checkbox as absent', () => {
    fixtureDocument({});
    expect(inspectCaptchaFrame('#checkbox')).toEqual({ checkbox: false, checked: false });
  });
});
