// In-page captcha reads. Self-contained: these run inside the widget frames and the top document.

interface ChallengeTileRaw {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reads the image challenge's instruction and tile boxes (reCAPTCHA layout). Self-contained. */
export function readChallengeTilesInPage(): { instruction: string; tiles: ChallengeTileRaw[] } {
  const tiles = Array.from(document.querySelectorAll('.rc-imageselect-tile'))
    .map(element => element.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.height > 0)
    .map(rect => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }));
  const instructionEl = document.querySelector(
    '.rc-imageselect-desc-wrapper, .rc-imageselect-desc, .rc-imageselect-desc-no-selection',
  );
  const instruction = (instructionEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { instruction, tiles };
}

/** True when the top document already holds a response token from a captcha widget. Self-contained. */
export function captchaTokenInPage(): boolean {
  const fields = document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
    'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]',
  );
  return Array.from(fields).some(field => field.value.trim().length > 0);
}
