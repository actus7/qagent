import { describe, expect, it } from 'vitest';
import { normalizeActions } from '../agents/normalize-actions';

const done = { done: { text: 'ok', success: true } };
const click = { click: { intent: 'open', selector: '@e1' } };
const identity = (value: string) => value;

// Models that send tool arguments as JSON text (MiMo, some routers) wrap or encode the action list in different ways.
describe('normalizeActions', () => {
  it('keeps a plain array of action objects', () => {
    expect(normalizeActions([click, done], identity)).toEqual([click, done]);
  });

  it('parses an action list sent as a JSON string', () => {
    expect(normalizeActions(JSON.stringify([click, done]), identity)).toEqual([click, done]);
  });

  it('parses a list that was encoded twice', () => {
    expect(normalizeActions(JSON.stringify(JSON.stringify([done])), identity)).toEqual([done]);
  });

  it('parses items that are JSON strings', () => {
    expect(normalizeActions([JSON.stringify(click), JSON.stringify(done)], identity)).toEqual([click, done]);
  });

  it('flattens items wrapped in arrays instead of reporting action "0"', () => {
    expect(normalizeActions([[click], [done]], identity)).toEqual([click, done]);
  });

  it('wraps a single action object', () => {
    expect(normalizeActions(done, identity)).toEqual([done]);
  });

  it('skips null items', () => {
    expect(normalizeActions([null, click], identity)).toEqual([click]);
  });

  it('repairs a broken JSON string with the given repair function', () => {
    const repair = (value: string) => value.replace(/,\s*]$/, ']');
    expect(normalizeActions('[{"done":{"text":"ok","success":true}},]', repair)).toEqual([done]);
  });

  it('rejects items that are not action objects', () => {
    expect(() => normalizeActions(['click'], identity)).toThrow('Invalid action output format');
    expect(() => normalizeActions('not json at all', identity)).toThrow('Invalid action output format');
    expect(() => normalizeActions([42], identity)).toThrow('Invalid action output format');
  });
});
