import { describe, expect, it } from 'vitest';
import { isTargetStateSatisfied, matchTargetIndexes, pickTargetIndex, type TargetCandidate } from '../target-resolver';

// A small document: 0 = <div class="card">, 1 = <button>Save</button> inside it, 2 = <button>Cancel</button>.
const card: TargetCandidate = { tag: 'div', text: 'Save Cancel', visible: true, ancestors: [] };
const save: TargetCandidate = { tag: 'button', role: 'button', text: 'Save', visible: true, ancestors: [0] };
const cancel: TargetCandidate = { tag: 'button', role: 'button', text: 'Cancel', visible: true, ancestors: [0] };

describe('matchTargetIndexes', () => {
  it('matches by text, case-insensitively', () => {
    expect(matchTargetIndexes([card, save, cancel], { text: 'cancel' })).toEqual([2]);
  });

  it('keeps the innermost match when an outer element also contains the text', () => {
    // The card contains "Save", but the button is the element to act on.
    expect(matchTargetIndexes([card, save, cancel], { text: 'Save' })).toEqual([1]);
  });

  it('narrows by role or tag', () => {
    const link: TargetCandidate = { tag: 'a', role: 'link', text: 'Save', visible: true, ancestors: [] };
    const linkCard = { ...link, ancestors: [] as number[] };
    expect(matchTargetIndexes([card, save, linkCard], { text: 'save', role: 'link' })).toEqual([2]);
    expect(matchTargetIndexes([card, save, linkCard], { role: 'button' })).toEqual([1]);
  });

  it('skips hidden candidates unless asked to include them', () => {
    const hidden: TargetCandidate = { ...save, visible: false };
    expect(matchTargetIndexes([card, hidden], { text: 'Save' })).toEqual([0]);
    expect(matchTargetIndexes([card, hidden], { text: 'Save' }, { includeHidden: true })).toEqual([1]);
  });
});

describe('matchTargetIndexes ranking', () => {
  // A Neon-like sidebar: links in document order, plus a navigation container that holds all of them.
  const nav: TargetCandidate = { tag: 'nav', role: 'navigation', text: 'Tables SQL Editor Roles Databases', visible: true, ancestors: [] };
  const tables: TargetCandidate = { tag: 'a', role: 'link', text: 'Tables', visible: true, ancestors: [0] };
  const sqlEditor: TargetCandidate = { tag: 'a', role: 'link', text: 'SQL Editor', visible: true, ancestors: [0] };
  const roles: TargetCandidate = { tag: 'a', role: 'link', text: 'Roles', visible: true, ancestors: [0] };
  const databases: TargetCandidate = { tag: 'a', role: 'link', text: 'Databases', visible: true, ancestors: [0] };
  const sidebar = [nav, tables, sqlEditor, roles, databases];

  it('picks the Databases link from a sidebar that also contains the word in another link', () => {
    expect(pickTargetIndex(sidebar, { text: 'Databases', role: 'link' })).toBe(4);
    expect(matchTargetIndexes(sidebar, { text: 'Databases' })).toEqual([4]);
  });

  it('prefers an exact text match over a link that only contains the text', () => {
    // "Tables" carries a tooltip or icon title that says "Databases", and it comes first in the document.
    const tablesWithTooltip: TargetCandidate = { ...tables, text: 'Tables Databases', ancestors: [] };
    const flat = [tablesWithTooltip, { ...databases, ancestors: [] }];
    expect(matchTargetIndexes(flat, { text: 'Databases', role: 'link' })).toEqual([1]);
    expect(pickTargetIndex(flat, { text: 'Databases', role: 'link' })).toBe(1);
  });

  it('ranks a visible exact match above a hidden duplicate when hidden candidates are included', () => {
    const collapsed: TargetCandidate = { ...databases, visible: false, ancestors: [] };
    const flat = [collapsed, { ...databases, ancestors: [] }];
    expect(matchTargetIndexes(flat, { text: 'Databases' }, { includeHidden: true })).toEqual([1]);
  });

  it('still keeps nth within the best-ranked matches, in document order', () => {
    const first: TargetCandidate = { ...databases, ancestors: [] };
    const second: TargetCandidate = { ...databases, ancestors: [] };
    expect(pickTargetIndex([first, tables, second], { text: 'Databases', nth: 1 })).toBe(2);
  });
});

describe('pickTargetIndex', () => {
  it('returns the nth match, zero-based', () => {
    const first: TargetCandidate = { tag: 'button', role: 'button', text: 'Add', visible: true, ancestors: [] };
    const second: TargetCandidate = { ...first };
    expect(pickTargetIndex([first, second], { text: 'add', nth: 1 })).toBe(1);
  });

  it('reports the candidate count when nothing matches', () => {
    expect(() => pickTargetIndex([save, cancel], { text: 'Delete' })).toThrow(
      'No element matches {"text":"Delete"} (0 candidates)',
    );
  });

  it('reports the count when nth is past the last match', () => {
    expect(() => pickTargetIndex([card, save, cancel], { role: 'button', nth: 5 })).toThrow('(2 candidates)');
  });
});

describe('isTargetStateSatisfied', () => {
  it('waits for visibility, invisibility, presence and absence separately', () => {
    expect(isTargetStateSatisfied('attached', 1, 0)).toBe(true);
    expect(isTargetStateSatisfied('visible', 1, 0)).toBe(false);
    expect(isTargetStateSatisfied('hidden', 1, 0)).toBe(true);
    expect(isTargetStateSatisfied('hidden', 0, 0)).toBe(true);
    expect(isTargetStateSatisfied('detached', 0, 0)).toBe(true);
    expect(isTargetStateSatisfied('detached', 1, 0)).toBe(false);
  });
});
