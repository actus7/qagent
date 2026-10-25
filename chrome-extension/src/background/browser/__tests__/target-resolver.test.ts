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
