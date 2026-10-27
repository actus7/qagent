// Known captcha widgets. Frames are matched by URL; the checkbox selector is what a human would click.
// Selectors and frame URLs come from the vendors' public embed code; they change, so a miss is reported, not guessed.

export type CaptchaVendor = 'recaptcha' | 'hcaptcha' | 'turnstile';

interface CaptchaVendorSpec {
  vendor: CaptchaVendor;
  /** Matches the widget frame URL. */
  frameUrl: RegExp;
  /** The checkbox inside the widget frame. */
  checkboxSelector: string;
  /** Frame that holds the image challenge, when the vendor shows one in its own frame. */
  challengeFrameUrl?: RegExp;
}

export const CAPTCHA_VENDORS: readonly CaptchaVendorSpec[] = [
  {
    vendor: 'recaptcha',
    frameUrl: /^https:\/\/www\.google\.com\/recaptcha\/(api2|enterprise)\/anchor/,
    checkboxSelector: '#recaptcha-anchor',
    challengeFrameUrl: /^https:\/\/www\.google\.com\/recaptcha\/(api2|enterprise)\/bframe/,
  },
  {
    vendor: 'hcaptcha',
    frameUrl: /^https:\/\/(newassets\.)?hcaptcha\.com\/captcha/,
    checkboxSelector: '#checkbox',
  },
  {
    vendor: 'turnstile',
    frameUrl: /^https:\/\/challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform/,
    checkboxSelector: 'input[type="checkbox"]',
  },
];

export function matchCaptchaVendor(frameUrl: string): CaptchaVendorSpec | null {
  return CAPTCHA_VENDORS.find(spec => spec.frameUrl.test(frameUrl)) ?? null;
}

/** Raw facts read inside a frame. Self-contained: it is serialized and run in the page's main world. */
export function inspectCaptchaFrame(checkboxSelector: string): { checkbox: boolean; checked: boolean } {
  const box = document.querySelector(checkboxSelector) as (HTMLInputElement & Element) | null;
  if (!box) return { checkbox: false, checked: false };
  return { checkbox: true, checked: box.checked === true || box.getAttribute('aria-checked') === 'true' };
}
