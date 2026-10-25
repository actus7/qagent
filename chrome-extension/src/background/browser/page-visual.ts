// Theme and contrast reads. The in-page functions are serialized into the page, so they reference nothing outside.
import { type ContrastSample, compositeOver, parseCssColor, type Rgba } from './contrast';

export const CONTRAST_SCAN_LIMIT = 5000;
export const THEME_VARIABLE_LIMIT = 40;
const WHITE: Rgba = [255, 255, 255, 1];

export interface ThemeReport {
  colorScheme: string;
  prefersDark: boolean;
  bodyColor: string;
  bodyBackground: string;
  fontFamily: string;
  fontSize: string;
  themeColor: string | null;
  customProperties: Array<{ name: string; value: string }>;
}

export interface ContrastSampleRaw {
  text: string;
  fg: string;
  /** Computed background colors from the element up to the root; transparent layers are left out. */
  bgLayers: string[];
  fontSizePx: number;
  fontWeight: number;
}

/** Reads the page's theme facts. Self-contained: runs in the page. */
export function readThemeInPage(variableLimit: number): ThemeReport {
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body ?? document.documentElement);
  const customProperties: Array<{ name: string; value: string }> = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet: its rules are not readable
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ':root') continue;
      for (const name of Array.from(rule.style)) {
        if (!name.startsWith('--') || customProperties.length >= variableLimit) continue;
        customProperties.push({ name, value: rule.style.getPropertyValue(name).trim() });
      }
    }
  }
  return {
    colorScheme: rootStyle.colorScheme,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    bodyColor: bodyStyle.color,
    bodyBackground: bodyStyle.backgroundColor,
    fontFamily: bodyStyle.fontFamily,
    fontSize: bodyStyle.fontSize,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    customProperties,
  };
}

/** Collects visible text elements with their computed colors. Self-contained: runs in the page. */
export function collectContrastSamplesInPage(maxSamples: number, scanLimit: number): ContrastSampleRaw[] {
  const samples: ContrastSampleRaw[] = [];
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_ELEMENT);
  let scanned = 0;
  let node: Node | null = walker.currentNode;
  while (node && samples.length < maxSamples && scanned < scanLimit) {
    scanned += 1;
    const element = node as HTMLElement;
    const text = Array.from(element.childNodes)
      .filter(child => child.nodeType === Node.TEXT_NODE)
      .map(child => child.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const style = getComputedStyle(element);
    const visible =
      text.length > 0 &&
      element.getClientRects().length > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0;
    if (visible) {
      const bgLayers: string[] = [];
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor;
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') bgLayers.push(color);
      }
      samples.push({
        text: text.slice(0, 80),
        fg: style.color,
        bgLayers,
        fontSizePx: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
      });
    }
    node = walker.nextNode();
  }
  return samples;
}

/** Composites the background layers (nearest first) over white, the default when nothing paints one. */
export function backgroundFromLayers(layers: string[]): Rgba {
  let base: Rgba = WHITE;
  for (const layer of [...layers].reverse()) {
    const color = parseCssColor(layer);
    if (color) base = compositeOver(color, base);
  }
  return base;
}

/** Turns raw page samples into contrast samples. Samples whose colors cannot be parsed are dropped. */
export function toContrastSamples(raw: ContrastSampleRaw[]): ContrastSample[] {
  const samples: ContrastSample[] = [];
  for (const item of raw) {
    const fg = parseCssColor(item.fg);
    if (!fg) continue;
    samples.push({
      text: item.text,
      fg,
      bg: backgroundFromLayers(item.bgLayers),
      fontSizePx: item.fontSizePx,
      fontWeight: item.fontWeight,
    });
  }
  return samples;
}

/** Model-facing text for the theme report. Page strings stay inside the report, so the caller wraps the result. */
export function formatTheme(theme: ThemeReport): string {
  const lines = [
    `color-scheme: ${theme.colorScheme || 'normal'}`,
    `prefers dark: ${theme.prefersDark ? 'yes' : 'no'}`,
    `body color: ${theme.bodyColor}`,
    `body background: ${theme.bodyBackground}`,
    `font: ${theme.fontFamily} ${theme.fontSize}`,
    `theme-color: ${theme.themeColor ?? 'none'}`,
  ];
  if (theme.customProperties.length > 0) {
    lines.push('root custom properties:');
    lines.push(...theme.customProperties.map(item => `  ${item.name}: ${item.value}`));
  }
  return lines.join('\n');
}
