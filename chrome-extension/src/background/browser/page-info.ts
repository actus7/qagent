// Compact structural summary of the page for the model: landmarks, headings and per-kind inventory.
// collectPageFacts runs in the page and returns raw facts; formatPageInfo turns them into text in Node.

import { ariaStateFlags, formatAriaState, type AttributeBag } from './dom/aria-state';

export const PAGE_INFO_MAX_HEADINGS = 60;

type InventoryKind = 'links' | 'buttons' | 'fields' | 'forms';

interface InventoryItem {
  label: string;
  role: string;
  tag: string;
  region: string;
  /** Native and ARIA attributes that carry state; reduced to flags by ariaStateFlags. */
  attributes: AttributeBag;
  box?: { x: number; y: number; width: number; height: number };
}

interface LandmarkFact {
  role: string;
  label: string;
  depth: number;
}

interface HeadingFact {
  level: number;
  text: string;
}

export interface PageFacts {
  url: string;
  title: string;
  description: string;
  landmarks: LandmarkFact[];
  headings: { total: number; items: HeadingFact[] };
  inventory: Record<InventoryKind, { total: number; items: InventoryItem[] }>;
}

export interface PageInfoOptions {
  maxPerKind: number;
  geometry: boolean;
}

const KIND_TITLES: Record<InventoryKind, string> = {
  links: 'Links',
  buttons: 'Buttons',
  fields: 'Fields',
  forms: 'Forms',
};

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatItem(item: InventoryItem, geometry: boolean): string {
  const parts = [item.role];
  if (item.label) parts.push(JSON.stringify(clip(item.label, 80)));
  if (item.region) parts.push(`region=${item.region}`);
  const state = formatAriaState(ariaStateFlags(item.attributes, item.tag));
  if (state) parts.push(state);
  if (geometry && item.box) {
    const { x, y, width, height } = item.box;
    parts.push(`@${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)}`);
  }
  return `- ${parts.join(' ')}`;
}

function formatLandmarks(landmarks: LandmarkFact[]): string[] {
  if (landmarks.length === 0) return ['Landmarks: none'];
  const lines = ['Landmarks:'];
  for (const landmark of landmarks) {
    const label = landmark.label ? ` ${JSON.stringify(clip(landmark.label, 60))}` : '';
    lines.push(`${'  '.repeat(landmark.depth + 1)}${landmark.role}${label}`);
  }
  return lines;
}

/** Plain text for the model. Each kind is capped at maxPerKind, and the header keeps the true total. */
export function formatPageInfo(facts: PageFacts, options: PageInfoOptions): string {
  const lines: string[] = [`URL: ${facts.url}`, `Title: ${facts.title}`];
  if (facts.description) lines.push(`Description: ${clip(facts.description, 200)}`);
  lines.push(...formatLandmarks(facts.landmarks));

  const headingItems = facts.headings.items.slice(0, options.maxPerKind);
  lines.push(`Headings (${facts.headings.total}):`);
  for (const heading of headingItems) {
    lines.push(
      `${'  '.repeat(Math.max(0, heading.level - 1))}h${heading.level} ${JSON.stringify(clip(heading.text, 80))}`,
    );
  }
  if (facts.headings.total > headingItems.length) lines.push(`  ...${facts.headings.total - headingItems.length} more`);

  for (const kind of Object.keys(KIND_TITLES) as InventoryKind[]) {
    const { total, items } = facts.inventory[kind];
    lines.push(`${KIND_TITLES[kind]} (${total}):`);
    for (const item of items.slice(0, options.maxPerKind)) lines.push(formatItem(item, options.geometry));
    if (total > Math.min(items.length, options.maxPerKind)) {
      lines.push(`  ...${total - Math.min(items.length, options.maxPerKind)} more`);
    }
  }
  return lines.join('\n');
}

/**
 * Page-side collector. Passed to page.evaluate, so it must stay self-contained.
 * Gathers at most `limit` items per kind but counts every visible one.
 */
export function collectPageFacts(limit: number, geometry: boolean, headingLimit: number): PageFacts {
  const STATE_ATTRIBUTES = [
    'disabled',
    'required',
    'checked',
    'readonly',
    'aria-disabled',
    'aria-checked',
    'aria-pressed',
    'aria-expanded',
    'aria-selected',
    'aria-current',
    'aria-required',
    'aria-invalid',
    'aria-busy',
  ];
  const LANDMARK_ROLES = ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search', 'form', 'region'];
  const TAG_ROLE: Record<string, string> = {
    nav: 'navigation',
    main: 'main',
    footer: 'contentinfo',
    aside: 'complementary',
  };
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const labelledBy = (el: Element): string => {
    const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    return ids
      .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  };
  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
    if (explicit) return explicit.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'form') return 'form';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type;
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    return tag;
  };
  const attributesOf = (el: Element): AttributeBag => {
    const bag: AttributeBag = {};
    for (const name of STATE_ATTRIBUTES) {
      if (el.hasAttribute(name)) bag[name] = el.getAttribute(name) ?? '';
    }
    return bag;
  };

  // Landmarks: document order, depth = number of landmark ancestors.
  const landmarkRole = (el: Element): string | undefined => {
    const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase();
    if (explicit && LANDMARK_ROLES.includes(explicit)) return explicit;
    const tag = el.tagName.toLowerCase();
    if (TAG_ROLE[tag]) return TAG_ROLE[tag];
    if (tag === 'header' && !el.closest('article, section, main, aside, nav')) return 'banner';
    if (tag === 'section' && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) return 'region';
    if (tag === 'form' && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) return 'form';
    return undefined;
  };
  const landmarkElements = new Map<Element, { role: string; label: string }>();
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    const role = landmarkRole(el);
    if (role) {
      landmarkElements.set(el, { role, label: el.getAttribute('aria-label')?.trim() || labelledBy(el) });
    }
  }
  const regionOf = (el: Element): string => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const landmark = landmarkElements.get(node);
      if (landmark) return landmark.label ? `${landmark.role} "${landmark.label}"` : landmark.role;
    }
    return '';
  };
  const landmarks: LandmarkFact[] = [];
  for (const [el, landmark] of landmarkElements) {
    let depth = 0;
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (landmarkElements.has(node)) depth += 1;
    }
    landmarks.push({ role: landmark.role, label: landmark.label, depth });
  }

  // Headings.
  const headingElements = Array.from(
    document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]'),
  ).filter(isVisible);
  const headingItems: HeadingFact[] = headingElements.slice(0, headingLimit).map(el => {
    const tagLevel = /^H([1-6])$/.exec(el.tagName);
    const ariaLevel = Number.parseInt(el.getAttribute('aria-level') ?? '', 10);
    return {
      level: tagLevel ? Number(tagLevel[1]) : Number.isFinite(ariaLevel) ? ariaLevel : 2,
      text: textOf(el),
    };
  });

  // Inventory of visible interactive elements per kind.
  const selectors: Record<InventoryKind, string> = {
    links: 'a[href], [role="link"]',
    buttons:
      'button, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], [role="button"]',
    fields:
      'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), textarea, select, [role="textbox"], [role="combobox"], [role="searchbox"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"]',
    forms: 'form',
  };
  const labelOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label')?.trim();
    if (aria) return aria;
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value.trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return el.labels?.[0]?.textContent?.trim() || el.getAttribute('placeholder') || el.name || '';
    }
    if (el instanceof HTMLFormElement) return el.id || el.getAttribute('name') || '';
    const text = textOf(el);
    if (text) return text;
    const img = el.querySelector('img[alt]');
    return img?.getAttribute('alt')?.trim() || el.getAttribute('title')?.trim() || '';
  };
  const boxOf = (el: Element) => {
    if (!geometry) return undefined;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const inventory = {} as PageFacts['inventory'];
  for (const kind of ['links', 'buttons', 'fields', 'forms'] as InventoryKind[]) {
    const matches = Array.from(document.querySelectorAll(selectors[kind])).filter(
      el => kind === 'forms' || isVisible(el),
    );
    inventory[kind] = {
      total: matches.length,
      items: matches.slice(0, limit).map(el => ({
        label: labelOf(el),
        role: roleOf(el),
        tag: el.tagName.toLowerCase(),
        region: regionOf(el),
        attributes: attributesOf(el),
        box: boxOf(el),
      })),
    };
  }

  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  return {
    url: location.href,
    title: document.title,
    description,
    landmarks,
    headings: { total: headingElements.length, items: headingItems },
    inventory,
  };
}
