// WCAG 2.x contrast math. Pure: the page reports computed colors, this module decides pass or fail.

export type Rgba = [number, number, number, number];

const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i;

/** Parses the computed-style form `rgb(r, g, b)` or `rgba(r, g, b, a)`. Other forms return null. */
export function parseCssColor(value: string): Rgba | null {
  const match = RGB_PATTERN.exec(value.trim());
  if (!match) return null;
  const alphaRaw = match[4];
  const alpha =
    alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Math.min(1, Math.max(0, alpha))];
}

/** Composites a translucent foreground over an opaque background. */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * channelLuminance(color[0]) + 0.7152 * channelLuminance(color[1]) + 0.0722 * channelLuminance(color[2])
  );
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG large text: 24px or more, or 18.66px (14pt) bold. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export interface ContrastSample {
  text: string;
  fg: Rgba;
  bg: Rgba;
  fontSizePx: number;
  fontWeight: number;
}

export interface ContrastFinding {
  text: string;
  ratio: number;
  required: number;
  large: boolean;
}

/** AA minimum: 4.5:1 for normal text, 3:1 for large text. Returns only the samples that fail. */
export function auditContrastSamples(samples: ContrastSample[]): { checked: number; failures: ContrastFinding[] } {
  const failures: ContrastFinding[] = [];
  for (const sample of samples) {
    const large = isLargeText(sample.fontSizePx, sample.fontWeight);
    const required = large ? 3 : 4.5;
    const ratio = contrastRatio(compositeOver(sample.fg, sample.bg), sample.bg);
    if (ratio < required) failures.push({ text: sample.text, ratio, required, large });
  }
  return { checked: samples.length, failures };
}
