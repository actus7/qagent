// Finds signals that a page is busy or measurably progressing: progress bars, percent text, spinners, busy regions.

export type ProgressKind = 'progressbar' | 'progress-element' | 'percent-text' | 'spinner' | 'busy-region';

export interface ProgressSignal {
  kind: ProgressKind;
  /** Short label such as `div#upload` or `progress.bar`; not guaranteed unique. */
  label: string;
  text?: string;
  percent?: number;
}

export interface ProgressReport {
  signals: ProgressSignal[];
  /** A percent read from document.title, when the page reports progress there. */
  titlePercent?: number;
}

const PERCENT_PATTERN = /(\d{1,3}(?:\.\d+)?)\s?%/;
const DEFAULT_LIMIT = 10;

const KIND_ORDER: Record<ProgressKind, number> = {
  progressbar: 0,
  'progress-element': 1,
  'percent-text': 2,
  spinner: 3,
  'busy-region': 4,
};

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Percent from the first `NN%` in the text, or undefined. */
export function parsePercentText(text: string): number | undefined {
  const match = PERCENT_PATTERN.exec(text);
  return match ? clampPercent(Number.parseFloat(match[1])) : undefined;
}

/** Percent for an ARIA range (valuenow within valuemin..valuemax). Undefined when the range is empty or invalid. */
export function ariaRangePercent(now: number, min: number, max: number): number | undefined {
  if (!Number.isFinite(now) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return undefined;
  return clampPercent(((now - min) / (max - min)) * 100);
}

/** Strongest signals first, one per label, capped at `limit`. Percent-bearing signals rank above bare spinners. */
export function rankProgressSignals(signals: ProgressSignal[], limit: number = DEFAULT_LIMIT): ProgressSignal[] {
  const ordered = [...signals].sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    return Number(b.percent !== undefined) - Number(a.percent !== undefined);
  });
  const seen = new Set<string>();
  const unique: ProgressSignal[] = [];
  for (const signal of ordered) {
    const key = `${signal.kind}|${signal.label}|${signal.text ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(signal);
  }
  return unique.slice(0, limit);
}

export function formatProgressReport(report: ProgressReport): string {
  const lines = report.signals.map(signal => {
    const parts = [signal.kind, signal.label];
    if (signal.percent !== undefined) parts.push(`${Math.round(clampPercent(signal.percent))}%`);
    if (signal.text) parts.push(JSON.stringify(signal.text));
    return `- ${parts.join(' ')}`;
  });
  if (report.titlePercent !== undefined) lines.push(`- document.title reports ${Math.round(report.titlePercent)}%`);
  if (lines.length === 0) {
    return 'No progress signal found. The page shows nothing measurable: ask the user what completion looks like before waiting.';
  }
  return lines.join('\n');
}

/**
 * Page-side scan. Passed to page.evaluate, so it must stay self-contained.
 * Returns raw signals; ranking and formatting happen in Node.
 */
export function collectProgressSignals(maxTextChars: number): ProgressReport {
  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const labelOf = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0];
    return cls ? `${tag}.${cls}` : tag;
  };
  const clean = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, maxTextChars);
  const signals: ProgressSignal[] = [];

  for (const el of Array.from(document.querySelectorAll('[role="progressbar"]'))) {
    if (!visible(el)) continue;
    const now = Number.parseFloat(el.getAttribute('aria-valuenow') ?? '');
    const min = Number.parseFloat(el.getAttribute('aria-valuemin') ?? '0') || 0;
    const max = Number.parseFloat(el.getAttribute('aria-valuemax') ?? '100') || 100;
    const percent = Number.isFinite(now) && max > min ? ((now - min) / (max - min)) * 100 : undefined;
    signals.push({
      kind: 'progressbar',
      label: labelOf(el),
      percent,
      text: clean(el.getAttribute('aria-label') ?? '') || undefined,
    });
  }
  for (const el of Array.from(document.querySelectorAll<HTMLProgressElement>('progress, meter'))) {
    if (!visible(el) || !(el.max > 0)) continue;
    signals.push({ kind: 'progress-element', label: labelOf(el), percent: (el.value / el.max) * 100 });
  }
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  const blocks = new Set<HTMLElement>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/\d\s?%/.test(node.textContent ?? '')) continue;
    let block: HTMLElement | null = node.parentElement;
    while (block && getComputedStyle(block).display === 'inline') block = block.parentElement;
    if (block && visible(block)) blocks.add(block);
  }
  for (const el of blocks) {
    const text = clean(el.innerText ?? '');
    const match = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(text);
    signals.push({
      kind: 'percent-text',
      label: labelOf(el),
      text: text.slice(0, maxTextChars),
      percent: match ? Math.min(100, Number.parseFloat(match[1])) : undefined,
    });
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[class]'))) {
    if (!visible(el)) continue;
    const isSpinner =
      /spinner|loading|progress/i.test(el.getAttribute('class') ?? '') && getComputedStyle(el).animationName !== 'none';
    if (isSpinner) signals.push({ kind: 'spinner', label: labelOf(el) });
  }
  for (const el of Array.from(document.querySelectorAll('[aria-busy="true"]'))) {
    if (visible(el)) signals.push({ kind: 'busy-region', label: labelOf(el) });
  }

  const titleMatch = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(document.title);
  return {
    signals,
    titlePercent: titleMatch ? Math.min(100, Number.parseFloat(titleMatch[1])) : undefined,
  };
}
