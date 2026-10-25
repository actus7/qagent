// Readable element targets ({selector, text, role, nth}) resolved against a snapshot of candidates.
// The page reports one TargetCandidate per element of the raw selector list; the functions here decide
// which candidate the target means. Keeping this pure lets it be tested without a browser.

export interface TargetSpec {
  selector?: string;
  text?: string;
  role?: string;
  nth?: number;
}

export interface TargetCandidate {
  tag: string;
  /** Explicit role attribute, or the implicit role of the tag (button, link, textbox...). */
  role?: string;
  text: string;
  visible: boolean;
  /** Indexes (into the same candidate list) of candidates that contain this one. */
  ancestors: number[];
}

export type TargetState = 'attached' | 'visible' | 'hidden' | 'detached';

/** Used when a target gives text or role but no selector. Mirrors what the snapshot lists as interactive. */
export const DEFAULT_TARGET_SELECTOR =
  'a,button,input,select,textarea,summary,label,h1,h2,h3,h4,h5,h6,[role],[tabindex],[contenteditable]';

export function describeTargetSpec(spec: TargetSpec): string {
  return JSON.stringify(spec);
}

/**
 * Candidates that satisfy role, text and (optionally) visibility, innermost first.
 * An outer match that wraps another match is dropped, so `text: "Save"` picks the button, not its wrapper.
 */
export function matchTargetIndexes(
  candidates: TargetCandidate[],
  spec: TargetSpec,
  options: { includeHidden?: boolean } = {},
): number[] {
  const wantedRole = spec.role?.trim().toLowerCase();
  const wantedText = spec.text?.trim().toLowerCase();
  const matched: number[] = [];
  candidates.forEach((candidate, index) => {
    if (!options.includeHidden && !candidate.visible) return;
    if (wantedRole && candidate.role !== wantedRole && candidate.tag !== wantedRole) return;
    if (wantedText && !candidate.text.toLowerCase().includes(wantedText)) return;
    matched.push(index);
  });
  const outer = new Set<number>();
  for (const index of matched) {
    for (const ancestor of candidates[index].ancestors) outer.add(ancestor);
  }
  return matched.filter(index => !outer.has(index));
}

/**
 * Index of the candidate the target names (its `nth` match, zero-based).
 * Throws with the candidate count so the model can tell "no match" from "fewer matches than nth".
 */
export function pickTargetIndex(candidates: TargetCandidate[], spec: TargetSpec): number {
  const matches = matchTargetIndexes(candidates, spec);
  const nth = spec.nth ?? 0;
  const picked = matches[nth];
  if (picked === undefined) {
    throw new Error(`No element matches ${describeTargetSpec(spec)} (${matches.length} candidates)`);
  }
  return picked;
}

/** Whether a wait for `state` is over, given the candidates that match at all and those that are visible. */
export function isTargetStateSatisfied(state: TargetState, matchingAll: number, matchingVisible: number): boolean {
  switch (state) {
    case 'attached':
      return matchingAll > 0;
    case 'visible':
      return matchingVisible > 0;
    case 'hidden':
      return matchingVisible === 0;
    case 'detached':
      return matchingAll === 0;
  }
}

/**
 * Page-side: one candidate per element of `selector` (or the default list), in document order.
 * Passed to page.evaluate, so it must stay self-contained (no imports, no module-level helpers).
 */
export function collectTargetCandidates(selector: string | null, defaultSelector: string): TargetCandidate[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector ?? defaultSelector));
  const indexOf = new Map<Element, number>();
  elements.forEach((element, index) => indexOf.set(element, index));
  const implicitRole = (el: HTMLElement): string | undefined => {
    const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
    if (explicit) return explicit.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : undefined;
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      return 'textbox';
    }
    return undefined;
  };
  const textOf = (el: HTMLElement): string => {
    const label = el.getAttribute('aria-label')?.trim();
    if (label) return label;
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value.trim();
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    return el.getAttribute('placeholder')?.trim() || el.getAttribute('title')?.trim() || '';
  };
  const visibleOf = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  return elements.map(el => {
    const ancestors: number[] = [];
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const index = indexOf.get(parent);
      if (index !== undefined) ancestors.push(index);
    }
    return {
      tag: el.tagName.toLowerCase(),
      role: implicitRole(el),
      text: textOf(el),
      visible: visibleOf(el),
      ancestors,
    };
  });
}
