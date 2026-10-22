import { describe, expect, it, vi } from 'vitest';
vi.mock('webextension-polyfill', () => ({}));
import { parseKeyCombination, convertKey } from '../page-keys';
import { parseSelectorIndex, build_initial_state } from '../page-state';

describe('parseKeyCombination', () => {
  it('splits modifiers from the main key', () => {
    expect(parseKeyCombination('Control+Shift+ArrowLeft')).toEqual({
      modifiers: ['Control', 'Shift'],
      mainKey: 'ArrowLeft',
    });
  });

  it('returns no modifiers for a single key', () => {
    expect(parseKeyCombination('Enter')).toEqual({ modifiers: [], mainKey: 'Enter' });
  });
});

describe('convertKey', () => {
  it('maps named keys case-insensitively to puppeteer key codes', () => {
    expect(convertKey('ArrowLeft', false)).toBe('ArrowLeft');
    expect(convertKey('a', false)).toBe('KeyA');
    expect(convertKey('7', false)).toBe('Digit7');
    expect(convertKey('CONTROL', false)).toBe('Control');
  });

  it('passes unknown keys through unchanged', () => {
    expect(convertKey('F5', false)).toBe('F5');
  });

  it('maps control/cmd/option to Meta/Alt only on Mac', () => {
    expect(convertKey('ctrl', true)).toBe('Meta');
    expect(convertKey('cmd', true)).toBe('Meta');
    expect(convertKey('opt', true)).toBe('Alt');
    expect(convertKey('ctrl', false)).toBe('ctrl');
  });
});

describe('parseSelectorIndex', () => {
  it('parses @eN refs, case-insensitively', () => {
    expect(parseSelectorIndex('@e12')).toBe(12);
    expect(parseSelectorIndex('  @E3 ')).toBe(3);
  });

  it('parses legacy [N] selectors', () => {
    expect(parseSelectorIndex('[7]')).toBe(7);
  });

  it('returns null for CSS or xpath selectors', () => {
    expect(parseSelectorIndex('#submit')).toBeNull();
    expect(parseSelectorIndex('xpath=//button')).toBeNull();
    expect(parseSelectorIndex('@e')).toBeNull();
  });
});

describe('build_initial_state', () => {
  it('uses empty defaults when no arguments are given', () => {
    const state = build_initial_state();
    expect(state.tabId).toBe(0);
    expect(state.url).toBe('');
    expect(state.title).toBe('');
    expect(state.selectorMap.size).toBe(0);
    expect(state.screenshot).toBeNull();
  });
});
