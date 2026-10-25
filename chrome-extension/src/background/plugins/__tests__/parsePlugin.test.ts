import { describe, expect, it } from 'vitest';
import { parsePlugin, PluginValidationError } from '@extension/storage';

const validTool = {
  name: 'extract_prices',
  description: 'Extract prices',
  parameters: { currency: { type: 'string', required: false, description: 'ISO code' } },
  code: 'return [...document.querySelectorAll(".price")].map(el => el.textContent);',
};

const validPlugin = {
  name: 'Price tools',
  description: 'Extract prices from shops',
  matches: ['*.shop.test'],
  instructions: 'Prices appear in .price elements.',
  tools: [validTool],
};

describe('parsePlugin', () => {
  it('returns the normalized plugin with defaults for optional fields', () => {
    const parsed = parsePlugin({ name: '  Price tools  ', tools: [{ ...validTool, parameters: undefined }] });
    expect(parsed).toEqual({
      name: 'Price tools',
      description: '',
      version: '1.0.0',
      enabled: true,
      matches: [],
      instructions: '',
      tools: [{ ...validTool, parameters: {} }],
    });
  });

  it('keeps an id when it is a safe identifier', () => {
    expect(parsePlugin({ ...validPlugin, id: 'price-tools_1' }).id).toBe('price-tools_1');
  });

  it('accepts a complete plugin', () => {
    const parsed = parsePlugin(validPlugin);
    expect(parsed.matches).toEqual(['*.shop.test']);
    expect(parsed.tools[0].parameters.currency).toEqual({
      type: 'string',
      required: false,
      description: 'ISO code',
    });
  });

  it.each([
    ['a missing name', { ...validPlugin, name: '' }, /name is required/],
    ['a non-object input', 'plugin', /plugin must be an object/],
    ['an id with spaces', { ...validPlugin, id: 'bad id' }, /id may only contain/],
    ['a camelCase tool name', { ...validPlugin, tools: [{ ...validTool, name: 'extractPrices' }] }, /snake_case/],
    ['duplicate tool names', { ...validPlugin, tools: [validTool, { ...validTool }] }, /tool names must be unique/],
    [
      'an unknown parameter type',
      {
        ...validPlugin,
        tools: [{ ...validTool, parameters: { x: { type: 'object' } } }],
      },
      /must have type string, number or boolean/,
    ],
    [
      'a parameter name that is not an identifier',
      { ...validPlugin, tools: [{ ...validTool, parameters: { 'bad-name': { type: 'string' } } }] },
      /must be a plain identifier/,
    ],
    ['empty tool code', { ...validPlugin, tools: [{ ...validTool, code: '   ' }] }, /code of tool .* is required/],
    ['code over the size cap', { ...validPlugin, tools: [{ ...validTool, code: 'x'.repeat(10001) }] }, /at most 10000/],
    [
      'too many tools',
      { ...validPlugin, tools: Array.from({ length: 21 }, (_, i) => ({ ...validTool, name: `t_${i}` })) },
      /at most 20 items/,
    ],
    ['a non-boolean enabled flag', { ...validPlugin, enabled: 'yes' }, /enabled must be true or false/],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parsePlugin(raw)).toThrow(PluginValidationError);
    expect(() => parsePlugin(raw)).toThrow(message);
  });
});
